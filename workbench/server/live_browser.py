#!/usr/bin/env python3
"""
recoder live browser server
===========================
A real Playwright/Chromium session exposed over HTTP + WebSocket so the
recoder workbench can drive a live page from inside its own browser surface.

Endpoints
---------
GET  /health                          -> {ok, browser, sessions, uptime, version}
GET  /api/sessions                    -> list of live sessions
POST /api/sessions                    -> {url} create a session, returns {id, url, title, img}
GET  /api/sessions/{id}               -> session detail (url, title, history, mode)
POST /api/sessions/{id}/goto          -> {url} navigate
POST /api/sessions/{id}/act           -> {action, ...} click/type/scroll/press/select/wait/extract/eval
POST /api/sessions/{id}/back          -> history back
POST /api/sessions/{id}/forward       -> history forward
POST /api/sessions/{id}/reload        -> reload
POST /api/sessions/{id}/mode          -> {mode: agent|manual}
POST /api/sessions/{id}/close         -> close the session
POST /api/sessions/{id}/record/start  -> begin a Playwright trace + step log
POST /api/sessions/{id}/record/stop   -> stop, save trace.zip + steps.json, return URLs
GET  /api/traces                      -> list saved traces
GET  /api/traces/{name}/view          -> parsed trace model for the viewer
GET  /traces/{file}                   -> download a saved trace artefact
WS   /ws/{id}                         -> live frame stream (JPEG base64) + action events

Every action returns a real result: the element it resolved, the coordinates it
clicked, the text it read, and a fresh screenshot. Nothing is simulated.

Run
---
    pip install -r requirements.txt
    python3 -m playwright install chromium
    python3 live_browser.py --port 8787

Environment
-----------
    PORT            listen port (default 8787)
    HOST            bind address (default 0.0.0.0)
    LB_TOKEN        optional bearer token; when set every /api call must send it
    LB_ORIGINS      optional comma-separated CORS allowlist (default *)
    LB_TTL          idle session TTL in seconds (default 1800)
    LB_TRACE_DIR    where traces are written (default ./traces)
"""
import argparse
import asyncio
import base64
import json
import os
import sys
import time
import uuid
from pathlib import Path

from playwright.async_api import async_playwright

try:
    from trace_view import parse_trace
except ImportError:  # running from another cwd
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from trace_view import parse_trace

try:
    from aiohttp import web, WSMsgType
except ImportError:  # pragma: no cover
    print("aiohttp is required: pip install aiohttp", file=sys.stderr)
    raise

VERSION = "1.2.0"
VIEWPORT = {"width": 1280, "height": 800}
JPEG_QUALITY = 62
FRAME_INTERVAL = 0.45          # seconds between pushed frames
IDLE_TTL = int(os.environ.get("LB_TTL", "1800"))
TRACE_DIR = Path(os.environ.get("LB_TRACE_DIR", "traces"))
AUTH_TOKEN = os.environ.get("LB_TOKEN", "").strip()
ORIGINS = os.environ.get("LB_ORIGINS", "*").strip() or "*"
CORS_MODE = os.environ.get("LB_CORS", "auto").strip().lower() or "auto"

SESSIONS = {}
PW = None
BROWSER = None
STARTED = time.time()


