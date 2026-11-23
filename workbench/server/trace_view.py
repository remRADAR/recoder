#!/usr/bin/env python3
"""
Playwright trace -> viewer model
================================
Turns a real Playwright `trace.zip` into the structure the workbench's trace
viewer renders: the ordered action list (from the `before`/`after` call pairs),
the screencast frames, and the frame each action should be shown against.

This parses Playwright's own trace format (v7/v8), not a bespoke log, so a
trace recorded by `playwright show-trace`, by the live browser server, or by
any Playwright test run opens the same way.

Format notes (v8)
-----------------
trace.trace is newline-delimited JSON. Relevant record types:

  context-options   once, at the top: browserName, options.viewport, sdkLanguage
  before            {callId, startTime, class, method, params, pageId}
  after             {callId, endTime, error?}          -- pairs with `before`
  screencast-frame  {sha1, width, height, timestamp}   -- timestamp is ms
  frame-snapshot    DOM snapshot (not needed for the viewer)
  log               console / browser log lines
  input             raw input events

Screencast images live in resources/<sha1> inside the same zip.
"""
import base64
import json
import zipfile
from pathlib import Path

# Playwright's internal API classes are noisy in a UI; map them to something
# a person reading the trace can act on.
CLASS_LABEL = {
    "Frame": "page",
    "Page": "page",
    "BrowserContext": "context",
    "ElementHandle": "element",
    "Locator": "locator",
    "Keyboard": "keyboard",
    "Mouse": "mouse",
    "Route": "network",
    "Request": "network",
    "Response": "network",
    "Tracing": "trace",
    "Worker": "worker",
}

# Methods that are bookkeeping rather than something the user did.
NOISE = {
    "expect", "querySelector", "querySelectorAll", "waitForSelector",
    "waitForLoadState", "waitForTimeout", "evaluateExpression",
    "evaluateExpressionHandle", "setInputFiles", "isVisible", "isEnabled",
    "isChecked", "isEditable", "isHidden", "textContent", "innerText",
    "getAttribute", "boundingBox", "count", "allTextContents",
    "waitForFunction", "waitForEvent", "addInitScript", "setViewportSize",
    "setExtraHTTPHeaders", "route", "unroute", "newPage", "close",
    "start", "stop", "setDefaultTimeout", "setDefaultNavigationTimeout",
    # internal bookkeeping Playwright emits around every locator call
    "queryCount", "dispose", "screenshot", "waitForElementState",
    "highlight", "scrollIntoViewIfNeeded", "isDisabled",
    "inputValue", "evaluateAll", "ariaSnapshot",
}

MAX_RESOURCE_BYTES = 6 * 1024 * 1024   # per image, guard against huge frames


