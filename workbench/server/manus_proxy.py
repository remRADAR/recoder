#!/usr/bin/env python3
"""
Manus API proxy for </recode>.

WHY THIS EXISTS
---------------
The Manus API (https://api.manus.ai) cannot be called from a browser page.
Verified against the live service on 2026-11-23:

    OPTIONS /v2/task.list
      Origin: https://example.com
      Access-Control-Request-Headers: x-manus-api-key
    -> 204, and NO access-control-allow-origin header at all.

    Same preflight with Origin: https://manus.im
    -> 204 with access-control-allow-origin: https://manus.im

So the preflight only succeeds for Manus's own origin. A page on any other
origin is blocked by the browser before the request is ever sent. (A plain
GET without the custom header does get `access-control-allow-origin: *`, but
the API key must travel in `x-manus-api-key`, which forces a preflight.)

This proxy is therefore not a convenience — it is the only way the workbench
can talk to Manus. It also keeps the API key off the client: the browser
never sees it, and the key is held in this process's environment.

ENDPOINTS
---------
    GET  /health                     proxy + upstream reachability
    GET  /api/manus/me               -> GET  /v2/user.me
    GET  /api/manus/tasks            -> GET  /v2/task.list
    POST /api/manus/tasks            -> POST /v2/task.create
    GET  /api/manus/task?id=         -> GET  /v2/task.detail
    GET  /api/manus/messages?id=     -> GET  /v2/task.listMessages
    POST /api/manus/message          -> POST /v2/task.sendMessage
    POST /api/manus/webhook          -> POST /v2/webhook.create
    GET  /api/manus/watch?id=        -> SSE stream of new task messages

Every response is passed through with Manus's own JSON body intact, so the
client sees the real `{ok, request_id, ...}` / `{ok:false, error:{...}}`
envelope rather than a re-shaped one.

CONFIG (environment)
--------------------
    MANUS_API_KEY   required for any authenticated call
    MP_TOKEN        optional bearer token the client must present
    MP_ORIGINS      comma-separated CORS allowlist (default: *)
    MP_PORT         default 8790
    MP_CORS         auto | on | off   (default auto)

`MP_CORS=auto` detects a forwarding proxy in front of us (the artifact host
injects its own Access-Control-Allow-Origin) and stays out of the way, so the
browser never sees a duplicate header — a duplicate is a hard CORS failure.
"""

import asyncio
import json
import os
import time
from typing import Any, Dict, Optional

from aiohttp import ClientSession, ClientTimeout, web

MANUS_BASE = os.environ.get("MANUS_BASE", "https://api.manus.ai").rstrip("/")
API_KEY = os.environ.get("MANUS_API_KEY", "").strip()
MP_TOKEN = os.environ.get("MP_TOKEN", "").strip()
MP_ORIGINS = [o.strip() for o in os.environ.get("MP_ORIGINS", "*").split(",") if o.strip()]
MP_PORT = int(os.environ.get("MP_PORT", "8790"))
MP_CORS = os.environ.get("MP_CORS", "auto").lower()

STARTED = time.time()

# Manus rate-limits per user: 10/min for task.create + task.sendMessage,
# 100/min for reads. We surface the upstream headers rather than guessing.
RATE_HINT = {"create": 10, "read": 100}


# --------------------------------------------------------------------------
# CORS
# --------------------------------------------------------------------------
def _behind_proxy(request: web.Request) -> bool:
    """True when something in front of us already sets CORS headers."""
    if MP_CORS == "off":
        return True
    if MP_CORS == "on":
        return False
    # auto: a forwarding proxy shows up as x-forwarded-* or a non-local peer
    for h in ("x-forwarded-for", "x-forwarded-host", "x-real-ip", "cf-connecting-ip",
              "fly-forwarded-proto", "x-forwarded-proto"):
        if request.headers.get(h):
            return True
    return False


def _origin_ok(origin: str) -> Optional[str]:
    if not origin:
        return None
    if "*" in MP_ORIGINS:
        return "*"
    return origin if origin in MP_ORIGINS else None


@web.middleware
async def cors_mw(request: web.Request, handler):
    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    else:
        try:
            resp = await handler(request)
        except web.HTTPException as e:
            resp = e
        except Exception as e:  # noqa: BLE001 - surface, never crash the proxy
            resp = web.json_response(
                {"ok": False, "error": {"code": "proxy_error", "message": str(e)}},
                status=502,
            )

    if not _behind_proxy(request):
        allow = _origin_ok(request.headers.get("Origin", ""))
        if allow:
            resp.headers["Access-Control-Allow-Origin"] = allow
            if allow != "*":
                resp.headers["Vary"] = "Origin"
            resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
            resp.headers["Access-Control-Allow-Headers"] = "content-type,authorization,x-mp-token"
            resp.headers["Access-Control-Max-Age"] = "600"
    return resp