# --------------------------------------------------------------------------
# session
# --------------------------------------------------------------------------
class Session:
    def __init__(self, sid, context, page, url, label=""):
        self.id = sid
        self.context = context
        self.page = page
        self.url = url
        self.label = label or ""
        self.title = ""
        self.mode = "agent"
        self.created = time.time()
        self.touched = time.time()
        self.history = []
        self.clients = set()
        self.pump = None
        self.last_frame = None
        self.lock = asyncio.Lock()
        self.recording = False
        self.rec_started = 0.0
        self.rec_steps = []

    def log(self, action, target, detail, ok=True, ms=0, pos=None):
        entry = {
            "i": len(self.history) + 1,
            "action": action,
            "target": target,
            "detail": detail,
            "ok": ok,
            "ms": int(ms),
            "at": time.strftime("%H:%M:%S"),
            "url": self.url,
            "pos": pos,
        }
        self.history.append(entry)
        if self.recording:
            self.rec_steps.append(dict(entry, ts=round(time.time() - self.rec_started, 3)))
        self.touched = time.time()
        return entry

    async def snapshot(self, quality=JPEG_QUALITY):
        try:
            buf = await self.page.screenshot(type="jpeg", quality=quality)
            return base64.b64encode(buf).decode("ascii")
        except Exception:
            return None

    async def info(self):
        try:
            self.url = self.page.url
            self.title = await self.page.title()
        except Exception:
            pass
        return {
            "id": self.id,
            "label": self.label,
            "url": self.url,
            "title": self.title,
            "mode": self.mode,
            "steps": len(self.history),
            "created": self.created,
            "recording": self.recording,
        }

    async def broadcast(self, payload):
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def frame_loop(self):
        """Push a live frame whenever the page changes, plus a heartbeat."""
        while True:
            try:
                if self.clients:
                    frame = await self.snapshot()
                    if frame and frame != self.last_frame:
                        self.last_frame = frame
                        await self.broadcast({"t": "frame", "img": frame,
                                              "url": self.page.url})
                await asyncio.sleep(FRAME_INTERVAL)
            except asyncio.CancelledError:
                return
            except Exception:
                await asyncio.sleep(1.0)


async def get_session(sid):
    s = SESSIONS.get(sid)
    if not s:
        raise web.HTTPNotFound(text=json.dumps({"error": "no such session"}),
                               content_type="application/json")
    return s


# --------------------------------------------------------------------------
# element resolution helpers
# --------------------------------------------------------------------------
async def resolve(page, sel):
    """Resolve a selector to a locator + a human description + a position."""
    loc = page.locator(sel).first
    count = await page.locator(sel).count()
    if count == 0:
        return None, None, None
    try:
        await loc.wait_for(state="attached", timeout=4000)
    except Exception:
        pass
    box = None
    try:
        box = await loc.bounding_box()
    except Exception:
        pass
    pos = None
    if box:
        pos = {
            "x": round((box["x"] + box["width"] / 2) / VIEWPORT["width"] * 100, 2),
            "y": round((box["y"] + box["height"] / 2) / VIEWPORT["height"] * 100, 2),
        }
    desc = sel
    try:
        tag = await loc.evaluate("e => e.tagName.toLowerCase()")
        txt = (await loc.inner_text())[:40].strip().replace("\n", " ")
        desc = tag + (("\u201c" + txt + "\u201d") if txt else "")
    except Exception:
        pass
    return loc, desc, pos


