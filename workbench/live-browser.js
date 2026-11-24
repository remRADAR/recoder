/* ============================================================
   LIVE BROWSER  —  real Playwright sessions over HTTP + WebSocket
   ============================================================
   The workbench hosts its own browser surface. This module talks to a
   real Playwright/Chromium server (server/live_browser.py) either on the
   same origin or through a public tunnel, streams live frames, drives the
   page with real actions, and lets the user take over.

   v1.2 adds:
     - multi-session tabs: several live pages open at once, each with its
       own page, history, frame and mode; switch between them freely
     - a real Playwright trace viewer: parses trace.zip (Playwright's own
       format) and replays the recorded screencast frame by frame
   ============================================================ */
const LB = {
  base: '',            // server origin, e.g. https://xxx.trycloudflare.com
  ws: null,
  sid: null,           // the ACTIVE session
  url: '',
  title: '',
  mode: 'idle',        // idle | agent | manual
  steps: [],
  img: null,
  connected: false,
  busy: false,
  sessions: [],        // server truth: every live session
  tabs: {},            // sid -> {steps, img, url, title, lastPos, mode}
  lastPos: null,
  retry: 0,
  health: null,
  recording: false,
  recStart: 0,
  traces: [],
  lastTrace: null,
  token: '',           // optional bearer token, when the server sets LB_TOKEN
  viewer: null,        // parsed trace model currently open
  trvIdx: 0,
  trvTimer: null
};
const LB_LS = 'recoder-lb-v1';
/* The deployed server. A live browser server is a real process with a real
   Chromium in it — it cannot be shipped inside a static page, so this points
   at the Fly.io deployment (server/deploy.sh) rather than at anything local.
   It is only a default: whatever the user sets in Browser -> Live browser
   server is stored in localStorage and wins over this. */
const LB_DEFAULT = 'https://recoder.fly.dev';

function lbLoad() {
  try {
    const raw = localStorage.getItem(LB_LS);
    if (raw) { const o = JSON.parse(raw); LB.base = o.base || ''; LB.token = o.token || ''; }
  } catch (e) {}
  if (!LB.base) LB.base = LB_DEFAULT;
}
function lbSave() {
  try { localStorage.setItem(LB_LS, JSON.stringify({ base: LB.base, token: LB.token })); } catch (e) {}
}
/* Headers for every call. The server only enforces the token when it was
   started with LB_TOKEN set, so sending it unconditionally is harmless. */
function lbHeaders(extra) {
  const h = { 'content-type': 'application/json' };
  if (LB.token) h['authorization'] = 'Bearer ' + LB.token;
  return extra ? Object.assign(h, extra) : h;
}
function lbOrigin() {
  if (LB.base) return LB.base.replace(/\/+$/, '');
  // same-origin fallback: the server may be served next to the page
  return location.origin;
}
function lbUrl(p) { return lbOrigin() + p; }
function lbConfigured() { return !!LB.base; }

/* ---------- connection ---------- */
/* /health is deliberately unauthenticated so a load balancer can probe it.
   That means a wrong token still gets a 200 from /health while every real
   call fails with 401. So when a token is set, verify it against an
   authenticated endpoint before declaring the server usable. */