# --------------------------------------------------------------------------
# auth + upstream
# --------------------------------------------------------------------------
def _client_authorized(request: web.Request) -> bool:
    if not MP_TOKEN:
        return True
    got = request.headers.get("x-mp-token", "")
    if not got:
        auth = request.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            got = auth[7:].strip()
    if not got:
        # EventSource cannot set headers, so /watch accepts ?token=
        got = request.query.get("token", "")
    return got == MP_TOKEN


def _key_from_request(request: web.Request) -> Optional[str]:
    """Allow a per-request key so the panel can work without a server env var."""
    return request.headers.get("x-manus-key") or None


async def _call_with_key(method: str, path: str, request: web.Request, *,
                         params=None, body=None) -> Dict[str, Any]:
    key = _key_from_request(request) or API_KEY
    url = MANUS_BASE + path
    t0 = time.time()
    headers = {"content-type": "application/json", "accept": "application/json"}
    if key:
        headers["x-manus-api-key"] = key
    async with ClientSession(timeout=ClientTimeout(total=45)) as s:
        async with s.request(method, url, params=params, json=body, headers=headers) as r:
            raw = await r.text()
            try:
                data = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                data = {"ok": False, "error": {"code": "bad_upstream_json", "message": raw[:400]}}
            return {"status": r.status, "data": data,
                    "ms": int((time.time() - t0) * 1000),
                    "rate": {"limit": r.headers.get("x-ratelimit-limit"),
                             "remaining": r.headers.get("x-ratelimit-remaining"),
                             "reset": r.headers.get("x-ratelimit-reset")}}


def _relay(res: Dict[str, Any]) -> web.Response:
    out = dict(res["data"]) if isinstance(res["data"], dict) else {"ok": False, "raw": res["data"]}
    out.setdefault("ok", res["status"] < 400)
    out["_proxy"] = {"status": res["status"], "ms": res["ms"], "rate": res["rate"]}
    return web.json_response(out, status=200 if res["status"] < 500 else 502)


def _guard(request: web.Request) -> Optional[web.Response]:
    if not _client_authorized(request):
        return web.json_response(
            {"ok": False, "error": {"code": "proxy_unauthorized",
                                    "message": "Missing or wrong x-mp-token for the Manus proxy."}},
            status=401)
    # A per-request key (x-manus-key) is a valid alternative to the server's
    # MANUS_API_KEY, so only refuse when neither is present.
    if not API_KEY and not _key_from_request(request):
        return web.json_response(
            {"ok": False, "error": {"code": "no_api_key",
                                    "message": "The proxy has no MANUS_API_KEY set. "
                                               "Start it with MANUS_API_KEY=... or paste a key "
                                               "into the Manus panel (key is then sent per-request)."}},
            status=503)
    return None


# --------------------------------------------------------------------------
# handlers
# --------------------------------------------------------------------------
async def health(request: web.Request) -> web.Response:
    reachable = None
    detail = ""
    try:
        async with ClientSession(timeout=ClientTimeout(total=8)) as s:
            async with s.get(MANUS_BASE + "/v2/user.me",
                             headers={"x-manus-api-key": API_KEY or "probe"}) as r:
                reachable = True
                detail = "upstream reachable (HTTP %d)" % r.status
    except Exception as e:  # noqa: BLE001
        reachable = False
        detail = str(e)[:200]
    return web.json_response({
        "ok": True,
        "service": "manus-proxy",
        "version": "1.0.0",
        "uptime_s": int(time.time() - STARTED),
        "upstream": MANUS_BASE,
        "upstream_reachable": reachable,
        "upstream_detail": detail,
        "api_key_configured": bool(API_KEY),
        "client_token_required": bool(MP_TOKEN),
        "cors_mode": "passthrough" if _behind_proxy(request) else "self",
        "rate_hint": RATE_HINT,
    })


async def me(request: web.Request) -> web.Response:
    g = _guard(request)
    if g:
        return g
    return _relay(await _call_with_key("GET", "/v2/user.me", request))


async def list_tasks(request: web.Request) -> web.Response:
    g = _guard(request)
    if g:
        return g
    params = {k: v for k, v in request.query.items() if k in ("limit", "cursor", "sort", "status")}
    return _relay(await _call_with_key("GET", "/v2/task.list", request, params=params or None))


async def create_task(request: web.Request) -> web.Response:
    g = _guard(request)
    if g:
        return g
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": {"code": "bad_json",
                                                         "message": "Body must be JSON."}}, status=400)
    # Accept either the full Manus shape or a convenience {prompt, title}.
    if "message" not in body and "prompt" in body:
        body = {
            "message": {"content": [{"type": "text", "text": str(body["prompt"]),
                                     "visibility": "visible"}]},
            "title": body.get("title") or "",
            "locale": body.get("locale") or "en-US",
            "interactive_mode": bool(body.get("interactive_mode", False)),
            "share_visibility": body.get("share_visibility") or "private",
            "agent_profile": body.get("agent_profile") or "standard",
        }
    return _relay(await _call_with_key("POST", "/v2/task.create", request, body=body))