# --------------------------------------------------------------------------
# actions
# --------------------------------------------------------------------------
async def do_action(s, body):
    page = s.page
    action = (body.get("action") or "").lower()
    sel = body.get("selector") or ""
    t0 = time.time()
    pos = None
    target = sel or action
    detail = ""
    ok = True

    if action == "goto":
        url = body.get("url") or ""
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=45000)
        s.url = page.url
        detail = "HTTP %s \u00b7 %s" % (resp.status if resp else "?", await page.title())
        target = url

    elif action == "click":
        loc, desc, pos = await resolve(page, sel)
        if loc is None:
            ok, detail = False, "no element matched " + sel
        else:
            target = desc
            await loc.scroll_into_view_if_needed(timeout=5000)
            await loc.click(timeout=10000)
            detail = "clicked " + desc

    elif action == "type":
        loc, desc, pos = await resolve(page, sel)
        if loc is None:
            ok, detail = False, "no element matched " + sel
        else:
            target = desc
            text = body.get("text", "")
            await loc.fill("")
            await loc.type(text, delay=18)
            detail = "typed %d chars into %s" % (len(text), desc)

    elif action == "press":
        key = body.get("key", "Enter")
        await page.keyboard.press(key)
        target = "keyboard"
        detail = "pressed " + key

    elif action == "scroll":
        dy = int(body.get("dy", 600))
        await page.mouse.wheel(0, dy)
        target = "viewport"
        detail = "scrolled %+d px" % dy

    elif action == "select":
        loc, desc, pos = await resolve(page, sel)
        if loc is None:
            ok, detail = False, "no element matched " + sel
        else:
            target = desc
            await loc.select_option(body.get("value", ""))
            detail = "selected %s in %s" % (body.get("value"), desc)

    elif action == "wait":
        ms = int(body.get("ms", 1000))
        await page.wait_for_timeout(ms)
        target = "clock"
        detail = "waited %d ms" % ms

    elif action == "extract":
        if sel:
            loc, desc, pos = await resolve(page, sel)
            if loc is None:
                ok, detail = False, "no element matched " + sel
            else:
                target = desc
                txt = await loc.inner_text()
                detail = txt[:400]
        else:
            txt = await page.inner_text("body")
            target = "document"
            detail = txt[:400]

    elif action == "eval":
        val = await page.evaluate(body.get("script", "1"))
        target = "page context"
        detail = json.dumps(val)[:400]

    else:
        ok, detail = False, "unknown action " + action

    ms = (time.time() - t0) * 1000
    entry = s.log(action, target, detail, ok=ok, ms=ms, pos=pos)
    frame = await s.snapshot()
    if frame:
        s.last_frame = frame
    await s.broadcast({"t": "step", "step": entry, "img": frame,
                       "url": page.url, "title": await page.title()})
    return {"ok": ok, "step": entry, "img": frame, "url": page.url,
            "title": await page.title()}


# --------------------------------------------------------------------------
# http handlers
# --------------------------------------------------------------------------
async def h_health(request):
    return web.json_response({
        "ok": True,
        "browser": "chromium",
        "engine": "playwright",
        "version": VERSION,
        "sessions": len(SESSIONS),
        "uptime": int(time.time() - STARTED),
        "viewport": VIEWPORT,
        "auth": bool(AUTH_TOKEN),
        "recording": sum(1 for s in SESSIONS.values() if s.recording),
    })


async def h_list(request):
    out = [await s.info() for s in SESSIONS.values()]
    return web.json_response({"sessions": out})


async def h_create(request):
    body = await request.json() if request.can_read_body else {}
    url = body.get("url") or "about:blank"
    if url != "about:blank" and not url.startswith(("http://", "https://")):
        url = "https://" + url
    context = await BROWSER.new_context(
        viewport=VIEWPORT,
        user_agent=("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"),
    )
    page = await context.new_page()
    sid = uuid.uuid4().hex[:12]
    s = Session(sid, context, page, url, label=(body.get("label") or "").strip())
    SESSIONS[sid] = s
    if url != "about:blank":
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            s.log("navigate", url, "opened " + url, ms=0)
        except Exception as e:
            s.log("navigate", url, "failed: " + str(e)[:120], ok=False)
    s.pump = asyncio.create_task(s.frame_loop())
    info = await s.info()
    info["img"] = await s.snapshot()
    return web.json_response(info)


async def h_detail(request):
    s = await get_session(request.match_info["id"])
    info = await s.info()
    info["history"] = s.history
    info["img"] = await s.snapshot()
    return web.json_response(info)


async def h_goto(request):
    s = await get_session(request.match_info["id"])
    body = await request.json()
    async with s.lock:
        r = await do_action(s, {"action": "goto", "url": body.get("url", "")})
    return web.json_response(r)


async def h_act(request):
    s = await get_session(request.match_info["id"])
    body = await request.json()
    async with s.lock:
        r = await do_action(s, body)
    return web.json_response(r)


