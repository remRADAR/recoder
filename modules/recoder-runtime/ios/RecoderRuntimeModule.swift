import ExpoModulesCore
import Foundation
import Network
import WebKit

public class RecoderRuntimeModule: Module {
  private var listeners: [String: NWListener] = [:]
  private var servers: [String: [String: String]] = [:]
  private var executions: [String: WKWebView] = [:]

  public func definition() -> ModuleDefinition {
    Name("RecoderRuntime")
    Events("runtimeOutput")

    AsyncFunction("executeJavaScript") { (input: [String: Any]) async throws -> [String: Any] in
      guard let sessionId = input["sessionId"] as? String, let code = input["code"] as? String else { throw RuntimeError.invalidInput }
      let timeoutMs = input["timeoutMs"] as? Int ?? 5000
      let maxOutputBytes = input["maxOutputBytes"] as? Int ?? 64000
      return try await self.execute(sessionId: sessionId, code: code, timeoutMs: timeoutMs, maxOutputBytes: maxOutputBytes)
    }

    AsyncFunction("cancelExecution") { (input: [String: Any]) in
      guard let sessionId = input["sessionId"] as? String else { return }
      await MainActor.run { self.executions.removeValue(forKey: sessionId)?.stopLoading() }
    }

    AsyncFunction("startLocalServer") { (input: [String: Any]) async throws -> [String: Any] in
      guard let serverId = input["serverId"] as? String, let files = input["files"] as? [String: String] else { throw RuntimeError.invalidInput }
      return try await self.startServer(serverId: serverId, files: files)
    }

    AsyncFunction("stopLocalServer") { (input: [String: Any]) in
      guard let serverId = input["serverId"] as? String else { return }
      self.listeners.removeValue(forKey: serverId)?.cancel()
      self.servers.removeValue(forKey: serverId)
    }
  }

  private func execute(sessionId: String, code: String, timeoutMs: Int, maxOutputBytes: Int) async throws -> [String: Any] {
    let webView = await MainActor.run { () -> WKWebView in
      let configuration = WKWebViewConfiguration()
      configuration.websiteDataStore = .nonPersistent()
      let view = WKWebView(frame: .zero, configuration: configuration)
      view.isHidden = true
      return view
    }
    await MainActor.run { self.executions[sessionId] = webView }
    let source = """
    (() => { const output = []; let bytes = 0; const emit = (stream, value) => { const text = String(value) + '\\n'; const size = new TextEncoder().encode(text).length; if (bytes + size <= \(maxOutputBytes)) { bytes += size; output.push({stream, text}); window.webkit.messageHandlers.recoder.postMessage({stream, text}); } }; console.log = (...v) => emit('stdout', v.join(' ')); console.error = (...v) => emit('stderr', v.join(' ')); try { \(code.replacingOccurrences(of: "</script", with: "<\\/script")) ; return { ok: true, output }; } catch (error) { emit('stderr', error); return { ok: false, output }; } })()
    """
    let result: Any = try await withThrowingTaskGroup(of: Any.self) { group in
      group.addTask { try await MainActor.run { try await webView.evaluateJavaScript(source) ?? [String: Any]() } }
      group.addTask { try await Task.sleep(nanoseconds: UInt64(timeoutMs) * 1_000_000); throw RuntimeError.timedOut }
      guard let first = try await group.next() else { throw RuntimeError.executionFailed }
      group.cancelAll(); return first
    }
    await MainActor.run { self.executions.removeValue(forKey: sessionId)?.stopLoading() }
    let output = (result as? [String: Any])?["output"] as? [[String: Any]] ?? []
    let events = output.enumerated().map { index, item in ["id": index, "at": Int(Date().timeIntervalSince1970 * 1000), "stream": item["stream"] ?? "stderr", "text": item["text"] ?? ""] }
    for event in events { sendEvent("runtimeOutput", ["sessionId": sessionId, "stream": event["stream"] ?? "stderr", "text": event["text"] ?? ""]) }
    return ["id": sessionId, "status": "completed", "startedAt": Int(Date().timeIntervalSince1970 * 1000), "finishedAt": Int(Date().timeIntervalSince1970 * 1000), "events": events, "isolation": "device-webview-context", "resourceLimitMs": timeoutMs, "outputLimitBytes": maxOutputBytes]
  }

  private func startServer(serverId: String, files: [String: String]) async throws -> [String: Any] {
    let listener = try NWListener(using: .tcp, on: .any)
    listener.parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: 0)
    servers[serverId] = files
    let port = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UInt16, Error>) in
      listener.stateUpdateHandler = { state in
        if case .ready = state, let port = listener.port?.rawValue { continuation.resume(returning: port) }
        if case .failed(let error) = state { continuation.resume(throwing: error) }
      }
      listener.newConnectionHandler = { [weak self] connection in self?.serve(connection, serverId: serverId) }
      self.listeners[serverId] = listener; listener.start(queue: .global(qos: .userInitiated))
    }
    return ["id": serverId, "url": "http://127.0.0.1:\(port)/index.html", "root": "app-sandbox:\(serverId)", "startedAt": Int(Date().timeIntervalSince1970 * 1000)]
  }

  private func serve(_ connection: NWConnection, serverId: String) {
    connection.start(queue: .global(qos: .userInitiated))
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, _ in
      guard let self, let data, let request = String(data: data, encoding: .utf8) else { connection.cancel(); return }
      let rawPath = request.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
      let path = rawPath.removingPercentEncoding ?? ""
      let relative = path == "/" ? "index.html" : String(path.drop(while: { $0 == "/" }))
      guard !relative.contains(".."), !relative.contains("\\"), let body = self.servers[serverId]?[relative] else { self.respond(connection, status: "404 Not Found", body: "Not found"); return }
      self.respond(connection, status: "200 OK", body: body)
    }
  }

  private func respond(_ connection: NWConnection, status: String, body: String) { let data = body.data(using: .utf8) ?? Data(); let header = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(data.count)\r\nConnection: close\r\n\r\n".data(using: .utf8)!; connection.send(content: header + data, completion: .contentProcessed { _ in connection.cancel() }) }
}

enum RuntimeError: Error { case invalidInput, timedOut, executionFailed }
