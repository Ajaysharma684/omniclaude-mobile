/* Polish layer: compact answer label, short messages, new home screen, thinking dots,
   follow-up buttons, scroll-down button, accent colours. Loads last.
   Remove pro.js and pro.css to undo. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, props) => Object.assign(document.createElement(tag), props);
  const input = $('chat-input');
  const scroller = $('chat-scroll-container');

  /* ---------- Accent colour ---------- */
  const ACCENTS = ['blue', 'green', 'purple'];
  function setAccent(name) {
    if (!ACCENTS.includes(name)) name = 'blue';
    document.documentElement.dataset.accent = name;
    try { localStorage.setItem('omnicode_accent', name); } catch (_) {}
    document.querySelectorAll('#pro-accents button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.accent === name)));
  }
  const prefs = $('fx-prefs');
  if (prefs) {
    const row = el('div', { id: 'pro-accents' });
    row.innerHTML = '<span>Accent colour</span><div>' + ACCENTS.map(a =>
      `<button type="button" data-accent="${a}" aria-label="${a}"></button>`).join('') + '</div>';
    row.onclick = e => { const a = e.target.dataset.accent; if (a) setAccent(a); };
    prefs.appendChild(row);
  }
  let saved = null;
  try { saved = localStorage.getItem('omnicode_accent'); } catch (_) {}
  setAccent(saved);

  /* ---------- Compact answer label ---------- */
  window.buildAssistantMetaHTML = function (msg) {
    // "Groq (openai/gpt-oss-120b)" becomes "Groq · gpt-oss-120b"
    const name = String(msg.modelDisplayName || 'AI')
      .replace(/^(.*?)\s*\((.*)\)$/, (_, a, b) => a + ' · ' + b)
      .replace(/(^|· )[\w.-]+\//, '$1');
    const time = msg.latencySec ? ' · ' + msg.latencySec + 's' : '';
    const tag = t => `<span class="pro-tag">${t}</span>`;
    return `<span class="pro-model" title="${escapeHtml(msg.intentReason || '')}">${escapeHtml(name + time)}</span>` +
      (msg.wasFallback ? tag('backup') : '') + (msg.isDemo ? tag('demo') : '');
  };

  /* ---------- Simple model names in the top menu ---------- */
  const NAMES = {
    auto: '✨ Auto (recommended)', 'groq-fast': 'Fast · Groq', 'google-gemini': 'Smart · Gemini',
    'openrouter-free': 'Backup · OpenRouter', 'gemini-large': 'Long PDFs · Gemini',
    custom: 'Custom model ID'
  };
  Object.entries(NAMES).forEach(([value, label]) => {
    const o = document.querySelector(`#header-model-select option[value="${value}"]`);
    if (o) o.textContent = label;
  });

  /* ---------- Home screen ---------- */
  const home = $('welcome-screen');
  const ICONS = {
    study: 'M4 5c3-1 6-1 8 1 2-2 5-2 8-1v13c-3-1-6-1-8 1-2-2-5-2-8-1zM12 6v13',
    quiz: 'M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .8-1 1.7M12 17.5v.1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
    pdf: 'M7 3h7l5 5v13H7zM14 3v5h5M12 18v-6M9.5 14.5L12 12l2.5 2.5'
  };
  const card = (k, title, sub) => `<button type="button" data-go="${k}">
    <svg viewBox="0 0 24 24"><path d="${ICONS[k]}"/></svg><b>${title}</b><small>${sub}</small></button>`;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  home.innerHTML = `<div class="pro-home"><h1>${hello} 👋</h1><p>What would you like to do?</p><div>
    ${card('study', 'Study', 'Notes and explanations')}
    ${card('quiz', 'Quiz', 'Test yourself')}
    ${card('code', 'Code', 'Write and debug')}
    ${card('pdf', 'Upload PDF', 'Papers and syllabus')}</div></div>`;
  home.addEventListener('click', e => {
    const k = e.target.closest('[data-go]')?.dataset.go;
    if (!k) return;
    if (k === 'pdf') return triggerPdfExamWorkflow();
    if (k === 'quiz' && input.value.trim()) {
      setWorkspaceMode('study');
      return [...document.querySelectorAll('#fx-exam button')].find(b => b.textContent === 'Quiz me')?.click();
    }
    setWorkspaceMode(k === 'code' ? 'code' : 'study');
    if (k === 'quiz') showToast('Type a topic, then tap "Quiz me"', 'info');
    input.focus();
  });

  /* ---------- Follow-up buttons, thinking dots, short messages ---------- */
  const PLAIN = ' Answer in simple Markdown text, not HTML.';
  const FOLLOW = [
    ['Explain more', 'Explain your last answer in more detail.' + PLAIN],
    ['Give an example', 'Give a clear worked example for your last answer.' + PLAIN],
    ['Quiz me', 'Quiz me on your last answer with one multiple-choice question at a time. Wait for my reply before showing the correct option.' + PLAIN]
  ];
  const DOTS = '<span class="pro-dots" role="status" aria-label="Thinking"><i></i><i></i><i></i></span>';
  const _render = window.renderActiveSession;
  window.renderActiveSession = function (...a) {
    _render.apply(this, a);
    const session = getActiveSession();
    if (!session) return;
    const rows = $('messages-list').children;
    session.messages.forEach((m, i) => {
      if (m.display && rows[i]) {
        const text = rows[i].querySelector('.whitespace-pre-wrap');
        if (text) text.textContent = m.display;
      }
      const body = $('msg-body-' + i);
      if (body && m.role === 'assistant' && !m.content && runtime.isGenerating) body.innerHTML = DOTS;
    });
    const last = session.messages.length - 1;
    const msg = session.messages[last];
    if (msg && msg.role === 'assistant' && msg.content && !runtime.isGenerating && !msg.content.startsWith('⚠️')) {
      const row = el('div', { className: 'pro-follow' });
      FOLLOW.forEach(([label, full]) => {
        const b = el('button', { type: 'button', textContent: label });
        b.onclick = () => window.omniAsk(label, full, false);
        row.appendChild(b);
      });
      rows[last].querySelector('.fx-actions')?.after(row);
      scrollToBottom(true);
    }
    updateDown();
  };

  /* ---------- Scroll-to-bottom button ---------- */
  const down = el('button', { type: 'button', id: 'pro-down' });
  down.setAttribute('aria-label', 'Scroll to latest');
  down.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';
  const footer = document.querySelector('footer');
  footer.appendChild(down);
  function updateDown() {
    const far = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 220;
    down.classList.toggle('on', far && !$('messages-list').classList.contains('hidden'));
  }
  scroller.addEventListener('scroll', updateDown, { passive: true });
  down.onclick = () => scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });

  /* ---------- Transition when switching tabs ---------- */
  const _setMode = window.setWorkspaceMode;
  window.setWorkspaceMode = function (...a) {
    const changed = a[0] !== state.workspaceMode;
    _setMode.apply(this, a);
    if (changed) {
      scroller.classList.remove('pro-swap');
      void scroller.offsetWidth;
      scroller.classList.add('pro-swap');
    }
  };
})();
