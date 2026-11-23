import type { ExecutionEvent, ExecutionProvider, ExecutionSession, LocalServer, Project, RuntimeEvent, SourceFile } from "@/shared/recoder";

const EXECUTION_LIMIT_MS = 5_000;
const OUTPUT_LIMIT_BYTES = 64 * 1024;

type WorkerMessage = { type: "event"; stream: "stdout" | "stderr" | "system"; text: string } | { type: "done"; status: "completed" | "failed" };
type WebRecord = { session: ExecutionSession; worker: Worker | null };

const listeners = new Set<(event: RuntimeEvent) => void>();
const records = new Map<string, WebRecord>();
let sequence = 0;

function id(prefix: string) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function emit(session: ExecutionSession, stream: ExecutionEvent["stream"], text: string) {
  const event: ExecutionEvent = { id: session.events.length + 1, at: Date.now(), stream, text };
  session.events.push(event);
  const bytes = new TextEncoder().encode(session.events.map((item) => item.text).join("\n")).byteLength;
  if (bytes > OUTPUT_LIMIT_BYTES) {
    session.outputTruncated = true;
    while (new TextEncoder().encode(session.events.map((item) => item.text).join("\n")).byteLength > OUTPUT_LIMIT_BYTES && session.events.length > 1) session.events.shift();
  }
  const runtimeEvent: RuntimeEvent = { sessionId: session.id, id: event.id, at: event.at, stream, text, outputTruncated: session.outputTruncated };
  listeners.forEach((listener) => listener(runtimeEvent));
}

function workerSource() {
  return `
    self.onmessage = ({ data }) => {
      let stopped = false;
      const send = (stream, value) => { if (!stopped) self.postMessage({ type: "event", stream, text: String(value) }); };
      const consoleLike = {
        log: (...values) => send("stdout", values.join(" ")),
        info: (...values) => send("stdout", values.join(" ")),
        warn: (...values) => send("stderr", values.join(" ")),
        error: (...values) => send("stderr", values.join(" ")),
      };
      try {
        new Function("console", data.source)(consoleLike);
        self.postMessage({ type: "done", status: "completed" });
      } catch (error) {
        send("stderr", error && error.stack ? error.stack : error);
        self.postMessage({ type: "done", status: "failed" });
      }
    };
  `;
}

function createSession(file: SourceFile): ExecutionSession {
  return { id: id("web-run"), status: "running", startedAt: Date.now(), events: [{ id: 1, at: Date.now(), stream: "system", text: `Running ${file.name} in a disposable browser worker.` }], isolation: "simulated-disposable", resourceLimitMs: EXECUTION_LIMIT_MS, outputLimitBytes: OUTPUT_LIMIT_BYTES };
}

export function createWebProvider(): ExecutionProvider {
  return {
    async start({ file }) {
      if (typeof Worker === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") throw new Error("Browser worker execution is unavailable in this environment.");
      const session = createSession(file);
      const workerUrl = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
      const worker = new Worker(workerUrl);
      const record: WebRecord = { session, worker };
      records.set(session.id, record);
      return new Promise<ExecutionSession>((resolve) => {
        let settled = false;
        const finish = (status: "completed" | "failed" | "timed_out" | "cancelled") => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          session.status = status;
          session.finishedAt = Date.now();
          records.set(session.id, { session, worker: null });
          resolve({ ...session, events: [...session.events] });
        };
        const timeout = setTimeout(() => { emit(session, "stderr", "Execution timed out after 5 seconds."); finish("timed_out"); }, EXECUTION_LIMIT_MS);
        worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
          if (data.type === "event") emit(session, data.stream, data.text);
          else finish(data.status);
        };
        worker.onerror = (event) => { emit(session, "stderr", event.message || "Browser worker failed."); finish("failed"); };
        worker.postMessage({ source: file.content });
      });
    },
    async cancel(sessionId) {
      const record = records.get(sessionId);
      if (!record || record.session.status !== "running") return;
      record.worker?.terminate();
      record.session.status = "cancelled";
      record.session.finishedAt = Date.now();
      emit(record.session, "system", "Execution cancelled.");
      records.set(sessionId, { session: record.session, worker: null });
    },
    async get(sessionId) {
      const record = records.get(sessionId);
      if (!record) throw new Error("Execution session not found.");
      return { ...record.session, events: [...record.session.events] };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function startWebPreview(project: Project): LocalServer {
  if (typeof URL === "undefined" || typeof Blob === "undefined") throw new Error("Browser preview is unavailable in this environment.");
  const index = project.files.find((file) => file.name === "index.html")?.content ?? "<!doctype html><html><body><h1>Recoder preview</h1></body></html>";
  const main = project.files.find((file) => file.name === "main.js")?.content;
  const script = main ? `<script>\n${main.replace(/<\/script/gi, "<\\/script")}\n</script>` : "";
  const html = index.includes("</body>") ? index.replace(/<\/body>/i, `${script}</body>`) : `${index}${script}`;
  return { id: id("web-preview"), url: URL.createObjectURL(new Blob([html], { type: "text/html" })), root: project.name, startedAt: Date.now() };
}

export function stopWebPreview(server: LocalServer) {
  if (typeof URL !== "undefined") URL.revokeObjectURL(server.url);
}
