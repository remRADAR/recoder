/*
 * </recode> RADARMatrix client
 *
 * Browser-side adapter for the project's RADARMatrix gateway. It supports the
 * two surfaces documented by the workbench: POST /mcp (JSON-RPC 2.0) and
 * POST /v1/chat/completions (OpenAI-compatible). The gateway token is kept in
 * this browser's localStorage, never in the source tree.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'recode-radarmatrix-v1';
  const RM = {
    base: '',
    token: '',
    workspace: '',
    mode: 'mcp',
    busy: false,
    lastError: '',
    lastTest: null,
    requestId: 0
  };

  function byId(id) { return document.getElementById(id); }
  function trimBase(value) { return String(value || '').trim().replace(/\/+$/, ''); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        RM.base = trimBase(saved.base);
        RM.token = saved.token || '';
        RM.workspace = saved.workspace || '';
        RM.mode = saved.mode === 'openai' ? 'openai' : 'mcp';
      }
    } catch (_) {}
    hydrateForm();
    renderPane();
    return RM;
  }

  function save(config) {
    const source = config || {
      base: byId('rm-base') && byId('rm-base').value,
      token: byId('rm-token') && byId('rm-token').value,
      workspace: byId('rm-ws') && byId('rm-ws').value,
      mode: byId('rm-mode') && byId('rm-mode').value
    };
    RM.base = trimBase(source.base);
    RM.token = String(source.token || '').trim();
    RM.workspace = String(source.workspace || '').trim();
    RM.mode = source.mode === 'openai' ? 'openai' : 'mcp';
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        base: RM.base, token: RM.token, workspace: RM.workspace, mode: RM.mode
      }));
    } catch (_) {}
    hydrateForm();
    renderPane();
    return RM;
  }

  function hydrateForm() {
    const fields = [
      ['rm-base', RM.base], ['rm-token', RM.token],
      ['rm-ws', RM.workspace], ['rm-mode', RM.mode]
    ];
    fields.forEach(function (item) {
      const el = byId(item[0]);
      if (el && document.activeElement !== el) el.value = item[1];
    });
  }

  function headers(extra) {
    const h = Object.assign({
      'accept': 'application/json', 'content-type': 'application/json'
    }, extra || {});
    if (RM.token) h.authorization = 'Bearer ' + RM.token;
    if (RM.workspace) h['x-radar-workspace'] = RM.workspace;
    return h;
  }

  async function request(path, options) {
    if (!RM.base) throw new Error('Set the RADARMatrix gateway URL first.');
    const opts = Object.assign({}, options || {});
    opts.headers = headers(opts.headers);
    const response = await fetch(RM.base + path, opts);
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch (_) { data = { raw: text }; }
    if (!response.ok) {
      const message = data && data.error && (data.error.message || data.error)
        || data.message || ('Gateway returned HTTP ' + response.status);
      throw new Error(String(message));
    }
    if (data && data.error) {
      throw new Error(String(data.error.message || data.error));
    }
    return data;
  }

  function nextId() { RM.requestId += 1; return RM.requestId; }

  async function mcp(method, params) {
    const body = {
      jsonrpc: '2.0', id: nextId(), method: method,
      params: params || {}
    };
    return request('/mcp', { method: 'POST', body: JSON.stringify(body) });
  }

  async function chat(messages, options) {
    const opts = options || {};
    const body = {
      model: opts.model || 'radarmatrix',
      messages: Array.isArray(messages) ? messages : [],
      stream: false
    };
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.max_tokens != null) body.max_tokens = opts.max_tokens;
    if (opts.tools) body.tools = opts.tools;
    if (opts.response_format) body.response_format = opts.response_format;
    return request('/v1/chat/completions', {
      method: 'POST', body: JSON.stringify(body)
    });
  }

  async function complete(prompt, options) {
    const data = await chat([{ role: 'user', content: String(prompt || '') }], options);
    const choice = data && data.choices && data.choices[0];
    return choice && choice.message ? choice.message.content : '';
  }

  async function testGateway(config) {
    if (config) save(config);
    if (!RM.base) throw new Error('Set the RADARMatrix gateway URL first.');
    RM.busy = true;
    RM.lastError = '';
    renderPane();
    setMessage('Testing RADARMatrix…', 'busy');
    try {
      let data;
      if (RM.mode === 'openai') {
        data = await chat([{ role: 'user', content: 'Reply with the single word OK.' }], {
          model: 'radarmatrix', max_tokens: 8, temperature: 0
        });
      } else {
        // tools/list is a read-only JSON-RPC health check for MCP gateways.
        data = await mcp('tools/list', {});
      }
      RM.lastTest = { ok: true, at: Date.now(), data: data };
      setMessage('RADARMatrix gateway responded successfully.', 'ok');
      renderPane();
      return data;
    } catch (error) {
      RM.lastError = error.message || String(error);
      RM.lastTest = { ok: false, at: Date.now(), error: RM.lastError };
      setMessage(RM.lastError, 'error');
      renderPane();
      throw error;
    } finally {
      RM.busy = false;
      renderPane();
    }
  }

  function setMessage(text, kind) {
    const el = byId('rm-msg');
    if (!el) return;
    el.className = kind ? 'rm-' + kind : '';
    el.textContent = text || '';
  }

  function renderPane() {
    const pane = byId('rm-pane');
    if (!pane) return;
    const state = RM.lastTest && RM.lastTest.ok ? 'connected' : (RM.base ? 'configured' : 'not configured');
    pane.innerHTML = [
      '<div class="pane-pad">',
      '<div class="hint" style="margin-top:0"><b>RADARMatrix</b> · ' + esc(state) + '</div>',
      RM.base ? '<div class="sub">' + esc(RM.base) + (RM.workspace ? ' · workspace ' + esc(RM.workspace) : '') + '</div>' : '',
      RM.lastError ? '<div class="rm-error">' + esc(RM.lastError) + '</div>' : '',
      '<button class="btn" id="rm-pane-test"' + (RM.busy ? ' disabled' : '') + '>' + (RM.busy ? 'Testing…' : 'Test gateway') + '</button>',
      '</div>'
    ].join('');
    const button = byId('rm-pane-test');
    if (button) button.addEventListener('click', function () { testGateway().catch(function () {}); });
  }

  function wire() {
    const saveButton = byId('rm-save');
    const testButton = byId('rm-test2');
    if (saveButton && !saveButton.dataset.rmWired) {
      saveButton.dataset.rmWired = '1';
      saveButton.addEventListener('click', function () {
        save();
        setMessage('RADARMatrix settings saved.', 'ok');
      });
    }
    if (testButton && !testButton.dataset.rmWired) {
      testButton.dataset.rmWired = '1';
      testButton.addEventListener('click', function () { testGateway().catch(function () {}); });
    }
    ['rm-base', 'rm-token', 'rm-ws', 'rm-mode'].forEach(function (id) {
      const el = byId(id);
      if (el && !el.dataset.rmWired) {
        el.dataset.rmWired = '1';
        el.addEventListener('change', function () { save(); });
      }
    });
    renderPane();
  }

  // Public API. Aliases cover the names used by the existing HTML labels and
  // make it easy for app.js to call the client without importing a module.
  root.RM = RM;
  root.rmLoad = load;
  root.rmSave = save;
  root.rmSaveConfig = save;
  root.rmRequest = request;
  root.rmMcp = mcp;
  root.rmChat = chat;
  root.rmComplete = complete;
  root.rmTest = testGateway;
  root.rmTestGateway = testGateway;
  root.renderRmPane = renderPane;
  root.rmWire = wire;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { load(); wire(); });
  } else {
    load(); wire();
  }
})(window);
