# </recode> — workbench

A browser-based code workbench with GitHub integration, a live Playwright browser,
and AI provider + agent integration. This directory (`workbench/`) is the
runnable app; the rest of the repository is the Manus-managed Expo project.

The product name is **`</recode>`** — the `/` renders in red, it is not a typo.

```
workbench/
  index.html          app shell — markup only (no inline CSS/JS)
  app.css             all styling (fluid clamp() sizing, 320px → 2560px)
  app.js              core: editor, explorer, tabs, panes, settings, palette
  model-catalogue.js  48 models across 8 providers
  radarmatrix.js      RADARMatrix — the project's own source AI
  live-browser.js     live Playwright browser surface
  manus.js            Manus client (this integration)
  server/
    live_browser.py   Playwright server — drives real pages, records traces
    radar_gateway.py  reference RADARMatrix gateway (MCP + OpenAI-compatible)
    manus_proxy.py    Manus API proxy  ← required, see below
    Dockerfile, fly.toml, render.yaml, railway.json, docker-compose.yml
  docs/
    report.md                    full build report
    radarmatrix-handover.md      RADARMatrix integration contract
```

## Run it

The page is static; open `index.html` over HTTP (not `file://`).

```bash
cd workbench && python3 -m http.server 8899
```

Servers are optional and independent:

```bash
# live browser (needs chromium: python3 -m playwright install chromium)
pip install aiohttp playwright
LB_PORT=8788 LB_TOKEN=devtok python3 server/live_browser.py

# Manus proxy
pip install aiohttp
MANUS_API_KEY=... MP_PORT=8790 python3 server/manus_proxy.py
```

Then in the app: **Browser → Live browser server** and **Manus → Configure**.

## Manus integration

### Why a proxy is unavoidable

`api.manus.ai` cannot be called from a browser page. Verified against the live
service on 2026-11-23:

```
OPTIONS /v2/task.list
  Origin: https://example.com
  Access-Control-Request-Headers: x-manus-api-key
→ 204, no access-control-allow-origin at all

Same preflight with Origin: https://manus.im
→ 204, access-control-allow-origin: https://manus.im
```

The preflight only passes for Manus's own origin, so the browser blocks the
request before it is sent. The key must travel in `x-manus-api-key`, which
always triggers a preflight — so there is no way around this from a page on
another origin. `server/manus_proxy.py` exists because of it, and the key
stays on the server.

### API surface used

Manus API v2 (<https://open.manus.ai/docs/v2>), all proxied:

| Workbench call | Manus endpoint | Notes |
|---|---|---|
| `GET /api/manus/me` | `GET /v2/user.me` | identity / credential check |
| `GET /api/manus/tasks` | `GET /v2/task.list` | task history |
| `POST /api/manus/tasks` | `POST /v2/task.create` | accepts `{prompt, title}` or the full shape |
| `GET /api/manus/task?id=` | `GET /v2/task.detail` | status |
| `GET /api/manus/messages?id=` | `GET /v2/task.listMessages` | transcript |
| `POST /api/manus/message` | `POST /v2/task.sendMessage` | follow-up turn |
| `POST /api/manus/webhook` | `POST /v2/webhook.create` | callback registration |
| `GET /api/manus/watch?id=` | — | SSE wrapper over listMessages + detail |

Rate limits are per user and surfaced from upstream headers:
**10/min** for `task.create` + `task.sendMessage`, **100/min** for reads.

### How the panel works

`manus.js` keeps `MN` state in `localStorage` (`recode-manus-v1`) holding only
the proxy URL, the proxy token and an optional per-request key — never a
secret that matters, and never the server-side key.

The panel renders connection state, a new-task composer, the active task with
its live transcript, task history, and a proxy call log with per-call latency.
The transcript distinguishes user / assistant / tool / status / error messages
and renders code fences, inline code and links.

Progress is pushed, not polled by the browser: `/api/manus/watch` is an SSE
stream that emits `message` events for new transcript entries and `status`
events with the task status, then terminates when the task reaches
`completed`, `failed`, `stopped` or `error`.

## Deploying

`server/Dockerfile` builds both Python servers. `fly.toml`, `render.yaml`,
`railway.json` and `docker-compose.yml` are ready as-is; any of them yields a
permanent HTTPS URL.

For Manus, set at minimum:

```
MANUS_API_KEY=<key from manus.im → Settings → Developers>
MP_TOKEN=<long random string>
```

`MP_CORS=auto` (the default) detects a forwarding host and stops emitting its
own `Access-Control-Allow-Origin`, because a duplicated header is a hard CORS
failure. Set `MP_CORS=on` only when the server is reached directly.

## Status

**Verified**
- The Manus preflight behaviour above, against the live service.
- The proxy boots, `/health` reports upstream reachability, and every route
  relays Manus's real envelope — a bogus key returns Manus's own 401 with a
  real `request_id`, proving the request reached Manus and the response came
  back through the proxy.
- The deployed page: `</recode>` wordmark with the `/` in red, the Manus rail
  destination, the panel, the Configure modal, and a real fetch from the page
  to the proxy.
- Layout: 0 horizontal overflow from 320×568 to 2560×1440; 0 console errors.

**Not verified — needs a credential or an account**
1. **No end-to-end Manus task was run.** Creating a task needs a real
   `MANUS_API_KEY`, which this environment does not have. The request is built
   and sent correctly and Manus's rejection comes back intact, but no task has
   ever been created, so the success path (task id, transcript, SSE stream)
   is untested against a live task.
2. **No server is permanently hosted.** Both servers are files in this repo;
   they must be deployed for the browser to reach them, because a browser page
   cannot reach localhost of the machine the deploy runs on.
