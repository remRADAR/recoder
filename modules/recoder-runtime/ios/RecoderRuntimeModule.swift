import ExpoModulesCore
import Foundation
import Network
import Security
import WebKit

private let maxRequestBytes = 16_384
private let maxConnections = 8

private final class OutputHandler: NSObject, WKScriptMessageHandler {
  private let lock = NSLock()
  private var events: [[String: Any]] = []
  private var bytes = 0
  private var truncated = false
  private let sessionId: String
  private let limit: Int
  private let emit: ([[String: Any]) -> Void

  init(sessionId: String, limit: Int, emit: @escaping ([[String: Any]) -> Void) { self.sessionId = sessionId; self.limit = limit; self.emit = emit }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let stream = body["stream"] as? String, ["stdout", "stderr"].contains(stream), let text = body["text"] as? String, text.utf8.count <= maxRequestBytes else { return }
    lock.lock(); defer { lock.unlock() }
    guard !truncated else { return }
    let remaining = limit - bytes
    guard remaining > 0 else { return }
    let clipped = String(text.prefix { _ in true }).data(using: .utf8).flatMap { data in data.count <= remaining ? text : String(data: data.prefix(remaining), encoding: .utf8) } ?? ""
    bytes += clipped.utf8.count
    if !clipped.isEmpty { let event: [String: Any] = ["id": events.count + 1, "at": Int(Date().timeIntervalSince1970 * 1000), "stream": stream, "text": clipped]; events.append(event); emit(event) }
    if clipped.utf8.count < text.utf8.count { truncated = true; let event: [String: Any] = ["id": events.count + 1, "at": Int(Date().timeIntervalSince1970 * 1000), "stream": "system", "text": "Output truncated at 64 KB.\n", "outputTruncated": true]; events.append(event); emit(event) }
  }
  func snapshot() -> [[String: Any]] { lock.lock(); defer { lock.unlock() }; return events }
  var isTruncated: Bool { lock.lock(); defer { lock.unlock() }; return truncated }
}

private final class RuntimeStore {
  let queue = DispatchQueue(label: "recoder.runtime.store")
  var executions: [String: WKWebView] = [:]
  var listeners: [String: NWListener] = [:]
  var files: [String: [String: String]] = [:]
  var tokens: [String: String] = [:]
}

public final class RecoderRuntimeModule: Module {
  private let store = RuntimeStore()

  public func definition() -> ModuleDefinition {
    Name("RecoderRuntime")
    Events("runtimeOutput")
    AsyncFunction("executeJavaScript") { (input: [String: Any]) async throws -> [String: Any] in
      guard let id = input["sessionId"] as? String, let code = input["code"] as? String else { throw RuntimeError.invalidInput }
      return try await self.execute(id: id, code: code, timeoutMs: input["timeoutMs"] as? Int ?? 5000, limit: input["maxOutputBytes"] as? Int ?? 64000)
    }
    AsyncFunction("cancelExecution") { (input: [String: Any]) in
      guard let id = input["sessionId"] as? String else { return }
      self.store.queue.sync { self.store.executions[id]?.stopLoading() }
    }
    AsyncFunction("startLocalServer") { (input: [String: Any]) async throws -> [String: Any] in
      guard let id = input["serverId"] as? String, let files = input["files"] as? [String: String] else { throw RuntimeError.invalidInput }
      return try await self.startServer(id: id, files: files)
    }
    AsyncFunction("stopLocalServer") { (input: [String: Any]) in
      guard let id = input["serverId"] as? String else { return }
      self.store.queue.sync { self.store.listeners.removeValue(forKey: id)?.cancel(); self.store.files.removeValue(forKey: id); self.store.tokens.removeValue(forKey: id) }
    }
  }

