/* Study and daily-use features: exam mode, voice input, read aloud, regenerate, share,
   chat search, light theme. Loads after ui.js. Remove features.js and features.css to undo. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, props) => Object.assign(document.createElement(tag), props);
  const pref = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }
  };
  const input = $('chat-input');
  const footer = document.querySelector('footer');

  /* ---------- Light theme ---------- */
  function applyTheme(light) {
    document.documentElement.classList.toggle('light', light);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = light ? '#f6f5f1' : '#141413';
  }
  applyTheme(pref.get('omnicode_theme') === 'light');

  /* ---------- Settings rows: theme and voice language ---------- */
  const tab = $('settings-tab-providers');
  if (tab) {
    const box = el('div', { id: 'fx-prefs', className: 'p-3.5 rounded-2xl bg-ocBg border border-ocBorder' });
    box.innerHTML =
      '<label><span>Light theme</span><input type="checkbox" id="fx-light"></label>' +
      '<label><span>Voice language</span><select id="fx-lang">' +
      '<option value="en-IN">English (India)</option><option value="hi-IN">हिन्दी</option></select></label>';
    tab.prepend(box);
    $('fx-light').checked = document.documentElement.classList.contains('light');
    $('fx-light').onchange = e => {
      applyTheme(e.target.checked);
      pref.set('omnicode_theme', e.target.checked ? 'light' : 'dark');
    };
    $('fx-lang').value = pref.get('omnicode_voice_lang') || 'en-IN';
    $('fx-lang').onchange = e => pref.set('omnicode_voice_lang', e.target.value);
  }

  /* ---------- Send a long instruction but show a short message in the chat ---------- */
  window.omniAsk = function (short, full, useAttachments) {
    if (runtime.isGenerating) return showToast('Wait for the current answer to finish', 'info');
    const typed = input.value;
    const files = runtime.attachments;
    // Follow-up taps must not swallow files or text the user is still preparing
    if (!useAttachments) runtime.attachments = [];
    const session = getActiveSession();
    const before = session.messages.length;
    const untitled = before === 0;
    input.value = full;
    handleSendOrStop(); // everything up to the network request runs right away
    if (!useAttachments) {
      runtime.attachments = files;
      renderAttachmentsStrip();
      input.value = typed;
    }
    const sent = session.messages[before];
    if (!sent) return;
    sent.display = short;
    if (untitled) session.title = short.slice(0, 38);
    saveState();
    renderSessionsDrawer();
    renderActiveSession();
  };

  /* ---------- Exam mode ---------- */
  const PLAIN = ' Answer in simple Markdown text, not HTML.';
  const EXAM = [
    ['Important questions', 'List the most important exam questions, ranked by how likely they are, grouped into 2-mark, 5-mark and 10-mark questions.'],
    ['One-page summary', 'Write a one-page revision summary with key definitions, formulas and points to remember.'],
    ['Short answers', 'Give 10 likely 2-mark questions, each with a short model answer.'],
    ['Long answers', 'Give 4 likely 10-mark questions, each with a full model answer using headings, steps and examples.'],
    ['Quiz me', 'Quiz me with one multiple-choice question at a time. Wait for my answer, then say if it is right, explain why, and ask the next one.'],
    ['Explain simply', 'Explain this in very simple words with a real-life example, then the exam-ready definition.']
  ];
  const bar = el('div', { id: 'fx-exam' });
  bar.setAttribute('aria-label', 'Exam mode');
  EXAM.forEach(([label, task]) => {
    const b = el('button', { type: 'button', textContent: label });
    b.onclick = () => {
      if (runtime.isGenerating) return showToast('Wait for the current answer to finish', 'info');
      const topic = input.value.trim();
      const hasContext = runtime.attachments.length > 0 || getActiveSession().messages.length > 0;
      if (!topic && !hasContext) {
        input.focus();
        return showToast('Type a topic or attach your notes first', 'info');
      }
      const about = topic ? 'Topic: ' + topic
        : runtime.attachments.length ? 'Use the attached material.' : 'Use the topic and material above.';
      const short = topic ? `${label}: ${topic}` : label;
      window.omniAsk(short, `${label}. ${about}\n${task}${PLAIN}`, true);
    };
    bar.appendChild(b);
  });
  footer.prepend(bar);
  const showExam = () => bar.classList.toggle('on', state.workspaceMode === 'study');
  const _setMode = window.setWorkspaceMode;
  window.setWorkspaceMode = function (...a) { _setMode.apply(this, a); showExam(); };
  const _sync = window.syncAllUI;
  window.syncAllUI = function (...a) { _sync.apply(this, a); showExam(); };

  /* ---------- Voice input ---------- */
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Recognition) {
    const mic = el('button', { type: 'button', id: 'fx-mic' });
    mic.setAttribute('aria-label', 'Speak your question');
    mic.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
    $('send-stop-btn').before(mic);
    let rec = null;
    mic.onclick = () => {
      if (rec) return rec.stop();
      const base = input.value.trim() ? input.value.trim() + ' ' : '';
      rec = new Recognition();
      rec.lang = pref.get('omnicode_voice_lang') || 'en-IN';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = e => {
        input.value = base + Array.from(e.results, r => r[0].transcript).join('');
        handleComposerInput(input);
      };
      rec.onerror = e => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') showToast('Allow microphone access to use voice input', 'error');
        else if (e.error === 'network') showToast('Voice input needs an internet connection', 'error');
        else if (e.error !== 'aborted') showToast('Did not catch that. Tap the mic and try again', 'info');
      };
      rec.onend = () => { rec = null; mic.classList.remove('on'); };
      try { rec.start(); mic.classList.add('on'); } catch (_) { rec = null; }
    };
    // Sending stops the mic so late words don't land in the empty box
    $('send-stop-btn').addEventListener('click', () => rec?.abort(), true);
  }

  /* ---------- Read aloud ---------- */
  const synth = window.speechSynthesis;
  let speakingBtn = null;
  function stopSpeaking() {
    if (!speakingBtn) return;
    synth.cancel();
    speakingBtn.textContent = 'Listen';
    speakingBtn = null;
  }
  const plain = md => md
    .replace(/```[\s\S]*?(```|$)/g, ' (code block skipped) ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[#>\-*•]+\s*/gm, '')
    .replace(/[*_`#|]/g, '');
  function speak(text, btn) {
    const same = speakingBtn === btn;
    stopSpeaking();
    if (same) return;
    // Long text is spoken in small pieces: some phones cut off a single long one
    const parts = plain(text).match(/[^.!?।\n]{1,180}[.!?।\n]*\s*/g) || [];
    const chunks = parts.filter(p => p.trim());
    if (!chunks.length) return showToast('Nothing to read', 'info');
    const lang = /[ऀ-ॿ]/.test(text) ? 'hi-IN' : 'en-IN';
    speakingBtn = btn;
    btn.textContent = 'Stop';
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = lang;
      if (i === chunks.length - 1) u.onend = () => { if (speakingBtn === btn) stopSpeaking(); };
      synth.speak(u);
    });
  }
  window.addEventListener('pagehide', stopSpeaking);

  /* ---------- Share ---------- */
  async function share(text) {
    if (navigator.share) {
      try { return await navigator.share({ title: 'OmniCode', text }); }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    copyTextToClipboard(text, () => showToast('Copied. Paste it where you want to share', 'info'));
  }

  /* ---------- Regenerate ---------- */
  async function regenerate() {
    if (runtime.isGenerating) return;
    stopSpeaking();
    const session = getActiveSession();
    const idx = session.messages.length - 1;
    const old = session.messages[idx];
    const user = session.messages[idx - 1];
    if (!old || old.role !== 'assistant' || !user || user.role !== 'user') return;
    const atts = (user.badges || []).map(b => ({
      kind: b.kind === 'IMG' ? 'image' : b.kind === 'SCANNED PDF' ? 'scanned-pdf' : b.kind.toLowerCase(),
      name: b.name, charCount: 0
    }));
    const plan = buildCandidateChainForRequest(user.content, atts);
    const msg = {
      role: 'assistant', content: '', isAutoRouted: plan.isAutoRouted,
      modelDisplayName: plan.chain[0].displayName, intentReason: plan.intentReason,
      latencySec: null, wasFallback: false, isDemo: state.demoMode, timestamp: Date.now()
    };
    session.messages[idx] = msg;
    setGeneratingState(true);
    renderActiveSession();
    runtime.abortController = new AbortController();
    const signal = runtime.abortController.signal;
    const t0 = performance.now();
    let failed = null;
    try {
      if (state.demoMode) await runDemoStream(session, idx, user.content, user.badges || [], signal);
      else await executeCandidateChain(session, idx, plan, t0, signal);
      msg.latencySec = msg.latencySec || ((performance.now() - t0) / 1000).toFixed(1);
    } catch (err) {
      failed = err;
    } finally {
      // The old answer comes back if the new one failed or was stopped before any text
      if (!msg.content.trim() || (failed && failed.name !== 'AbortError')) {
        session.messages[idx] = old;
        if (failed && failed.name !== 'AbortError') showToast('Could not regenerate. Kept the previous answer', 'error');
      }
      setGeneratingState(false);
      runtime.abortController = null;
      session.updatedAt = Date.now();
      saveState();
      renderActiveSession();
    }
  }

  /* ---------- Buttons under each answer ---------- */
  const _render = window.renderActiveSession;
  window.renderActiveSession = function (...a) {
    stopSpeaking();
    _render.apply(this, a);
    const session = getActiveSession();
    if (!session) return;
    session.messages.forEach((m, i) => {
      const body = $('msg-body-' + i);
      const last = i === session.messages.length - 1;
      if (!body || m.role !== 'assistant' || !m.content || (last && runtime.isGenerating)) return;
      const row = el('div', { className: 'fx-actions' });
      const add = (label, fn) => {
        const b = el('button', { type: 'button', textContent: label });
        b.onclick = () => fn(b);
        row.appendChild(b);
      };
      if (synth) add('Listen', b => speak(m.content, b));
      add('Share', () => share(m.content));
      if (last) add('Regenerate', regenerate);
      body.after(row);
    });
    // The new buttons add height; on the empty home screen stay at the top
    if (session.messages.length) scrollToBottom(true);
    else $('chat-scroll-container').scrollTop = 0;
  };

  /* ---------- Search old chats ---------- */
  const list = $('session-list');
  const search = el('input', { id: 'fx-search', type: 'search', placeholder: 'Search chats…', autocomplete: 'off' });
  search.setAttribute('aria-label', 'Search chats');
  list.before(search);
  const none = el('p', { id: 'fx-none', textContent: 'No matching chats' });
  list.after(none);
  function filter() {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    Array.from(list.children).forEach((row, i) => {
      const s = state.sessions[i];
      const hit = !q || (s && (s.title.toLowerCase().includes(q) ||
        s.messages.some(m => (m.content || '').toLowerCase().includes(q))));
      row.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    none.style.display = shown ? 'none' : 'block';
  }
  search.oninput = filter;
  const _drawer = window.renderSessionsDrawer;
  window.renderSessionsDrawer = function (...a) { _drawer.apply(this, a); filter(); };

  // initApp may already have drawn the screen before these wrappers existed
  window.addEventListener('DOMContentLoaded', () => {
    window.renderSessionsDrawer();
    window.renderActiveSession();
    showExam();
  });
})();
