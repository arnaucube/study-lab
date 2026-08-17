(() => {
  'use strict';

  const STORAGE_KEY = 'study-pal:v1';
  const SETTINGS_KEY = 'study-pal:settings:v1';
  const USAGE_KEY = 'study-pal:usage:v1';
  // USD per million tokens. Last checked against OpenAI Docs on 2026-08-17.
  const MODEL_PRICES = [
    { match: /^gpt-5\.6-terra(?:-|$)/, input: 2, cached: .2, output: 12 },
    { match: /^gpt-5\.6-luna(?:-|$)/, input: .2, cached: .02, output: 1.2 },
    { match: /^gpt-5\.6-sol(?:-|$)/, input: 5, cached: .5, output: 30 },
    { match: /^gpt-5\.6$/, input: 5, cached: .5, output: 30 },
    { match: /^gpt-5\.4-mini(?:-|$)/, input: .75, cached: .075, output: 4.5 },
    { match: /^gpt-5\.4(?:-20\d{2}|$)/, input: 2.5, cached: .25, output: 15 },
    { match: /^gpt-5-mini(?:-|$)/, input: .25, cached: .025, output: 2 },
    { match: /^gpt-5-nano(?:-|$)/, input: .05, cached: .005, output: .4 },
    { match: /^gpt-5(?:-20\d{2}|$)/, input: 1.25, cached: .125, output: 10 },
    { match: /^gpt-4\.1-mini(?:-|$)/, input: .4, cached: .1, output: 1.6 },
    { match: /^gpt-4\.1(?:-20\d{2}|$)/, input: 2, cached: .5, output: 8 },
    { match: /^gpt-4o-mini(?:-|$)/, input: .15, cached: .075, output: .6 }
  ];
  const DEFAULT_SETTINGS = {
    apiKey: '',
    model: 'gpt-5-mini',
    apiUrl: 'https://api.openai.com/v1/responses',
    systemPrompt: 'You are a patient technical tutor. Use clear Markdown and LaTeX where useful. Build on the conversation context and explain assumptions.'
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const els = {
    welcome: $('#welcome'), conversation: $('#conversation'), composer: $('#composer'),
    prompt: $('#prompt'), send: $('#send'), tree: $('#tree'), mapEmpty: $('#map-empty'),
    nodeCount: $('#node-count'), branchCount: $('#branch-count'), branchContext: $('#branch-context'),
    branchLabel: $('#branch-label'), selectionMenu: $('#selection-menu'), selectionPreview: $('#selection-preview'),
    selectionAction: $('#selection-action'), selectionCustom: $('#selection-custom'), settings: $('#settings-dialog'),
    apiKey: $('#api-key'), model: $('#model'), apiUrl: $('#api-url'), systemPrompt: $('#system-prompt'),
    keyStatus: $('#key-status'), toast: $('#toast'), usageDialog: $('#usage-dialog'),
    monthTokens: $('#month-tokens'), usageMonth: $('#usage-month'), usageTotal: $('#usage-total'),
    usageCost: $('#usage-cost'), usageRequests: $('#usage-requests'), usageInput: $('#usage-input'),
    usageCached: $('#usage-cached'), usageOutput: $('#usage-output'), usageModels: $('#usage-models'),
    usageRecent: $('#usage-recent'), usageNote: $('#usage-note')
  };

  let settings = loadJSON(SETTINGS_KEY, DEFAULT_SETTINGS);
  let state = normalizeState(loadJSON(STORAGE_KEY, { nodes: [], activeId: null }));
  let usageRecords = loadUsage();
  let activeRequest = null;
  let selectedText = null;
  let saveTimer = 0;
  let toastTimer = 0;

  function loadJSON(key, fallback) {
    try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
    catch { return { ...fallback }; }
  }

  function loadUsage() {
    try {
      const records = JSON.parse(localStorage.getItem(USAGE_KEY) || '[]');
      return Array.isArray(records) ? records.filter(record => record && Number.isFinite(record.timestamp)) : [];
    } catch { return []; }
  }

  function normalizeState(value) {
    const nodes = Array.isArray(value.nodes) ? value.nodes.filter(n => n && n.id && n.question).map(node => {
      if (node.status !== 'loading') return node;
      return { ...node, status: 'error', error: 'The page was closed before this response finished.' };
    }) : [];
    const activeId = nodes.some(n => n.id === value.activeId) ? value.activeId : (nodes.at(-1)?.id || null);
    return { nodes, activeId };
  }

  function persistSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
      catch { showToast('Browser storage is full — this map could not be saved'); }
    }, 180);
  }

  function nodeById(id) { return state.nodes.find(node => node.id === id); }

  function pathTo(id) {
    const path = [];
    const seen = new Set();
    let node = nodeById(id);
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      path.push(node);
      node = nodeById(node.parentId);
    }
    return path.reverse();
  }

  function childrenOf(id) { return state.nodes.filter(node => node.parentId === id); }

  function uid() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function escapeHTML(value = '') {
    return value.replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
  }

  function inlineMarkdown(text) {
    let output = escapeHTML(text);
    output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
    output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    output = output.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return output;
  }

  function renderMath(source, displayMode) {
    if (!globalThis.katex) return `<code class="math-fallback">${escapeHTML(source)}</code>`;
    try { return katex.renderToString(source, { displayMode, throwOnError: false, strict: false, trust: false }); }
    catch { return `<code class="math-fallback">${escapeHTML(source)}</code>`; }
  }

  function markdown(source = '') {
    const stash = [];
    const token = html => `\u0000${stash.push(html) - 1}\u0000`;
    let text = source.replace(/\r\n?/g, '\n');
    text = text.replace(/```([\w+-]*)\n([\s\S]*?)```/g, (_, lang, code) => token(`<pre data-language="${escapeHTML(lang)}"><code>${escapeHTML(code.trimEnd())}</code></pre>`));
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, formula) => token(renderMath(formula.trim(), true)));
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, formula) => token(renderMath(formula.trim(), true)));
    text = text.replace(/\\\((.*?)\\\)/g, (_, formula) => token(renderMath(formula.trim(), false)));
    text = text.replace(/(?<!\\)\$([^$\n]+?)\$/g, (_, formula) => token(renderMath(formula.trim(), false)));

    const lines = text.split('\n');
    const html = [];
    let paragraph = [];
    let list = null;
    const flushParagraph = () => {
      if (paragraph.length) html.push(`<p>${inlineMarkdown(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
      paragraph = [];
    };
    const closeList = () => { if (list) html.push(`</${list}>`); list = null; };

    for (const line of lines) {
      const heading = line.match(/^(#{1,3})\s+(.+)/);
      const bullet = line.match(/^\s*[-*+]\s+(.+)/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.+)/);
      const quote = line.match(/^>\s?(.*)/);
      const blockToken = line.match(/^\u0000(\d+)\u0000$/);
      if (blockToken) { flushParagraph(); closeList(); html.push(stash[Number(blockToken[1])]); }
      else if (heading) { flushParagraph(); closeList(); const level = heading[1].length; html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); }
      else if (bullet || numbered) {
        flushParagraph();
        const wanted = bullet ? 'ul' : 'ol';
        if (list !== wanted) { closeList(); html.push(`<${wanted}>`); list = wanted; }
        html.push(`<li>${inlineMarkdown((bullet || numbered)[1])}</li>`);
      } else if (quote) { flushParagraph(); closeList(); html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`); }
      else if (!line.trim()) { flushParagraph(); closeList(); }
      else paragraph.push(line);
    }
    flushParagraph(); closeList();
    return html.join('').replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)]);
  }

  function answerHTML(node) {
    if (node.status === 'loading' && !node.answer) return '<span class="thinking" aria-label="Thinking"><i></i><i></i><i></i></span>';
    if (node.status === 'error') return `<p class="error-text">${escapeHTML(node.error || 'The request failed.')}</p>`;
    return markdown(node.answer || '');
  }

  function renderConversation({ scroll = false } = {}) {
    const path = pathTo(state.activeId);
    els.welcome.hidden = path.length > 0;
    els.conversation.hidden = path.length === 0;
    const fragment = document.createDocumentFragment();
    for (const node of path) {
      const article = document.createElement('article');
      article.className = 'message';
      article.dataset.nodeId = node.id;
      article.innerHTML = `
        <div class="question-row"><div class="question-bubble">${escapeHTML(node.question)}</div></div>
        <div class="answer"><span class="answer-mark" aria-hidden="true">S</span><div class="answer-body">${answerHTML(node)}</div></div>
        <div class="answer-actions">
          <button class="mini-action copy-answer" type="button">Copy answer</button>
          <button class="mini-action branch-here" type="button">Branch here</button>
          ${node.status === 'error' ? '<button class="mini-action retry-node" type="button">Retry</button>' : ''}
        </div>`;
      fragment.append(article);
    }
    els.conversation.replaceChildren(fragment);
    renderBranchContext();
    if (scroll) requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }));
  }

  function renderTree() {
    const ids = new Set(state.nodes.map(node => node.id));
    const grouped = new Map();
    for (const node of state.nodes) {
      const parentId = node.parentId && ids.has(node.parentId) ? node.parentId : null;
      if (!grouped.has(parentId)) grouped.set(parentId, []);
      grouped.get(parentId).push(node);
    }
    const roots = grouped.get(null) || [];
    const activePath = new Set(pathTo(state.activeId).map(node => node.id));
    const build = nodes => {
      const ul = document.createElement('ul');
      for (const node of nodes) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `tree-node${node.id === state.activeId ? ' active' : ''}`;
        button.dataset.nodeId = node.id;
        button.setAttribute('aria-current', node.id === state.activeId ? 'true' : 'false');
        const children = grouped.get(node.id) || [];
        button.innerHTML = `<span class="node-dot">${node.status === 'loading' ? '…' : (activePath.has(node.id) ? '●' : '○')}</span><span class="node-copy"><span class="node-title">${escapeHTML(node.question)}</span><span class="node-meta">${children.length} ${children.length === 1 ? 'reply' : 'branches'}</span></span>`;
        li.append(button);
        if (children.length) li.append(build(children));
        ul.append(li);
      }
      return ul;
    };
    els.tree.replaceChildren(build(roots));
    els.mapEmpty.hidden = state.nodes.length > 0;
    els.tree.hidden = state.nodes.length === 0;
    els.nodeCount.textContent = String(state.nodes.length);
    let branchCount = 0;
    for (const children of grouped.values()) branchCount += Math.max(0, children.length - 1);
    els.branchCount.textContent = String(branchCount);
  }

  function renderBranchContext() {
    const active = nodeById(state.activeId);
    const latest = state.nodes.at(-1);
    const branching = active && latest && active.id !== latest.id;
    els.branchContext.hidden = !branching;
    if (branching) els.branchLabel.textContent = active.question;
  }

  function renderAll(options) { renderConversation(options); renderTree(); }

  function updateStreamedNode(node) {
    if (state.activeId !== node.id) return;
    const body = $(`.message[data-node-id="${CSS.escape(node.id)}"] .answer-body`, els.conversation);
    if (body) body.innerHTML = answerHTML(node);
  }

  function inputFor(parentId, question) {
    const messages = [];
    for (const node of pathTo(parentId)) {
      messages.push({ role: 'user', content: node.question });
      if (node.answer) messages.push({ role: 'assistant', content: node.answer });
    }
    messages.push({ role: 'user', content: question });
    return messages;
  }

  async function ask(question, parentId = state.activeId) {
    question = question.trim();
    if (!question) return;
    if (activeRequest) { showToast('Stop or finish the current response first'); return; }
    if (!settings.apiKey) { openSettings(); showToast('Add an OpenAI API key to begin'); return; }

    const node = { id: uid(), parentId: parentId || null, question, answer: '', status: 'loading', createdAt: Date.now() };
    state.nodes.push(node);
    state.activeId = node.id;
    persistSoon();
    renderAll({ scroll: true });
    setBusy(true);
    const controller = new AbortController();
    activeRequest = controller;
    let completedUsage = null;

    try {
      const response = await fetch(settings.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` },
        body: JSON.stringify({ model: settings.model, instructions: settings.systemPrompt, input: inputFor(parentId, question), stream: true }),
        signal: controller.signal
      });
      if (!response.ok) {
        let message = `API request failed (${response.status})`;
        try { const data = await response.json(); message = data.error?.message || message; } catch {}
        throw new Error(message);
      }
      if (!response.body) throw new Error('This browser did not provide a streaming response body.');
      await consumeSSE(response.body, event => {
        if (event.type === 'response.output_text.delta') node.answer += event.delta || '';
        if (event.type === 'response.completed' || event.type === 'response.done') {
          completedUsage = event.response?.usage || event.usage || completedUsage;
        }
        if (event.type === 'response.failed') throw new Error(event.response?.error?.message || 'The model response failed.');
      }, () => updateStreamedNode(node));
      node.status = 'complete';
      if (completedUsage) recordUsage(node.id, settings.model, settings.apiUrl, completedUsage);
    } catch (error) {
      node.status = 'error';
      node.error = error.name === 'AbortError' ? 'Response stopped.' : error.message;
    } finally {
      activeRequest = null;
      persistSoon();
      setBusy(false);
      renderAll();
    }
  }

  async function consumeSSE(stream, onEvent, onPaint) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let paintQueued = false;
    const queuePaint = () => {
      if (paintQueued) return;
      paintQueued = true;
      setTimeout(() => { paintQueued = false; onPaint(); }, 70);
    };
    const processBlock = block => {
      for (const line of block.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        onEvent(JSON.parse(data));
        queuePaint();
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) processBlock(block);
      if (done) break;
    }
    if (buffer.trim()) processBlock(buffer);
    onPaint();
  }

  function setBusy(busy) {
    els.prompt.disabled = busy;
    els.send.textContent = busy ? '■' : '↑';
    els.send.setAttribute('aria-label', busy ? 'Stop response' : 'Send message');
  }

  function openSettings() {
    els.apiKey.value = settings.apiKey || '';
    els.model.value = settings.model;
    els.apiUrl.value = settings.apiUrl;
    els.systemPrompt.value = settings.systemPrompt;
    els.settings.showModal();
    setTimeout(() => els.apiKey.focus(), 50);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function updateKeyStatus() { els.keyStatus.classList.toggle('ready', Boolean(settings.apiKey)); }

  function updateThemeButton() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const button = $('#theme-toggle');
    button.querySelector('span').textContent = dark ? '☀' : '☾';
    button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
    button.title = `Switch to ${dark ? 'light' : 'dark'} theme`;
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('study-pal:theme', next); } catch {}
    updateThemeButton();
  }

  function priceForModel(model) {
    const key = String(model || '').toLowerCase();
    return MODEL_PRICES.find(price => price.match.test(key)) || null;
  }

  function isOpenAIEndpoint(apiUrl) {
    try { return new URL(apiUrl).hostname === 'api.openai.com'; }
    catch { return false; }
  }

  function recordUsage(nodeId, model, apiUrl, rawUsage) {
    if (usageRecords.some(record => record.nodeId === nodeId)) return;
    const inputTokens = Number(rawUsage.input_tokens) || 0;
    const outputTokens = Number(rawUsage.output_tokens) || 0;
    const cachedTokens = Math.min(inputTokens, Number(rawUsage.input_tokens_details?.cached_tokens) || 0);
    const totalTokens = Number(rawUsage.total_tokens) || inputTokens + outputTokens;
    const price = isOpenAIEndpoint(apiUrl) ? priceForModel(model) : null;
    const costUSD = price
      ? (((inputTokens - cachedTokens) * price.input) + (cachedTokens * price.cached) + (outputTokens * price.output)) / 1_000_000
      : null;
    usageRecords.push({
      id: uid(), nodeId, timestamp: Date.now(), model: String(model || 'unknown'),
      inputTokens, cachedTokens, outputTokens, totalTokens, costUSD,
      rates: price ? { input: price.input, cached: price.cached, output: price.output } : null
    });
    // Keep bounded history while retaining roughly a year of normal personal use.
    usageRecords = usageRecords.slice(-2000);
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(usageRecords)); }
    catch { showToast('Usage was returned, but local usage history is full'); }
    updateUsageButton();
  }

  function currentMonthRecords() {
    const now = new Date();
    return usageRecords.filter(record => {
      const date = new Date(record.timestamp);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
  }

  function sum(records, key) { return records.reduce((total, record) => total + (Number(record[key]) || 0), 0); }

  function formatTokens(value, compact = false) {
    const number = Number(value) || 0;
    if (!compact || number < 1000) return Math.round(number).toLocaleString();
    if (number < 1_000_000) return `${(number / 1000).toFixed(number < 10_000 ? 1 : 0)}K`;
    return `${(number / 1_000_000).toFixed(number < 10_000_000 ? 1 : 0)}M`;
  }

  function formatCost(value) {
    if (!Number.isFinite(value)) return 'Unpriced';
    if (value > 0 && value < .01) return '<$0.01';
    return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value < 1 ? 4 : 2 });
  }

  function updateUsageButton() {
    const total = sum(currentMonthRecords(), 'totalTokens');
    els.monthTokens.textContent = formatTokens(total, true);
    const label = `${formatTokens(total)} tokens tracked this month`;
    $('#open-usage').title = label;
    $('#open-usage').setAttribute('aria-label', `${label}. Open API usage details`);
  }

  function usageRowsByModel(records) {
    const groups = new Map();
    for (const record of records) {
      const model = String(record.model || 'unknown');
      if (!groups.has(model)) groups.set(model, { model, totalTokens: 0, costUSD: 0, unpriced: 0 });
      const group = groups.get(model);
      group.totalTokens += Number(record.totalTokens) || 0;
      if (Number.isFinite(record.costUSD)) group.costUSD += record.costUSD;
      else group.unpriced += 1;
    }
    return [...groups.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  }

  function renderUsage() {
    const records = currentMonthRecords().sort((a, b) => b.timestamp - a.timestamp);
    const totalCost = records.reduce((total, record) => total + (Number.isFinite(record.costUSD) ? record.costUSD : 0), 0);
    const unpriced = records.filter(record => !Number.isFinite(record.costUSD)).length;
    els.usageMonth.textContent = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    els.usageTotal.textContent = formatTokens(sum(records, 'totalTokens'));
    els.usageCost.textContent = records.length && unpriced === records.length
      ? 'Unpriced'
      : `${formatCost(totalCost)}${unpriced ? ' +' : ''}`;
    els.usageRequests.textContent = formatTokens(records.length);
    els.usageInput.textContent = formatTokens(sum(records, 'inputTokens'));
    els.usageCached.textContent = formatTokens(sum(records, 'cachedTokens'));
    els.usageOutput.textContent = formatTokens(sum(records, 'outputTokens'));

    const groups = usageRowsByModel(records);
    els.usageModels.innerHTML = groups.length ? groups.map(group => `
      <div class="usage-row">
        <span class="model-name" title="${escapeHTML(group.model)}">${escapeHTML(group.model)}</span>
        <span class="row-tokens">${formatTokens(group.totalTokens)} tokens</span>
        <span class="row-cost">${group.unpriced ? 'Partly unpriced' : formatCost(group.costUSD)}</span>
      </div>`).join('') : '<p class="usage-empty">No tracked requests this month.</p>';

    els.usageRecent.innerHTML = records.length ? records.slice(0, 12).map(record => `
      <div class="usage-row">
        <span class="model-name">${new Date(record.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
        <span class="row-tokens">${formatTokens(record.totalTokens)} tokens</span>
        <span class="row-cost">${formatCost(record.costUSD)}</span>
      </div>`).join('') : '<p class="usage-empty">Completed requests will appear here.</p>';

    els.usageNote.textContent = unpriced
      ? `${unpriced} request${unpriced === 1 ? '' : 's'} could not be estimated because the model or endpoint has no local price entry.`
      : 'Estimate uses standard OpenAI text-token prices recorded when each request completed. Pricing table checked August 17, 2026.';
  }

  function openUsage() {
    renderUsage();
    els.usageDialog.showModal();
  }

  function showSelectionMenu(text, nodeId, rect) {
    selectedText = { text: text.slice(0, 5000), nodeId };
    els.selectionPreview.textContent = text.length > 240 ? `${text.slice(0, 240)}…` : text;
    els.selectionMenu.hidden = false;
    const width = 330;
    const left = Math.max(12, Math.min(innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    const estimatedHeight = 235;
    const top = rect.bottom + estimatedHeight < innerHeight ? rect.bottom + 10 : Math.max(10, rect.top - estimatedHeight - 8);
    Object.assign(els.selectionMenu.style, { left: `${left}px`, top: `${top}px` });
  }

  function hideSelectionMenu() { els.selectionMenu.hidden = true; selectedText = null; }

  els.composer.addEventListener('submit', event => {
    event.preventDefault();
    if (activeRequest) { activeRequest.abort(); return; }
    const question = els.prompt.value;
    els.prompt.value = '';
    els.prompt.style.height = '';
    ask(question);
  });
  els.prompt.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); els.composer.requestSubmit(); }
  });
  els.prompt.addEventListener('input', () => {
    els.prompt.style.height = 'auto';
    els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 180)}px`;
  });
  document.addEventListener('click', event => {
    const starter = event.target.closest('.starter');
    if (starter) { els.prompt.value = starter.dataset.prompt; els.prompt.focus(); }
    const treeNode = event.target.closest('.tree-node');
    if (treeNode) { state.activeId = treeNode.dataset.nodeId; persistSoon(); renderAll(); document.body.classList.remove('map-open'); scrollTo({ top: 0, behavior: 'smooth' }); }
    const branch = event.target.closest('.branch-here');
    if (branch) { state.activeId = branch.closest('.message').dataset.nodeId; persistSoon(); renderAll(); els.prompt.focus(); }
    const retry = event.target.closest('.retry-node');
    if (retry) { const old = nodeById(retry.closest('.message').dataset.nodeId); state.activeId = old.parentId; ask(old.question, old.parentId); }
    const copy = event.target.closest('.copy-answer');
    if (copy) { const node = nodeById(copy.closest('.message').dataset.nodeId); navigator.clipboard.writeText(node.answer).then(() => showToast('Answer copied')); }
  });
  document.addEventListener('mouseup', event => {
    if (event.target.closest('.selection-menu')) return;
    requestAnimationFrame(() => {
      const selection = getSelection();
      const text = selection?.toString().trim();
      if (!text || text.length < 2 || !selection.rangeCount) return;
      const answer = selection.anchorNode?.parentElement?.closest('.answer-body');
      if (!answer || !answer.contains(selection.focusNode)) return;
      const message = answer.closest('.message');
      showSelectionMenu(text, message.dataset.nodeId, selection.getRangeAt(0).getBoundingClientRect());
    });
  });

  $('#ask-selection').addEventListener('click', () => {
    if (!selectedText) return;
    const action = els.selectionAction.value === 'custom' ? els.selectionCustom.value.trim() : els.selectionAction.value;
    if (!action) { els.selectionCustom.focus(); return; }
    const question = `${action}\n\nSelected passage:\n> ${selectedText.text.replace(/\n/g, '\n> ')}`;
    const parentId = selectedText.nodeId;
    hideSelectionMenu();
    getSelection()?.removeAllRanges();
    ask(question, parentId);
  });
  els.selectionAction.addEventListener('change', () => {
    els.selectionCustom.hidden = els.selectionAction.value !== 'custom';
    if (!els.selectionCustom.hidden) els.selectionCustom.focus();
  });
  $('#close-selection').addEventListener('click', hideSelectionMenu);
  window.addEventListener('scroll', hideSelectionMenu, { passive: true });
  $('#open-settings').addEventListener('click', openSettings);
  $('#open-usage').addEventListener('click', openUsage);
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#close-settings').addEventListener('click', () => els.settings.close());
  $('#close-usage').addEventListener('click', () => els.usageDialog.close());
  $('#reset-usage').addEventListener('click', () => {
    if (!usageRecords.length || confirm('Reset the locally tracked API usage history? This cannot be undone.')) {
      usageRecords = [];
      localStorage.removeItem(USAGE_KEY);
      updateUsageButton();
      renderUsage();
      showToast('Local usage history reset');
    }
  });
  $('#toggle-key').addEventListener('click', event => { const show = els.apiKey.type === 'password'; els.apiKey.type = show ? 'text' : 'password'; event.target.textContent = show ? 'Hide' : 'Show'; });
  $('#settings-form').addEventListener('submit', event => {
    event.preventDefault();
    settings = { apiKey: els.apiKey.value.trim(), model: els.model.value.trim() || DEFAULT_SETTINGS.model, apiUrl: els.apiUrl.value.trim() || DEFAULT_SETTINGS.apiUrl, systemPrompt: els.systemPrompt.value.trim() };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    updateKeyStatus(); els.settings.close(); showToast('Settings saved');
  });
  $('#forget-key').addEventListener('click', () => { settings.apiKey = ''; els.apiKey.value = ''; localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); updateKeyStatus(); showToast('API key removed'); });
  $('#new-session').addEventListener('click', () => {
    if (!state.nodes.length || confirm('Start a new map? This will delete the current conversation tree from this browser.')) {
      if (activeRequest) activeRequest.abort();
      state = { nodes: [], activeId: null }; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); renderAll();
    }
  });
  $('#clear-branch').addEventListener('click', () => { state.activeId = state.nodes.at(-1)?.id || null; persistSoon(); renderAll({ scroll: true }); });
  $('#collapse-map').addEventListener('click', () => { document.body.classList.remove('map-open'); document.body.classList.add('map-collapsed'); $('#expand-map').hidden = false; });
  $('#expand-map').addEventListener('click', () => { document.body.classList.remove('map-collapsed'); document.body.classList.add('map-open'); $('#expand-map').hidden = true; });

  updateKeyStatus();
  updateThemeButton();
  updateUsageButton();
  renderAll();
})();
