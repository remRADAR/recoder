/* ============================================================
   MANUS INTEGRATION — hand the workbench to Manus, and back
   ============================================================
   Manus (https://manus.im) is a general AI agent that runs tasks
   asynchronously: you create a task, it works, and you read the
   messages it produces. This module makes </recode> a Manus
   client, so a task started here can read the repo, edit files and
   report back — and so Manus can continue work started here.

   WHY A PROXY IS REQUIRED (verified 2026-11-23, not assumed)
   ----------------------------------------------------------
   api.manus.ai cannot be called from a browser page:

     OPTIONS /v2/task.list
       Origin: https://example.com
       Access-Control-Request-Headers: x-manus-api-key
     -> 204 with NO access-control-allow-origin

     Same preflight with Origin: https://manus.im
     -> 204 with access-control-allow-origin: https://manus.im

   The preflight only passes for Manus's own origin, so the browser
   blocks the request before it is sent. The API key must travel in
   `x-manus-api-key`, which always forces a preflight. Hence
   server/manus_proxy.py — and the key never reaches this page.

   API surface used (Manus API v2, https://open.manus.ai/docs/v2):
     GET  /v2/user.me            identity + credential check
     GET  /v2/task.list          task history
     POST /v2/task.create        start a task
     GET  /v2/task.detail        status
     GET  /v2/task.listMessages  the transcript
     POST /v2/task.sendMessage   follow-up turn
   ============================================================ */

const MN = {
  proxy: '',        // e.g. https://manus-proxy.fly.dev
  token: '',        // optional x-mp-token for the proxy
  key: '',          // optional per-request Manus key (kept in this browser only)
  user: null,
  tasks: [],
  active: null,     // task id being watched
  messages: [],
  status: '',
  busy: false,
  lastError: '',
  health: null,
  es: null,
  log: []
};
const MN_LS = 'recode-manus-v1';

function mnLoad() {
  try {
    const raw = localStorage.getItem(MN_LS);
    if (!raw) return;
    const o = JSON.parse(raw);
    MN.proxy = o.proxy || '';
    MN.token = o.token || '';
    MN.key = o.key || '';
  } catch (e) {}
}
function mnSave() {
  try {
    localStorage.setItem(MN_LS, JSON.stringify({
      proxy: MN.proxy, token: MN.token, key: MN.key
    }));
  } catch (e) {}
}
function mnReady() { return !!MN.proxy; }

function mnUrl(path) {
  return MN.proxy.replace(/\/+$/, '') + path;
}
function mnHeaders(extra) {
  const h = Object.assign({ 'content-type': 'application/json' }, extra || {});
  if (MN.token) h['x-mp-token'] = MN.token;
  if (MN.key) h['x-manus-key'] = MN.key;
  return h;
}

function mnLog(kind, text, ms) {
  MN.log.push({ kind: kind, text: text, ms: ms || 0, at: Date.now() });
  if (MN.log.length > 60) MN.log.shift();
}

async function mnFetch(path, opts) {
  const t0 = performance.now();
  const res = await fetch(mnUrl(path), Object.assign({
    headers: mnHeaders()
  }, opts || {}));
  const ms = Math.round(performance.now() - t0);
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  mnLog(path, (data.ok === false ? 'error' : 'ok') + ' · HTTP ' + res.status, ms);
  if (data.ok === false) {
    const err = data.error || {};
    throw new Error((err.message || 'Manus request failed') +
      (err.code ? ' (' + err.code + ')' : ''));
  }
  return data;
}

/* ---------- connection ---------- */
async function mnHealth() {
  if (!mnReady()) throw new Error('Set the Manus proxy URL first.');
  const res = await fetch(mnUrl('/health'), { headers: mnHeaders() });
  const data = await res.json().catch(() => ({}));
  MN.health = data;
  return data;
}

async function mnConnect() {
  MN.busy = true; MN.lastError = '';
  renderMnPane();
  try {
    const h = await mnHealth();
    if (!h.api_key_configured && !MN.key) {
      throw new Error('The proxy has no MANUS_API_KEY and no key was pasted here. ' +
        'Start the proxy with MANUS_API_KEY=... or paste a key below.');
    }
    const me = await mnFetch('/api/manus/me');
    MN.user = {
      id: me.user_id || '',
      name: me.name || '',
      email: me.email || '',
      avatar: me.avatar_url || ''
    };
    await mnListTasks();
    toast('Manus connected' + (MN.user.name ? ' as <b>' + esc(MN.user.name) + '</b>' : ''));
  } catch (e) {
    MN.lastError = e.message;
    MN.user = null;
  } finally {
    MN.busy = false;
    renderMnPane();
  }
}

