/* ============================================================
   RADARMATRIX INTEGRATION  —  the project's own source AI
   ============================================================
   RADARMatrix (github.com/remRADAR/RADARMatrix) is the cloud intelligence
   and memory layer for RADARCharts by REM. It exposes an MCP gateway with
   nine tool contracts, RBAC, workspace isolation and an audit trail.

   This module wires it in as the workbench's own source AI rather than a
   separate internal IDE: the workbench is a client of RADARMatrix, and
   RADARMatrix is the identity/intelligence layer behind it.

   Two integration surfaces are supported, both real:
     1. MCP gateway  — JSON-RPC 2.0 over HTTP (tools/list, tools/call)
     2. OpenAI-compatible adapter — /chat/completions, for chat + inline edit
   ============================================================ */
const RM = {
  base: '',            // e.g. https://matrix.example.com  (MCP gateway root)
  token: '',           // bearer token / workspace-scoped credential
  workspace: '',       // workspace id for isolation
  mode: 'mcp',         // mcp | openai
  tools: [],
  connected: false,
  lastError: '',
  health: null,
  calls: []
};
const RM_LS = 'recoder-radarmatrix-v1';

/* The nine foundation tool contracts, as published in the repository README. */
const RM_TOOL_CONTRACTS = [
  { name: 'radar.recall', role: 'viewer', write: false, desc: 'Retrieve context from the knowledge core for a workspace.' },
  { name: 'radar.search', role: 'viewer', write: false, desc: 'Full-text and semantic search across canonical data and documents.' },
  { name: 'radar.remember', role: 'contributor', write: true, desc: 'Persist a new memory/context entry with provenance.' },
  { name: 'radar.record_decision', role: 'editor', write: true, desc: 'Write an immutable decision record to the audit log.' },
  { name: 'radar.list_documents', role: 'viewer', write: false, desc: 'Enumerate documents in the workspace scope.' },
  { name: 'radar.get_document', role: 'viewer', write: false, desc: 'Fetch a single document by id.' },
  { name: 'radar.audit_trail', role: 'editor', write: false, desc: 'Read the write-operation audit trail.' },
  { name: 'radar.agent_directory', role: 'viewer', write: false, desc: 'Read-only agent directory (specialist registry).' },
  { name: 'radar.route_task', role: 'viewer', write: false, desc: 'Deterministic, plan-only task routing to a specialist.' }
];

function rmLoad() {
  try {
    const raw = localStorage.getItem(RM_LS);
    if (!raw) return;
    const o = JSON.parse(raw);
    RM.base = o.base || '';
    RM.token = o.token || '';
    RM.workspace = o.workspace || '';
    RM.mode = o.mode || 'mcp';
  } catch (e) {}
}
function rmSave() {
  try {
    localStorage.setItem(RM_LS, JSON.stringify({
      base: RM.base, token: RM.token, workspace: RM.workspace, mode: RM.mode
    }));
  } catch (e) {}
}
function rmReady() { return !!(RM.base && RM.token); }
function rmUrl(p) { return RM.base.replace(/\/+$/, '') + p; }