def _read_lines(zf, name):
    try:
        raw = zf.read(name)
    except KeyError:
        return []
    out = []
    for line in raw.decode("utf-8", "replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def _short(v, n=160):
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    s = s.replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "\u2026"


def _describe(method, params):
    """A one-line, human description of what the call did."""
    p = params or {}
    if method == "goto":
        return "navigate to " + _short(p.get("url", ""), 90)
    if method == "click":
        return "click " + _short(p.get("selector", p.get("locator", "")), 90)
    if method in ("fill", "type", "pressSequentially"):
        return "%s %s into %s" % (
            "type" if method != "fill" else "fill",
            _short(p.get("value", p.get("text", "")), 40),
            _short(p.get("selector", p.get("locator", "")), 70),
        )
    if method == "press":
        return "press " + _short(p.get("key", ""), 20)
    if method in ("selectOption",):
        return "select " + _short(p.get("values", p.get("value", "")), 40)
    if method in ("goBack", "goForward", "reload"):
        return {"goBack": "back", "goForward": "forward", "reload": "reload"}[method]
    if method in ("waitForNavigation", "waitForURL"):
        return "wait for navigation"
    if method == "setContent":
        return "set page content"
    if method == "title":
        return "read page title"
    if method == "url":
        return "read page url"
    # generic: method + the most useful param
    for k in ("selector", "locator", "url", "key", "value", "text", "name"):
        if p.get(k):
            return "%s %s" % (method, _short(p[k], 80))
    return method


def parse_trace(path):
    """Parse a trace.zip into a viewer model. Raises on a non-trace zip."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(str(path))
    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        if "trace.trace" not in names:
            raise ValueError("not a Playwright trace: trace.trace missing")

        records = _read_lines(zf, "trace.trace")

        meta = {"browserName": "", "viewport": None, "sdkLanguage": "",
                "userAgent": "", "version": None}
        befores = {}
        order = []
        frames = []
        logs = []

        for r in records:
            t = r.get("type")
            if t == "context-options":
                meta["version"] = r.get("version")
                meta["browserName"] = r.get("browserName", "")
                meta["sdkLanguage"] = r.get("sdkLanguage", "")
                opts = r.get("options") or {}
                meta["viewport"] = opts.get("viewport")
                meta["userAgent"] = opts.get("userAgent", "")
            elif t == "before":
                cid = r.get("callId")
                befores[cid] = r
                order.append(cid)
            elif t == "screencast-frame":
                frames.append({
                    "sha1": r.get("sha1", ""),
                    "w": r.get("width", 0),
                    "h": r.get("height", 0),
                    "t": round(float(r.get("timestamp", 0)), 1),
                })
            elif t == "log":
                msg = r.get("message", "")
                if msg:
                    logs.append({"t": round(float(r.get("time", 0)), 1),
                                 "level": r.get("level", "info"),
                                 "message": _short(msg, 300)})

        afters = {}
        for r in records:
            if r.get("type") == "after":
                afters[r.get("callId")] = r

        frames.sort(key=lambda f: f["t"])

        def frame_at(ts):
            """Index of the last screencast frame at or before ts."""
            lo, hi, best = 0, len(frames) - 1, -1
            while lo <= hi:
                mid = (lo + hi) // 2
                if frames[mid]["t"] <= ts:
                    best = mid
                    lo = mid + 1
                else:
                    hi = mid - 1
            return best

        actions = []
        for cid in order:
            b = befores.get(cid) or {}
            a = afters.get(cid) or {}
            method = b.get("method", "")
            cls = b.get("class", "")
            if method in NOISE:
                continue
            start = float(b.get("startTime", 0) or 0)
            end = float(a.get("endTime", start) or start)
            err = a.get("error")
            if isinstance(err, dict):
                err = err.get("message") or err.get("name") or "error"
            actions.append({
                "i": len(actions) + 1,
                "callId": cid,
                "class": cls,
                "kind": CLASS_LABEL.get(cls, cls.lower() or "call"),
                "method": method,
                "params": b.get("params") or {},
                "desc": _describe(method, b.get("params")),
                "start": round(start, 1),
                "end": round(end, 1),
                "ms": round(max(0.0, end - start), 1),
                "error": _short(err, 200) if err else None,
                "frame": frame_at(start),
            })

        # Only ship the screencast images the viewer will actually show.
        resources = {}
        for f in frames:
            sha = f["sha1"]
            if not sha or sha in resources:
                continue
            key = "resources/" + sha
            if key not in names:
                continue
            try:
                info = zf.getinfo(key)
                if info.file_size > MAX_RESOURCE_BYTES:
                    continue
                blob = zf.read(key)
            except Exception:
                continue
            mime = "image/jpeg" if sha.lower().endswith((".jpeg", ".jpg")) else "image/png"
            resources[sha] = "data:%s;base64,%s" % (
                mime, base64.b64encode(blob).decode("ascii"))

        duration = 0.0
        if actions:
            duration = round((actions[-1]["end"] - actions[0]["start"]) / 1000.0, 2)
        elif frames:
            duration = round((frames[-1]["t"] - frames[0]["t"]) / 1000.0, 2)

        return {
            "name": path.stem,
            "size": path.stat().st_size,
            "meta": meta,
            "duration": duration,
            "actions": actions,
            "frames": frames,
            "resources": resources,
            "logs": logs[:200],
            "counts": {
                "actions": len(actions),
                "frames": len(frames),
                "logs": len(logs),
                "errors": sum(1 for x in actions if x["error"]),
            },
        }


if __name__ == "__main__":  # quick manual check
    import sys
    d = parse_trace(sys.argv[1])
    print(json.dumps({k: d[k] for k in ("name", "duration", "counts", "meta")}, indent=2))
    for a in d["actions"][:12]:
        print("%3d %-8s %-14s %-52s %6.1fms frame=%d" % (
            a["i"], a["kind"], a["method"], a["desc"][:52], a["ms"], a["frame"]))