async def h_nav(request):
    s = await get_session(request.match_info["id"])
    which = request.match_info["which"]
    async with s.lock:
        if which == "back":
            await s.page.go_back(wait_until="domcontentloaded", timeout=30000)
        elif which == "forward":
            await s.page.go_forward(wait_until="domcontentloaded", timeout=30000)
        else:
            await s.page.reload(wait_until="domcontentloaded", timeout=30000)
        entry = s.log(which, s.page.url, which + " \u2192 " + s.page.url)
        frame = await s.snapshot()
        await s.broadcast({"t": "step", "step": entry, "img": frame, "url": s.page.url})
    return web.json_response({"ok": True, "step": entry, "img": frame, "url": s.page.url})


async def h_mode(request):
    s = await get_session(request.match_info["id"])
    body = await request.json()
    s.mode = body.get("mode", "agent")
    await s.broadcast({"t": "mode", "mode": s.mode})
    return web.json_response({"ok": True, "mode": s.mode})


async def h_close(request):
    sid = request.match_info["id"]
    s = SESSIONS.pop(sid, None)
    if s:
        if s.pump:
            s.pump.cancel()
        try:
            await s.context.close()
        except Exception:
            pass
    return web.json_response({"ok": True, "closed": sid})


# --------------------------------------------------------------------------
# recording  (real Playwright tracing + a step log)
# --------------------------------------------------------------------------
async def h_rec_start(request):
    s = await get_session(request.match_info["id"])
    if s.recording:
        return web.json_response({"ok": True, "already": True,
                                  "started": s.rec_started})
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    await s.context.tracing.start(screenshots=True, snapshots=True, sources=True)
    s.recording = True
    s.rec_started = time.time()
    s.rec_steps = []
    s.log("record", "trace", "recording started")
    await s.broadcast({"t": "record", "recording": True})
    return web.json_response({"ok": True, "recording": True,
                              "started": s.rec_started})


async def h_rec_stop(request):
    s = await get_session(request.match_info["id"])
    if not s.recording:
        return web.json_response({"ok": False, "error": "not recording"}, status=400)
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    name = "trace-%s-%s" % (stamp, s.id[:6])
    zip_path = TRACE_DIR / (name + ".zip")
    steps_path = TRACE_DIR / (name + ".json")
    try:
        await s.context.tracing.stop(path=str(zip_path))
    except Exception as e:
        s.recording = False
        return web.json_response({"ok": False, "error": str(e)}, status=500)
    s.recording = False
    duration = round(time.time() - s.rec_started, 2)
    payload = {
        "name": name,
        "session": s.id,
        "url": s.url,
        "title": s.title,
        "started": s.rec_started,
        "duration": duration,
        "steps": s.rec_steps,
        "trace": "/traces/" + zip_path.name,
        "size": zip_path.stat().st_size if zip_path.exists() else 0,
    }
    steps_path.write_text(json.dumps(payload, indent=2))
    s.log("record", "trace", "saved %s (%d steps, %.1fs)" % (name, len(s.rec_steps), duration))
    await s.broadcast({"t": "record", "recording": False, "trace": payload})
    return web.json_response({"ok": True, "trace": payload,
                              "zip": "/traces/" + zip_path.name,
                              "steps": "/traces/" + steps_path.name})


async def h_traces(request):
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    out = []
    for p in sorted(TRACE_DIR.glob("*.json"), reverse=True):
        try:
            d = json.loads(p.read_text())
        except Exception:
            continue
        out.append({
            "name": d.get("name", p.stem),
            "url": d.get("url", ""),
            "title": d.get("title", ""),
            "duration": d.get("duration", 0),
            "steps": len(d.get("steps", [])),
            "trace": d.get("trace", ""),
            "steps_url": "/traces/" + p.name,
            "view_url": "/api/traces/" + p.stem + "/view",
            "size": d.get("size", 0),
        })
    return web.json_response({"traces": out})