/* ---------- MCP JSON-RPC ---------- */
async function rmRpc(method, params) {
  const body = { jsonrpc: '2.0', id: Date.now(), method: method, params: params || {} };
  const t0 = performance.now();
  const res = await fetch(rmUrl('/mcp'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + RM.token,
      'x-radar-workspace': RM.workspace
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  const ms = Math.round(performance.now() - t0);
  RM.calls.push({ method: method, ms: ms, ok: res.ok && !data.error, at: new Date().toLocaleTimeString() });
  if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
  if (data.error) throw new Error(data.error.message || 'MCP error');
  return data.result;
}

async function rmListTools() {
  const r = await rmRpc('tools/list', {});
  RM.tools = (r && r.tools) || [];
  return RM.tools;
}

async function rmCallTool(name, args) {
  const r = await rmRpc('tools/call', { name: name, arguments: args || {} });
  return r;
}

async function rmTest() {
  const box = $('#rm-msg');
  if (!rmReady()) { if (box) box.innerHTML = '<div class="gh-err"><b>Enter the gateway URL and a token.</b></div>'; return; }
  if (box) box.innerHTML = '<div class="gh-note"><span class="gh-spin" style="display:inline-block;vertical-align:-2px"></span> Calling tools/list\u2026</div>';
  try {
    const tools = await rmListTools();
    RM.connected = true;
    RM.lastError = '';
    // also read /health so the pane can show the gateway's real state
    try {
      const hr = await fetch(rmUrl('/health'), { cache: 'no-store' });
      if (hr.ok) RM.health = await hr.json();
    } catch (e) {}
    if (box) box.innerHTML = '<div class="gh-ok"><b>Gateway reachable.</b> ' + tools.length + ' tool contract(s) advertised' +
      (tools.length ? ': ' + tools.map((t) => esc(t.name)).join(', ') : '') + '</div>';
    renderRmPane();
    toast('RADARMatrix gateway connected \u00b7 <b>' + tools.length + '</b> tools');
  } catch (e) {
    RM.connected = false;
    RM.lastError = e.message;
    if (box) box.innerHTML = '<div class="gh-err"><b>' + esc(e.message) + '</b>' +
      (/Failed to fetch|NetworkError|load failed/i.test(e.message)
        ? ' \u2014 the browser could not reach the gateway. Check the URL, CORS, and that the MCP server is running.'
        : '') + '</div>';
    renderRmPane();
  }
}

/* ---------- OpenAI-compatible adapter (chat + inline edit) ---------- */
async function rmChat(msgs, system) {
  const res = await fetch(rmUrl('/v1/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + RM.token,
      'x-radar-workspace': RM.workspace
    },
    body: JSON.stringify({
      model: 'radar-matrix',
      temperature: 0.2,
      messages: [{ role: 'system', content: system }].concat(msgs)
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
  const ch = (data.choices || [])[0];
  return ch && ch.message ? (ch.message.content || '') : '';
}

/* ---------- pane ---------- */
function renderRmPane() {
  const el = $('#rm-pane');
  if (!el) return;
  const out = [];
  out.push('<div class="gh-sec"><div class="gh-card">' +
    '<div class="gh-lbl">RADARMatrix <span class="sp"></span>' +
    '<span class="rm-badge' + (RM.connected ? ' on' : '') + '">' + (RM.connected ? 'connected' : 'not connected') + '</span></div>' +
    '<div class="gh-note" style="margin-top:0">The project\u2019s own source AI \u2014 the cloud intelligence and memory layer for RADARCharts by REM. ' +
    'The workbench is a client of it, not a separate IDE.</div>' +
    '<div class="gh-row2" style="margin-top:8px">' +
    '<button class="gh-btn sm" id="rm-open">Configure</button>' +
    '<button class="gh-btn sm" id="rm-test">Test gateway</button>' +
    '<button class="gh-btn sm" id="rm-use">' + (AI.provider === 'radarmatrix' ? 'Active AI source' : 'Use as AI source') + '</button>' +
    '</div>' +
    (RM.health ? '<div class="gh-note" style="margin-top:8px">Gateway v' + esc(RM.health.version || '?') +
      ' \u00b7 ' + (RM.health.tools || 0) + ' tools \u00b7 ' + (RM.health.workspaces || 0) + ' workspace(s) \u00b7 ' +
      (RM.health.upstream ? 'upstream model' : 'local retrieval') + '</div>' : '') +
    '</div></div>');

  out.push('<div class="gh-sec"><div class="gh-lbl">Tool contracts <span class="sp"></span><span class="rm-cnt">' +
    (RM.tools.length || RM_TOOL_CONTRACTS.length) + '</span></div>');
  const list = RM.tools.length
    ? RM.tools.map((t) => ({ name: t.name, desc: t.description || '', role: '', write: false }))
    : RM_TOOL_CONTRACTS;
  list.forEach((t) => {
    out.push('<div class="rm-tool"><span class="nm">' + esc(t.name) + '</span>' +
      (t.write ? '<span class="w">write</span>' : '') +
      (t.role ? '<span class="r">' + esc(t.role) + '</span>' : '') +
      '<div class="ds">' + esc((t.desc || '').slice(0, 120)) + '</div></div>');
  });
  out.push('</div>');

  if (RM.calls.length) {
    out.push('<div class="gh-sec"><div class="gh-lbl">Recent calls</div>');
    RM.calls.slice(-6).reverse().forEach((c) => {
      out.push('<div class="rm-call"><span class="m">' + esc(c.method) + '</span>' +
        '<span class="t">' + c.ms + 'ms</span>' +
        '<span class="s' + (c.ok ? ' on' : '') + '">' + (c.ok ? 'ok' : 'err') + '</span></div>');
    });
    out.push('</div>');
  }

  /* decision queue: commits recorded while the gateway was unreachable */
  const q = rmQueue();
  out.push('<div class="gh-sec"><div class="gh-lbl">Decision records <span class="sp"></span>' +
    '<span class="rm-cnt">' + q.length + ' queued</span></div>');
  out.push('<div class="gh-note" style="margin-top:0">Every commit pushed from Source Control is written to ' +
    '<code>radar.record_decision</code>. Records made while the gateway is unreachable are queued here and flushed when it comes back.</div>');
  if (q.length) {
    q.slice(-4).reverse().forEach((it) => {
      const d = it.decision || {};
      out.push('<div class="rm-tool"><span class="nm">' + esc((d.title || 'commit').slice(0, 46)) + '</span>' +
        '<span class="w">queued</span>' +
        '<div class="ds">' + esc((d.summary || '').slice(0, 90)) + '</div></div>');
    });
    out.push('<div class="gh-row2" style="margin-top:6px"><button class="gh-btn sm" id="rm-flush">Flush ' +
      q.length + ' to the gateway</button></div>');
  } else {
    out.push('<div class="gh-note" style="margin-top:4px;color:var(--dim2)">Nothing queued.</div>');
  }
  out.push('</div>');

  out.push('<div class="gh-sec" style="padding-bottom:14px"><div class="gh-card">' +
    '<div class="gh-lbl">Handover notes for the Matrix side</div>' +
    '<div class="gh-note" style="margin-top:0">What the Matrix team needs to expose for this client to work end to end:</div>' +
    '<ol class="rm-steps">' +
    '<li><b>MCP endpoint</b> at <code>POST /mcp</code> speaking JSON-RPC 2.0, with <code>tools/list</code> and <code>tools/call</code>.</li>' +
    '<li><b>Bearer auth</b> on every call plus a workspace header (<code>x-radar-workspace</code>) so isolation is enforced server-side.</li>' +
    '<li><b>CORS</b> allowing the workbench origin, with <code>authorization</code> and <code>x-radar-workspace</code> in <code>Access-Control-Allow-Headers</code>.</li>' +
    '<li><b>OpenAI-compatible adapter</b> at <code>POST /v1/chat/completions</code> for chat and inline edit.</li>' +
    '<li><b>Tool results</b> returned as MCP content blocks so the client can render them without special-casing.</li>' +
    '<li><b>Audit events</b> for every write tool, so the workbench can show provenance next to the change.</li>' +
    '</ol></div></div>');

  el.innerHTML = out.join('');
  const o = $('#rm-open'); if (o) o.addEventListener('click', openRmConfig);
  const t = $('#rm-test'); if (t) t.addEventListener('click', rmTest);
  const u = $('#rm-use'); if (u) u.addEventListener('click', () => {
    if (!rmReady()) { toast('Configure the gateway URL and token first'); openRmConfig(); return; }
    AI.provider = 'radarmatrix'; AI.key = ''; AI.model = 'radar-matrix'; AI.base = RM.base;
    aiSave(); renderAiPane(); renderAiStatus(); renderRmPane();
    toast('AI source set to <b>RADARMatrix</b> \u00b7 the project\u2019s own model');
  });
  const f = $('#rm-flush'); if (f) f.addEventListener('click', async () => {
    f.disabled = true; f.textContent = 'Flushing\u2026';
    const r = await rmFlushQueue();
    toast(r.flushed ? 'Wrote <b>' + r.flushed + '</b> decision record(s) to RADARMatrix' :
      'Nothing could be written \u2014 ' + r.remaining + ' still queued');
  });
}

function openRmConfig() {
  const b = $('#rm-base'); if (b) b.value = RM.base;
  const k = $('#rm-token'); if (k) k.value = RM.token;
  const w = $('#rm-ws'); if (w) w.value = RM.workspace;
  const m = $('#rm-mode'); if (m) m.value = RM.mode;
  const msg = $('#rm-msg'); if (msg) msg.innerHTML = '';
  openModal('m-rm');
}

function saveRmConfig() {
  RM.base = ($('#rm-base') && $('#rm-base').value.trim()) || '';
  RM.token = ($('#rm-token') && $('#rm-token').value.trim()) || '';
  RM.workspace = ($('#rm-ws') && $('#rm-ws').value.trim()) || '';
  RM.mode = ($('#rm-mode') && $('#rm-mode').value) || 'mcp';
  rmSave();
  closeModal('m-rm');
  renderRmPane();
  toast('RADARMatrix settings saved');
}

/* ============================================================
   DECISION RECORDING  —  source control -> radar.record_decision
   ============================================================
   Every commit the workbench pushes is a decision worth keeping: what
   changed, why, by whom, and against which commit. When the gateway is
   configured we write an immutable decision record for it. When it is not,
   the record is queued locally and flushed the moment the gateway comes up,
   so nothing is silently dropped.
   ============================================================ */
const RM_QUEUE_LS = 'recoder-radarmatrix-queue-v1';

function rmQueue() {
  try { return JSON.parse(localStorage.getItem(RM_QUEUE_LS) || '[]'); } catch (e) { return []; }
}
function rmQueueSave(q) {
  try { localStorage.setItem(RM_QUEUE_LS, JSON.stringify(q.slice(-50))); } catch (e) {}
}

/* Build the decision payload from a real commit. */
function rmCommitDecision(ctx) {
  const files = (ctx.files || []).map((f) => ({ path: f.path, status: f.status }));
  return {
    kind: 'source_control.commit',
    title: 'Commit ' + String(ctx.sha || '').slice(0, 7) + ' on ' + ctx.repo + '@' + ctx.branch,
    summary: ctx.message,
    rationale: ctx.message,
    decided_at: new Date().toISOString(),
    actor: (GH.user && GH.user.login) || 'workbench',
    workspace: RM.workspace || undefined,
    evidence: {
      repository: ctx.repo,
      branch: ctx.branch,
      commit: ctx.sha,
      commit_url: ctx.url,
      parent: ctx.parent || null,
      files_changed: files.length,
      files: files.slice(0, 40),
      additions: ctx.additions || 0,
      deletions: ctx.deletions || 0,
      source: 'recoder-workbench'
    },
    tags: ['commit', ctx.repo, ctx.branch]
  };
}

/* Record a commit decision. Returns {queued|sent, id?}. Never throws. */
async function rmRecordCommit(ctx) {
  const decision = rmCommitDecision(ctx);
  if (!rmReady()) {
    const q = rmQueue();
    q.push({ decision: decision, at: Date.now() });
    rmQueueSave(q);
    renderRmPane();
    return { queued: true, reason: 'gateway not configured' };
  }
  try {
    const r = await rmCallTool('radar.record_decision', { decision: decision });
    RM.calls.push({ method: 'radar.record_decision', ms: 0, ok: true, at: new Date().toLocaleTimeString() });
    renderRmPane();
    return { sent: true, result: r };
  } catch (e) {
    const q = rmQueue();
    q.push({ decision: decision, at: Date.now(), error: e.message });
    rmQueueSave(q);
    renderRmPane();
    return { queued: true, reason: e.message };
  }
}

/* Flush anything queued while the gateway was down. */
async function rmFlushQueue() {
  if (!rmReady()) return { flushed: 0, remaining: rmQueue().length };
  const q = rmQueue();
  if (!q.length) return { flushed: 0, remaining: 0 };
  const keep = [];
  let flushed = 0;
  for (const item of q) {
    try {
      await rmCallTool('radar.record_decision', { decision: item.decision });
      flushed++;
    } catch (e) {
      keep.push(item);
    }
  }
  rmQueueSave(keep);
  renderRmPane();
  return { flushed: flushed, remaining: keep.length };
}