async function mnListTasks() {
  const d = await mnFetch('/api/manus/tasks?limit=20');
  MN.tasks = d.data || [];
  return MN.tasks;
}

/* ---------- tasks ---------- */
async function mnCreateTask(prompt, title) {
  MN.busy = true; MN.lastError = '';
  renderMnPane();
  try {
    const d = await mnFetch('/api/manus/tasks', {
      method: 'POST',
      body: JSON.stringify({ prompt: prompt, title: title || '' })
    });
    const t = d.task || d.data || {};
    const id = t.id || t.task_id || '';
    if (!id) throw new Error('Manus accepted the request but returned no task id.');
    MN.active = id;
    MN.messages = [];
    MN.status = t.status || 'running';
    await mnListTasks();
    mnWatch(id);
    toast('Manus task started');
    return id;
  } catch (e) {
    MN.lastError = e.message;
    throw e;
  } finally {
    MN.busy = false;
    renderMnPane();
  }
}

async function mnOpenTask(id) {
  MN.active = id;
  MN.messages = [];
  MN.status = '';
  renderMnPane();
  try {
    const d = await mnFetch('/api/manus/messages?id=' + encodeURIComponent(id) + '&limit=100');
    MN.messages = d.messages || [];
    const det = await mnFetch('/api/manus/task?id=' + encodeURIComponent(id));
    MN.status = ((det.task || {}).status) || '';
  } catch (e) {
    MN.lastError = e.message;
  }
  renderMnPane();
  if (MN.status === 'running') mnWatch(id);
}

function mnWatch(id) {
  if (MN.es) { try { MN.es.close(); } catch (e) {} MN.es = null; }
  if (!mnReady()) return;
  // EventSource cannot set headers, so the proxy token rides as a query
  // param when one is configured. The proxy accepts either form.
  const full = mnUrl('/api/manus/watch?id=' + encodeURIComponent(id)) +
    (MN.token ? '&token=' + encodeURIComponent(MN.token) : '');
  let es;
  try { es = new EventSource(full); } catch (e) { return; }
  MN.es = es;
  es.addEventListener('message', (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (!MN.messages.some((x) => x.id === m.id)) MN.messages.push(m);
      renderMnMessages();
    } catch (e) {}
  });
  es.addEventListener('status', (ev) => {
    try {
      const s = JSON.parse(ev.data);
      MN.status = s.status || MN.status;
      renderMnPane();
    } catch (e) {}
  });
  es.addEventListener('error', () => {
    try { es.close(); } catch (e) {}
    MN.es = null;
  });
}

async function mnSend(text) {
  if (!MN.active) throw new Error('Open a task first.');
  MN.busy = true;
  renderMnPane();
  try {
    await mnFetch('/api/manus/message', {
      method: 'POST',
      body: JSON.stringify({ task_id: MN.active, prompt: text })
    });
    await mnOpenTask(MN.active);
  } finally {
    MN.busy = false;
    renderMnPane();
  }
}

/* ---------- transcript rendering ---------- */
function mnMsgText(m) {
  if (m.assistant_message && m.assistant_message.content) return m.assistant_message.content;
  if (m.user_message && m.user_message.content) return m.user_message.content;
  if (m.error_message && m.error_message.content) return m.error_message.content;
  if (m.status_update) return m.status_update.brief || m.status_update.description || '';
  if (m.tool_used) {
    const t = m.tool_used;
    return (t.brief || t.tool || 'tool') + (t.description ? ' — ' + t.description : '');
  }
  return '';
}

function mnMsgKind(m) {
  if (m.type) return m.type;
  if (m.assistant_message) return 'assistant_message';
  if (m.user_message) return 'user_message';
  if (m.tool_used) return 'tool_used';
  if (m.status_update) return 'status_update';
  if (m.error_message) return 'error_message';
  return 'message';
}