async def h_trace_view(request):
    """Parse a saved trace.zip into the viewer model.

    This reads Playwright's own trace format, so the viewer shows the real
    call list and the real screencast frames rather than a re-logged summary.
    """
    name = request.match_info["name"]
    if "/" in name or ".." in name:
        raise web.HTTPBadRequest(text="bad name")
    zip_path = TRACE_DIR / (name + ".zip")
    if not zip_path.exists():
        raise web.HTTPNotFound(text=json.dumps({"error": "no such trace"}),
                               content_type="application/json")
    try:
        model = await asyncio.get_event_loop().run_in_executor(
            None, parse_trace, zip_path)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)[:300]}, status=500)
    model["ok"] = True
    model["zip_url"] = "/traces/" + zip_path.name
    return web.json_response(model)


async def h_trace_file(request):
    name = request.match_info["file"]
    if "/" in name or ".." in name:
        raise web.HTTPBadRequest(text="bad name")
    p = TRACE_DIR / name
    if not p.exists():
        raise web.HTTPNotFound(text="no such trace")
    ctype = "application/zip" if p.suffix == ".zip" else "application/json"
    return web.FileResponse(p, headers={"content-type": ctype})


async def h_ws(request):
    sid = request.match_info["id"]
    s = await get_session(sid)
    ws = web.WebSocketResponse(heartbeat=25)
    await ws.prepare(request)
    s.clients.add(ws)
    try:
        await ws.send_json({"t": "hello", "session": await s.info(),
                            "history": s.history,
                            "img": await s.snapshot()})
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    body = json.loads(msg.data)
                except Exception:
                    continue
                if body.get("action") == "ping":
                    await ws.send_json({"t": "pong"})
                    continue
                async with s.lock:
                    r = await do_action(s, body)
                await ws.send_json({"t": "result", "result": r})
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        s.clients.discard(ws)
    return ws


async def h_index(request):
    return web.json_response({
        "service": "recoder live browser",
        "version": VERSION,
        "uptime": int(time.time() - STARTED),
        "endpoints": ["/health", "/api/sessions", "/api/sessions/{id}",
                      "/api/sessions/{id}/goto", "/api/sessions/{id}/act",
                      "/api/sessions/{id}/back|forward|reload",
                      "/api/sessions/{id}/mode", "/api/sessions/{id}/close",
                      "/api/sessions/{id}/record/start", "/api/sessions/{id}/record/stop",
                      "/api/traces", "/api/traces/{name}/view",
                      "/traces/{file}", "/ws/{id}"],
    })


# --------------------------------------------------------------------------
# idle reaper
# --------------------------------------------------------------------------
async def reaper():
    while True:
        await asyncio.sleep(60)
        now = time.time()
        for sid, s in list(SESSIONS.items()):
            if now - s.touched > IDLE_TTL and not s.clients:
                SESSIONS.pop(sid, None)
                if s.pump:
                    s.pump.cancel()
                try:
                    await s.context.close()
                except Exception:
                    pass
                print("[live-browser] reaped idle session %s" % sid, flush=True)


# --------------------------------------------------------------------------
# boot
# --------------------------------------------------------------------------
async def on_startup(app):
    global PW, BROWSER
    PW = await async_playwright().start()
    BROWSER = await PW.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage",
              "--disable-blink-features=AutomationControlled"],
    )
    app["reaper"] = asyncio.create_task(reaper())
    print("[live-browser] chromium up", flush=True)


