/* App-style UI layer: bottom navigation and Android back button. Loads after fixes.js. */
(function () {
  'use strict';
  const icon = d => `<span class="pill"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></span>`;
  const items = [
    ['chat', 'Chat', 'M4 5h16v11H9l-5 4z'],
    ['study', 'Study', 'M4 5c3-1 6-1 8 1 2-2 5-2 8-1v13c-3-1-6-1-8 1-2-2-5-2-8-1zM12 6v13'],
    ['code', 'Code', 'M8 7l-5 5 5 5M16 7l5 5-5 5'],
    ['history', 'History', 'M12 8v4l3 2M4 12a8 8 0 1 0 2-5M4 4v4h4'],
    ['settings', 'Settings', 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4']
  ];
  const nav = document.createElement('nav');
  nav.id = 'app-nav';
  nav.innerHTML = items.map(([k, label, d]) => `<button type="button" data-k="${k}">${icon(d)}${label}</button>`).join('');
  document.querySelector('footer').after(nav);

  const mark = () => nav.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', b.dataset.k === state.workspaceMode));

  nav.addEventListener('click', e => {
    const k = e.target.closest('button')?.dataset.k;
    if (!k) return;
    navigator.vibrate?.(8);
    if (k === 'history') window.toggleDrawer(true);
    else if (k === 'settings') window.openSettingsModal();
    else window.setWorkspaceMode(k);
  });

  const setMode = window.setWorkspaceMode;
  window.setWorkspaceMode = function (...a) { setMode.apply(this, a); mark(); };
  mark();

  // The bottom bar replaces the top mode row (attaching stays on the paperclip)
  let row = document.getElementById('mode-btn-code');
  while (row && row.parentElement && !row.parentElement.querySelector(':scope > main')) row = row.parentElement;
  row?.classList.add('ui-modebar-hidden');

  // Hide the bar while the keyboard is open
  const input = document.getElementById('chat-input');
  input.addEventListener('focus', () => document.body.classList.add('ui-typing'));
  input.addEventListener('blur', () => setTimeout(() => document.body.classList.remove('ui-typing'), 150));

  // Android back button closes the open panel instead of leaving the app
  const watchers = {};
  function watch(key, close) {
    if (!window.CloseWatcher || watchers[key]) return;
    const w = new CloseWatcher();
    w.onclose = () => { delete watchers[key]; close(); };
    watchers[key] = w;
  }
  function unwatch(key) { watchers[key]?.destroy(); delete watchers[key]; }

  const drawer = window.toggleDrawer;
  window.toggleDrawer = function (open) {
    drawer.apply(this, arguments);
    if (open) watch('drawer', () => window.toggleDrawer(false)); else unwatch('drawer');
  };
  const settings = window.openSettingsModal;
  window.openSettingsModal = function () {
    settings.apply(this, arguments);
    watch('settings-modal', () => window.closeModal('settings-modal'));
  };
  const close = window.closeModal;
  window.closeModal = function (id) { close.apply(this, arguments); unwatch(id); };
})();