function renderMnMessages() {
  const el = $('#mn-msgs');
  if (!el) return;
  if (!MN.messages.length) {
    el.innerHTML = '<div class="hint" style="margin:0">No messages yet. Manus reports progress here as it works.</div>';
    return;
  }
  el.innerHTML = MN.messages.map((m) => {
    const kind = mnMsgKind(m);
    const text = mnMsgText(m);
    const cls = kind === 'user_message' ? 'u'
      : kind === 'error_message' ? 'e'
      : kind === 'tool_used' ? 't'
      : kind === 'status_update' ? 's' : 'a';
    const label = kind === 'user_message' ? 'you'
      : kind === 'assistant_message' ? 'manus'
      : kind === 'tool_used' ? 'tool'
      : kind === 'status_update' ? 'status'
      : kind === 'error_message' ? 'error' : kind;
    return '<div class="mn-msg ' + cls + '">' +
      '<div class="mn-msg-h"><span class="k">' + esc(label) + '</span>' +
      (m.timestamp ? '<span class="ts">' + new Date(m.timestamp).toLocaleTimeString() + '</span>' : '') +
      '</div><div class="mn-msg-b">' + mnFmt(text) + '</div></div>';
  }).join('');
  el.scrollTop = el.scrollHeight;
}

/* minimal markdown: code fences, inline code, bold, links */
function mnFmt(s) {
  let t = esc(String(s || ''));
  t = t.replace(/```([\s\S]*?)```/g, (_, c) => '<pre class="mn-code">' + c.replace(/^\w*\n/, '') + '</pre>');
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\n/g, '<br>');
  return t;
}

/* ---------- panel ---------- */
function renderMnPane() {
  const el = $('#mn-pane');
  if (!el) return;
  const out = [];

  out.push('<div class="gh-sec"><div class="gh-card">' +
    '<div class="gh-lbl">Manus <span class="sp"></span>' +
    '<span class="mn-badge' + (MN.user ? ' on' : '') + '">' +
    (MN.user ? 'connected' : 'not connected') + '</span></div>' +
    '<div class="gh-note" style="margin-top:0">Manus runs tasks asynchronously. ' +
    'Start one here and it works on this repo; its progress streams back into this panel.</div>' +
    (MN.user ? '<div class="mn-user">' +
      (MN.user.avatar ? '<img src="' + esc(MN.user.avatar) + '" alt="">' : '') +
      '<div><div class="nm">' + esc(MN.user.name || MN.user.id) + '</div>' +
      '<div class="em">' + esc(MN.user.email || '') + '</div></div></div>' : '') +
    '<div class="gh-row2" style="margin-top:8px">' +
    '<button class="gh-btn sm" id="mn-open">Configure</button>' +
    '<button class="gh-btn sm" id="mn-test">' + (MN.busy ? 'Working…' : 'Connect') + '</button>' +
    '</div>' +
    (MN.health ? '<div class="gh-note" style="margin-top:8px">Proxy v' + esc(MN.health.version || '?') +
      ' · upstream ' + (MN.health.upstream_reachable ? 'reachable' : 'unreachable') +
      ' · key ' + (MN.health.api_key_configured ? 'on server' : 'per-request') + '</div>' : '') +
    (MN.lastError ? '<div class="gh-err" style="margin-top:8px"><b>' + esc(MN.lastError) + '</b></div>' : '') +
    '</div></div>');

  /* new task */
  out.push('<div class="gh-sec"><div class="gh-lbl">New task</div>' +
    '<textarea class="field mn-ta" id="mn-prompt" rows="3" ' +
    'placeholder="e.g. Read the repo and add a README section on the Manus integration"></textarea>' +
    '<div class="gh-row2" style="margin-top:6px">' +
    '<button class="gh-btn pri sm" id="mn-start"' + (MN.user ? '' : ' disabled') + '>Start task</button>' +
    '<button class="gh-btn sm" id="mn-ctx">Insert repo context</button>' +
    '</div></div>');

  /* active task */
  if (MN.active) {
    out.push('<div class="gh-sec"><div class="gh-lbl">Active task <span class="sp"></span>' +
      '<span class="mn-st ' + (MN.status === 'running' ? 'run' : 'done') + '">' +
      esc(MN.status || 'unknown') + '</span></div>' +
      '<div class="mn-id">' + esc(MN.active) + '</div>' +
      '<div id="mn-msgs" class="mn-msgs"></div>' +
      '<div class="mn-send"><input class="field" id="mn-reply" placeholder="Reply to Manus…">' +
      '<button class="gh-btn sm" id="mn-send">Send</button></div>' +
      '</div>');
  }

  /* history */
  out.push('<div class="gh-sec"><div class="gh-lbl">Tasks <span class="sp"></span>' +
    '<span class="rm-cnt">' + MN.tasks.length + '</span></div>');
  if (!MN.tasks.length) {
    out.push('<div class="gh-note" style="margin-top:0;color:var(--dim2)">' +
      (MN.user ? 'No tasks yet.' : 'Connect to list your tasks.') + '</div>');
  } else {
    MN.tasks.slice(0, 12).forEach((t) => {
      out.push('<div class="mn-task' + (t.id === MN.active ? ' on' : '') + '" data-task="' + esc(t.id) + '">' +
        '<div class="top"><span class="nm">' + esc((t.title || t.id).slice(0, 52)) + '</span>' +
        '<span class="st ' + (t.status === 'running' ? 'run' : '') + '">' + esc(t.status || '') + '</span></div>' +
        '<div class="ds">' + esc(t.task_type || 'standard') +
        (t.credit_usage ? ' · ' + t.credit_usage + ' credits' : '') + '</div></div>');
    });
  }
  out.push('</div>');

  /* call log */
  if (MN.log.length) {
    out.push('<div class="gh-sec"><div class="gh-lbl">Proxy calls</div>');
    MN.log.slice(-6).reverse().forEach((c) => {
      out.push('<div class="rm-call"><span class="m">' + esc(c.text) + '</span>' +
        '<span class="t">' + c.ms + 'ms</span>' +
        '<span class="s' + (c.kind.indexOf('error') < 0 ? ' on' : '') + '">' +
        (c.kind.indexOf('error') < 0 ? 'ok' : 'err') + '</span></div>');
    });
    out.push('</div>');
  }

  el.innerHTML = out.join('');
  renderMnMessages();
  mnWire();
}