async function lbHealth(quiet) {
  const chip = $('#br-conn');
  if (!lbConfigured()) {
    LB.connected = false;
    if (chip) {
      chip.className = 'br-conn off';
      chip.innerHTML = '<span class="d"></span>no server set';
    }
    if (!quiet) openLiveServer();
    return null;
  }
  try {
    const r = await fetch(lbUrl('/health'), { cache: 'no-store', headers: lbHeaders() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    LB.health = d;

    if (LB.token) {
      const a = await fetch(lbUrl('/api/sessions'), { cache: 'no-store', headers: lbHeaders() });
      if (a.status === 401) {
        LB.connected = false;
        if (chip) {
          chip.className = 'br-conn off';
          chip.innerHTML = '<span class="d"></span>token rejected';
        }
        if (!quiet) toast('The server rejected the access token \u2014 check it in Live browser server');
        return null;
      }
      if (!a.ok) throw new Error('HTTP ' + a.status);
    }

    LB.connected = true;
    if (chip) {
      chip.className = 'br-conn on';
      chip.innerHTML = '<span class="d"></span>live \u00b7 ' + esc(d.engine || 'playwright') +
        ' \u00b7 ' + esc(d.browser || 'chromium');
    }
    return d;
  } catch (e) {
    LB.connected = false;
    if (chip) {
      chip.className = 'br-conn off';
      chip.innerHTML = '<span class="d"></span>server offline';
    }
    if (!quiet) toast('Live browser server unreachable \u2014 check the server URL');
    return null;
  }
}

async function lbApi(path, body, method) {
  const r = await fetch(lbUrl(path), {
    method: method || (body ? 'POST' : 'GET'),
    headers: lbHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}

/* ---------- per-tab state ---------- */
/* Each live session keeps its own page, history, frame and mode. Switching
   tabs must not lose any of that, so the active session is stashed into
   LB.tabs before another one is loaded. */
function lbStash() {
  if (!LB.sid) return;
  LB.tabs[LB.sid] = {
    steps: LB.steps, img: LB.img, url: LB.url, title: LB.title,
    lastPos: LB.lastPos, mode: LB.mode
  };
}
function lbRestore(sid) {
  const t = LB.tabs[sid];
  if (!t) { LB.steps = []; LB.img = null; LB.url = ''; LB.title = ''; LB.lastPos = null; return false; }
  LB.steps = t.steps || [];
  LB.img = t.img || null;
  LB.url = t.url || '';
  LB.title = t.title || '';
  LB.lastPos = t.lastPos || null;
  return true;
}
function lbTabLabel(s) {
  if (!s) return 'new tab';
  return (s.label || s.title || s.url || s.id || 'session').replace(/^https?:\/\//, '').slice(0, 34);
}

/* ---------- session ---------- */
async function lbOpen(url, opts) {
  if (!LB.connected) { const h = await lbHealth(); if (!h) return; }
  const target = (url || '').trim() || 'about:blank';
  const o = opts || {};
  lbStash();
  lbSetMode('agent');
  lbPushStep({ action: 'navigate', target: target, detail: 'opening a live session\u2026', ok: true, ms: 0, at: lbClock(), url: target, run: true });
  try {
    const d = await lbApi('/api/sessions', { url: target, label: o.label || '' });
    LB.sid = d.id;
    LB.url = d.url;
    LB.title = d.title;
    LB.steps = [];
    LB.lastPos = null;
    if (d.img) lbSetFrame(d.img);
    lbConnectWs();
    const u = $('#br-url'); if (u) u.value = d.url;
    lbPushStep({ action: 'navigate', target: d.url, detail: 'live \u00b7 ' + (d.title || d.url), ok: true, ms: 0, at: lbClock(), url: d.url });
    toast('Live session open \u00b7 <b>' + esc(d.title || d.url) + '</b>');
    await lbRefreshSessions();
  } catch (e) {
    lbPushStep({ action: 'navigate', target: target, detail: 'failed: ' + e.message, ok: false, ms: 0, at: lbClock(), url: target });
    toast('Could not open the session: ' + esc(e.message));
  }
}

/* Open an additional tab, leaving the current one running. */
async function lbNewTab(url) {
  if (!LB.connected) { const h = await lbHealth(); if (!h) return; }
  const target = (url || '').trim() || 'about:blank';
  lbStash();
  try {
    const d = await lbApi('/api/sessions', { url: target });
    LB.sid = d.id;
    LB.url = d.url;
    LB.title = d.title;
    LB.steps = [];
    LB.lastPos = null;
    LB.img = null;
    if (d.img) lbSetFrame(d.img);
    else {
      const img = $('#br-shot'); if (img) { img.classList.add('hidden'); img.removeAttribute('src'); }
      const empty = $('#br-empty'); if (empty) empty.style.display = '';
    }
    lbConnectWs();
    const u = $('#br-url'); if (u) u.value = d.url;
    lbPushStep({ action: 'navigate', target: d.url, detail: 'new tab \u00b7 ' + (d.title || d.url), ok: true, ms: 0, at: lbClock(), url: d.url });
    await lbRefreshSessions();
    toast('New tab \u00b7 <b>' + esc(d.title || d.url) + '</b>');
  } catch (e) {
    toast('Could not open a tab: ' + esc(e.message));
  }
}

/* Switch to an existing session without closing the current one. */
async function lbSwitchTab(sid) {
  if (!sid || sid === LB.sid) return;
  lbStash();
  LB.sid = sid;
  const had = lbRestore(sid);
  if (!had) { LB.steps = []; LB.img = null; }
  if (LB.img) lbSetFrame(LB.img);
  else {
    const img = $('#br-shot'); if (img) { img.classList.add('hidden'); img.removeAttribute('src'); }
    const empty = $('#br-empty'); if (empty) empty.style.display = '';
  }
  const u = $('#br-url'); if (u) u.value = LB.url || '';
  renderBrLog();
  renderBrTabs();
  renderBrSessions();
  lbPlaceCursor(LB.lastPos);
  lbConnectWs();
  // pull the authoritative history for this tab
  try {
    const d = await lbApi('/api/sessions/' + sid);
    if (LB.sid === sid) {
      LB.steps = d.history || [];
      LB.url = d.url || LB.url;
      LB.title = d.title || LB.title;
      if (d.img) lbSetFrame(d.img);
      const uu = $('#br-url'); if (uu) uu.value = LB.url;
      renderBrLog(); renderBrTabs();
    }
  } catch (e) {}
}

async function lbCloseTab(sid) {
  const id = sid || LB.sid;
  if (!id) return;
  try { await lbApi('/api/sessions/' + id + '/close', {}); } catch (e) {}
  delete LB.tabs[id];
  if (LB.ws && LB.sid === id) { try { LB.ws.close(); } catch (e) {} LB.ws = null; }
  await lbRefreshSessions();
  if (LB.sid === id) {
    const next = LB.sessions[0];
    LB.sid = null; LB.steps = []; LB.img = null; LB.url = ''; LB.title = ''; LB.lastPos = null;
    if (next) { await lbSwitchTab(next.id); }
    else {
      const img = $('#br-shot'); if (img) { img.classList.add('hidden'); img.removeAttribute('src'); }
      const empty = $('#br-empty'); if (empty) empty.style.display = '';
      renderBrLog(); renderBrTabs(); lbSetMode('idle');
    }
  } else {
    renderBrTabs();
  }
}

function lbConnectWs() {
  if (LB.ws) { try { LB.ws.close(); } catch (e) {} LB.ws = null; }
  if (!LB.sid) return;
  const sid = LB.sid;
  const wsBase = lbOrigin().replace(/^http/, 'ws');
  const wsTok = LB.token ? '?token=' + encodeURIComponent(LB.token) : '';
  let ws;
  try { ws = new WebSocket(wsBase + '/ws/' + sid + wsTok); } catch (e) { return; }
  LB.ws = ws;
  ws.onopen = () => { LB.retry = 0; };
  ws.onmessage = (ev) => {
    if (LB.sid !== sid) return;   // a stale socket from a tab we left
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'hello') {
      if (m.img) lbSetFrame(m.img);
      if (m.session) { LB.url = m.session.url; LB.title = m.session.title; }
      if (m.history && m.history.length) { LB.steps = m.history; renderBrLog(); }
    } else if (m.t === 'frame') {
      lbSetFrame(m.img);
      if (m.url) { LB.url = m.url; const u = $('#br-url'); if (u && document.activeElement !== u) u.value = m.url; }
    } else if (m.t === 'step') {
      lbPushStep(m.step);
      if (m.img) lbSetFrame(m.img);
      if (m.url) { LB.url = m.url; const u = $('#br-url'); if (u && document.activeElement !== u) u.value = m.url; }
      if (m.title) LB.title = m.title;
    } else if (m.t === 'mode') {
      lbSetMode(m.mode);
    } else if (m.t === 'result') {
      const r = m.result;
      if (r && r.step) lbPushStep(r.step);
      if (r && r.img) lbSetFrame(r.img);
    }
  };
  ws.onclose = () => {
    if (LB.ws === ws) LB.ws = null;
    if (LB.sid === sid && LB.retry < 4) {
      LB.retry++;
      setTimeout(() => { if (LB.sid === sid) lbConnectWs(); }, 900 * LB.retry);
    }
  };
  ws.onerror = () => {};
}

function lbClock() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
}

function lbPushStep(s) {
  if (!s) return;
  const last = LB.steps[LB.steps.length - 1];
  if (last && last.run) LB.steps.pop();
  s.i = LB.steps.length + 1;
  LB.steps.push(s);
  renderBrLog();
  const row = $('.br-step[data-brstep="' + (LB.steps.length - 1) + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function lbSetFrame(b64) {
  if (!b64) return;
  LB.img = b64;
  const img = $('#br-shot'), empty = $('#br-empty');
  if (!img) return;
  img.classList.remove('hidden');
  img.src = 'data:image/jpeg;base64,' + b64;
  if (empty) empty.style.display = 'none';
  if (img.complete) lbPlaceCursor(LB.lastPos);
  else img.onload = () => lbPlaceCursor(LB.lastPos);
}

function lbPlaceCursor(pos) {
  const img = $('#br-shot'), stage = $('#br-stage'), cur = $('#br-cursor');
  if (!img || !stage || !cur) return;
  if (!pos || img.classList.contains('hidden')) { cur.classList.remove('on'); return; }
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const nw = img.naturalWidth || 1280, nh = img.naturalHeight || 800;
  const scale = Math.min(sw / nw, sh / nh);
  const w = nw * scale, h = nh * scale;
  const ox = (sw - w) / 2, oy = (sh - h) / 2;
  cur.style.left = (ox + w * pos.x / 100) + 'px';
  cur.style.top = (oy + h * pos.y / 100) + 'px';
  cur.classList.add('on');
  cur.classList.remove('pulse');
  void cur.offsetWidth;
  cur.classList.add('pulse');
}

function lbSetMode(m) {
  LB.mode = m;
  const el = $('#br-mode');
  if (el) {
    el.className = 'br-mode' + (m === 'agent' ? ' agent' : m === 'manual' ? ' manual' : '');
    const t = $('#br-mode-txt');
    if (t) t.textContent = m === 'agent' ? 'agent driving' : m === 'manual' ? 'you have control' : 'idle';
  }
  const b = $('#br-takeover'), h = $('#br-handback');
  if (b) b.classList.toggle('on', m === 'manual');
  if (h) h.classList.toggle('on', m === 'agent');
}

/* ---------- actions ---------- */
async function lbAct(body, label) {
  if (!LB.sid) { toast('Open a live session first'); return null; }
  if (LB.busy) return null;
  LB.busy = true;
  const t0 = performance.now();
  lbPushStep({ action: body.action, target: label || body.selector || body.action,
               detail: 'running\u2026', ok: true, ms: 0, at: lbClock(), url: LB.url, run: true });
  try {
    const r = await lbApi('/api/sessions/' + LB.sid + '/act', body);
    if (r.img) lbSetFrame(r.img);
    if (r.url) { LB.url = r.url; const u = $('#br-url'); if (u && document.activeElement !== u) u.value = r.url; }
    LB.lastPos = r.step && r.step.pos ? r.step.pos : null;
    lbPlaceCursor(LB.lastPos);
    if (r.step) lbPushStep(r.step);
    if (!r.ok) toast('Action failed: ' + esc(r.step.detail));
    return r;
  } catch (e) {
    lbPushStep({ action: body.action, target: label || body.selector || body.action,
                 detail: 'failed: ' + e.message, ok: false, ms: Math.round(performance.now() - t0),
                 at: lbClock(), url: LB.url });
    toast('Action failed: ' + esc(e.message));
    return null;
  } finally {
    LB.busy = false;
  }
}

async function lbGoto(url) {
  if (!url) return;
  if (!LB.sid) return lbOpen(url);
  const t0 = performance.now();
  lbPushStep({ action: 'navigate', target: url, detail: 'navigating\u2026', ok: true, ms: 0, at: lbClock(), url: url, run: true });
  try {
    const r = await lbApi('/api/sessions/' + LB.sid + '/goto', { url: url });
    if (r.img) lbSetFrame(r.img);
    LB.url = r.url; LB.title = r.title;
    const u = $('#br-url'); if (u) u.value = r.url;
    lbPushStep(r.step);
    renderBrTabs();
    toast('Loaded <b>' + esc(r.title || r.url) + '</b>');
  } catch (e) {
    lbPushStep({ action: 'navigate', target: url, detail: 'failed: ' + e.message, ok: false,
                 ms: Math.round(performance.now() - t0), at: lbClock(), url: url });
    toast('Navigation failed: ' + esc(e.message));
  }
}

async function lbNav(which) {
  if (!LB.sid) return;
  try {
    const r = await lbApi('/api/sessions/' + LB.sid + '/' + which, {});
    if (r.img) lbSetFrame(r.img);
    LB.url = r.url;
    const u = $('#br-url'); if (u) u.value = r.url;
    if (r.step) lbPushStep(r.step);
    renderBrTabs();
  } catch (e) { toast(esc(e.message)); }
}

async function lbSetModeRemote(m) {
  lbSetMode(m);
  if (LB.sid) { try { await lbApi('/api/sessions/' + LB.sid + '/mode', { mode: m }); } catch (e) {} }
}

async function lbClose() {
  if (LB.sid) { try { await lbApi('/api/sessions/' + LB.sid + '/close', {}); } catch (e) {} }
  if (LB.ws) { try { LB.ws.close(); } catch (e) {} LB.ws = null; }
  if (LB.sid) delete LB.tabs[LB.sid];
  LB.sid = null; LB.steps = []; LB.img = null; LB.lastPos = null;
  const img = $('#br-shot'); if (img) { img.classList.add('hidden'); img.removeAttribute('src'); }
  const empty = $('#br-empty'); if (empty) empty.style.display = '';
  renderBrLog(); renderBrTabs(); lbSetMode('idle'); lbRefreshSessions();
}

async function lbRefreshSessions() {
  if (!lbConfigured()) { LB.sessions = []; renderBrSessions(); renderBrTabs(); return; }
  try {
    const d = await lbApi('/api/sessions');
    LB.sessions = d.sessions || [];
  } catch (e) { LB.sessions = []; }
  renderBrSessions();
  renderBrTabs();
}

/* ---------- recording: a real Playwright trace ---------- */
async function lbRecStart() {
  if (!LB.sid) { toast('Open a live session first'); return; }
  if (LB.recording) return;
  try {
    await lbApi('/api/sessions/' + LB.sid + '/record/start', {});
    LB.recording = true;
    LB.recStart = Date.now();
    renderBrRec();
    toast('Recording \u2014 every action is being captured into a Playwright trace');
  } catch (e) { toast('Could not start recording: ' + esc(e.message)); }
}

async function lbRecStop() {
  if (!LB.sid || !LB.recording) return;
  const btn = $('#br-rec');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }
  try {
    const d = await lbApi('/api/sessions/' + LB.sid + '/record/stop', {});
    LB.recording = false;
    LB.lastTrace = d.trace;
    renderBrRec();
    await lbLoadTraces();
    toast('Trace saved \u00b7 <b>' + esc(d.trace.name) + '</b> \u00b7 ' + d.trace.steps.length + ' steps, ' +
      (d.trace.size / 1024 / 1024).toFixed(1) + ' MB');
  } catch (e) {
    LB.recording = false;
    renderBrRec();
    toast('Could not save the trace: ' + esc(e.message));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function lbLoadTraces() {
  if (!lbConfigured()) { LB.traces = []; renderBrRec(); return; }
  try {
    const d = await lbApi('/api/traces');
    LB.traces = d.traces || [];
  } catch (e) { LB.traces = []; }
  renderBrRec();
}

function lbRecClock() {
  if (!LB.recording) return '';
  const s = Math.floor((Date.now() - LB.recStart) / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function renderBrRec() {
  const btn = $('#br-rec');
  if (btn) {
    btn.className = 'br-rec' + (LB.recording ? ' on' : '');
    btn.innerHTML = '<span class="d"></span>' + (LB.recording ? 'Stop \u00b7 ' + lbRecClock() : 'Record');
  }
  const list = $('#br-traces');
  if (!list) return;
  if (!LB.traces.length) {
    list.innerHTML = '<div class="br-trace empty">No traces yet \u2014 hit Record, drive the page, then Stop.</div>';
    return;
  }
  list.innerHTML = LB.traces.slice(0, 6).map((t) => {
    const mb = (t.size / 1024 / 1024).toFixed(1);
    return '<div class="br-trace">' +
      '<div class="hd"><span class="nm">' + esc(t.name.replace(/^trace-/, '')) + '</span>' +
      '<span class="k">' + t.steps + ' steps \u00b7 ' + t.duration.toFixed(1) + 's \u00b7 ' + mb + ' MB</span></div>' +
      '<div class="u">' + esc((t.title || t.url || '').slice(0, 60)) + '</div>' +
      '<div class="acts">' +
      '<button class="primary" data-brview="' + esc(t.name) + '">View</button>' +
      '<a href="' + esc(lbUrl(t.trace)) + '" target="_blank" rel="noopener" download>trace.zip</a>' +
      '<a href="' + esc(lbUrl(t.steps_url)) + '" target="_blank" rel="noopener">steps.json</a>' +
      '</div></div>';
  }).join('');
}

/* ============================================================
   TRACE VIEWER  —  parses Playwright's own trace.zip
   ============================================================
   The server parses trace.trace (newline-delimited JSON) into an ordered
   action list plus the screencast frames, and ships the frames the viewer
   needs as data URLs. This renders that model: pick an action, see the
   exact frame the page was showing when it ran.
   ============================================================ */
async function lbOpenTrace(name) {
  const box = $('#trv');
  if (!box) return;
  box.classList.add('on');
  const nm = $('#trv-name'); if (nm) nm.textContent = name;
  const meta = $('#trv-meta'); if (meta) meta.textContent = 'parsing trace\u2026';
  const list = $('#trv-list'); if (list) list.innerHTML = '<div class="trv-row empty">Loading\u2026</div>';
  const empty = $('#trv-empty'); if (empty) { empty.style.display = ''; empty.textContent = 'Parsing trace\u2026'; }
  const shot = $('#trv-shot'); if (shot) shot.classList.remove('on');
  LB.viewer = null; LB.trvIdx = 0;
  try {
    const d = await lbApi('/api/traces/' + encodeURIComponent(name) + '/view');
    if (!d.ok) throw new Error(d.error || 'could not parse the trace');
    LB.viewer = d;
    const m = d.meta || {};
    if (meta) {
      meta.innerHTML = esc(m.browserName || 'chromium') +
        (m.viewport ? ' \u00b7 ' + m.viewport.width + '\u00d7' + m.viewport.height : '') +
        ' \u00b7 ' + d.duration.toFixed(2) + 's \u00b7 ' +
        '<b>' + d.counts.actions + '</b> actions \u00b7 ' + d.counts.frames + ' frames' +
        (d.counts.errors ? ' \u00b7 <span style="color:var(--red)">' + d.counts.errors + ' errors</span>' : '');
    }
    const zip = $('#trv-zip'); if (zip) zip.href = lbUrl(d.zip_url || ('/traces/' + name + '.zip'));
    const range = $('#trv-range');
    if (range) { range.min = 0; range.max = Math.max(0, d.actions.length - 1); range.value = 0; }
    renderTrvList();
    trvGo(0);
  } catch (e) {
    if (meta) meta.textContent = 'could not open this trace';
    if (list) list.innerHTML = '<div class="trv-row empty">' + esc(e.message) + '</div>';
    if (empty) { empty.style.display = ''; empty.textContent = e.message; }
  }
}

function trvFrameFor(a) {
  const v = LB.viewer;
  if (!v || !v.frames.length) return null;
  let i = a && typeof a.frame === 'number' ? a.frame : 0;
  if (i < 0) i = 0;
  if (i >= v.frames.length) i = v.frames.length - 1;
  const f = v.frames[i];
  return f ? v.resources[f.sha1] || null : null;
}

function renderTrvList() {
  const el = $('#trv-list');
  const v = LB.viewer;
  if (!el || !v) return;
  if (!v.actions.length) {
    el.innerHTML = '<div class="trv-row empty">This trace recorded no page actions.</div>';
    return;
  }
  el.innerHTML = v.actions.map((a, i) => {
    const on = i === LB.trvIdx ? ' on' : '';
    const err = a.error ? ' err' : '';
    return '<div class="trv-row' + on + err + '" data-trv="' + i + '">' +
      '<span class="n">' + a.i + '</span>' +
      '<div class="bd"><div class="m"><span class="k">' + esc(a.kind) + '</span> ' + esc(a.method) + '</div>' +
      '<div class="d">' + esc(a.desc) + '</div>' +
      (a.error ? '<div class="e">' + esc(a.error) + '</div>' : '') + '</div>' +
      '<span class="ms">' + (a.ms >= 1000 ? (a.ms / 1000).toFixed(2) + 's' : Math.round(a.ms) + 'ms') + '</span>' +
      '</div>';
  }).join('');
}

function trvGo(i) {
  const v = LB.viewer;
  if (!v || !v.actions.length) return;
  i = Math.max(0, Math.min(v.actions.length - 1, i));
  LB.trvIdx = i;
  const a = v.actions[i];
  const shot = $('#trv-shot'), empty = $('#trv-empty');
  const src = trvFrameFor(a);
  if (shot && src) {
    shot.src = src;
    shot.classList.add('on');
    if (empty) empty.style.display = 'none';
  } else if (empty) {
    empty.style.display = '';
    empty.textContent = 'No screencast frame for this step.';
  }
  const range = $('#trv-range'); if (range) range.value = i;
  const pos = $('#trv-pos'); if (pos) pos.textContent = (i + 1) + ' / ' + v.actions.length;
  const det = $('#trv-detail');
  if (det) {
    const p = a.params && Object.keys(a.params).length
      ? Object.keys(a.params).slice(0, 3).map((k) => k + '=' + String(JSON.stringify(a.params[k])).slice(0, 40)).join('  ')
      : '';
    det.innerHTML = '<b>' + esc(a.method) + '</b> \u00b7 ' + esc(a.desc) + (p ? ' <span class="p">' + esc(p) + '</span>' : '');
  }
  $$('#trv-list .trv-row').forEach((r) => r.classList.toggle('on', parseInt(r.dataset.trv, 10) === i));
  const row = $('#trv-list .trv-row[data-trv="' + i + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function trvPlay() {
  const v = LB.viewer;
  if (!v || !v.actions.length) return;
  if (LB.trvTimer) { trvPause(); return; }
  const btn = $('#trv-play'); if (btn) btn.innerHTML = '\u275a\u275a Pause';
  if (LB.trvIdx >= v.actions.length - 1) trvGo(0);
  LB.trvTimer = setInterval(() => {
    if (!LB.viewer) return trvPause();
    if (LB.trvIdx >= LB.viewer.actions.length - 1) { trvPause(); return; }
    trvGo(LB.trvIdx + 1);
  }, 700);
}
function trvPause() {
  if (LB.trvTimer) { clearInterval(LB.trvTimer); LB.trvTimer = null; }
  const btn = $('#trv-play'); if (btn) btn.innerHTML = '\u25b6 Play';
}
function trvClose() {
  trvPause();
  const box = $('#trv'); if (box) box.classList.remove('on');
  LB.viewer = null;
}

/* Replay a saved trace's step log back through the action log + stage.
   (The step log is the server's own record; the trace viewer above reads
   Playwright's trace.zip instead.) */
async function lbReplayTrace(stepsUrl) {
  try {
    const r = await fetch(lbUrl(stepsUrl), { cache: 'no-store' });
    const d = await r.json();
    const steps = d.steps || [];
    if (!steps.length) { toast('That trace has no steps'); return; }
    lbSetMode('agent');
    LB.steps = [];
    renderBrLog();
    let i = 0;
    const tick = () => {
      if (i >= steps.length) { toast('Replayed <b>' + steps.length + '</b> recorded steps'); return; }
      const s = steps[i];
      lbPushStep({ action: s.action, target: s.target, detail: s.detail, ok: s.ok,
                   ms: s.ms, at: s.at, url: s.url, pos: s.pos });
      if (s.pos) { LB.lastPos = s.pos; lbPlaceCursor(s.pos); }
      if (s.url) { const u = $('#br-url'); if (u) u.value = s.url; }
      i++;
      setTimeout(tick, 620);
    };
    tick();
  } catch (e) { toast('Could not load that trace: ' + esc(e.message)); }
}

/* ---------- agent: natural-language instruction ---------- */
/* The agent turns a plain instruction into a real action sequence and runs
   each step against the live page, reporting every outcome. */
async function lbAgent(instruction) {
  const q = (instruction || '').trim();
  if (!q) return;
  const hint = $('#br-ask-hint');
  const setHint = (t, warn) => { if (hint) { hint.innerHTML = t; hint.style.color = warn ? 'var(--amber)' : ''; } };

  // "open <url>" / "go to <url>"
  const m = q.match(/^(?:open|go to|goto|navigate to|visit)\s+(\S+)/i);
  if (m) {
    let u = m[1];
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    setHint('Navigating the live session to ' + esc(u) + '\u2026');
    await lbGoto(u);
    setHint('Live session is on <b>' + esc(LB.title || u) + '</b>.');
    return;
  }

  // "click <selector>" / "type <text> into <selector>" / "read <selector>"
  const c = q.match(/^click\s+(.+)$/i);
  if (c) { setHint('Clicking ' + esc(c[1]) + '\u2026'); await lbAct({ action: 'click', selector: c[1].trim() }, c[1].trim()); setHint('Clicked.'); return; }

  const t = q.match(/^type\s+["']>([^"']+?)["']?\s+(?:in|into)\s+(.+)$/i);
  if (t) { setHint('Typing into ' + esc(t[2]) + '\u2026'); await lbAct({ action: 'type', selector: t[2].trim(), text: t[1] }, t[2].trim()); setHint('Typed.'); return; }

  const r = q.match(/^(?:read|extract|get)\s+(.+)$/i);
  if (r) {
    setHint('Reading ' + esc(r[1]) + '\u2026');
    const res = await lbAct({ action: 'extract', selector: r[1].trim() }, r[1].trim());
    if (res && res.ok) setHint('Read: <b>' + esc(res.step.detail.slice(0, 220)) + '</b>');
    return;
  }

  const s = q.match(/^scroll(?:\s+(-?\d+))?$/i);
  if (s) { setHint('Scrolling\u2026'); await lbAct({ action: 'scroll', dy: parseInt(s[1] || '600', 10) }, 'viewport'); setHint('Scrolled.'); return; }

  // a bare address
  if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(q)) {
    setHint('Navigating to ' + esc(q) + '\u2026');
    await lbGoto('https://' + q);
    setHint('Live session is on <b>' + esc(LB.title || q) + '</b>.');
    return;
  }

  // otherwise: hand the instruction to the connected model, which returns a
  // JSON action plan we then execute for real against the live page.
  if (!aiReady()) {
    setHint('I can run: <b>open &lt;url&gt;</b>, <b>click &lt;selector&gt;</b>, <b>type &lt;text&gt; into &lt;selector&gt;</b>, <b>read &lt;selector&gt;</b>, <b>scroll</b>. Connect a model in the AI panel to plan anything more complex.', true);
    return;
  }
  setHint('Asking <b>' + esc(AI.model) + '</b> to plan this against the live page\u2026');
  try {
    const plan = await lbPlan(q);
    if (!plan || !plan.length) { setHint('The model returned no steps.', true); return; }
    setHint('Running a ' + plan.length + '-step plan\u2026');
    for (const st of plan) {
      await lbAct(st, st.selector || st.action);
      await new Promise((r2) => setTimeout(r2, 220));
    }
    setHint('Plan complete \u00b7 ' + plan.length + ' steps executed on the live page.');
  } catch (e) {
    setHint('Planning failed: ' + esc(e.message), true);
  }
}

async function lbPlan(instruction) {
  const sys = 'You drive a live web page with Playwright. Reply with ONLY a JSON array of actions, no prose. ' +
    'Allowed actions: {"action":"goto","url":"..."}, {"action":"click","selector":"..."}, ' +
    '{"action":"type","selector":"...","text":"..."}, {"action":"press","key":"Enter"}, ' +
    '{"action":"scroll","dy":600}, {"action":"extract","selector":"..."}, {"action":"wait","ms":800}. ' +
    'Use real CSS selectors. Maximum 8 actions.';
  const ctx = 'Current page: ' + LB.url + '\nTitle: ' + LB.title +
    '\nRecent actions:\n' + LB.steps.slice(-6).map((s) => s.action + ' ' + s.target + ' -> ' + s.detail).join('\n');
  const out = await aiCall(aiProv(), { key: AI.key, model: AI.model, base: AI.base }, [
    { role: 'user', content: ctx + '\n\nInstruction: ' + instruction }
  ], sys);
  const m = String(out).match(/\[[\s\S]*\]/);
  if (!m) throw new Error('the model did not return an action plan');
  return JSON.parse(m[0]);
}

/* ---------- panel takeover ---------- */
async function lbTakePanel(key) {
  if (BR.taken === key) { BR.taken = null; renderBrSessions(); toast('Released <b>' + esc(key) + '</b>'); return; }
  BR.taken = key;
  const p = BR_PANELS.find((x) => x[0] === key);
  showPanel(key);
  renderBrSessions();
  lbSetMode('agent');
  toast('Agent attached to the <b>' + esc(p ? p[1] : key) + '</b> panel tab');
}

/* ---------- render ---------- */
function renderBrLog() {
  const el = $('#br-log');
  if (!el) return;
  if (!LB.steps.length) {
    el.innerHTML = '<div class="br-step"><span class="n">\u00b7</span><div class="bd">' +
      '<div class="a">idle</div><div class="dt">Open a live session to start driving a real page.</div></div></div>';
    const c0 = $('#br-count'); if (c0) c0.textContent = '0 / 0';
    return;
  }
  el.innerHTML = LB.steps.map((s, i) => {
    const on = i === LB.steps.length - 1 ? ' on' : '';
    const cls = 'br-step' + on + (s.run ? ' run' : '');
    return '<div class="' + cls + '" data-brstep="' + i + '">' +
      '<span class="n">' + (s.ok === false ? '!' : s.i) + '</span>' +
      '<div class="bd"><div class="a ' + esc(s.action) + '"' + (s.ok === false ? ' style="color:var(--red)"' : '') + '>' + esc(s.action) + '</div>' +
      '<div class="tg">' + esc(s.target || '') + '</div>' +
      '<div class="dt">' + esc(s.detail || '') + '</div></div>' +
      '<span class="ms">' + (s.ms ? (s.ms / 1000).toFixed(1) + 's' : s.at || '') + '</span></div>';
  }).join('');
  const c = $('#br-count');
  if (c) c.textContent = LB.steps.length + ' steps';
  const p = $('#br-prog');
  if (p) p.style.width = Math.min(100, LB.steps.length * 6) + '%';
}

/* The tab strip: one tab per live session, plus a new-tab button. */
function renderBrTabs() {
  const el = $('#br-tabs');
  if (!el) return;
  const rows = [];
  const seen = {};
  LB.sessions.forEach((s) => {
    seen[s.id] = 1;
    const on = s.id === LB.sid ? ' on' : '';
    const rec = s.recording ? '<span class="rec" title="recording"></span>' : '';
    rows.push('<div class="br-tab' + on + '" data-brtab="' + esc(s.id) + '" title="' + esc(s.url || '') + '">' +
      '<span class="fav">\u25CF</span>' +
      '<span class="nm">' + esc(lbTabLabel(s)) + '</span>' + rec +
      '<span class="x" data-brtabclose="' + esc(s.id) + '" title="Close tab">\u2715</span></div>');
  });
  // a session we just created may not be in the list yet
  if (LB.sid && !seen[LB.sid]) {
    rows.push('<div class="br-tab on" data-brtab="' + esc(LB.sid) + '">' +
      '<span class="fav">\u25CF</span><span class="nm">' + esc(lbTabLabel({ title: LB.title, url: LB.url })) + '</span>' +
      '<span class="x" data-brtabclose="' + esc(LB.sid) + '">\u2715</span></div>');
  }
  rows.push('<button class="br-newtab" id="br-newtab" title="New live tab">+</button>');
  el.innerHTML = rows.join('');
  const nt = $('#br-newtab');
  if (nt) nt.addEventListener('click', () => {
    const u = $('#br-url');
    lbNewTab(u && u.value.trim() && u.value.trim() !== LB.url ? u.value.trim() : 'about:blank');
  });
}

function renderBrSessions() {
  const el = $('#br-sessions');
  if (!el) return;
  const rows = [];
  const others = LB.sessions.filter((s) => s.id !== LB.sid);
  if (LB.sid) {
    rows.push('<div class="br-sess on" data-brsess="' + esc(LB.sid) + '">' +
      '<span class="d"></span><span class="nm">playwright \u00b7 ' + esc((LB.title || LB.url || 'session').slice(0, 26)) + '</span>' +
      '<span class="k">' + LB.steps.length + ' steps</span></div>');
  }
  others.forEach((s) => {
    rows.push('<div class="br-sess" data-brsess="' + esc(s.id) + '">' +
      '<span class="d off"></span><span class="nm">' + esc((s.title || s.url || s.id).slice(0, 26)) + '</span>' +
      '<span class="k">' + (s.steps || 0) + ' steps</span></div>');
  });
  if (!LB.sid && !others.length) {
    rows.push('<div class="br-sess"><span class="d off"></span><span class="nm">no live session</span><span class="k">idle</span></div>');
  }
  BR_PANELS.forEach((p) => {
    const taken = BR.taken === p[0];
    rows.push('<div class="br-sess' + (taken ? ' on' : '') + '" data-brsess="' + p[0] + '">' +
      '<span class="d' + (taken ? '' : ' off') + '"></span>' +
      '<span class="nm">panel \u00b7 ' + esc(p[1].toLowerCase()) + '</span>' +
      '<span class="take' + (taken ? ' on' : '') + '" data-brtake="' + p[0] + '">' + (taken ? 'agent' : 'take') + '</span></div>');
  });
  el.innerHTML = rows.join('');
}

/* ---------- wiring ---------- */
function wireLiveBrowser() {
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
  on('br-go', 'click', () => { const u = $('#br-url'); if (u) lbGoto(u.value.trim()); });
  on('br-url', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const u = $('#br-url'); if (u) lbGoto(u.value.trim()); } });
  on('br-back', 'click', () => lbNav('back'));
  on('br-fwd', 'click', () => lbNav('forward'));
  on('br-reload', 'click', () => lbNav('reload'));
  on('br-ask-go', 'click', () => { const i = $('#br-ask'); if (i) { lbAgent(i.value); i.value = ''; } });
  on('br-ask', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const i = $('#br-ask'); lbAgent(i.value); i.value = ''; } });
  on('br-takeover', 'click', () => { lbSetModeRemote('manual'); toast('You have control \u2014 the agent will not act until you hand back'); });
  on('br-handback', 'click', () => { lbSetModeRemote('agent'); toast('Control handed back to the agent'); });
  on('br-close-session', 'click', () => lbCloseTab(LB.sid));
  on('br-rec', 'click', () => { if (LB.recording) lbRecStop(); else lbRecStart(); });
  on('br-side-toggle', 'click', () => $('#br-side').classList.toggle('hide'));
  on('br-conn', 'click', () => { openLiveServer(); });

  const log = $('#br-log');
  if (log) log.addEventListener('click', (ev) => {
    const s = ev.target.closest('[data-brstep]');
    if (!s) return;
    const i = parseInt(s.dataset.brstep, 10);
    const st = LB.steps[i];
    if (st && st.pos) { LB.lastPos = st.pos; lbPlaceCursor(st.pos); }
    $$('#br-log .br-step').forEach((r) => r.classList.remove('on'));
    s.classList.add('on');
  });

  const tabs = $('#br-tabs');
  if (tabs) tabs.addEventListener('click', (ev) => {
    const x = ev.target.closest('[data-brtabclose]');
    if (x) { ev.stopPropagation(); lbCloseTab(x.dataset.brtabclose); return; }
    const t = ev.target.closest('[data-brtab]');
    if (t) lbSwitchTab(t.dataset.brtab);
  });

  const sess = $('#br-sessions');
  if (sess) sess.addEventListener('click', (ev) => {
    const take = ev.target.closest('[data-brtake]');
    if (take) { lbTakePanel(take.dataset.brtake); return; }
    const row = ev.target.closest('[data-brsess]');
    if (!row) return;
    const id = row.dataset.brsess;
    if (BR_PANELS.some((p) => p[0] === id)) { lbTakePanel(id); return; }
    if (id !== LB.sid) lbSwitchTab(id);
  });

  const traces = $('#br-traces');
  if (traces) traces.addEventListener('click', (ev) => {
    const v = ev.target.closest('[data-brview]');
    if (v) { lbOpenTrace(v.dataset.brview); return; }
    const b = ev.target.closest('[data-brreplay]');
    if (b) lbReplayTrace(b.dataset.brreplay);
  });

  /* trace viewer controls */
  on('trv-close', 'click', trvClose);
  on('trv-play', 'click', trvPlay);
  on('trv-prev', 'click', () => { trvPause(); trvGo(LB.trvIdx - 1); });
  on('trv-next', 'click', () => { trvPause(); trvGo(LB.trvIdx + 1); });
  const range = $('#trv-range');
  if (range) range.addEventListener('input', () => { trvPause(); trvGo(parseInt(range.value, 10)); });
  const list = $('#trv-list');
  if (list) list.addEventListener('click', (ev) => {
    const r = ev.target.closest('[data-trv]');
    if (r) { trvPause(); trvGo(parseInt(r.dataset.trv, 10)); }
  });
  document.addEventListener('keydown', (ev) => {
    const box = $('#trv');
    if (!box || !box.classList.contains('on')) return;
    if (ev.key === 'Escape') { trvClose(); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); trvPause(); trvGo(LB.trvIdx + 1); }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); trvPause(); trvGo(LB.trvIdx - 1); }
    if (ev.key === ' ') { ev.preventDefault(); trvPlay(); }
  });
}

/* ---------- server settings modal ---------- */
function openLiveServer() {
  const cur = $('#ls-url');
  if (cur) cur.value = LB.base || '';
  const tk = $('#ls-token');
  if (tk) tk.value = LB.token || '';
  const st = $('#ls-status');
  if (st) st.innerHTML = LB.connected
    ? '<div class="gh-ok"><b>Connected.</b> ' + esc((LB.health && LB.health.engine) || 'playwright') + ' \u00b7 ' + esc((LB.health && LB.health.browser) || 'chromium') + ' \u00b7 ' + (LB.health ? LB.health.sessions : 0) + ' session(s)</div>'
    : '<div class="gh-err"><b>Not connected.</b> Enter the live browser server URL.</div>';
  openModal('m-live');
}

async function saveLiveServer() {
  const v = ($('#ls-url') && $('#ls-url').value.trim()) || '';
  LB.base = v.replace(/\/+$/, '');
  LB.token = ($('#ls-token') && $('#ls-token').value.trim()) || '';
  lbSave();
  const st = $('#ls-status');
  if (st) st.innerHTML = '<div class="gh-note"><span class="gh-spin" style="display:inline-block;vertical-align:-2px"></span> Checking\u2026</div>';
  const h = await lbHealth(true);
  if (h) {
    if (st) st.innerHTML = '<div class="gh-ok"><b>Connected.</b> ' + esc(h.engine) + ' \u00b7 ' + esc(h.browser) + ' \u00b7 viewport ' + h.viewport.width + '\u00d7' + h.viewport.height + '</div>';
    toast('Live browser server connected');
    lbRefreshSessions();
  } else if (st) {
    st.innerHTML = '<div class="gh-err"><b>Could not reach that server.</b> Check the URL and that the server is running.</div>';
  }
}

/* ============================================================
   WORKBENCH GLUE  —  the names the rest of the app calls
   ============================================================ */
const BR = { open: false, taken: null, loaded: false };
const BR_PANELS = [
  ['terminal', 'Terminal'], ['problems', 'Problems'], ['debug', 'Debug'],
  ['ports', 'Ports'], ['ai', 'AI'], ['output', 'Output']
];

function openBrowser() {
  BR.open = true;
  const b = $('#browser');
  if (b) b.classList.add('on');
  $$('#rail button').forEach((x) => x.classList.toggle('on', x.dataset.view === 'browser'));
  if (!BR.loaded) {
    BR.loaded = true;
    lbLoad();
    if (lbConfigured()) lbHealth(true).then(() => { lbRefreshSessions(); lbLoadTraces(); });
    else lbHealth(true);   // sets the chip to "no server set" without probing
  } else {
    renderBrTabs(); renderBrLog(); renderBrSessions(); renderBrRec();
  }
  lbSetMode(LB.mode);
  if (!BR.recTimer) BR.recTimer = setInterval(() => { if (LB.recording) renderBrRec(); }, 1000);
}

function closeBrowser() {
  BR.open = false;
  const b = $('#browser');
  if (b) b.classList.remove('on');
  $$('#rail button').forEach((x) => x.classList.toggle('on', x.dataset.view === 'files'));
}

/* -- compatibility shims: the command palette and keybindings call these -- */
function brLoad() {
  lbLoad();
  if (!lbConfigured()) { lbHealth(true); return; }
  lbHealth(true).then(() => { lbRefreshSessions(); lbLoadTraces(); });
}
function brGo() { const u = $('#br-url'); if (u) lbGoto(u.value.trim()); }
function brAsk() { const i = $('#br-ask'); if (i) { lbAgent(i.value); i.value = ''; } }
function brSetMode(m) { lbSetMode(m); }
function brPlaceCursor(p) { lbPlaceCursor(p); }
function brTakeover() { lbSetModeRemote('manual'); toast('You have control \u2014 the agent will not act until you hand back'); }
function brHandback() { lbSetModeRemote('agent'); toast('Control handed back to the agent'); }
function brTakePanel(k) { lbTakePanel(k); }
function brPause() { lbSetModeRemote('manual'); }
function brReset() { lbSetMode('idle'); }
function brPlay() {
  if (!LB.steps.length) { toast('No live session yet \u2014 open an address first'); return; }
  lbSetModeRemote('agent');
  let i = 0;
  const tick = () => {
    if (i >= LB.steps.length) { toast('Replayed <b>' + LB.steps.length + '</b> live steps'); return; }
    brShowStep(i); i++;
    setTimeout(tick, 700);
  };
  tick();
}
function brShowStep(i) {
  const s = LB.steps[i];
  if (!s) return;
  if (s.img) lbSetFrame(s.img);
  LB.lastPos = s.pos || null;
  lbPlaceCursor(LB.lastPos);
  $$('#br-log .br-step').forEach((r) => r.classList.remove('on'));
  const row = $('.br-step[data-brstep="' + i + '"]');
  if (row) { row.classList.add('on'); row.scrollIntoView({ block: 'nearest' }); }
  if (s.url) { const u = $('#br-url'); if (u) u.value = s.url; }
}

function wireBrowser() {
  wireLiveBrowser();
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
  on('br-close', 'click', closeBrowser);
  on('ls-save', 'click', saveLiveServer);
  on('ls-check', 'click', saveLiveServer);
  on('rm-save', 'click', saveRmConfig);
  on('rm-test2', 'click', rmTest);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && BR.open && !($('#trv') && $('#trv').classList.contains('on'))) closeBrowser();
  });
}
