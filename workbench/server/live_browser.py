#!/usr/bin/env python3
"""
Live Playwright browser server for </recode>.

HTTP contract
-------------
GET  /health
POST /api/sessions                         {"url": "https://example.com"}
POST /api/sessions/{id}/goto               {"url": "https://example.com"}
POST /api/sessions/{id}/act                {"instruction": "click ..."}
POST /api/sessions/{id}/back
POST /api/sessions/{id}/forward
POST /api/sessions/{id}/reload
POST /api/sessions/{id}/mode               {"mode": "agent|takeover|recording|idle"}
WS   /ws/{id}

The WebSocket emits JSON messages such as:
  {"type":"state", "session": {...}}
  {"type":"screenshot", "data":"<base64 jpeg>"}
  {"type":"action", "label":"click", "status":"done"}
  {"type":"trace", "trace": {...}}

Configuration
-------------
LB_PORT       Listen port, default 8788
LB_HOST       Listen address, default 0.0.0.0
LB_TOKEN      Optional bearer/query token required by API and WebSocket calls
LB_MAX_SESSIONS Maximum simultaneous browser sessions, default 4
LB_SESSION_TTL Session idle timeout in seconds, default 1800
LB_SCREENSHOT_MS Screenshot interval, default 750
LB_HEADLESS   1/true for headless Chromium, default true
LB_ARTIFACT_DIR Directory for Playwright trace files, default ./artifacts

Install
-------
pip install aiohttp playwright
python3 -m playwright install chromium
python3 server/live_browser.py

This service is deliberately bounded and does not expose arbitrary Python or
shell execution. The browser can still visit external pages, so deploy it
behind authentication and a network policy appropriate for the environment.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional, Set
from urllib.parse import urlparse

from aiohttp import WSMsgType, web

try:
    from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright
except ImportError as exc:  # pragma: no cover - gives a useful startup error
    raise SystemExit(
        "Playwright is required. Install with `pip install aiohttp playwright` "
        "and then run `python3 -m playwright install chromium`."
    ) from exc


HOST = os.environ.get("LB_HOST", "0.0.0.0")
PORT = int(os.environ.get("LB_PORT", "8788"))
TOKEN = os.environ.get("LB_TOKEN", "").strip()
MAX_SESSIONS = max(1, min(int(os.environ.get("LB_MAX_SESSIONS", "4")), 20))
SESSION_TTL = max(60, int(os.environ.get("LB_SESSION_TTL", "1800")))
SCREENSHOT_MS = max(250, min(int(os.environ.get("LB_SCREENSHOT_MS", "750")), 5000))
HEADLESS = os.environ.get("LB_HEADLESS", "true").lower() not in {"0", "false", "no"}
ARTIFACT_DIR = Path(os.environ.get("LB_ARTIFACT_DIR", "artifacts"))
MAX_BODY = 64 * 1024
MAX_ACTION = 2000
MAX_URL = 4096

CORS_HEADERS = {
    "Access-Control-Allow-Origin": os.environ.get("LB_ORIGIN", "*"),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,authorization",
    "Access-Control-Max-Age": "600",
}


def now() -> float:
    return time.time()


def json_response(data: Any, status: int = 200) -> web.Response:
    response = web.Response(status=status) if status == 204 else web.json_response(data, status=status)
    for key, value in CORS_HEADERS.items():
        response.headers[key] = value
    return response


def authorized(request: web.Request) -> bool:
    if not TOKEN:
        return True
    value = request.headers.get("Authorization", "")
    if value.lower().startswith("bearer ") and secrets.compare_digest(value[7:].strip(), TOKEN):
        return True
    query_token = request.query.get("token", "")
    return bool(query_token) and secrets.compare_digest(query_token, TOKEN)


def auth_error() -> web.Response:
    return json_response({"ok": False, "error": "unauthorized"}, 401)


async def read_json(request: web.Request) -> Dict[str, Any]:
    if request.content_length and request.content_length > MAX_BODY:
        raise web.HTTPRequestEntityTooLarge(max_size=MAX_BODY, actual_size=request.content_length)
    try:
        body = await request.read()
        if len(body) > MAX_BODY:
            raise web.HTTPRequestEntityTooLarge(max_size=MAX_BODY, actual_size=len(body))
        if not body:
            return {}
        value = json.loads(body.decode("utf-8"))
        if not isinstance(value, dict):
            raise web.HTTPBadRequest(text="JSON body must be an object")
        return value
    except json.JSONDecodeError as exc:
        raise web.HTTPBadRequest(text="Invalid JSON body") from exc


def clean_url(value: Any) -> str:
    url = str(value or "").strip()
    if not url or len(url) > MAX_URL:
        raise web.HTTPBadRequest(text="A URL is required and must be shorter than 4096 characters")
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https", "about", "data"}:
        raise web.HTTPBadRequest(text="Only http, https, about, and data URLs are allowed")
    return url


@dataclass
class Session:
    id: str
    context: BrowserContext
    page: Page
    created_at: float = field(default_factory=now)
    last_used: float = field(default_factory=now)
    mode: str = "idle"
    url: str = "about:blank"
    websockets: Set[web.WebSocketResponse] = field(default_factory=set)
    screenshot_task: Optional[asyncio.Task] = None
    trace_started: bool = False
    trace_path: Optional[Path] = None
    action_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def touch(self) -> None:
        self.last_used = now()

    def summary(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "url": self.url,
            "mode": self.mode,
            "created_at": self.created_at,
            "last_used": self.last_used,
            "clients": len(self.websockets),
            "recording": self.trace_started,
        }


class LiveBrowser:
    def __init__(self) -> None:
        self.playwright: Optional[Playwright] = None
        self.browser: Optional[Browser] = None
        self.sessions: Dict[str, Session] = {}
        self.lock = asyncio.Lock()
        self.reaper_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=HEADLESS)
        self.reaper_task = asyncio.create_task(self.reap_loop())

    async def stop(self) -> None:
        if self.reaper_task:
            self.reaper_task.cancel()
            await asyncio.gather(self.reaper_task, return_exceptions=True)
        async with self.lock:
            ids = list(self.sessions)
        for session_id in ids:
            await self.close_session(session_id)
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()

    async def reap_loop(self) -> None:
        while True:
            await asyncio.sleep(30)
            cutoff = now() - SESSION_TTL
            async with self.lock:
                expired = [sid for sid, s in self.sessions.items() if s.last_used < cutoff and not s.websockets]
            for session_id in expired:
                await self.close_session(session_id)

    async def create_session(self, url: str) -> Session:
        if not self.browser:
            raise web.HTTPServiceUnavailable(text="Browser is still starting")
        async with self.lock:
            if len(self.sessions) >= MAX_SESSIONS:
                raise web.HTTPTooManyRequests(text="Maximum live browser sessions reached")
            session_id = secrets.token_urlsafe(12)
            context = await self.browser.new_context(
                viewport={"width": 1280, "height": 800},
                device_scale_factor=1,
                ignore_https_errors=False,
            )
            page = await context.new_page()
            session = Session(id=session_id, context=context, page=page, url=url)
            self.sessions[session_id] = session
        await self.navigate(session, url)
        session.screenshot_task = asyncio.create_task(self.screenshot_loop(session))
        return session

    async def get(self, session_id: str) -> Session:
        async with self.lock:
            session = self.sessions.get(session_id)
        if not session:
            raise web.HTTPNotFound(text="Unknown browser session")
        session.touch()
        return session

    async def close_session(self, session_id: str) -> None:
        async with self.lock:
            session = self.sessions.pop(session_id, None)
        if not session:
            return
        if session.screenshot_task:
            session.screenshot_task.cancel()
            await asyncio.gather(session.screenshot_task, return_exceptions=True)
        try:
            if session.trace_started:
                await self.stop_trace(session)
            await session.context.close()
        except Exception:
            pass

    async def navigate(self, session: Session, url: str) -> Dict[str, Any]:
        async with session.action_lock:
            session.touch()
            await session.page.goto(url, wait_until="domcontentloaded", timeout=30000)
            session.url = session.page.url
            await self.broadcast(session, {"type": "state", "session": session.summary()})
            return {"ok": True, "session": session.summary()}

    async def screenshot_loop(self, session: Session) -> None:
        interval = SCREENSHOT_MS / 1000
        while True:
            await asyncio.sleep(interval)
            if not session.websockets:
                continue
            try:
                image = await session.page.screenshot(type="jpeg", quality=65, animations="disabled")
                await self.broadcast(session, {
                    "type": "screenshot",
                    "data": base64.b64encode(image).decode("ascii"),
                    "url": session.page.url,
                })
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                await self.broadcast(session, {"type": "action", "label": "screenshot", "status": "error", "detail": str(exc)[:200]})

    async def broadcast(self, session: Session, payload: Dict[str, Any]) -> None:
        if not session.websockets:
            return
        message = json.dumps(payload, ensure_ascii=False)
        stale = []
        for socket in list(session.websockets):
            try:
                await socket.send_str(message)
            except Exception:
                stale.append(socket)
        for socket in stale:
            session.websockets.discard(socket)

    async def set_mode(self, session: Session, mode: str) -> Dict[str, Any]:
        mode = str(mode or "idle").lower()
        if mode not in {"agent", "takeover", "recording", "idle"}:
            raise web.HTTPBadRequest(text="mode must be agent, takeover, recording, or idle")
        async with session.action_lock:
            if mode == "recording" and not session.trace_started:
                session.trace_path = ARTIFACT_DIR / f"trace-{session.id}-{int(now())}.zip"
                await session.context.tracing.start(screenshots=True, snapshots=True, sources=False)
                session.trace_started = True
            elif mode != "recording" and session.trace_started:
                await self.stop_trace(session)
            session.mode = mode
            session.touch()
            await self.broadcast(session, {"type": "mode", "mode": mode, "session": session.summary()})
            return {"ok": True, "session": session.summary()}

    async def stop_trace(self, session: Session) -> Optional[Dict[str, Any]]:
        if not session.trace_started:
            return None
        path = session.trace_path or (ARTIFACT_DIR / f"trace-{session.id}-{int(now())}.zip")
        try:
            await session.context.tracing.stop(path=str(path))
        finally:
            session.trace_started = False
            session.trace_path = None
        trace = {"path": str(path), "name": path.name, "created_at": now()}
        await self.broadcast(session, {"type": "trace", "trace": trace})
        return trace

    async def act(self, session: Session, instruction: str) -> Dict[str, Any]:
        instruction = str(instruction or "").strip()
        if not instruction or len(instruction) > MAX_ACTION:
            raise web.HTTPBadRequest(text=f"instruction must be 1-{MAX_ACTION} characters")
        low = instruction.lower()
        async with session.action_lock:
            session.touch()
            if re.match(r"^(open|go to|navigate to)\s+", low):
                target = re.sub(r"^(open|go to|navigate to)\s+", "", instruction, flags=re.I).strip()
                if not urlparse(target).scheme:
                    target = "https://" + target
                await session.page.goto(clean_url(target), wait_until="domcontentloaded", timeout=30000)
                session.url = session.page.url
                await self.broadcast(session, {"type": "state", "session": session.summary()})
                return {"ok": True, "session": session.summary()}
            match = re.match(r"^(?:click|press)\s+(.+)$", instruction, flags=re.I)
            if match:
                selector = match.group(1).strip()
                await session.page.locator(selector).first.click(timeout=15000)
                return await self.action_ok(session, "click", selector)
            match = re.match(r"^(?:type|fill)\s+(.+?)\s+(?:into|in)\s+(.+)$", instruction, flags=re.I)
            if match:
                text, selector = match.group(1), match.group(2)
                await session.page.locator(selector).first.fill(text, timeout=15000)
                return await self.action_ok(session, "type", selector)
            match = re.match(r"^(?:read|get text from)\s+(.+)$", instruction, flags=re.I)
            if match:
                selector = match.group(1).strip()
                text = await session.page.locator(selector).first.inner_text(timeout=15000)
                await self.broadcast(session, {"type": "action", "label": "read", "status": "done", "detail": selector, "result": text[:10000]})
                return {"ok": True, "result": text[:10000], "session": session.summary()}
            match = re.match(r"^scroll(?:\s+(up|down))?(?:\s+(\d+))?$", low)
            if match:
                direction = -1 if match.group(1) == "up" else 1
                amount = min(int(match.group(2) or 600), 5000)
                await session.page.mouse.wheel(0, direction * amount)
                return await self.action_ok(session, "scroll", f"{direction * amount}px")
            raise web.HTTPBadRequest(text="Unsupported action. Use open, click, type/fill, read, or scroll.")

    async def action_ok(self, session: Session, label: str, detail: str) -> Dict[str, Any]:
        payload = {"type": "action", "label": label, "status": "done", "detail": detail}
        await self.broadcast(session, payload)
        return {"ok": True, "session": session.summary(), "action": payload}


browser = LiveBrowser()


@web.middleware
async def cors_and_errors(request: web.Request, handler):
    if request.method == "OPTIONS":
        return json_response({}, 204)
    try:
        response = await handler(request)
    except web.HTTPException as exc:
        response = json_response({"ok": False, "error": exc.text or exc.reason}, exc.status)
    except Exception as exc:  # never leak a traceback to the browser
        print(f"live-browser error: {request.method} {request.path}: {exc}")
        response = json_response({"ok": False, "error": "internal_server_error"}, 500)
    for key, value in CORS_HEADERS.items():
        response.headers[key] = value
    return response


async def health(request: web.Request) -> web.Response:
    return json_response({
        "ok": True,
        "service": "live-browser",
        "version": "1.0.0",
        "browser": "chromium",
        "headless": HEADLESS,
        "sessions": len(browser.sessions),
        "max_sessions": MAX_SESSIONS,
        "token_configured": bool(TOKEN),
    })


async def create_session(request: web.Request) -> web.Response:
    body = await read_json(request)
    session = await browser.create_session(clean_url(body.get("url", "about:blank")))
    return json_response({"ok": True, "session": session.summary()})


async def session_goto(request: web.Request) -> web.Response:
    session = await browser.get(request.match_info["session_id"])
    body = await read_json(request)
    return json_response(await browser.navigate(session, clean_url(body.get("url"))))


async def session_act(request: web.Request) -> web.Response:
    session = await browser.get(request.match_info["session_id"])
    body = await read_json(request)
    instruction = body.get("instruction") or body.get("action")
    return json_response(await browser.act(session, instruction))


async def session_navigation(request: web.Request) -> web.Response:
    session = await browser.get(request.match_info["session_id"])
    action = request.match_info["action"]
    async with session.action_lock:
        if action == "back":
            await session.page.go_back(wait_until="domcontentloaded", timeout=30000)
        elif action == "forward":
            await session.page.go_forward(wait_until="domcontentloaded", timeout=30000)
        elif action == "reload":
            await session.page.reload(wait_until="domcontentloaded", timeout=30000)
        else:
            raise web.HTTPNotFound(text="Unknown navigation action")
        session.url = session.page.url
        session.touch()
    await browser.broadcast(session, {"type": "state", "session": session.summary()})
    return json_response({"ok": True, "session": session.summary()})


async def session_mode(request: web.Request) -> web.Response:
    session = await browser.get(request.match_info["session_id"])
    body = await read_json(request)
    return json_response(await browser.set_mode(session, body.get("mode")))


async def websocket(request: web.Request) -> web.StreamResponse:
    session = await browser.get(request.match_info["session_id"])
    socket = web.WebSocketResponse(heartbeat=20)
    await socket.prepare(request)
    session.websockets.add(socket)
    session.touch()
    await socket.send_json({"type": "state", "session": session.summary()})
    try:
        async for message in socket:
            if message.type == WSMsgType.TEXT:
                # Optional client-side action channel. HTTP remains the primary
                # contract, but accepting JSON here makes the client extensible.
                try:
                    payload = json.loads(message.data)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict) and payload.get("action"):
                    try:
                        await browser.act(session, payload["action"])
                    except Exception as exc:
                        await socket.send_json({"type": "action", "label": "action", "status": "error", "detail": str(exc)[:300]})
            elif message.type == WSMsgType.ERROR:
                break
    finally:
        session.websockets.discard(socket)
        session.touch()
    return socket


async def on_startup(app: web.Application) -> None:
    await browser.start()


async def on_cleanup(app: web.Application) -> None:
    await browser.stop()


def create_app() -> web.Application:
    app = web.Application(middlewares=[auth_middleware, cors_and_errors], client_max_size=MAX_BODY)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    app.router.add_route("OPTIONS", "/{tail:.*}", lambda request: json_response({}, 204))
    app.router.add_get("/health", health)
    app.router.add_post("/api/sessions", create_session)
    app.router.add_post("/api/sessions/{session_id}/goto", session_goto)
    app.router.add_post("/api/sessions/{session_id}/act", session_act)
    app.router.add_post("/api/sessions/{session_id}/{action:back|forward|reload}", session_navigation)
    app.router.add_post("/api/sessions/{session_id}/mode", session_mode)
    app.router.add_get("/ws/{session_id}", websocket)
    return app


# Apply auth after route setup, while keeping /health public for diagnostics.
@web.middleware
async def auth_middleware(request: web.Request, handler):
    if request.method != "OPTIONS" and request.path != "/health" and not authorized(request):
        return auth_error()
    return await handler(request)


if __name__ == "__main__":
    application = create_app()
    web.run_app(application, host=HOST, port=PORT)