  private func execute(id: String, code: String, timeoutMs: Int, limit: Int) async throws -> [String: Any] {
    let handler = OutputHandler(sessionId: id, limit: limit) { [weak self] event in guard let self else { return }; self.sendEvent("runtimeOutput", ["sessionId": id, "id": event["id"] ?? 0, "at": event["at"] ?? 0, "stream": event["stream"] ?? "stderr", "text": event["text"] ?? "", "outputTruncated": event["outputTruncated"] ?? false]) }
    let webView = await MainActor.run { () -> WKWebView in let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent(); config.userContentController.add(handler, name: "recoderOutput"); return WKWebView(frame: .zero, configuration: config) }
    store.queue.sync { store.executions[id] = webView }
    defer { store.queue.sync { store.executions.removeValue(forKey: id)?.stopLoading() }; webView.configuration.userContentController.removeScriptMessageHandler(forName: "recoderOutput") }
    await MainActor.run { webView.loadHTMLString("<!doctype html><html><body></body></html>", baseURL: URL(string: "about:blank")) }
    try await waitUntilReady(webView)
    let escaped = code.replacingOccurrences(of: "</script", with: "<\\/script")
    let source = "(() => { const emit = (stream, value) => window.webkit.messageHandlers.recoderOutput.postMessage({stream, text: String(value) + '\\n'}); console.log = (...v) => emit('stdout', v.join(' ')); console.error = (...v) => emit('stderr', v.join(' ')); try { \(escaped) ; return 'ok'; } catch (error) { emit('stderr', error && error.stack ? error.stack : error); return 'error'; } })()"
    let result = try await withThrowingTaskGroup(of: Any.self) { group -> Any in
      group.addTask { try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any, Error>) in MainActor.assumeIsolated { webView.evaluateJavaScript(source) { value, error in if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: value ?? NSNull()) } } } } }
      group.addTask { try await Task.sleep(nanoseconds: UInt64(timeoutMs) * 1_000_000); throw RuntimeError.timedOut }
      let first = try await group.next()!; group.cancelAll(); return first
    }
    _ = result
    let events = handler.snapshot()
    return ["id": id, "status": "completed", "startedAt": Int(Date().timeIntervalSince1970 * 1000), "finishedAt": Int(Date().timeIntervalSince1970 * 1000), "events": events, "isolation": "device-webview-context", "resourceLimitMs": timeoutMs, "outputLimitBytes": limit, "outputTruncated": handler.isTruncated]
  }

  private func waitUntilReady(_ webView: WKWebView) async throws { for _ in 0..<40 { let state = try await MainActor.run { try await webView.evaluateJavaScript("document.readyState") as? String }; if state == "complete" || state == "interactive" { return }; try await Task.sleep(nanoseconds: 25_000_000) }; throw RuntimeError.notReady }

  private func secureToken() throws -> String { var bytes = [UInt8](repeating: 0, count: 24); guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw RuntimeError.tokenFailed }; return Data(bytes).base64URLEncodedString() }
  private func startServer(id: String, files: [String: String]) async throws -> [String: Any] {
    let token = try secureToken(); let listener = try NWListener(using: .tcp, on: .any); listener.parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: 0)
    store.queue.sync { store.files[id] = files; store.tokens[id] = token; store.listeners[id] = listener }
    let port: UInt16 = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UInt16, Error>) in
      var resumed = false; let lock = NSLock(); listener.stateUpdateHandler = { state in lock.lock(); defer { lock.unlock() }; guard !resumed else { return }; if case .ready = state, let value = listener.port?.rawValue { resumed = true; continuation.resume(returning: value) } else if case .failed(let error) = state { resumed = true; continuation.resume(throwing: error) } }
      listener.newConnectionHandler = { [weak self] connection in self?.serve(connection, id: id) }; listener.start(queue: DispatchQueue(label: "recoder.server.\(id)"))
    }
    return ["id": id, "url": "http://127.0.0.1:\(port)/index.html?token=\(token)", "root": "app-sandbox:\(id)", "startedAt": Int(Date().timeIntervalSince1970 * 1000)]
  }
  private func serve(_ connection: NWConnection, id: String) { connection.start(queue: .global(qos: .userInitiated)); var buffer = Data(); func receive() { connection.receive(minimumIncompleteLength: 1, maximumLength: maxRequestBytes - buffer.count) { [weak self] data, _, _, _ in guard let self, let data, buffer.count + data.count <= maxRequestBytes else { connection.cancel(); return }; buffer.append(data); guard let request = String(data: buffer, encoding: .utf8) else { connection.cancel(); return }; guard let range = request.range(of: "\r\n\r\n") else { receive(); return }; let header = String(request[..<range.lowerBound]); self.respond(connection, id: id, request: header) } }; receive() }
  private func respond(_ connection: NWConnection, id: String, request: String) { let line = request.split(separator: "\r\n").first.map(String.init) ?? ""; let pieces = line.split(separator: " "); guard pieces.count >= 2, pieces[0] == "GET", let url = URL(string: "http://127.0.0.1\(pieces[1])"), let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "token" })?.value, store.queue.sync(execute: { store.tokens[id] }) == token else { send(connection, "403 Forbidden", "Forbidden", "text/plain"); return }; let path = url.path.removingPercentEncoding ?? ""; let relative = path == "/" ? "index.html" : String(path.dropFirst()); guard !relative.isEmpty, !relative.contains(".."), !relative.contains("\\"), let body = store.queue.sync(execute: { store.files[id]?[relative] }) else { send(connection, "404 Not Found", "Not found", "text/plain"); return }; let mime = relative.hasSuffix(".js") ? "text/javascript" : relative.hasSuffix(".css") ? "text/css" : relative.hasSuffix(".json") ? "application/json" : "text/html"; send(connection, "200 OK", body, mime) }
  private func send(_ connection: NWConnection, _ status: String, _ body: String, _ mime: String) { let data = body.data(using: .utf8) ?? Data(); let header = "HTTP/1.1 \(status)\r\nContent-Type: \(mime); charset=utf-8\r\nContent-Length: \(data.count)\r\nConnection: close\r\n\r\n".data(using: .utf8)!; connection.send(content: header + data, completion: .contentProcessed { _ in connection.cancel() }) }
}

private enum RuntimeError: Error { case invalidInput, timedOut, notReady, tokenFailed }
private extension Data { func base64URLEncodedString() -> String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") } }