function mnWire() {
  const open = $('#mn-open');
  if (open) open.addEventListener('click', () => openModal('m-manus'));
  const test = $('#mn-test');
  if (test) test.addEventListener('click', () => mnConnect());
  const start = $('#mn-start');
  if (start) start.addEventListener('click', async () => {
    const p = ($('#mn-prompt') || {}).value || '';
    if (!p.trim()) { toast('Describe the task first'); return; }
    try { await mnCreateTask(p.trim()); } catch (e) { toast(esc(e.message)); }
  });
  const ctx = $('#mn-ctx');
  if (ctx) ctx.addEventListener('click', () => {
    const ta = $('#mn-prompt');
    if (!ta) return;
    const f = (typeof activeFile !== 'undefined' && activeFile) ? activeFile : '';
    const body = (typeof files !== 'undefined' && files[f]) ? files[f] : '';
    ta.value = (ta.value ? ta.value + '\n\n' : '') +
      'Repository: remRADAR/recoder\nFile: ' + (f || '(none open)') + '\n\n' +
      (body ? '```\n' + body.slice(0, 4000) + '\n```' : '');
  });
  const send = $('#mn-send');
  if (send) send.addEventListener('click', async () => {
    const v = ($('#mn-reply') || {}).value || '';
    if (!v.trim()) return;
    try { await mnSend(v.trim()); } catch (e) { toast(esc(e.message)); }
  });
  const reply = $('#mn-reply');
  if (reply) reply.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (send) send.click(); }
  });
  $$('#mn-pane [data-task]').forEach((n) => {
    n.addEventListener('click', () => mnOpenTask(n.dataset.task));
  });
}

/* ---------- settings modal ---------- */
function mnOpenSettings() {
  const p = $('#mn-proxy'); if (p) p.value = MN.proxy;
  const t = $('#mn-token'); if (t) t.value = MN.token;
  const k = $('#mn-key'); if (k) k.value = MN.key;
  const msg = $('#mn-msg'); if (msg) msg.innerHTML = '';
  openModal('m-manus');
}

function mnSaveSettings() {
  MN.proxy = (($('#mn-proxy') || {}).value || '').trim();
  MN.token = (($('#mn-token') || {}).value || '').trim();
  MN.key = (($('#mn-key') || {}).value || '').trim();
  mnSave();
  const msg = $('#mn-msg');
  if (msg) msg.innerHTML = '<div class="gh-ok">Saved. Press <b>Connect</b> to verify.</div>';
  renderMnPane();
}

/* ---------- boot ---------- */
mnLoad();

/* Wire the Manus modal, and close a pre-existing gap: the RADARMatrix
   modal's Save / Test buttons were rendered but never bound. */
(function mnBoot() {
  const bind = () => {
    const save = $('#mn-save');
    if (save) save.addEventListener('click', () => {
      mnSaveSettings();
      closeModal('m-manus');
      toast('Manus settings saved');
      mnConnect();
    });
    const rsave = $('#rm-save');
    if (rsave && typeof saveRmConfig === 'function') {
      rsave.addEventListener('click', () => saveRmConfig());
    }
    const rtest = $('#rm-test2');
    if (rtest && typeof rmTest === 'function') {
      rtest.addEventListener('click', () => rmTest());
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