async def on_cleanup(app):
    t = app.get("reaper")
    if t:
        t.cancel()
    for s in list(SESSIONS.values()):
        if s.pump:
            s.pump.cancel()
        try:
            await s.context.close()
        except Exception:
            pass
    SESSIONS.clear()
    if BROWSER:
        await BROWSER.close()
    if PW:
        await PW.stop()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8787")))
    ap.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    args = ap.parse_args()

    app = web.Application(client_max_size=32 * 1024 * 1024)

    @web.middleware
    async def cors(request, handler):
        if request.method == "OPTIONS":
            resp = web.Response(status=204)
        else:
            try:
                resp = await handler(request)
            except web.HTTPException as e:
                resp = e
        origin = request.headers.get("Origin", "")
        # CORS is subtle behind a proxy. Many hosting proxies and tunnels
        # (Cloudflare, Daytona, ngrok, Fly's edge) inject their own
        # Access-Control-Allow-Origin. If we add a second one the browser
        # rejects the whole response with "contains multiple values ... but
        # only one is allowed", and every call fails.
        #
        # LB_CORS:
        #   auto (default) - skip our header when a forwarding proxy is
        #                    detected, otherwise send it
        #   on             - always send it (direct/self-hosted, no proxy)
        #   off            - never send it (proxy definitely handles it)
        # NOTE: fly-client-ip is deliberately NOT in this list. Fly's edge
        # sets it on every request but does NOT inject an
        # Access-Control-Allow-Origin of its own (verified against a live
        # deployment: /health and /api/sessions both came back with no ACAO
        # header at all). Treating it as "a proxy handles CORS" made auto
        # mode skip our header on every Fly deployment, so the browser
        # blocked every call. Only headers from proxies that really do
        # rewrite CORS belong here.
        proxied = any(request.headers.get(h) for h in
                      ("x-forwarded-for", "x-forwarded-proto", "x-real-ip",
                       "cf-ray", "cf-connecting-ip"))
        send_cors = (CORS_MODE == "on") or (CORS_MODE == "auto" and not proxied)
        if send_cors:
            if ORIGINS == "*":
                resp.headers["Access-Control-Allow-Origin"] = "*"
            elif origin in [o.strip() for o in ORIGINS.split(",")]:
                resp.headers["Access-Control-Allow-Origin"] = origin
                resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "content-type, authorization"
        resp.headers["Access-Control-Max-Age"] = "86400"
        return resp

    @web.middleware
    async def auth(request, handler):
        if not AUTH_TOKEN or request.method == "OPTIONS":
            return await handler(request)
        if request.path in ("/", "/health"):
            return await handler(request)
        hdr = request.headers.get("Authorization", "")
        # A browser cannot set headers on a WebSocket handshake, so the token
        # may also arrive as ?token= on the /ws upgrade. Accept either.
        qs_token = request.query.get("token", "")
        if hdr != "Bearer " + AUTH_TOKEN and qs_token != AUTH_TOKEN:
            return web.json_response({"error": "unauthorized"}, status=401)
        return await handler(request)

    app.middlewares.append(cors)
    app.middlewares.append(auth)

    app.router.add_get("/", h_index)
    app.router.add_get("/health", h_health)
    app.router.add_get("/api/sessions", h_list)
    app.router.add_post("/api/sessions", h_create)
    app.router.add_get("/api/sessions/{id}", h_detail)
    app.router.add_post("/api/sessions/{id}/goto", h_goto)
    app.router.add_post("/api/sessions/{id}/act", h_act)
    app.router.add_post("/api/sessions/{id}/{which:back|forward|reload}", h_nav)
    app.router.add_post("/api/sessions/{id}/mode", h_mode)
    app.router.add_post("/api/sessions/{id}/close", h_close)
    app.router.add_post("/api/sessions/{id}/record/start", h_rec_start)
    app.router.add_post("/api/sessions/{id}/record/stop", h_rec_stop)
    app.router.add_get("/api/traces", h_traces)
    app.router.add_get("/api/traces/{name}/view", h_trace_view)
    app.router.add_get("/traces/{file}", h_trace_file)
    app.router.add_get("/ws/{id}", h_ws)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    print("[live-browser] listening on %s:%d" % (args.host, args.port), flush=True)
    web.run_app(app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
