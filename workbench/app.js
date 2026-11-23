/*
 * </recode> workbench application shell.
 *
 * This file is intentionally browser-native. It supplies the UI contract used
 * by index.html, model-catalogue.js, radarmatrix.js, live-browser.js, and
 * manus.js without requiring a bundler.
 */
(function (root) {
  'use strict';

  const $ = function (selector, scope) { return (scope || document).querySelector(selector); };
  const $$ = function (selector, scope) { return Array.from((scope || document).querySelectorAll(selector)); };
  const esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  root.$ = $; root.$$ = $$; root.esc = esc;

  const STORAGE = 'recode-workbench-v1';
  const AI_STORAGE = 'recode-ai-v1';
  const initialFiles = {
    'README.md': '# </recode>\n\nA mobile-first coding workbench.\n\nUse the Manus panel to connect an agent, or configure an AI provider from the AI rail.',
    'src/main.ts': 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("world"));\n',
    'src/radar.ts': 'export const workspace = "radar";\nexport const status = "ready";\n',
    'package.json': '{\n  "name": "recode-project",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "start": "node src/main.ts"\n  }\n}\n'
  };

  const state = {
    files: {}, activeFile: '', openFiles: [], dirty: new Set(),
    view: 'editor', pane: 'files', panel: 'terminal', provider: null,
    aiMessages: [], diff: null, search: '', terminal: [], problems: [
      { severity: 'warning', text: 'No project diagnostics have been collected yet.' }
    ]
  };
  root.files = state.files;
  root.activeFile = state.activeFile;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
      state.files = Object.assign({}, initialFiles, saved.files || {});
      state.activeFile = saved.activeFile && state.files[saved.activeFile]
        ? saved.activeFile : Object.keys(state.files)[0];
      state.openFiles = Array.isArray(saved.openFiles) && saved.openFiles.length
        ? saved.openFiles.filter(function (f) { return state.files[f]; })
        : [state.activeFile];
      if (!state.openFiles.includes(state.activeFile)) state.openFiles.push(state.activeFile);
    } catch (_) {
      state.files = Object.assign({}, initialFiles);
      state.activeFile = Object.keys(state.files)[0];
      state.openFiles = [state.activeFile];
    }
    root.files = state.files; root.activeFile = state.activeFile;
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({
        files: state.files, activeFile: state.activeFile, openFiles: state.openFiles
      }));
    } catch (_) {}
  }

  function toast(message, kind) {
    const host = byId('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = String(message || '');
    host.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, 3200);
  }
  root.toast = toast;

  function byId(id) { return document.getElementById(id); }
  function openModal(id) {
    const el = byId(id); if (!el) return;
    el.classList.add('on');
    const overlay = byId('overlay'); if (overlay) overlay.classList.add('on');
  }
  function closeModal(id) {
    const el = byId(id); if (el) el.classList.remove('on');
    if (!$$('.modal.on').length) { const overlay = byId('overlay'); if (overlay) overlay.classList.remove('on'); }
  }
  root.openModal = openModal; root.closeModal = closeModal;

  /* View switching. The browser and marketplace surfaces are full-bleed
     overlays inside .work, so they are toggled with the same `.on` class
     their own CSS uses — not a separate `view-on` state. */
  function setView(view) {
    state.view = view;
    $$('.browser, .mkt').forEach(function (el) { el.classList.remove('on'); });
    const browser = byId('browser'); const mkt = byId('mkt');
    if (view === 'browser' && browser) browser.classList.add('on');
    else if (view === 'marketplace' && mkt) mkt.classList.add('on');
    $$('.rail button[data-view], [data-bnav]').forEach(function (el) {
      el.classList.toggle('on', (el.dataset.view || el.dataset.bnav) === view);
    });
    if (view !== 'browser' && browser) browser.classList.remove('on');
    if (view !== 'marketplace' && mkt) mkt.classList.remove('on');
  }

  function setPane(pane) {
    state.pane = pane;
    $$('[data-pane]').forEach(function (el) { el.classList.toggle('on', el.dataset.pane === pane); });
    $$('[data-view]').forEach(function (el) { el.classList.toggle('on', el.dataset.view === pane); });
    const title = byId('sb-title'); if (title) title.textContent = pane.charAt(0).toUpperCase() + pane.slice(1);
    if (pane === 'ai') renderAiPane();
    if (pane === 'radarmatrix' && root.renderRmPane) root.renderRmPane();
    if (pane === 'manus' && root.renderMnPane) root.renderMnPane();
    if (pane === 'github') renderGithubPane();
    if (pane === 'search') renderSearchPane();
    if (pane === 'settings') renderSettingsPane();
  }

  /* The tree and the code view use the class names app.css styles:
     .row/.fi/.nm for a file row, .ln-row/.ln/.lc for a code line. */
  function renderTree() {
    const tree = byId('tree'); if (!tree) return;
    const names = Object.keys(state.files).sort();
    tree.innerHTML = names.map(function (name) {
      const active = name === state.activeFile ? ' active' : '';
      const dirty = state.dirty.has(name) ? '<span class="dirty">●</span>' : '';
      return '<div class="row file' + active + '" data-file="' + esc(name) + '"><span class="fi ts">' + iconFor(name) + '</span><span class="nm">' + esc(name) + '</span>' + dirty + '</div>';
    }).join('');
    $$('#tree [data-file]').forEach(function (el) { el.addEventListener('click', function () { openFile(el.dataset.file); }); });
  }
  function iconFor(name) {
    if (/\.tsx?$/.test(name)) return 'TS';
    if (/\.json$/.test(name)) return '{}';
    if (/\.md$/.test(name)) return 'M';
    return '·';
  }
  function openFile(name) {
    if (!state.files[name]) return;
    state.activeFile = name; root.activeFile = name;
    if (!state.openFiles.includes(name)) state.openFiles.push(name);
    renderTree(); renderTabs(); renderEditor(); updateStatus(); persist();
  }
  function renderTabs() {
    const tabs = byId('tabs'); if (!tabs) return;
    tabs.innerHTML = state.openFiles.map(function (name) {
      return '<button class="tab' + (name === state.activeFile ? ' on' : '') + '" data-tab="' + esc(name) + '">' + esc(name.split('/').pop()) + (state.dirty.has(name) ? ' •' : '') + '<span class="tab-x" data-close="' + esc(name) + '">×</span></button>';
    }).join('');
    $$('#tabs [data-tab]').forEach(function (el) { el.addEventListener('click', function (e) { if (!e.target.dataset.close) openFile(el.dataset.tab); }); });
    $$('#tabs [data-close]').forEach(function (el) { el.addEventListener('click', function (e) { e.stopPropagation(); closeFile(el.dataset.close); }); });
  }
  function closeFile(name) {
    if (state.dirty.has(name) && !window.confirm('Discard unsaved changes to ' + name + '?')) return;
    state.openFiles = state.openFiles.filter(function (f) { return f !== name; });
    state.dirty.delete(name);
    if (state.activeFile === name) state.activeFile = state.openFiles[0] || Object.keys(state.files)[0];
    root.activeFile = state.activeFile; renderTabs(); renderEditor(); renderTree(); persist();
  }

  function renderEditor() {
    const ta = byId('editor-ta'); const code = byId('code');
    const body = state.files[state.activeFile] || '';
    if (ta && document.activeElement !== ta) ta.value = body;
    if (code) {
      code.innerHTML = body.split('\n').map(function (line, i) {
        return '<div class="ln-row"><span class="ln">' + (i + 1) + '</span><span class="lc">' + highlight(line) + '</span></div>';
      }).join('');
    }
    const path = byId('bc-path'); if (path) path.textContent = state.activeFile || 'No file open';
    const dirty = byId('ed-dirty'); if (dirty) dirty.style.display = state.dirty.has(state.activeFile) ? '' : 'none';
    if (ta) ta.scrollTop = ta.scrollTop;
  }
  /* Token classes match app.css: .k keyword, .s string, .c comment. */
  function highlight(line) {
    let s = esc(line);
    s = s.replace(/(\/\/.*)$/g, '<span class="c">$1</span>');
    s = s.replace(/(['"`])((?:\\.|(?!\1).)*)\1/g, '<span class="s">$1$2$1</span>');
    s = s.replace(/\b(const|let|var|function|return|export|import|from|async|await|class|new)\b/g, '<span class="k">$1</span>');
    return s || '&nbsp;';
  }
  function markDirty() {
    const ta = byId('editor-ta'); if (!ta || !state.activeFile) return;
    state.files[state.activeFile] = ta.value; state.dirty.add(state.activeFile); root.files = state.files;
    renderEditor(); renderTabs(); renderTree(); updateStatus();
  }
  function saveActive() {
    if (!state.activeFile) return;
    const ta = byId('editor-ta'); if (ta) state.files[state.activeFile] = ta.value;
    state.dirty.delete(state.activeFile); root.files = state.files; persist(); renderEditor(); renderTabs(); renderTree();
    toast('Saved ' + esc(state.activeFile), 'ok');
  }
  function revertActive() { state.dirty.delete(state.activeFile); renderEditor(); renderTabs(); renderTree(); }

  function updateStatus() {
    const ta = byId('editor-ta'); const value = ta ? ta.value : '';
    const lines = value.slice(0, ta ? ta.selectionStart : 0).split('\n');
    const ln = byId('st-ln'); if (ln) ln.textContent = 'Ln ' + lines.length + ', Col ' + (lines[lines.length - 1].length + 1);
    const lang = byId('st-lang'); if (lang) lang.textContent = languageFor(state.activeFile);
    const host = byId('st-host'); if (host) host.textContent = 'JSC 12/12';
  }
  function languageFor(name) {
    if (/\.json$/.test(name)) return 'JSON';
    if (/\.md$/.test(name)) return 'Markdown';
    if (/\.css$/.test(name)) return 'CSS';
    return 'TypeScript';
  }

  function renderGithubPane() {
    const el = byId('gh-pane'); if (!el) return;
    el.innerHTML = '<div class="gh-sec"><div class="gh-card"><div class="gh-lbl">GitHub <span class="gh-badge">browser API</span></div><div class="gh-note">Sign in to clone, inspect, commit, push, or open a pull request. Credentials remain in this browser.</div><div class="gh-row2"><button class="gh-btn pri sm" id="gh-signin">Sign in</button><button class="gh-btn sm" id="gh-clone">Clone</button></div></div></div>';
    const sign = byId('gh-signin'); if (sign) sign.onclick = function () { openModal('m-signin'); };
    const clone = byId('gh-clone'); if (clone) clone.onclick = function () { openModal('m-clone'); };
  }
  function renderSearchPane() {
    const el = byId('search-results'); if (!el) return;
    const q = (byId('search-input') || {}).value || '';
    if (!q) { el.innerHTML = '<div class="hint">Search files in this workspace.</div>'; return; }
    const out = [];
    Object.keys(state.files).forEach(function (name) {
      state.files[name].split('\n').forEach(function (line, i) {
        if (line.toLowerCase().includes(q.toLowerCase())) out.push('<div class="search-hit" data-file="' + esc(name) + '"><b>' + esc(name) + ':' + (i + 1) + '</b> ' + esc(line.trim()) + '</div>');
      });
    });
    el.innerHTML = out.join('') || '<div class="hint">No matches.</div>';
    $$('#search-results [data-file]').forEach(function (n) { n.onclick = function () { openFile(n.dataset.file); }; });
  }
  function renderSettingsPane() {
    const el = byId('settings-list'); if (!el) return;
    el.innerHTML = '<div class="pane-pad"><div class="hint">Workspace settings are stored locally in this browser.</div><button class="btn" id="settings-reset">Reset sample workspace</button></div>';
    const reset = byId('settings-reset'); if (reset) reset.onclick = function () { if (window.confirm('Reset local workspace?')) { state.files = Object.assign({}, initialFiles); state.activeFile = Object.keys(state.files)[0]; state.openFiles = [state.activeFile]; state.dirty.clear(); persist(); renderAll(); } };
  }

  function providerConfig() {
    try { return JSON.parse(localStorage.getItem(AI_STORAGE) || 'null'); } catch (_) { return null; }
  }
  function renderAiPane() {
    const el = byId('ai-pane'); if (!el) return;
    const cfg = providerConfig(); state.provider = cfg;
    el.innerHTML = '<div class="gh-sec"><div class="gh-card"><div class="gh-lbl">AI provider <span class="ai-badge">' + esc(cfg ? cfg.providerName : 'not configured') + '</span></div><div class="gh-note">Connect an OpenAI-compatible provider, local server, or proxy. Keys remain in this browser.</div><div class="gh-row2"><button class="gh-btn pri sm" id="ai-config">Configure</button><button class="gh-btn sm" id="ai-clear">Clear</button></div></div></div>';
    const config = byId('ai-config'); if (config) config.onclick = function () { openProviderModal(); };
    const clear = byId('ai-clear'); if (clear) clear.onclick = function () { localStorage.removeItem(AI_STORAGE); renderAiPane(); updateAiStatus(); };
    updateAiStatus();
  }
  function openProviderModal() {
    const cfg = providerConfig() || {};
    const select = byId('pv-model'); const cat = root.MODEL_CATALOGUE;
    if (select && cat) {
      select.innerHTML = cat.providers.map(function (p) { return '<optgroup label="' + esc(p.name) + '">' + p.models.map(function (m) { return '<option value="' + esc(p.id + '::' + m.id) + '">' + esc(m.name) + '</option>'; }).join('') + '</optgroup>'; }).join('');
      const current = cfg.provider && cfg.model ? cfg.provider + '::' + cfg.model : '';
      if (current) select.value = current;
    }
    const key = byId('pv-key'); if (key) key.value = cfg.key || '';
    const base = byId('pv-base'); if (base) base.value = cfg.base || '';
    updateProviderInfo(); openModal('m-prov');
  }
  function selectedProvider() {
    const select = byId('pv-model'); const v = select && select.value || '';
    const split = v.split('::'); const cat = root.MODEL_CATALOGUE;
    const p = cat && cat.getProvider(split[0]); const m = cat && cat.getModel(split[1]);
    return { provider: p, model: m };
  }
  function updateProviderInfo() {
    const picked = selectedProvider(); const p = picked.provider; const hint = byId('pv-hint'); const base = byId('pv-base');
    if (hint) hint.textContent = p ? p.name + ' · ' + p.kind + ' API' : '';
    if (base && p && !base.value) base.value = p.base;
  }
  function saveProvider() {
    const picked = selectedProvider(); if (!picked.provider || !picked.model) return;
    const cfg = { provider: picked.provider.id, providerName: picked.provider.name, model: picked.model.id, key: (byId('pv-key') || {}).value || '', base: (byId('pv-base') || {}).value || picked.provider.base };
    localStorage.setItem(AI_STORAGE, JSON.stringify(cfg)); closeModal('m-prov'); renderAiPane(); toast('AI provider saved', 'ok');
  }
  async function testProvider() {
    const picked = selectedProvider(); const key = (byId('pv-key') || {}).value || ''; const base = (byId('pv-base') || {}).value || (picked.provider && picked.provider.base) || '';
    const msg = byId('pv-msg'); if (msg) msg.textContent = 'Testing…';
    try { const data = await providerChat('Reply with the single word OK.', { provider: picked.provider, model: picked.model, key: key, base: base }); if (msg) msg.innerHTML = '<span class="gh-ok">Provider responded.</span>'; return data; }
    catch (e) { if (msg) msg.innerHTML = '<span class="gh-err">' + esc(e.message) + '</span>'; }
  }
  async function providerChat(prompt, cfg) {
    const body = { model: cfg.model.id, messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 1200 };
    const headers = { 'content-type': 'application/json', accept: 'application/json' }; if (cfg.key) headers.authorization = 'Bearer ' + cfg.key;
    const res = await fetch(String(cfg.base).replace(/\/+$/, '') + '/chat/completions', { method: 'POST', headers: headers, body: JSON.stringify(body) });
    const data = await res.json().catch(function () { return {}; }); if (!res.ok) throw new Error((data.error && (data.error.message || data.error)) || 'Provider returned HTTP ' + res.status); return data;
  }
  function updateAiStatus() { const cfg = providerConfig(); const el = byId('st-ai-txt'); if (el) el.textContent = cfg ? 'AI: ' + cfg.model : 'AI: no provider'; }
  async function sendAi(text) {
    const cfg = providerConfig(); if (!cfg) { openProviderModal(); throw new Error('Configure an AI provider first.'); }
    const model = root.MODEL_CATALOGUE.getModel(cfg.model); const data = await providerChat(text, { provider: root.MODEL_CATALOGUE.getProvider(cfg.provider), model: model, key: cfg.key, base: cfg.base });
    const answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '(No text returned)';
    state.aiMessages.push({ role: 'user', content: text }, { role: 'assistant', content: answer }); renderAiChat(); return answer;
  }
  function renderAiChat() { const el = byId('ai-msgs'); if (el) el.innerHTML = state.aiMessages.map(function (m) { return '<div class="ai-msg ' + m.role + '"><b>' + esc(m.role) + '</b><div>' + esc(m.content).replace(/\n/g, '<br>') + '</div></div>'; }).join(''); }

  function aiEdit() { const bar = byId('inline-bar'); if (bar) bar.classList.add('on'); const input = byId('ib-input'); if (input) input.focus(); }
  async function runInlineEdit() {
    const input = byId('ib-input'); const msg = byId('ib-msg'); if (!input || !input.value.trim()) return;
    if (msg) msg.textContent = 'Working…';
    try {
      const original = state.files[state.activeFile]; const answer = await sendAi('Rewrite this file according to the instruction. Return only the complete replacement file.\nInstruction: ' + input.value + '\n\nFile:\n' + original);
      state.diff = { file: state.activeFile, original: original, replacement: answer.replace(/^```[a-z]*\n?|```$/g, '').trim() };
      const bar = byId('diff-bar'); if (bar) bar.classList.add('on'); const text = byId('db-txt'); if (text) text.textContent = 'AI proposed changes to ' + state.activeFile; if (msg) msg.textContent = 'Review the proposed change below.';
    } catch (e) { if (msg) msg.textContent = e.message; }
  }
  function acceptDiff() { if (!state.diff) return; state.files[state.diff.file] = state.diff.replacement; state.dirty.add(state.diff.file); state.diff = null; const bar = byId('diff-bar'); if (bar) bar.classList.remove('on'); renderEditor(); renderTabs(); renderTree(); }
  function rejectDiff() { state.diff = null; const bar = byId('diff-bar'); if (bar) bar.classList.remove('on'); }

  function appendTerminal(text, kind) { state.terminal.push({ text: String(text), kind: kind || '' }); const el = byId('term'); if (el) el.innerHTML = state.terminal.map(function (l) { return '<div class="term-line ' + esc(l.kind) + '">' + esc(l.text) + '</div>'; }).join(''); const body = $('.panel-body[data-pbody="terminal"]'); if (body) body.scrollTop = body.scrollHeight; }
  function renderAll() { renderTree(); renderTabs(); renderEditor(); renderAiPane(); renderGithubPane(); renderSearchPane(); renderSettingsPane(); updateAiStatus(); updateStatus(); if (root.renderRmPane) root.renderRmPane(); if (root.renderMnPane) root.renderMnPane(); }

  function isMobileLayout() { return window.matchMedia && window.matchMedia('(max-width: 900px)').matches; }
  function toggleSidebar(force) {
    const sidebar = byId('sidebar'); if (!sidebar) return;
    const open = typeof force === 'boolean' ? force : !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open);
    const button = byId('btn-layout'); if (button) button.setAttribute('aria-expanded', String(open));
  }
  function togglePanel(force) {
    const panel = byId('panel'); if (!panel) return;
    if (isMobileLayout()) {
      const open = typeof force === 'boolean' ? force : !panel.classList.contains('sheet');
      panel.classList.toggle('sheet', open);
      panel.classList.toggle('collapsed', !open);
    } else {
      const collapsed = typeof force === 'boolean' ? !force : !panel.classList.contains('collapsed');
      panel.classList.toggle('collapsed', collapsed);
    }
  }
  function wireTouchSheet(el, direction, onOpen, onClose) {
    if (!el) return;
    let startX = 0; let startY = 0; let tracking = false;
    el.addEventListener('touchstart', function (e) {
      if (!e.touches || !e.touches[0]) return;
      startX = e.touches[0].clientX; startY = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (!tracking || !e.changedTouches || !e.changedTouches[0]) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (direction === 'horizontal' && Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        if (dx < 0 && onClose) onClose();
        if (dx > 0 && onOpen) onOpen();
      }
      if (direction === 'vertical' && Math.abs(dy) > 42 && Math.abs(dy) > Math.abs(dx) * 1.25) {
        if (dy < 0 && onOpen) onOpen();
        if (dy > 0 && onClose) onClose();
      }
    }, { passive: true });
  }

  function wire() {
    $$('.rail button[data-view], [data-bnav]').forEach(function (el) { el.addEventListener('click', function () { const v = el.dataset.view || el.dataset.bnav; if (['browser', 'marketplace'].includes(v)) setView(v); else { setView('editor'); setPane(v); } }); });
    $$('[data-ptab]').forEach(function (el) { el.addEventListener('click', function () { state.panel = el.dataset.ptab; $$('[data-ptab]').forEach(function (x) { x.classList.toggle('on', x === el); }); $$('[data-pbody]').forEach(function (x) { x.classList.toggle('on', x.dataset.pbody === state.panel); }); }); });
    $$('[data-mclose]').forEach(function (el) { el.addEventListener('click', function () { closeModal(el.dataset.mclose); }); });
    $$('.modal').forEach(function (el) { el.addEventListener('click', function (e) { if (e.target === el) closeModal(el.id); }); });
    const overlay = byId('overlay'); if (overlay) overlay.addEventListener('click', function () { $$('.modal.on').forEach(function (m) { m.classList.remove('on'); }); overlay.classList.remove('on'); });
    const ta = byId('editor-ta'); if (ta) { ta.addEventListener('input', markDirty); ta.addEventListener('keyup', updateStatus); ta.addEventListener('click', updateStatus); }
    const save = byId('ed-save'); if (save) save.onclick = saveActive; const revert = byId('ed-revert'); if (revert) revert.onclick = revertActive; const edit = byId('ed-edit'); if (edit) edit.onclick = function () { if (ta) { ta.removeAttribute('readonly'); ta.focus(); } };
    const aiEditButton = byId('ed-ai'); if (aiEditButton) aiEditButton.onclick = aiEdit; const ibRun = byId('ib-run'); if (ibRun) ibRun.onclick = runInlineEdit; const ibClose = byId('ib-close'); if (ibClose) ibClose.onclick = function () { const b = byId('inline-bar'); if (b) b.classList.remove('on'); }; const accept = byId('db-accept'); if (accept) accept.onclick = acceptDiff; const reject = byId('db-reject'); if (reject) reject.onclick = rejectDiff;
    const send = byId('ai-send'); if (send) send.onclick = async function () { const input = byId('ai-input'); if (!input || !input.value.trim()) return; const text = input.value.trim(); input.value = ''; try { await sendAi(text); } catch (e) { toast(esc(e.message), 'error'); } };
    const aiInput = byId('ai-input'); if (aiInput) aiInput.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (send) send.click(); } });
    const pvModel = byId('pv-model'); if (pvModel) pvModel.addEventListener('change', updateProviderInfo); const pvSave = byId('pv-save'); if (pvSave) pvSave.onclick = saveProvider; const pvTest = byId('pv-test'); if (pvTest) pvTest.onclick = testProvider;
    const search = byId('search-input'); if (search) search.addEventListener('input', renderSearchPane);
    const layout = byId('btn-layout'); if (layout) layout.onclick = function () { toggleSidebar(); };
    const panelToggle = byId('panel-toggle'); if (panelToggle) panelToggle.onclick = function () { togglePanel(); };
    wireTouchSheet(byId('sidebar'), 'horizontal', function () { toggleSidebar(true); }, function () { toggleSidebar(false); });
    wireTouchSheet(byId('panel-grab') || byId('panel'), 'vertical', function () { togglePanel(true); }, function () { togglePanel(false); });
    window.addEventListener('resize', function () { const panel = byId('panel'); if (panel && !isMobileLayout()) panel.classList.remove('sheet'); }, { passive: true });
    document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveActive(); } if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); aiEdit(); } });
  }

  /* live-browser.js exposes its parts (lbLoad, wireBrowser, lbHealth, ...) but
     no single entry point, so the shell boots it here. Without this the
     browser pane opens with unwired controls and a chip stuck on "checking". */
  function bootLiveBrowser() {
    if (typeof root.lbLoad !== 'function' || typeof root.wireBrowser !== 'function') return;
    root.lbLoad();
    root.wireBrowser();
    if (typeof root.lbHealth === 'function') {
      var configured = typeof root.lbConfigured === 'function' && root.lbConfigured();
      var probe = root.lbHealth(true);
      if (configured && probe && probe.then) {
        probe.then(function () {
          if (root.lbRefreshSessions) root.lbRefreshSessions();
          if (root.lbLoadTraces) root.lbLoadTraces();
        });
      }
    }
    if (root.renderBrTabs) root.renderBrTabs();
    if (root.renderBrLog) root.renderBrLog();
    if (root.renderBrSessions) root.renderBrSessions();
    if (root.renderBrRec) root.renderBrRec();
    if (root.lbSetMode && root.LB) root.lbSetMode(root.LB.mode);
  }

  function boot() { loadState(); wire(); renderAll(); setView('editor'); setPane('files'); appendTerminal('recode workspace ready'); if (root.rmLoad) root.rmLoad(); if (root.rmWire) root.rmWire(); if (root.mnLoad && root.renderMnPane) root.renderMnPane(); if (root.lbBoot) root.lbBoot(); else bootLiveBrowser(); }
  root.setView = setView; root.setPane = setPane; root.renderTree = renderTree; root.openFile = openFile; root.saveActive = saveActive; root.sendAi = sendAi; root.providerChat = providerChat; root.saveRmConfig = root.rmSave || function () {};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
