package expo.modules.recoder.runtime

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import org.json.JSONObject
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

private const val MAX_REQUEST_BYTES = 16 * 1024
private const val MAX_CONNECTIONS = 8
private const val MAX_ACTIVE_EXECUTIONS = 2

class RecoderRuntimeModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private val executions = ConcurrentHashMap<String, ExecutionHandle>()
  private val servers = ConcurrentHashMap<String, ServerHandle>()
  private val active = AtomicInteger(0)

  override fun definition() = ModuleDefinition {
    Name("RecoderRuntime")
    Events("runtimeOutput")
    AsyncFunction("executeJavaScript") { input: Map<String, Any>, promise: Promise ->
      val id = input["sessionId"] as? String ?: return@AsyncFunction promise.reject("INVALID_INPUT", "sessionId is required", null)
      val code = input["code"] as? String ?: return@AsyncFunction promise.reject("INVALID_INPUT", "code is required", null)
      if (active.incrementAndGet() > MAX_ACTIVE_EXECUTIONS) { active.decrementAndGet(); return@AsyncFunction promise.reject("EXECUTION_LIMIT", "Two device executions are already active", null) }
      val timeout = (input["timeoutMs"] as? Number)?.toLong() ?: 5000L
      val maxBytes = (input["maxOutputBytes"] as? Number)?.toInt() ?: 64000
      val handle = ExecutionHandle(id, maxBytes, promise) { event -> sendEvent("runtimeOutput", event + mapOf("sessionId" to id)) }
      executions[id] = handle
      main.post {
        if (handle.terminal.get()) { completeExecution(handle, "cancelled"); return@post }
        val webView = WebView(appContext.reactContext)
        handle.webView = webView
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = false
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.webViewClient = object : WebViewClient() { override fun onPageFinished(view: WebView, url: String) { if (url != "about:blank" || handle.terminal.get()) return; evaluate(handle, code) } }
        webView.addJavascriptInterface(OutputBridge(handle), "RecoderOutput")
        webView.loadDataWithBaseURL("about:blank", "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>", "text/html", "UTF-8", null)
        main.postDelayed({ if (!handle.terminal.get() && !handle.started.get()) evaluate(handle, code) }, 150)
        main.postDelayed({ if (handle.terminal.compareAndSet(false, true)) completeExecution(handle, "timed_out") }, timeout)
      }
    }
    AsyncFunction("cancelExecution") { input: Map<String, Any> -> (input["sessionId"] as? String)?.let { id -> executions[id]?.let { handle -> if (handle.terminal.compareAndSet(false, true)) main.post { handle.webView?.stopLoading(); handle.webView?.destroy(); completeExecution(handle, "cancelled") } } } }
    AsyncFunction("startLocalServer") { input: Map<String, Any>, promise: Promise ->
      val id = input["serverId"] as? String ?: return@AsyncFunction promise.reject("INVALID_INPUT", "serverId is required", null)
      val files = (input["files"] as? Map<*, *>)?.mapNotNull { (key, value) -> if (key is String && value is String) key to value else null }?.toMap() ?: emptyMap()
      thread(name = "recoder-server-$id") { try { val token = secureToken(); val socket = ServerSocket(0, MAX_CONNECTIONS, java.net.InetAddress.getLoopbackAddress()); val handle = ServerHandle(socket, files, token); servers[id] = handle; handle.acceptThread = thread(name = "recoder-accept-$id") { while (!socket.isClosed) try { val accepted = socket.accept(); if (!handle.semaphore.tryAcquire()) { accepted.close(); continue }; thread { try { serve(accepted, handle) } catch (_: Exception) { } finally { handle.semaphore.release() } } } catch (_: Exception) { break } }; main.post { promise.resolve(mapOf("id" to id, "url" to "http://127.0.0.1:${socket.localPort}/index.html?token=$token", "root" to "app-sandbox:$id", "startedAt" to System.currentTimeMillis())) } } catch (error: Exception) { main.post { promise.reject("SERVER_FAILED", error.message, error) } } }
    }
    AsyncFunction("stopLocalServer") { input: Map<String, Any> -> (input["serverId"] as? String)?.let { servers.remove(it)?.close() } }
  }

  private fun evaluate(handle: ExecutionHandle, code: String) {
    if (!handle.started.compareAndSet(false, true) || handle.terminal.get()) return
    val safe = JSONObject.quote(code).replace("</script", "<\\/script").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    val script = """(function(){console.log=function(){RecoderOutput.emit('stdout',Array.prototype.join.call(arguments,' '))};console.error=function(){RecoderOutput.emit('stderr',Array.prototype.join.call(arguments,' '))};try{eval($safe);RecoderOutput.done('completed')}catch(e){RecoderOutput.emit('stderr',e&&e.stack?e.stack:String(e));RecoderOutput.done('failed')}})()"""
    handle.webView?.evaluateJavascript(script, null)
  }

  private fun completeExecution(handle: ExecutionHandle, status: String) {
    if (!handle.resolved.compareAndSet(false, true)) return
    main.removeCallbacksAndMessages(handle)
    handle.webView?.stopLoading(); handle.webView?.removeJavascriptInterface("RecoderOutput"); handle.webView?.destroy()
    executions.remove(handle.id); active.decrementAndGet()
    handle.promise.resolve(mapOf("id" to handle.id, "status" to status, "startedAt" to handle.startedAt, "finishedAt" to System.currentTimeMillis(), "events" to handle.events, "isolation" to "device-webview-context", "resourceLimitMs" to 5000, "outputLimitBytes" to handle.maxBytes, "outputTruncated" to handle.truncated))
  }

  private fun secureToken(): String { val bytes = ByteArray(24); SecureRandom().nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) }
  private fun serve(socket: Socket, handle: ServerHandle) { socket.soTimeout = 2000; socket.use { val reader = BufferedReader(InputStreamReader(it.getInputStream())); val line = reader.readLine() ?: return; if (line.length > MAX_REQUEST_BYTES) return; val parts = line.split(" "); if (parts.size < 2 || parts[0] != "GET") return respond(it, "400 Bad Request", "Bad request", "text/plain"); var headerBytes = line.toByteArray().size; while (true) { val header = reader.readLine() ?: break; headerBytes += header.toByteArray().size; if (headerBytes > MAX_REQUEST_BYTES) return respond(it, "431 Request Header Fields Too Large", "Headers too large", "text/plain"); if (header.isEmpty()) break }; val uri = try { URI(parts[1]) } catch (_: Exception) { return respond(it, "400 Bad Request", "Bad request", "text/plain") }; if (uri.host != null && uri.host != "127.0.0.1") return respond(it, "403 Forbidden", "Forbidden", "text/plain"); val token = uri.query?.split("&")?.firstOrNull { it.startsWith("token=") }?.substringAfter("="); if (token != handle.token) return respond(it, "403 Forbidden", "Forbidden", "text/plain"); val relative = if (uri.path == "/" || uri.path.isEmpty()) "index.html" else uri.path.trimStart('/'); if (relative.contains("..") || relative.contains("\\") || relative.contains("%")) return respond(it, "403 Forbidden", "Forbidden", "text/plain"); val body = handle.files[relative] ?: return respond(it, "404 Not Found", "Not found", "text/plain"); val mime = when { relative.endsWith(".js") -> "text/javascript"; relative.endsWith(".css") -> "text/css"; relative.endsWith(".json") -> "application/json"; else -> "text/html" }; respond(it, "200 OK", body, mime) } }
  private fun respond(socket: Socket, status: String, body: String, mime: String) { val data = body.toByteArray(); socket.getOutputStream().apply { write("HTTP/1.1 $status\r\nContent-Type: $mime; charset=utf-8\r\nContent-Length: ${data.size}\r\nConnection: close\r\n\r\n".toByteArray()); write(data); flush() } }

  private inner class OutputBridge(private val handle: ExecutionHandle) {
    @JavascriptInterface fun emit(stream: String, text: String) { if (stream != "stdout" && stream != "stderr") return; handle.append(stream, text) }
    @JavascriptInterface fun done(status: String) { if (handle.terminal.compareAndSet(false, true)) main.post { completeExecution(handle, if (status == "failed") "failed" else "completed") } }
  }
  private class ExecutionHandle(val id: String, val maxBytes: Int, val promise: Promise, val emit: (Map<String, Any>) -> Unit) { val startedAt = System.currentTimeMillis(); val started = AtomicBoolean(false); val terminal = AtomicBoolean(false); val resolved = AtomicBoolean(false); val events = mutableListOf<Map<String, Any>>(); var truncated = false; var webView: WebView? = null; @Synchronized fun append(stream: String, text: String) { if (terminal.get() || truncated) return; val bytes = text.toByteArray().size; if (events.sumOf { (it["text"] as String).toByteArray().size } + bytes > maxBytes) { truncated = true; val event = mapOf<String, Any>("id" to events.size, "at" to System.currentTimeMillis(), "stream" to "system", "text" to "Output truncated at 64 KB.\n", "outputTruncated" to true); events.add(event); emit(event); return }; val event = mapOf<String, Any>("id" to events.size, "at" to System.currentTimeMillis(), "stream" to stream, "text" to text); events.add(event); emit(event) } }
  private class ServerHandle(val socket: ServerSocket, val files: Map<String, String>, val token: String) { val semaphore = Semaphore(MAX_CONNECTIONS); var acceptThread: Thread? = null; fun close() { socket.close(); acceptThread?.interrupt() } }
}