async def task_detail(request: web.Request) -> web.Response:
    g = _guard(request)
    if g:
        return g
    tid = request.query.get("id", "")
    if not tid:
        return web.json_response({"ok": False, "error": {"code": "invalid_argument",
                                                         "message": "id is required"}}, status=400)
    return _relay(await _call_with_key("GET", "/v2/task.detail", request, params={"task_id": tid}))


async def messages(request: web.Request) -> web.Response:
    g = _guard(request)
    if g:
        return g
    tid = request.query.get("id", "")
    if not tid:
        return web.json_response({"ok": False, "error": {"code": "invalid_argument",
                                                         "message": "id is required"}}, status=400)
    params = {"task_id": tid,
              "order": request.query.get("order", "asc"),
              "limit": request.query.get("limit", "50")}
    return _relay(await _call_with_key("GET", "/v2/task.listMessages", request, params=params))


async def send_message(request: web.Request) -> web.Response:
    g = _guard(request)
    if g:
        return g
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": {"code": "bad_json",
                                                         "message": "Body must be JSON."}}, status=400)
    if "task_id" not in body:
        return web.json_response({"ok": False, "error": {"code": "invalid_argument",
                                                         "message": "task_id is required"}}, status=400)
    if "message" not in body and "prompt" in body:
        body["message"] = {"content": [{"type": "text", "text": str(body.pop("prompt")),
                                        "visibility": "visible"}]}
    return _relay(await _call_with_key("POST", "/v2/task.sendMessage", request, body=body))


async def webhook(request: web.Request) -> web.Response:
    g = _guard(request)
    if g:
        return g
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": {"code": "bad_json",
                                                         "message": "Body must be JSON."}}, status=400)
    return _relay(await _call_with_key("POST", "/v2/webhook.create", request, body=body))


async def watch(request: web.Request) -> web.StreamResponse:
    """SSE: poll task.listMessages and push only messages we have not sent yet.

    Manus tasks are asynchronous, so this is the live-progress channel the
    workbench renders. Polling stays inside the read budget (100/min); a 2s
    interval is 30/min.
    """
    g = _guard(request)
    if g:
        return g
    tid = request.query.get("id", "")
    if not tid:
        return web.json_response({"ok": False, "error": {"code": "invalid_argument",
                                                         "message": "id is required"}}, status=400)

    resp = web.StreamResponse(headers={
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })
    await resp.prepare(request)

    seen = set()
    deadline = time.time() + 60 * 30  # hard cap: 30 minutes per stream
    try:
        while time.time() < deadline:
            res = await _call_with_key("GET", "/v2/task.listMessages", request,
                                       params={"task_id": tid, "order": "asc", "limit": "100"})
            data = res["data"] if isinstance(res["data"], dict) else {}
            if not data.get("ok", True):
                await resp.write(("event: error\ndata: " +
                                  json.dumps(data.get("error") or data) + "\n\n").encode())
                break
            msgs = data.get("messages") or []
            fresh = [m for m in msgs if m.get("id") and m["id"] not in seen]
            for m in fresh:
                seen.add(m["id"])
                await resp.write(("event: message\ndata: " +
                                  json.dumps(m) + "\n\n").encode())
            # stop once the task is no longer running
            det = await _call_with_key("GET", "/v2/task.detail", request,
                                       params={"task_id": tid})
            st = ((det["data"] or {}).get("task") or {}).get("status")
            await resp.write(("event: status\ndata: " +
                              json.dumps({"status": st, "count": len(seen)}) + "\n\n").encode())
            if st in ("completed", "failed", "stopped", "error"):
                break
            await asyncio.sleep(2)
    except (asyncio.CancelledError, ConnectionResetError):
        pass
    finally:
        try:
            await resp.write_eof()
        except Exception:  # noqa: BLE001
            pass
    return resp


def make_app() -> web.Application:
    app = web.Application(middlewares=[cors_mw], client_max_size=4 * 1024 * 1024)
    app.router.add_get("/health", health)
    app.router.add_get("/api/manus/me", me)
    app.router.add_get("/api/manus/tasks", list_tasks)
    app.router.add_post("/api/manus/tasks", create_task)
    app.router.add_get("/api/manus/task", task_detail)
    app.router.add_get("/api/manus/messages", messages)
    app.router.add_post("/api/manus/message", send_message)
    app.router.add_post("/api/manus/webhook", webhook)
    app.router.add_get("/api/manus/watch", watch)
    return app


if __name__ == "__main__":
    print("manus-proxy 1.0.0 on :%d  upstream=%s  key=%s  cors=%s"
          % (MP_PORT, MANUS_BASE, "set" if API_KEY else "MISSING", MP_CORS))
    web.run_app(make_app(), host="0.0.0.0", port=MP_PORT, print=None)
