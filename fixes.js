/* OmniClaude fixes.js — load AFTER the main inline <script>, just before </body>. */
(function () {
  'use strict';

  /* ---------- 0. Environment ---------- */
  const IS_APP = matchMedia('(display-mode: standalone)').matches ||
                 (document.referrer || '').startsWith('android-app://');

  // Allow zoom (accessibility)
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp) vp.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';

  /* ---------- 1. Remove Claude-branded models (Play impersonation risk) ---------- */
  ['claude-sonnet', 'claude-haiku'].forEach(k => {
    delete MODEL_REGISTRY[k];
    document.querySelectorAll(`#header-model-select option[value="${k}"]`).forEach(o => o.remove());
  });
  if (/^claude/.test(state.selectedModel || '')) state.selectedModel = 'auto';

  /* ---------- 2. Routing: Study mode must not force the coding route ---------- */
  const _classify = window.classifyPromptIntent;
  window.classifyPromptIntent = function (text, atts, mode) {
    return _classify(text, atts, mode === 'study' ? 'chat' : mode);
  };

  /* ---------- 3. Friendly status messages + stall watchdog ---------- */
  function explain(s) {
    if (s === 402) return 'billing problem on your provider account — check its billing page';
    if (s === 401 || s === 403) return 'API key rejected — check it in Settings';
    if (s === 404) return 'model unavailable on this provider';
    if (s === 413) return 'input too large — attach fewer or smaller files';
    if (s === 429) return 'rate limit reached — wait a minute or use another provider';
    if (s >= 500) return 'provider server error';
    return 'HTTP ' + s;
  }
  const STALL_MS = 25000;
  const _stream = window.streamFromProvider;
  window.streamFromProvider = async function (session, idx, pid, model, userSignal) {
    const name = PROVIDERS[pid] ? PROVIDERS[pid].shortName : pid;
    const c = new AbortController();
    let stalled = false;
    const fwd = () => c.abort();
    userSignal.addEventListener('abort', fwd, { once: true });
    const msg = session.messages[idx];
    let lastLen = (msg.content || '').length, lastT = Date.now();
    const timer = setInterval(() => {
      const len = (msg.content || '').length;
      if (len !== lastLen) { lastLen = len; lastT = Date.now(); }
      else if (Date.now() - lastT > STALL_MS) { stalled = true; c.abort(); }
    }, 2000);
    try {
      return await _stream(session, idx, pid, model, c.signal);
    } catch (e) {
      if (userSignal.aborted) throw e;
      if (stalled) throw new Error(name + ': no response for ' + (STALL_MS / 1000) + 's');
      const m = /HTTP (\d{3})/.exec((e && e.message) || '');
      if (m) throw new Error(name + ': ' + (pid === 'pollinations' && [401, 402, 403].includes(+m[1])
        ? 'the free backup service refused the request — add a Groq or Google key in Settings'
        : explain(+m[1])));
      throw e;
    } finally {
      clearInterval(timer);
      userSignal.removeEventListener('abort', fwd);
    }
  };

  // Remove the misleading "verify your internet connection" tip
  const _render = window.renderMarkdown;
  window.renderMarkdown = function (raw) {
    if (typeof raw === 'string') raw = raw.replace(/- Verify your mobile internet connection\.\n?/g, '');
    return _render(raw);
  };

  // HTTP 402 = account billing block: explain it under the card
  const _t402 = window.testSingleProviderKey;
  window.testSingleProviderKey = async function (pid) {
    await _t402(pid);
    const badge = document.getElementById('prov-badge-' + pid);
    if (badge && /402/.test(badge.textContent)) {
      badge.textContent = '● Billing needed (402)';
      showToast(PROVIDERS[pid].shortName + ': account billing is blocking requests. The app will use other providers.', 'error');
    }
  };

  /* ---------- 4. Test Key: ask the provider for real model names first ---------- */
  const _test = window.testSingleProviderKey;
  window.testSingleProviderKey = async function (pid) {
    try {
      const prov = PROVIDERS[pid];
      const el = document.getElementById('prov-key-' + pid);
      const key = normalizeApiKey(pid, el ? el.value : '');
      if (prov && prov.modelsEndpoint && key) {
        const found = await discoverLiveModel(pid, key);
        if (found) state.resolvedModels[pid] = found; // becomes first candidate
      }
    } catch (_) {}
    return _test(pid);
  };

  /* ---------- 5. Drop stale Pollinations models (when list is reachable) ---------- */
  let pollSet = null;
  fetch('https://text.pollinations.ai/models')
    .then(r => r.ok ? r.json() : [])
    .then(list => {
      const names = new Set();
      (Array.isArray(list) ? list : []).forEach(m => {
        if (typeof m === 'string') names.add(m);
        else if (m) {
          if (m.name) names.add(m.name);
          (m.aliases || []).forEach(a => names.add(a));
        }
      });
      if (names.size) pollSet = names;
    })
    .catch(() => {});
  const _dedupe = window.dedupeCandidates;
  window.dedupeCandidates = function (chain) {
    const out = _dedupe(chain);
    if (!pollSet) return out;
    const f = out.filter(c => c.provider !== 'pollinations' || c.apiModel === 'openai' || pollSet.has(c.apiModel));
    return f.length ? f : out;
  };

  /* ---------- 6. Storage: keep localStorage small ---------- */
  window.saveState = function () {
    try {
      const json = JSON.stringify(state, function (k, v) {
        if (k === 'fullPrompt' && typeof v === 'string' && v.length > 4000) return v.slice(0, 4000);
        if (k === 'images' && Array.isArray(v) && v.length && typeof v[0] === 'string' && v[0].startsWith('data:')) return [];
        return v;
      });
      localStorage.setItem(STORAGE_KEY, json);
    } catch (_) {
      showToast('Storage full — delete older sessions', 'error');
    }
  };

  // Cap what is sent to the API (free tiers have small limits)
  const _payload = window.buildPayloadMessages;
  window.buildPayloadMessages = function (session, upTo) {
    const msgs = _payload(session, upTo);
    const lastUser = msgs.map(m => m.role).lastIndexOf('user');
    msgs.forEach((m, i) => {
      const cap = i === lastUser ? 60000 : 4000;
      if (typeof m.content === 'string' && m.content.length > cap) {
        m.content = m.content.slice(0, cap) + '\n\n[...truncated to fit provider limits]';
      } else if (Array.isArray(m.content) && i !== lastUser) {
        m.content = m.content.filter(p => p.type === 'text');
        if (m.content[0] && m.content[0].text.length > cap) m.content[0].text = m.content[0].text.slice(0, cap);
      }
    });
    return msgs;
  };

  /* ---------- 7. Code highlighter (single pass, no entity corruption) ---------- */
  window.highlightCodeSafe = function (raw, lang) {
    const hash = /^(py|python|sh|bash)$/i.test(lang || '');
    const re = new RegExp(
      String.raw`(\/\/[^\n]*${hash ? String.raw`|#[^\n]*` : ''}|<!--[\s\S]*?-->)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(\d+(?:\.\d+)?)\b|\b(def|class|return|import|from|async|await|function|const|let|var|if|else|elif|for|while|try|except|catch|public|private|void|int|float|String)\b`,
      'g');
    let out = '', last = 0, m;
    while ((m = re.exec(raw))) {
      out += escapeHtml(raw.slice(last, m.index));
      const cls = m[1] ? 'tok-com' : m[2] ? 'tok-str' : m[3] ? 'tok-num' : 'tok-kw';
      out += '<span class="' + cls + '">' + escapeHtml(m[0]) + '</span>';
      last = re.lastIndex;
    }
    return out + escapeHtml(raw.slice(last));
  };

  // Generated apps run in a sandbox without localStorage
  ['code', 'study', 'chat'].forEach(k => {
    SYSTEM_PROMPTS[k] += '\nNote: Live Preview runs sandboxed, so generated apps must NOT use localStorage/sessionStorage. Keep state in JavaScript variables.';
  });

  /* ---------- 8. Download / Export ---------- */
  window.downloadSelfHtmlApp = async function () {
    try {
      const txt = await (await fetch(location.href.split('#')[0], { cache: 'no-cache' })).text();
      const url = URL.createObjectURL(new Blob([txt], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'omniclaude_mobile.html';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showToast('Downloaded omniclaude_mobile.html', 'info');
    } catch (_) { showToast('Download failed', 'error'); }
  };

  window.exportBackupJson = function () {
    const withKeys = confirm('Include API keys in the file?\nThey are saved as plain text — anyone with the file can use them.');
    const payload = {
      app: 'OmniCode', exportedAt: new Date().toISOString(),
      selectedModel: state.selectedModel, customModelId: state.customModelId,
      resolvedModels: state.resolvedModels, localEndpoint: state.localEndpoint
    };
    if (withKeys) payload.keys = state.keys;
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'omniclaude-backup.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast('Exported backup' + (withKeys ? ' (with keys)' : ''), 'info');
  };

  /* ---------- 9. Settings text, privacy notice, installed-app cleanup ---------- */
  const _cards = window.renderProviderCards;
  window.renderProviderCards = function () {
    _cards();
    if (IS_APP) {
      const k = document.getElementById('prov-key-local');
      if (k) k.closest('.p-3\\.5').remove();
    }
  };

  window.addEventListener('DOMContentLoaded', function () {
    // Offline demo wording
    const badge = document.getElementById('settings-demo-badge');
    const p = badge && badge.closest('div').parentElement.querySelector('p');
    if (p) p.textContent = 'ON = fake sample replies for testing the UI (no internet needed). OFF = real AI answers.';

    // Privacy + trademark notice at top of Providers tab
    const tab = document.getElementById('settings-tab-providers');
    if (tab) {
      const n = document.createElement('div');
      n.className = 'p-3 rounded-2xl bg-ocBg border border-ocBorder text-[11px] text-ocMuted leading-relaxed';
      n.innerHTML = '<b class="text-white">Privacy:</b> your messages and attached files are sent to the AI provider that answers (Pollinations, Google AI Studio, Groq or Mistral, depending on routing and your keys). Don\'t send anything you wouldn\'t share with them. Keys are stored only on this device.<br><br><b class="text-white">Unofficial app.</b> Not affiliated with or endorsed by Anthropic.';
      tab.insertBefore(n, tab.firstChild);
    }

    // Hide self-distribution UI inside the installed app
    if (IS_APP) {
      document.querySelectorAll('[onclick*="openSettingsModal(\'setup\')"], #tab-btn-setup, #settings-tab-setup')
        .forEach(el => el.remove());
      const tabs = document.getElementById('tab-btn-providers');
      if (tabs && tabs.parentElement) tabs.parentElement.className = 'grid grid-cols-1 gap-1.5 p-1 bg-ocBg rounded-xl border border-ocBorder';
    }
  });
  /* ---------- 10. Diagnostics: show the provider's real error text ---------- */
  const _t2 = window.testSingleProviderKey;
  window.testSingleProviderKey = async function (pid) {
    await _t2(pid);
    if (state.providerHealth[pid] !== 'error') return;
    const prov = PROVIDERS[pid];
    const el = document.getElementById('prov-key-' + pid);
    const key = normalizeApiKey(pid, el ? el.value : '');
    const badge = document.getElementById('prov-badge-' + pid);
    const card = badge && badge.closest('.p-3\\.5');
    if (!prov || !prov.modelsEndpoint || !key || !card) return;
    let info;
    try {
      const r = await fetch(prov.modelsEndpoint, { headers: { Authorization: 'Bearer ' + key } });
      const body = (await r.text()).replace(/\s+/g, ' ').slice(0, 220);
      info = 'Provider replied HTTP ' + r.status + ': ' + (body || '(empty body)');
      if (r.status === 200) {
        const model = state.resolvedModels[pid] || (prov.candidateModels || [])[0] || prov.testModel;
        const c = await fetch(prov.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ model: model, messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 16 })
        });
        const cb = (await c.text()).replace(/\s+/g, ' ').slice(0, 260);
        info = 'Models list OK. Chat call (' + model + ') replied HTTP ' + c.status + ': ' + (cb || '(empty body)');
        if (c.status === 200 || c.status === 429) {
          state.providerHealth[pid] = 'healthy';
          state.resolvedModels[pid] = model;
          saveState();
          badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium';
          badge.textContent = c.status === 429 ? '● Key OK (rate-limited)' : '● Healthy';
          if (c.status === 429) info = 'Key and plan are fine. Free tier is rate-limited — wait a minute between tries. (' + model + ')';
        }
      }
    } catch (e) {
      info = 'Could not reach provider: ' + e.message + ' (VPN, network or CORS block?)';
    }
    let p = document.getElementById('prov-diag-' + pid);
    if (!p) {
      p = document.createElement('p');
      p.id = 'prov-diag-' + pid;
      p.className = 'mt-2 text-[10px] font-mono text-amber-300 break-words';
      card.appendChild(p);
    }
    p.textContent = info;
  };
})();
