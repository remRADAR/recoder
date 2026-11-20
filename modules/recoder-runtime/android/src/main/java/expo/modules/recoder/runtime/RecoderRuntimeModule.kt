package expo.modules.recoder.runtime

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

class RecoderRuntimeModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private val executions = ConcurrentHashMap<String, WebView>()
  private val servers = ConcurrentHashMap<String, Pair<ServerSocket, Map<String, String>>>()

  override fun definition() = ModuleDefinition {
    Name("RecoderRuntime")
    Events("runtimeOutput")
    AsyncFunction("executeJavaScript") { input: Map<String, Any>, promise: Promise ->
      val id = input["sessionId"] as? String ?: return@AsyncFunction promise.reject("INVALID_INPUT", "sessionId is required", null)
      val code = input["code"] as? String ?: return@AsyncFunction promise.reject("INVALID_INPUT", "code is required", null)
      val timeout = (input["timeoutMs"] as? Number)?.toLong() ?: 5000L
      val maxBytes = (input["maxOutputBytes"] as? Number)?.toInt() ?: 64000
      val output = mutableListOf<Map<String, Any>>()
      val webView = WebView(appContext.reactContext).apply { settings.javaScriptEnabled = true; settings.domStorageEnabled = false; webViewClient = WebViewClient() }
      executions[id] = webView
      val finish = Runnable {
        executions.remove(id)?.destroy()
        promise.resolve(mapOf("id" to id, "status" to "timed_out", "startedAt" to System.currentTimeMillis(), "finishedAt" to System.currentTimeMillis(), "events" to output, "isolation" to "device-webview-context", "resourceLimitMs" to timeout, "outputLimitBytes" to maxBytes))
      }
      handler.postDelayed(finish, timeout)
      val safe = code.replace("</script", "<\\/script")
      val script = """(function(){var out=[],bytes=0;function emit(stream,v){var text=String(v)+'\\n';var size=new TextEncoder().encode(text).length;if(bytes+size<=${maxBytes}){bytes+=size;out.push({id:out.length,at:Date.now(),stream:stream,text:text});}};console.log=function(){emit('stdout',Array.prototype.join.call(arguments,' '))};console.error=function(){emit('stderr',Array.prototype.join.call(arguments,' '))};try{$safe;return JSON.stringify({ok:true,output:out})}catch(e){emit('stderr',e);return JSON.stringify({ok:false,output:out})}})()"""
      handler.post { webView.evaluateJavascript(script) { raw ->
        handler.removeCallbacks(finish); executions.remove(id)?.destroy()
        try {
          val decoded = org.json.JSONTokener(raw).nextValue() as? String
          val json = decoded?.let { org.json.JSONObject(it) }
          val rows = json?.optJSONArray("output")
          if (rows != null) for (index in 0 until rows.length()) {
            val row = rows.getJSONObject(index)
            output.add(mapOf("id" to row.optInt("id", index), "at" to row.optLong("at", System.currentTimeMillis()), "stream" to row.optString("stream", "stderr"), "text" to row.optString("text")))
          }
        } catch (_: Exception) { output.add(mapOf("id" to 0, "at" to System.currentTimeMillis(), "stream" to "stderr", "text" to "Execution result could not be decoded.\n")) }
        output.forEach { row -> sendEvent("runtimeOutput", row + mapOf("sessionId" to id)) }
        promise.resolve(mapOf("id" to id, "status" to "completed", "startedAt" to System.currentTimeMillis(), "finishedAt" to System.currentTimeMillis(), "events" to output, "isolation" to "device-webview-context", "resourceLimitMs" to timeout, "outputLimitBytes" to maxBytes))
      } }
    }
    AsyncFunction("cancelExecution") { input: Map<String, Any> -> (input["sessionId"] as? String)?.let { handler.post { executions.remove(it)?.destroy() } } }
    AsyncFunction("startLocalServer") { input: Map<String, Any>, promise: Promise ->
      val id = input["serverId"] as? String ?: return@AsyncFunction promise.reject("INVALID_INPUT", "serverId is required", null)
      val files = (input["files"] as? Map<*, *>)?.mapNotNull { (key, value) -> if (key is String && value is String) key to value else null }?.toMap() ?: emptyMap()
      thread(name = "recoder-server-$id") {
        try { val socket = ServerSocket(0, 50, java.net.InetAddress.getLoopbackAddress()); servers[id] = socket to files; while (!socket.isClosed) thread { serve(socket.accept(), files) }; handler.post { promise.resolve(mapOf("id" to id, "url" to "http://127.0.0.1:${socket.localPort}/index.html", "root" to "app-sandbox:$id", "startedAt" to System.currentTimeMillis())) } } catch (error: Exception) { handler.post { promise.reject("SERVER_FAILED", error.message, error) } }
      }
    }
    AsyncFunction("stopLocalServer") { input: Map<String, Any> -> (input["serverId"] as? String)?.let { servers.remove(it)?.first?.close() } }
  }

  private fun serve(socket: java.net.Socket, files: Map<String, String>) { socket.use { val request = BufferedReader(InputStreamReader(it.getInputStream())).readLine() ?: return; val raw = request.split(" ").getOrNull(1) ?: "/"; val path = try { URI(raw).path } catch (_: Exception) { "" }; val relative = if (path == "/") "index.html" else path.trimStart('/'); if (relative.contains("..") || relative.contains("\\") || !files.containsKey(relative)) { respond(it, "404 Not Found", "Not found") } else respond(it, "200 OK", files.getValue(relative)) } }
  private fun respond(socket: java.net.Socket, status: String, body: String) { val data = body.toByteArray(); val header = "HTTP/1.1 $status\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${data.size}\r\nConnection: close\r\n\r\n".toByteArray(); socket.getOutputStream().apply { write(header); write(data); flush() } }
}
