/*
 * </recode> live browser client.
 *
 * Talks to server/live_browser.py using the HTTP and WebSocket contract in the
 * workbench README. The server is optional: the UI remains usable when it is
 * offline or not configured.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'recode-live-browser-v1';
  const LB = {
    base: '', token: '', session: null, connected: false, mode: 'idle',
    recording: false, actions: [], traces: [], ws: null, busy: false
  };
  function byId(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function trimBase(value) { return String(value || '').trim().replace(/\/+$/, ''); }
  function authHeaders() { const h = { accept: 'application/json', 'content-type': 'application/json' }; if (LB.token) h.authorization = 'Bearer ' + LB.token; return h; }
  function loadConfig() { try { const o = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); LB.base = trimBase(o.base); LB.token = o.token || ''; } catch (_) {} hydrateForm(); renderConnection(); return LB; }
  function saveConfig() { LB.base = trimBase((byId('ls-url') || {}).value || ''); LB.token = String((byId('ls-token') || {}).value || '').trim(); try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ base: LB.base, token: LB.token })); } catch (_) {} hydrateForm(); renderConnection(); }
  function hydrateForm() { const u = byId('ls-url'); const t = byId('ls-token'); if (u && document.activeElement !== u) u.value = LB.base; if (t && document.activeElement !== t) t.value = LB.token; }
  function url(path) { return (LB.base || location.origin).replace(/\/+$/, '') + path; }
  async function api(path, options) {
    const opts = Object.assign({ headers: authHeaders() }, options || {}); opts.headers = Object.assign(authHeaders(), opts.headers || {});
    const res = await fetch(url(path), opts); const text = await res.text(); let data = {}; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!res.ok) throw new Error((data.error && (data.error.message || data.error)) || data.message || ('Live browser HTTP ' + res.status));
    return data;
  }
  function wsUrl(id) { const base = url('/ws/' + encodeURIComponent(id)); const u = new URL(base); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; if (LB.token) u.searchParams.set('token', LB.token); return u.toString(); }
  function addAction(label, status, detail) { LB.actions.push({ label: label, status: status || 'done', detail: detail || '', at: Date.now() }); if (LB.actions.length > 100) LB.actions.shift(); renderLog(); }
  function renderLog() { const el = byId('br-log'); if (el) el.innerHTML = LB.actions.slice(-40).map(function (a) { return '<div class="br-step"><span class="st ' + esc(a.status) + '">' + esc(a.status) + '</span><span class="txt">' + esc(a.label) + '</span><span class="ds">' + esc(a.detail) + '</span></div>'; }).join(''); const count = byId('br-count'); if (count) count.textContent = LB.actions.length + ' / 100'; }
  function setMode(mode) { LB.mode = mode || 'idle'; const txt = byId('br-mode-txt'); if (txt) txt.textContent = LB.mode; const modeEl = byId('br-mode'); if (modeEl) modeEl.className = 'br-mode ' + LB.mode; }
  function renderConnection() { const el = byId('br-conn'); if (!el) return; el.className = 'br-conn ' + (LB.connected ? 'on' : 'off'); el.innerHTML = '<span class="d"></span>' + (LB.connected ? 'connected' : (LB.base ? 'offline' : 'not configured')); }
  function showShot(data) { const img = byId('br-shot'); const empty = byId('br-empty'); let src = data; if (data && typeof data === 'object') src = data.data || data.screenshot || data.image || data.url; if (!src) return; if (typeof src === 'string' && !src.startsWith('data:') && !src.startsWith('http')) src = 'data:image/jpeg;base64,' + src; if (img) { img.src = src; img.classList.remove('hidden'); } if (empty) empty.classList.add('hidden'); }
  function handleMessage(raw) { let data = raw; if (typeof raw === 'string') { try { data = JSON.parse(raw); } catch (_) { return; } } if (!data) return; const type = data.type || data.event || ''; if (type === 'screenshot' || data.screenshot || data.image) showShot(data); if (type === 'state' || type === 'session') { LB.session = Object.assign({}, LB.session || {}, data.session || data); renderSessions(); } if (type === 'action' || type === 'log') addAction(data.label || data.action || 'browser action', data.status || 'done', data.detail || ''); if (type === 'mode') setMode(data.mode); if (type === 'trace' || data.trace) addTrace(data.trace || data); }
  function connectSocket() { if (!LB.session || !LB.session.id || typeof WebSocket === 'undefined') return; if (LB.ws) try { LB.ws.close(); } catch (_) {} try { LB.ws = new WebSocket(wsUrl(LB.session.id)); LB.ws.onopen = function () { LB.connected = true; renderConnection(); addAction('WebSocket connected', 'done'); }; LB.ws.onmessage = function (e) { handleMessage(e.data); }; LB.ws.onerror = function () { addAction('WebSocket error', 'error'); }; LB.ws.onclose = function () { LB.connected = false; renderConnection(); }; } catch (e) { addAction('WebSocket unavailable', 'error', e.message); } }
  async function check() { saveConfig(); const status = byId('ls-status'); if (status) status.textContent = 'Checking…'; try { const data = await api('/health'); if (status) status.innerHTML = '<span class="gh-ok">Live browser server is reachable.</span>'; addAction('Health check', 'done', data.version || 'ok'); return data; } catch (e) { if (status) status.innerHTML = '<span class="gh-err">' + esc(e.message) + '</span>'; addAction('Health check', 'error', e.message); throw e; } }
  async function createSession(target) { if (!LB.base) saveConfig(); const data = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ url: target || 'about:blank' }) }); LB.session = data.session || data; if (!LB.session.id && data.id) LB.session = data; setMode('idle'); renderSessions(); connectSocket(); addAction('Open session', 'done', target || 'about:blank'); return LB.session; }
  async function gotoPage(target) { if (!LB.session) await createSession(target); else { await api('/api/sessions/' + encodeURIComponent(LB.session.id) + '/goto', { method: 'POST', body: JSON.stringify({ url: target }) }); addAction('Navigate', 'done', target); } }
  async function sessionAction(action, payload) { if (!LB.session) throw new Error('Open a live browser session first.'); const id = encodeURIComponent(LB.session.id); let path = '/api/sessions/' + id + '/' + action; const data = await api(path, { method: 'POST', body: JSON.stringify(payload || {}) }); addAction(action, 'done'); handleMessage(data); return data; }
  async function act(instruction) { const text = String(instruction || '').trim(); if (!text) return; if (!LB.session) await createSession('about:blank'); const data = await sessionAction('act', { instruction: text, action: text }); addAction('Run action', 'done', text); return data; }
  function addTrace(trace) { LB.traces.push(trace); renderTraces(); }
  function renderTraces() { const el = byId('br-traces'); if (el) el.innerHTML = LB.traces.map(function (t, i) { return '<div class="br-trace"><span>trace ' + (i + 1) + '</span><button data-trace="' + i + '">Save</button></div>'; }).join(''); }
  function renderSessions() { const el = byId('br-sessions'); if (!el) return; el.innerHTML = LB.session ? '<div class="br-sess on"><b>Session ' + esc(String(LB.session.id).slice(0, 12)) + '</b><span>' + esc(LB.session.url || '') + '</span></div>' : '<div class="hint">No sessions.</div>'; }
  async function setBrowserMode(mode) { if (!LB.session) throw new Error('Open a session first.'); await sessionAction('mode', { mode: mode }); setMode(mode); }
  async function toggleRecording() { if (!LB.session) throw new Error('Open a session first.'); LB.recording = !LB.recording; await setBrowserMode(LB.recording ? 'recording' : 'idle'); const b = byId('br-rec'); if (b) b.classList.toggle('on', LB.recording); addAction(LB.recording ? 'Start recording' : 'Stop recording', 'done'); }
  function takeover() { return setBrowserMode('takeover').then(function () { setMode('takeover'); }); }
  function handback() { return setBrowserMode('agent').then(function () { setMode('agent'); }); }
  function closeSession() { if (LB.ws) try { LB.ws.close(); } catch (_) {} LB.ws = null; LB.session = null; LB.connected = false; setMode('idle'); renderSessions(); renderConnection(); const img = byId('br-shot'); if (img) { img.src = ''; img.classList.add('hidden'); } const empty = byId('br-empty'); if (empty) empty.classList.remove('hidden'); addAction('Close session', 'done'); }
  function wire() {
    const checkButton = byId('ls-check'); if (checkButton) checkButton.onclick = function () { check().catch(function () {}); };
    const saveButton = byId('ls-save'); if (saveButton) saveButton.onclick = function () { saveConfig(); closeModalSafe('m-live'); toastSafe('Live browser settings saved'); };
    const go = byId('br-go'); const urlInput = byId('br-url'); if (go) go.onclick = function () { gotoPage(urlInput && urlInput.value).catch(function (e) { addAction('Navigate', 'error', e.message); }); }; if (urlInput) urlInput.addEventListener('keydown', function (e) { if (e.key === 'Enter' && go) go.click(); });
    const back = byId('br-back'); if (back) back.onclick = function () { sessionAction('back').catch(function (e) { addAction('Back', 'error', e.message); }); }; const fwd = byId('br-fwd'); if (fwd) fwd.onclick = function () { sessionAction('forward').catch(function (e) { addAction('Forward', 'error', e.message); }); }; const reload = byId('br-reload'); if (reload) reload.onclick = function () { sessionAction('reload').catch(function (e) { addAction('Reload', 'error', e.message); }); };
    const ask = byId('br-ask'); const askGo = byId('br-ask-go'); if (askGo) askGo.onclick = function () { act(ask && ask.value).then(function () { if (ask) ask.value = ''; }).catch(function (e) { addAction('Agent action', 'error', e.message); }); }; if (ask) ask.addEventListener('keydown', function (e) { if (e.key === 'Enter' && askGo) askGo.click(); });
    const sideToggle = byId('br-side-toggle'); if (sideToggle) sideToggle.onclick = function () { const side = byId('br-side'); if (side) { const closing = !side.classList.contains('closed'); side.classList.toggle('closed', closing); sideToggle.setAttribute('aria-expanded', String(!closing)); } };
    const rec = byId('br-rec'); if (rec) rec.onclick = function () { toggleRecording().catch(function (e) { addAction('Recording', 'error', e.message); }); }; const take = byId('br-takeover'); if (take) take.onclick = function () { takeover().catch(function (e) { addAction('Take over', 'error', e.message); }); }; const hand = byId('br-handback'); if (hand) hand.onclick = function () { handback().catch(function (e) { addAction('Hand back', 'error', e.message); }); }; const close = byId('br-close-session'); if (close) close.onclick = closeSession; const closeView = byId('br-close'); if (closeView) closeView.onclick = function () { setViewSafe('editor'); };
    const config = byId('br-conn'); if (config) config.onclick = function () { openModalSafe('m-live'); };
  }
  function openModalSafe(id) { if (root.openModal) root.openModal(id); else { const e = byId(id); if (e) e.classList.add('on'); } }
  function closeModalSafe(id) { if (root.closeModal) root.closeModal(id); else { const e = byId(id); if (e) e.classList.remove('on'); } }
  function setViewSafe(view) { if (root.setView) root.setView(view); else { const e = byId('browser'); if (e) e.classList.remove('view-on'); } }
  function toastSafe(text) { if (root.toast) root.toast(text, 'ok'); }
  function boot() { loadConfig(); wire(); renderLog(); renderSessions(); renderTraces(); renderConnection(); }
  root.LB = LB; root.lbApi = api; root.lbCreateSession = createSession; root.lbGoto = gotoPage; root.lbAct = act; root.lbCheck = check; root.lbBoot = boot;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
