(() => {
  'use strict';

  const APP_PREFIX = 'study-lab';
  const STORAGE_KEY = `${APP_PREFIX}:v1`;
  const SETTINGS_KEY = `${APP_PREFIX}:settings:v1`;
  const USAGE_KEY = `${APP_PREFIX}:usage:v1`;
  const OPENROUTER_PRICES_KEY = `${APP_PREFIX}:openrouter-prices:v1`;
  const TREE_ZOOM_KEY = `${APP_PREFIX}:tree-zoom`;
  const THEME_KEY = `${APP_PREFIX}:theme`;
  const FILE_REQUEST_LIMIT = 50 * 1024 * 1024;
  const PRICE_CACHE_TTL = 24 * 60 * 60 * 1000;
  const PROVIDERS = {
    openai: {
      label: 'OpenAI', apiUrl: 'https://api.openai.com/v1/responses', model: 'gpt-5-mini',
      models: ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4.1']
    },
    openrouter: {
      label: 'OpenRouter', apiUrl: 'https://openrouter.ai/api/v1/responses', model: 'openai/gpt-5-mini',
      models: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-pro', 'deepseek/deepseek-r1']
    }
  };
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
    activeModelId: 'model-openai',
    apiKeys: { openai: '', openrouter: '' },
    models: [{ id: 'model-openai', provider: 'openai', model: 'gpt-5-mini', apiUrl: 'https://api.openai.com/v1/responses' }],
    systemPrompt: 'You are a patient technical tutor. Use clear Markdown and LaTeX where useful. Use mathematical language, assume graduate level knowledge. Build on the conversation context and explain assumptions.'
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const els = {
    welcome: $('#welcome'), conversation: $('#conversation'), composer: $('#composer'),
    prompt: $('#prompt'), send: $('#send'), tree: $('#tree'), mapEmpty: $('#map-empty'),
    nodeCount: $('#node-count'), branchCount: $('#branch-count'), branchContext: $('#branch-context'),
    branchLabel: $('#branch-label'), selectionMenu: $('#selection-menu'), selectionPreview: $('#selection-preview'),
    selectionAction: $('#selection-action'), selectionCustom: $('#selection-custom'), settings: $('#settings-dialog'),
    openaiApiKey: $('#openai-api-key'), openrouterApiKey: $('#openrouter-api-key'), modelConfigs: $('#model-configs'),
    openaiModelOptions: $('#openai-model-options'), openrouterModelOptions: $('#openrouter-model-options'),
    systemPrompt: $('#system-prompt'),
    keyStatus: $('#key-status'), toast: $('#toast'), usageDialog: $('#usage-dialog'),
    monthTokens: $('#month-tokens'), usageMonth: $('#usage-month'), usageTotal: $('#usage-total'),
    usageCost: $('#usage-cost'), usageRequests: $('#usage-requests'), usageInput: $('#usage-input'),
    usageCached: $('#usage-cached'), usageOutput: $('#usage-output'), usageModels: $('#usage-models'),
    usageRecent: $('#usage-recent'), usageNote: $('#usage-note'), usageDashboard: $('#usage-dashboard'), historyList: $('#history-list'),
    historyEmpty: $('#history-empty'), historyToggle: $('#toggle-history'),
    attachments: $('#attachments'), uploadFile: $('#upload-file'), fileInput: $('#file-input'),
    activeConnection: $('#active-connection'), activeModel: $('#active-model'), activeProvider: $('#active-provider'),
    conversationSearch: $('#conversation-search'), searchResults: $('#search-results'),
    treeZoom: $('#tree-zoom'), shortcutsDialog: $('#shortcuts-dialog')
  };

  migrateLegacyStorage();
  let settings = normalizeSettings(loadJSON(SETTINGS_KEY, DEFAULT_SETTINGS));
  let settingsDraft = null;
  let workspace = loadWorkspace();
  let state = currentMap();
  let usageRecords = loadUsage();
  let openRouterPrices = loadOpenRouterPrices();
  let activeRequest = null;
  let uploadingFiles = false;
  let uploadTargetMapId = null;
  let selectedText = null;
  let saveTimer = 0;
  let toastTimer = 0;
  let searchTimer = 0;
  let searchIndex = null;
  let pendingG = false;
  let pendingGTimer = 0;
  let treeZoom = loadTreeZoom();

  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; }
    catch { return { ...fallback }; }
  }

  function normalizeSettings(value = {}) {
    const apiKeys = {
      openai: String(value.apiKeys?.openai ?? value.profiles?.openai?.apiKey ?? value.apiKey ?? ''),
      openrouter: String(value.apiKeys?.openrouter ?? value.profiles?.openrouter?.apiKey ?? '')
    };
    let sourceModels = Array.isArray(value.models) ? value.models : null;
    if (!sourceModels?.length && value.profiles) {
      sourceModels = Object.entries(PROVIDERS).map(([provider, defaults]) => ({
        id: `model-${provider}`, provider, model: value.profiles[provider]?.model || defaults.model,
        apiUrl: value.profiles[provider]?.apiUrl || defaults.apiUrl
      }));
    }
    if (!sourceModels?.length) {
      const provider = PROVIDERS[value.provider] ? value.provider : 'openai';
      sourceModels = [{
        id: 'model-openai', provider, model: value.model || PROVIDERS[provider].model,
        apiUrl: value.apiUrl || PROVIDERS[provider].apiUrl
      }];
    }
    const usedIds = new Set();
    const models = sourceModels.map((saved, index) => {
      const provider = PROVIDERS[saved?.provider] ? saved.provider : 'openai';
      let id = String(saved?.id || `model-${index + 1}`);
      while (usedIds.has(id)) id = `${id}-${index + 1}`;
      usedIds.add(id);
      return {
        id, provider, model: String(saved?.model || PROVIDERS[provider].model),
        apiUrl: String(saved?.apiUrl || PROVIDERS[provider].apiUrl)
      };
    });
    const legacyActive = models.find(model => model.provider === value.provider)?.id;
    const activeModelId = models.some(model => model.id === value.activeModelId)
      ? value.activeModelId : (legacyActive || models[0].id);
    const active = models.find(model => model.id === activeModelId) || models[0];
    return {
      activeModelId, apiKeys, models, provider: active.provider, apiKey: apiKeys[active.provider],
      model: active.model, apiUrl: active.apiUrl,
      systemPrompt: String(value.systemPrompt ?? DEFAULT_SETTINGS.systemPrompt)
    };
  }

  function providerLabel(provider = settings.provider) {
    return PROVIDERS[provider]?.label || 'API provider';
  }

  function requestHeaders(json = false, connection = settings) {
    const headers = { 'Authorization': `Bearer ${connection.apiKey}` };
    if (json) headers['Content-Type'] = 'application/json';
    if (connection.provider === 'openrouter') headers['X-OpenRouter-Title'] = 'Study Lab';
    return headers;
  }

  function migrateLegacyStorage() {
    const legacyPrefix = ['study', 'pal'].join('-');
    const suffixes = [':v1', ':settings:v1', ':usage:v1', ':theme', ':tree-zoom'];
    for (const suffix of suffixes) {
      const currentKey = `${APP_PREFIX}${suffix}`;
      const legacyKey = `${legacyPrefix}${suffix}`;
      try {
        if (localStorage.getItem(currentKey) === null && localStorage.getItem(legacyKey) !== null) {
          localStorage.setItem(currentKey, localStorage.getItem(legacyKey));
        }
      } catch {}
    }
  }

  function loadUsage() {
    try {
      const records = JSON.parse(localStorage.getItem(USAGE_KEY) || '[]');
      return Array.isArray(records) ? records.filter(record => record && Number.isFinite(record.timestamp)) : [];
    } catch { return []; }
  }

  function loadOpenRouterPrices() {
    try {
      const prices = JSON.parse(localStorage.getItem(OPENROUTER_PRICES_KEY) || '{}');
      return prices && typeof prices === 'object' && !Array.isArray(prices) ? prices : {};
    } catch { return {}; }
  }

  function persistOpenRouterPrices() {
    const recent = Object.entries(openRouterPrices)
      .sort((a, b) => (Number(b[1]?.checkedAt) || 0) - (Number(a[1]?.checkedAt) || 0))
      .slice(0, 40);
    openRouterPrices = Object.fromEntries(recent);
    try { localStorage.setItem(OPENROUTER_PRICES_KEY, JSON.stringify(openRouterPrices)); } catch {}
  }

  function loadTreeZoom() {
    try { return Math.max(.8, Math.min(1.4, Number(localStorage.getItem(TREE_ZOOM_KEY)) || 1)); }
    catch { return 1; }
  }

  function blankMap() {
    const now = Date.now();
    return { id: uid(), title: 'Untitled map', titleCustom: false, nodes: [], attachments: [], collapsedIds: [], activeId: null, createdAt: now, updatedAt: now };
  }

  function titleFromNodes(nodes) {
    const first = nodes.find(node => !node.parentId) || nodes[0];
    if (!first) return 'Untitled map';
    const title = String(first.question).replace(/\s+/g, ' ').trim();
    return title.length > 54 ? `${title.slice(0, 54)}…` : title;
  }

  function normalizeMap(value = {}) {
    const normalized = normalizeState(value);
    const attachments = Array.isArray(value.attachments) ? value.attachments
      .filter(file => file && file.id && file.name)
      .map(file => ({
        id: String(file.id), name: String(file.name), size: Number(file.size) || 0,
        createdAt: Number(file.createdAt) || Date.now(), detail: file.detail === 'high' ? 'high' : 'low',
        kind: file.kind === 'markdown' || String(file.name).toLowerCase().endsWith('.md') ? 'markdown' : 'pdf',
        provider: PROVIDERS[file.provider] ? file.provider : 'openai'
      })) : [];
    const createdAt = Number(value.createdAt) || Number(normalized.nodes[0]?.createdAt) || Date.now();
    return {
      id: String(value.id || uid()),
      title: String(value.title || titleFromNodes(normalized.nodes)),
      titleCustom: Boolean(value.titleCustom),
      ...normalized,
      attachments,
      collapsedIds: Array.isArray(value.collapsedIds) ? [...new Set(value.collapsedIds.map(String))] : [],
      createdAt,
      updatedAt: Number(value.updatedAt) || Number(normalized.nodes.at(-1)?.createdAt) || createdAt
    };
  }

  function loadWorkspace() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch {}
    let maps = [];
    let activeMapId = null;
    if (raw && Array.isArray(raw.maps)) {
      maps = raw.maps.filter(Boolean).map(normalizeMap);
      activeMapId = raw.activeMapId;
    } else if (raw && Array.isArray(raw.nodes) && raw.nodes.length) {
      // Migrate the original single-map schema in place.
      const migrated = normalizeMap(raw);
      maps = [migrated];
      activeMapId = migrated.id;
    }
    if (!maps.length) maps.push(blankMap());
    if (!maps.some(map => map.id === activeMapId)) activeMapId = maps[0].id;
    return { version: 2, maps, activeMapId };
  }

  function currentMap() {
    return workspace.maps.find(map => map.id === workspace.activeMapId) || workspace.maps[0];
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
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); }
      catch { showToast('Browser storage is full — conversations could not be saved'); }
    }, 180);
  }

  function persistNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); return true; }
    catch { showToast('Browser storage is full — conversations could not be saved'); return false; }
  }

  function touchMap(map = state) { map.updatedAt = Date.now(); searchIndex = null; }

  function refreshMapTitle(map = state) {
    if (!map.titleCustom) map.title = titleFromNodes(map.nodes);
  }

  function nodeById(id, map = state) { return map.nodes.find(node => node.id === id); }

  function pathTo(id, map = state) {
    const path = [];
    const seen = new Set();
    let node = nodeById(id, map);
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      path.push(node);
      node = nodeById(node.parentId, map);
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

  function tableCells(line) {
    let source = line.trim();
    if (source.startsWith('|')) source = source.slice(1);
    if (source.endsWith('|') && !source.endsWith('\\|')) source = source.slice(0, -1);
    const cells = [];
    let cell = '';
    let code = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '\\' && source[index + 1] === '|') {
        cell += '|';
        index += 1;
      } else if (char === '`') {
        code = !code;
        cell += char;
      } else if (char === '|' && !code) {
        cells.push(cell.trim());
        cell = '';
      } else cell += char;
    }
    cells.push(cell.trim());
    return cells;
  }

  function tableDelimiter(line) {
    const cells = tableCells(line);
    if (!line.includes('|') || !cells.length || cells.some(cell => !/^:?-{3,}:?$/.test(cell))) return null;
    return cells.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : '');
  }

  function renderTable(header, alignments, rows) {
    const cellHTML = (cell, tag, index) => {
      const alignment = alignments[index] ? ` style="text-align: ${alignments[index]}"` : '';
      const scope = tag === 'th' ? ' scope="col"' : '';
      return `<${tag}${scope}${alignment}>${inlineMarkdown(cell || '')}</${tag}>`;
    };
    const head = header.map((cell, index) => cellHTML(cell, 'th', index)).join('');
    const body = rows.map(row => `<tr>${header.map((_, index) => cellHTML(row[index], 'td', index)).join('')}</tr>`).join('');
    return `<div class="table-scroll"><table><thead><tr>${head}</tr></thead>${body ? `<tbody>${body}</tbody>` : ''}</table></div>`;
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
    let listItemOpen = false;
    const flushParagraph = () => {
      if (paragraph.length) html.push(`<p>${inlineMarkdown(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
      paragraph = [];
    };
    const closeListItem = () => {
      if (listItemOpen) html.push('</li>');
      listItemOpen = false;
    };
    const closeList = () => {
      if (!list) return;
      closeListItem();
      html.push(`</${list}>`);
      list = null;
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const alignments = lineIndex + 1 < lines.length ? tableDelimiter(lines[lineIndex + 1]) : null;
      if (alignments) {
        const header = tableCells(line);
        if (header.length === alignments.length) {
          flushParagraph(); closeList();
          const rows = [];
          lineIndex += 2;
          while (lineIndex < lines.length && lines[lineIndex].trim() && lines[lineIndex].includes('|')) {
            rows.push(tableCells(lines[lineIndex]));
            lineIndex += 1;
          }
          html.push(renderTable(header, alignments, rows));
          lineIndex -= 1;
          continue;
        }
      }
      const heading = line.match(/^(#{1,3})\s+(.+)/);
      const bullet = line.match(/^\s*[-*+]\s+(.+)/);
      const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)/);
      const quote = line.match(/^>\s?(.*)/);
      const blockToken = line.match(/^\u0000(\d+)\u0000$/);
      if (blockToken) { flushParagraph(); closeList(); html.push(stash[Number(blockToken[1])]); }
      else if (heading) { flushParagraph(); closeList(); const level = heading[1].length; html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); }
      else if (bullet || numbered) {
        flushParagraph();
        const wanted = bullet ? 'ul' : 'ol';
        if (list !== wanted) {
          closeList();
          const start = numbered && numbered[1] !== '1' ? ` start="${Number(numbered[1])}"` : '';
          html.push(`<${wanted}${start}>`);
          list = wanted;
        } else closeListItem();
        html.push(`<li>${inlineMarkdown(bullet ? bullet[1] : numbered[2])}`);
        listItemOpen = true;
      } else if (quote) { flushParagraph(); closeList(); html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`); }
      else if (!line.trim()) {
        flushParagraph();
        let nextIndex = lineIndex + 1;
        while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex += 1;
        const nextLine = lines[nextIndex] || '';
        const continuesList = Boolean(list) && (/^\s+\S/.test(nextLine) || (list === 'ul'
          ? /^\s*[-*+]\s+/.test(nextLine)
          : /^\s*\d+[.)]\s+/.test(nextLine)));
        if (!continuesList) closeList();
      }
      else if (list && /^\s+\S/.test(line)) html.push(`<p>${inlineMarkdown(line.trim())}</p>`);
      else { closeList(); paragraph.push(line); }
    }
    flushParagraph(); closeList();
    return html.join('').replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)]);
  }

  function answerHTML(node) {
    if (node.status === 'loading' && !node.answer) return '<span class="thinking" aria-label="Thinking"><i></i><i></i><i></i></span>';
    if (node.status === 'error') return `<p class="error-text">${escapeHTML(node.error || 'The request failed.')}</p>`;
    return markdown(node.answer || '');
  }

  function answerAttribution(node) {
    if (!node.model || !node.provider || !node.answer) return '';
    return `<div class="answer-attribution" title="Generated by ${escapeHTML(node.model)} through ${escapeHTML(providerLabel(node.provider))}"><span>${escapeHTML(node.model)}</span><small>${escapeHTML(providerLabel(node.provider))}</small></div>`;
  }

  function renderConversation({ scroll = false } = {}) {
    const previousScroll = scroll ? null : { left: window.scrollX, top: window.scrollY };
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
        <div class="answer"><span class="answer-mark" aria-hidden="true">S</span><div class="answer-content"><div class="answer-body">${answerHTML(node)}</div>${answerAttribution(node)}</div></div>
        <div class="answer-actions">
          <button class="mini-action copy-answer" type="button">Copy answer</button>
          <button class="mini-action branch-here" type="button">Branch here</button>
          ${node.status === 'error' ? '<button class="mini-action retry-node" type="button">Retry</button>' : ''}
        </div>`;
      fragment.append(article);
    }
    els.conversation.replaceChildren(fragment);
    if (previousScroll && (window.scrollX !== previousScroll.left || window.scrollY !== previousScroll.top)) {
      window.scrollTo({ ...previousScroll, behavior: 'auto' });
    }
    renderBranchContext();
    if (scroll && state.activeId) requestAnimationFrame(() => {
      if (scroll === 'bottom') {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        return;
      }
      const targetId = state.activeId;
      requestAnimationFrame(() => {
        if (state.activeId !== targetId) return;
        const message = $(`.message[data-node-id="${CSS.escape(targetId)}"]`, els.conversation);
        if (!message) return;
        const headerHeight = $('.topbar')?.getBoundingClientRect().height || 68;
        const top = window.scrollY + message.getBoundingClientRect().top - headerHeight - 14;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      });
    });
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
    const collapsed = new Set(state.collapsedIds);
    const build = nodes => {
      const ul = document.createElement('ul');
      for (const node of nodes) {
        const li = document.createElement('li');
        li.dataset.nodeId = node.id;
        const wrap = document.createElement('div');
        wrap.className = 'tree-node-wrap';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `tree-node${node.id === state.activeId ? ' active' : ''}${activePath.has(node.id) ? ' on-path' : ''}`;
        button.dataset.nodeId = node.id;
        button.setAttribute('aria-current', node.id === state.activeId ? 'true' : 'false');
        const children = grouped.get(node.id) || [];
        const isCollapsed = children.length > 0 && collapsed.has(node.id);
        const toggle = document.createElement(children.length ? 'button' : 'span');
        toggle.className = children.length ? 'toggle-subtree' : 'toggle-placeholder';
        if (children.length) {
          toggle.type = 'button';
          toggle.dataset.nodeId = node.id;
          toggle.setAttribute('aria-label', `${isCollapsed ? 'Expand' : 'Collapse'} branch: ${node.question}`);
          toggle.setAttribute('aria-expanded', String(!isCollapsed));
          toggle.textContent = isCollapsed ? '▸' : '▾';
        }
        button.innerHTML = `<span class="node-dot">${node.status === 'loading' ? '…' : (activePath.has(node.id) ? '●' : '○')}</span><span class="node-copy"><span class="node-title">${escapeHTML(node.question)}</span><span class="node-meta">${children.length} ${children.length === 1 ? 'reply' : 'branches'}${isCollapsed ? ' · hidden' : ''}</span></span>`;
        wrap.append(toggle, button);
        li.append(wrap);
        if (children.length && !isCollapsed) li.append(build(children));
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

  function revealNode(map, nodeId) {
    if (!nodeId) return;
    const hidden = new Set(map.collapsedIds);
    for (const node of pathTo(nodeId, map).slice(0, -1)) hidden.delete(node.id);
    map.collapsedIds = [...hidden];
  }

  function toggleSubtree(nodeId, force) {
    if (!nodeById(nodeId)) return;
    const collapsed = new Set(state.collapsedIds);
    const shouldCollapse = force ?? !collapsed.has(nodeId);
    if (shouldCollapse) collapsed.add(nodeId);
    else collapsed.delete(nodeId);
    state.collapsedIds = [...collapsed];
    persistSoon();
    renderTree();
  }

  function setAllSubtrees(collapsed) {
    if (!collapsed) state.collapsedIds = [];
    else {
      const parents = new Set(state.nodes.map(node => node.parentId).filter(Boolean));
      state.collapsedIds = [...parents];
    }
    persistSoon();
    renderTree();
  }

  function updateTreeZoom(delta = 0) {
    treeZoom = Math.round(Math.max(.8, Math.min(1.4, treeZoom + delta)) * 10) / 10;
    els.tree.style.fontSize = `${.76 * treeZoom}rem`;
    els.tree.style.setProperty('--tree-indent', `${20 * treeZoom}px`);
    els.tree.style.setProperty('--tree-dot-size', `${17 * treeZoom}px`);
    els.tree.style.setProperty('--tree-node-pad-y', `${8 * treeZoom}px`);
    els.treeZoom.textContent = `${Math.round(treeZoom * 100)}%`;
    try { localStorage.setItem(TREE_ZOOM_KEY, String(treeZoom)); } catch {}
  }

  function renderBranchContext() {
    const active = nodeById(state.activeId);
    const latest = state.nodes.at(-1);
    const branching = active && latest && active.id !== latest.id;
    els.branchContext.hidden = !branching;
    if (branching) els.branchLabel.textContent = active.question;
  }

  function renderHistory() {
    const maps = workspace.maps
      .filter(map => map.nodes.length > 0 || map.attachments.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const fragment = document.createDocumentFragment();
    for (const map of maps) {
      const row = document.createElement('div');
      row.className = 'history-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `history-item${map.id === workspace.activeMapId ? ' active' : ''}`;
      button.dataset.mapId = map.id;
      button.setAttribute('aria-current', map.id === workspace.activeMapId ? 'page' : 'false');
      const date = new Date(map.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const fileMeta = map.attachments.length ? ` · ${map.attachments.length} file${map.attachments.length === 1 ? '' : 's'}` : '';
      button.innerHTML = `<span class="history-glyph" aria-hidden="true">${map.nodes.length || map.attachments.length ? '◇' : '＋'}</span><span class="history-copy"><span class="history-title">${escapeHTML(map.title)}</span><span class="history-meta">${map.nodes.length} ${map.nodes.length === 1 ? 'node' : 'nodes'}${fileMeta} · ${date}</span></span>`;
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'rename-map';
      rename.dataset.mapId = map.id;
      rename.setAttribute('aria-label', `Rename conversation: ${map.title}`);
      rename.title = 'Rename this conversation';
      rename.textContent = '✎';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-map';
      remove.dataset.mapId = map.id;
      remove.setAttribute('aria-label', `Delete conversation: ${map.title}`);
      remove.title = 'Delete this conversation';
      remove.textContent = '×';
      row.append(button, rename, remove);
      fragment.append(row);
    }
    els.historyList.replaceChildren(fragment);
    els.historyEmpty.hidden = maps.length > 0;
    els.historyList.hidden = maps.length === 0;
    if (els.conversationSearch.value.trim()) renderSearchResults();
    else els.searchResults.hidden = true;
  }

  function buildSearchIndex() {
    const entries = [];
    for (const map of workspace.maps) {
      if (!map.nodes.length && !map.attachments.length) continue;
      entries.push({ mapId: map.id, nodeId: null, kind: 'Map', label: map.title, fields: [map.title] });
      for (const node of map.nodes) {
        entries.push({
          mapId: map.id, nodeId: node.id, kind: 'Node', label: node.question,
          fields: [node.question, node.answer || ''], mapTitle: map.title
        });
      }
      for (const file of map.attachments) {
        entries.push({ mapId: map.id, nodeId: null, kind: file.kind === 'markdown' ? 'Markdown' : 'PDF', label: file.name, fields: [file.name], mapTitle: map.title });
      }
    }
    searchIndex = entries;
    return entries;
  }

  function searchExcerpt(fields, expression) {
    for (const field of fields) {
      const source = String(field || '').replace(/\s+/g, ' ').trim();
      const index = source.search(expression);
      if (index < 0) continue;
      const start = Math.max(0, index - 45);
      const end = Math.min(source.length, index + 115);
      return `${start ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
    }
    return '';
  }

  function renderSearchResults() {
    const query = els.conversationSearch.value.trim();
    if (!query) {
      els.searchResults.hidden = true;
      els.historyList.hidden = false;
      els.historyEmpty.hidden = workspace.maps.some(map => map.nodes.length || map.attachments.length);
      return;
    }
    const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const matches = [];
    for (const entry of searchIndex || buildSearchIndex()) {
      const excerpt = searchExcerpt(entry.fields, expression);
      if (!excerpt) continue;
      matches.push({ ...entry, excerpt });
      if (matches.length >= 60) break;
    }
    els.searchResults.innerHTML = matches.length ? matches.map(entry => `
      <button class="search-result" type="button" data-map-id="${escapeHTML(entry.mapId)}"${entry.nodeId ? ` data-node-id="${escapeHTML(entry.nodeId)}"` : ''}>
        <span class="search-result-top"><strong>${escapeHTML(entry.label)}</strong><small>${escapeHTML(entry.kind)} · ${escapeHTML(entry.mapTitle || entry.label)}</small></span>
        <span class="search-excerpt">${escapeHTML(entry.excerpt)}</span>
      </button>`).join('') : `<p class="search-empty">No results for “${escapeHTML(query)}”.</p>`;
    els.searchResults.hidden = false;
    els.historyList.hidden = true;
    els.historyEmpty.hidden = true;
  }

  function clearSearch() {
    clearTimeout(searchTimer);
    els.conversationSearch.value = '';
    renderSearchResults();
    renderHistory();
  }

  function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function renderAttachments() {
    const fragment = document.createDocumentFragment();
    for (const file of state.attachments) {
      const chip = document.createElement('span');
      chip.className = 'attachment-chip';
      const available = file.provider === settings.provider;
      chip.classList.toggle('inactive-provider', !available);
      chip.title = `${file.name}${file.size ? ` · ${formatFileSize(file.size)}` : ''} · Uploaded to ${providerLabel(file.provider)}${available ? ' · Included with every question' : ' · Not sent with the selected provider'}`;
      const badge = file.kind === 'markdown' ? 'MD' : 'PDF';
      chip.innerHTML = `<span class="attachment-badge${file.kind === 'markdown' ? ' md' : ''}" aria-hidden="true">${badge}</span><span class="attachment-name">${escapeHTML(file.name)}</span>${available ? '' : `<span class="attachment-provider">${escapeHTML(providerLabel(file.provider))}</span>`}<button class="remove-attachment" type="button" data-file-id="${escapeHTML(file.id)}" aria-label="Remove ${escapeHTML(file.name)} from this map">×</button>`;
      fragment.append(chip);
    }
    if (uploadingFiles && state.id === uploadTargetMapId) {
      const status = document.createElement('span');
      status.className = 'attachment-chip upload-status';
      status.innerHTML = '<span class="upload-spinner" aria-hidden="true"></span> Uploading…';
      fragment.append(status);
    }
    els.attachments.replaceChildren(fragment);
    els.attachments.hidden = !state.attachments.length && !(uploadingFiles && state.id === uploadTargetMapId);
    els.uploadFile.disabled = uploadingFiles || Boolean(activeRequest);
  }

  function renderAll(options) { renderConversation(options); renderTree(); renderHistory(); renderAttachments(); }

  function updateStreamedNode(node) {
    if (state.activeId !== node.id || !state.nodes.includes(node)) return;
    const body = $(`.message[data-node-id="${CSS.escape(node.id)}"] .answer-body`, els.conversation);
    if (body) {
      const previousScroll = { left: window.scrollX, top: window.scrollY };
      body.innerHTML = answerHTML(node);
      if (window.scrollX !== previousScroll.left || window.scrollY !== previousScroll.top) {
        window.scrollTo({ ...previousScroll, behavior: 'auto' });
      }
    }
  }

  function inputFor(map, parentId, question, provider = settings.provider) {
    const messages = [];
    for (const node of pathTo(parentId, map)) {
      if (provider === 'openrouter') {
        messages.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: node.question }] });
        if (node.answer) messages.push({
          type: 'message', role: 'assistant', id: `msg_${String(node.id).replace(/[^a-zA-Z0-9_-]/g, '')}`,
          status: 'completed', content: [{ type: 'output_text', text: node.answer, annotations: [] }]
        });
      } else {
        messages.push({ role: 'user', content: node.question });
        if (node.answer) messages.push({ role: 'assistant', content: node.answer });
      }
    }
    const content = map.attachments
      .filter(file => file.provider === provider)
      .map(file => file.kind === 'markdown'
        ? { type: 'input_file', file_id: file.id }
        : { type: 'input_file', file_id: file.id, detail: file.detail || 'low' });
    content.push({ type: 'input_text', text: question });
    const structured = provider === 'openrouter' || content.length > 1;
    messages.push(structured ? { type: 'message', role: 'user', content } : { role: 'user', content: question });
    return messages;
  }

  function filesEndpoint(apiUrl = settings.apiUrl) {
    const url = new URL(apiUrl);
    if (!/\/responses\/?$/.test(url.pathname)) throw new Error('The configured endpoint is not a Responses API URL, so its Files endpoint cannot be derived.');
    url.pathname = url.pathname.replace(/\/responses\/?$/, '/files');
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  async function uploadFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    if (activeRequest || uploadingFiles) { showToast('Finish the current operation first'); return; }
    if (!settings.apiKey) { openSettings(); showToast(`Add a ${providerLabel()} API key before uploading`); return; }

    const valid = files.filter(file => /\.(pdf|md)$/i.test(file.name));
    if (valid.length !== files.length) { showToast('Only PDF and Markdown (.md) files can be added'); return; }
    if (valid.some(file => file.size >= FILE_REQUEST_LIMIT)) { showToast('Each file must be smaller than 50 MB'); return; }
    const existingBytes = state.attachments.filter(file => file.provider === settings.provider).reduce((total, file) => total + file.size, 0);
    const addedBytes = valid.reduce((total, file) => total + file.size, 0);
    if (existingBytes + addedBytes >= FILE_REQUEST_LIMIT) { showToast('Files in one map must total less than 50 MB'); return; }

    const targetMap = state;
    const connection = { ...settings };
    uploadingFiles = true;
    uploadTargetMapId = targetMap.id;
    renderAttachments();
    let uploaded = 0;
    try {
      const endpoint = filesEndpoint(connection.apiUrl);
      for (const file of valid) {
        const form = new FormData();
        if (connection.provider === 'openai') form.append('purpose', 'user_data');
        form.append('file', file, file.name);
        const response = await fetch(endpoint, {
          method: 'POST', headers: requestHeaders(false, connection), body: form
        });
        if (!response.ok) {
          let message = `File upload failed (${response.status})`;
          try { const data = await response.json(); message = data.error?.message || message; } catch {}
          throw new Error(message);
        }
        const data = await response.json();
        if (!data.id) throw new Error('The Files API did not return a file ID.');
        targetMap.attachments.push({
          id: String(data.id), name: String(data.filename || file.name),
          size: Number(data.bytes ?? data.size_bytes) || file.size, createdAt: Date.now(), detail: 'low',
          kind: file.name.toLowerCase().endsWith('.md') ? 'markdown' : 'pdf',
          provider: connection.provider
        });
        uploaded += 1;
        touchMap(targetMap);
        persistNow();
        if (state === targetMap) renderAll();
      }
      showToast(`${uploaded} file${uploaded === 1 ? '' : 's'} added to this map`);
    } catch (error) {
      showToast(error.message || 'File upload failed');
    } finally {
      uploadingFiles = false;
      uploadTargetMapId = null;
      els.fileInput.value = '';
      renderAll();
    }
  }

  function removeAttachment(fileId) {
    const file = state.attachments.find(candidate => candidate.id === fileId);
    if (!file) return;
    if (!confirm(`Remove “${file.name}” from this map? The uploaded copy is not deleted from the API provider.`)) return;
    state.attachments = state.attachments.filter(candidate => candidate.id !== fileId);
    touchMap();
    persistNow();
    renderAll();
    showToast('File removed from this map');
  }

  async function ask(question, parentId = state.activeId) {
    question = question.trim();
    if (!question) return;
    if (activeRequest) { showToast('Stop or finish the current response first'); return; }
    if (uploadingFiles) { showToast('Wait for the file upload to finish'); return; }
    if (!settings.apiKey) { openSettings(); showToast(`Add a ${providerLabel()} API key to begin`); return; }

    const requestMap = state;
    const connection = { ...settings };
    const node = {
      id: uid(), parentId: parentId || null, question, answer: '', status: 'loading', createdAt: Date.now(),
      provider: connection.provider, model: connection.model
    };
    requestMap.nodes.push(node);
    requestMap.activeId = node.id;
    revealNode(requestMap, node.id);
    refreshMapTitle(requestMap);
    touchMap(requestMap);
    persistSoon();
    renderAll({ scroll: true });
    setBusy(true);
    const controller = new AbortController();
    activeRequest = controller;
    let completedUsage = null;

    try {
      const response = await fetch(connection.apiUrl, {
        method: 'POST',
        headers: requestHeaders(true, connection),
        body: JSON.stringify({ model: connection.model, instructions: connection.systemPrompt, input: inputFor(requestMap, parentId, question, connection.provider), stream: true }),
        signal: controller.signal
      });
      if (!response.ok) {
        let message = `API request failed (${response.status})`;
        try { const data = await response.json(); message = data.error?.message || message; } catch {}
        throw new Error(message);
      }
      if (!response.body) throw new Error('This browser did not provide a streaming response body.');
      await consumeSSE(response.body, event => {
        if (event.type === 'response.output_text.delta' || event.type === 'response.content_part.delta') node.answer += event.delta || '';
        if (event.type === 'response.completed' || event.type === 'response.done') {
          node.model = String(event.response?.model || node.model);
          completedUsage = event.response?.usage || event.usage || completedUsage;
        }
        if (event.type === 'response.failed') throw new Error(event.response?.error?.message || 'The model response failed.');
      }, () => updateStreamedNode(node));
      node.status = 'complete';
      if (completedUsage) await recordUsage(node.id, node.model || connection.model, connection.apiUrl, completedUsage, connection.provider);
    } catch (error) {
      node.status = 'error';
      node.error = error.name === 'AbortError' ? 'Response stopped.' : error.message;
    } finally {
      activeRequest = null;
      touchMap(requestMap);
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
    els.uploadFile.disabled = busy || uploadingFiles;
  }

  function openSettings() {
    settingsDraft = structuredClone({
      activeModelId: settings.activeModelId, apiKeys: settings.apiKeys, models: settings.models
    });
    els.openaiApiKey.value = settingsDraft.apiKeys.openai || '';
    els.openrouterApiKey.value = settingsDraft.apiKeys.openrouter || '';
    fillModelOptions(els.openaiModelOptions, PROVIDERS.openai.models);
    fillModelOptions(els.openrouterModelOptions, PROVIDERS.openrouter.models);
    renderModelCards();
    els.systemPrompt.value = settings.systemPrompt;
    els.settings.showModal();
    setTimeout(() => (settings.provider === 'openrouter' ? els.openrouterApiKey : els.openaiApiKey).focus(), 50);
  }

  function fillModelOptions(list, models) {
    list.replaceChildren(...models.map(model => Object.assign(document.createElement('option'), { value: model })));
  }

  function renderModelCards() {
    if (!settingsDraft) return;
    els.modelConfigs.innerHTML = settingsDraft.models.map((connection, index) => {
      const defaults = PROVIDERS[connection.provider];
      const active = connection.id === settingsDraft.activeModelId;
      return `<section class="model-config${active ? ' active' : ''}" data-model-card data-model-id="${escapeHTML(connection.id)}" data-provider="${connection.provider}">
        <div class="model-config-heading">
          <div><span class="provider-logo">${connection.provider === 'openrouter' ? 'OR' : 'OAI'}</span><h4>Model ${index + 1}</h4></div>
          <label class="default-model"><input class="default-model-radio" type="radio" name="default-model" value="${escapeHTML(connection.id)}"${active ? ' checked' : ''}> Use by default</label>
        </div>
        <div class="model-fields">
          <label>Provider
            <select class="model-provider">
              <option value="openai"${connection.provider === 'openai' ? ' selected' : ''}>OpenAI</option>
              <option value="openrouter"${connection.provider === 'openrouter' ? ' selected' : ''}>OpenRouter</option>
            </select>
          </label>
          <label>Model
            <input class="model-name-input" type="text" value="${escapeHTML(connection.model)}" placeholder="${escapeHTML(defaults.model)}" list="${connection.provider}-model-options" spellcheck="false" required>
          </label>
        </div>
        <details class="provider-advanced">
          <summary>Endpoint</summary>
          <label>Responses API endpoint
            <input class="model-api-url" type="url" value="${escapeHTML(connection.apiUrl)}" spellcheck="false" required>
          </label>
        </details>
        <button class="remove-model" type="button"${settingsDraft.models.length === 1 ? ' disabled' : ''} aria-label="Remove model ${index + 1}">Remove model</button>
      </section>`;
    }).join('');
  }

  function captureSettingsForm() {
    if (!settingsDraft) return;
    settingsDraft.apiKeys = {
      openai: els.openaiApiKey.value.trim(), openrouter: els.openrouterApiKey.value.trim()
    };
    settingsDraft.models = [...els.modelConfigs.querySelectorAll('[data-model-card]')].map(card => {
      const provider = $('.model-provider', card).value;
      return {
        id: card.dataset.modelId, provider,
        model: $('.model-name-input', card).value.trim() || PROVIDERS[provider].model,
        apiUrl: $('.model-api-url', card).value.trim() || PROVIDERS[provider].apiUrl
      };
    });
    settingsDraft.activeModelId = $('input[name="default-model"]:checked', els.modelConfigs)?.value
      || settingsDraft.models[0]?.id;
  }

  function updateModelCardSelection() {
    const selected = $('input[name="default-model"]:checked', els.modelConfigs)?.value;
    els.modelConfigs.querySelectorAll('[data-model-card]').forEach(card => {
      card.classList.toggle('active', card.dataset.modelId === selected);
    });
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function updateKeyStatus() {
    els.keyStatus.classList.toggle('ready', Boolean(settings.apiKey));
    els.activeModel.textContent = settings.model;
    els.activeProvider.textContent = providerLabel();
    els.activeConnection.title = `${providerLabel()} · ${settings.model} — open settings`;
    els.activeConnection.setAttribute('aria-label', `Current model: ${settings.model} through ${providerLabel()}. Open API settings`);
    const button = $('#open-settings');
    button.title = `${providerLabel()} · ${settings.model}`;
    button.setAttribute('aria-label', `API settings — ${providerLabel()}, ${settings.model}`);
  }

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
    try { localStorage.setItem(THEME_KEY, next); } catch {}
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

  async function openRouterPriceForModel(model) {
    const key = String(model || '').trim();
    if (!key.includes('/')) return null;
    const cached = openRouterPrices[key];
    const validCached = cached && Number.isFinite(Number(cached.input)) && Number.isFinite(Number(cached.output));
    if (validCached && Date.now() - Number(cached.checkedAt) < PRICE_CACHE_TTL) return cached;
    try {
      const path = key.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`https://openrouter.ai/api/v1/model/${path}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) return validCached ? cached : null;
      const pricing = (await response.json()).data?.pricing;
      const prompt = pricing?.prompt == null ? NaN : Number(pricing.prompt);
      const completion = pricing?.completion == null ? NaN : Number(pricing.completion);
      const cacheRead = pricing?.input_cache_read == null ? NaN : Number(pricing.input_cache_read);
      if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return validCached ? cached : null;
      const price = {
        input: prompt * 1_000_000,
        cached: (Number.isFinite(cacheRead) ? cacheRead : prompt) * 1_000_000,
        output: completion * 1_000_000,
        request: Number(pricing?.request) || 0,
        checkedAt: Date.now(),
        source: 'openrouter'
      };
      openRouterPrices[key] = price;
      persistOpenRouterPrices();
      return price;
    } catch { return validCached ? cached : null; }
  }

  async function recordUsage(nodeId, model, apiUrl, rawUsage, provider) {
    if (usageRecords.some(record => record.nodeId === nodeId)) return;
    const inputTokens = Number(rawUsage.input_tokens) || 0;
    const outputTokens = Number(rawUsage.output_tokens) || 0;
    const cachedTokens = Math.min(inputTokens, Number(rawUsage.input_tokens_details?.cached_tokens) || 0);
    const totalTokens = Number(rawUsage.total_tokens) || inputTokens + outputTokens;
    const price = provider === 'openrouter'
      ? await openRouterPriceForModel(model)
      : (isOpenAIEndpoint(apiUrl) ? priceForModel(model) : null);
    const costUSD = price
      ? ((((inputTokens - cachedTokens) * price.input) + (cachedTokens * price.cached) + (outputTokens * price.output)) / 1_000_000) + (Number(price.request) || 0)
      : null;
    usageRecords.push({
      id: uid(), nodeId, timestamp: Date.now(), model: String(model || 'unknown'),
      inputTokens, cachedTokens, outputTokens, totalTokens, costUSD,
      rates: price ? {
        input: price.input, cached: price.cached, output: price.output,
        request: Number(price.request) || 0, source: price.source || 'openai', checkedAt: price.checkedAt || Date.now()
      } : null
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
      ? `${unpriced} request${unpriced === 1 ? '' : 's'} could not be estimated because its model price could not be resolved.`
      : 'Estimates use the rate recorded when each request completed: the local OpenAI table or OpenRouter\'s model-pricing API.';
  }

  function openUsage() {
    renderUsage();
    const openRouter = settings.provider === 'openrouter';
    els.usageDashboard.href = openRouter ? 'https://openrouter.ai/activity' : 'https://platform.openai.com/usage';
    els.usageDashboard.textContent = `${openRouter ? 'OpenRouter' : 'OpenAI'} dashboard ↗`;
    els.usageDialog.showModal();
  }

  function createNewMap() {
    const existingBlank = workspace.maps.find(map => map.nodes.length === 0 && map.attachments.length === 0);
    const map = existingBlank || blankMap();
    if (!existingBlank) workspace.maps.push(map);
    workspace.activeMapId = map.id;
    state = map;
    els.conversationSearch.value = '';
    persistNow();
    renderAll();
    closeHistoryOnSmallScreen();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    els.prompt.focus();
  }

  function switchMap(mapId, nodeId = null) {
    const map = workspace.maps.find(candidate => candidate.id === mapId);
    if (!map) { closeHistoryOnSmallScreen(); return; }
    workspace.activeMapId = map.id;
    state = map;
    state.activeId = nodeId && nodeById(nodeId, state) ? nodeId : (state.nodes.at(-1)?.id || null);
    revealNode(state, state.activeId);
    persistSoon();
    hideSelectionMenu();
    renderAll({ scroll: state.activeId ? (nodeId ? true : 'bottom') : false });
    closeHistoryOnSmallScreen();
  }

  function activateNode(nodeId, scroll = true) {
    if (!nodeById(nodeId)) return;
    state.activeId = nodeId;
    revealNode(state, nodeId);
    persistSoon();
    renderAll({ scroll });
    document.body.classList.remove('map-open');
  }

  function visibleTreeNodeIds() {
    return [...els.tree.querySelectorAll('.tree-node')].map(button => button.dataset.nodeId);
  }

  function moveVisibleNode(offset) {
    const ids = visibleTreeNodeIds();
    if (!ids.length) return;
    const current = Math.max(0, ids.indexOf(state.activeId));
    activateNode(ids[Math.max(0, Math.min(ids.length - 1, current + offset))]);
  }

  function moveMap(offset) {
    const maps = workspace.maps
      .filter(map => map.nodes.length || map.attachments.length)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (!maps.length) return;
    const current = Math.max(0, maps.findIndex(map => map.id === state.id));
    switchMap(maps[Math.max(0, Math.min(maps.length - 1, current + offset))].id);
  }

  function focusConversationSearch() {
    document.body.classList.remove('history-collapsed', 'map-open');
    if (matchMedia('(max-width: 1100px)').matches) document.body.classList.add('history-open');
    updateHistoryToggle();
    els.conversationSearch.focus();
    els.conversationSearch.select();
  }

  function handleVimNavigation(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const editable = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (editable) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (editable === els.conversationSearch) clearSearch();
        editable.blur();
      }
      return;
    }
    if ($('dialog[open]')) return;
    if (pendingG && event.key !== 'g') {
      clearTimeout(pendingGTimer);
      pendingG = false;
    }
    if (event.key === '?') { event.preventDefault(); els.shortcutsDialog.showModal(); return; }
    if (event.key === '/') { event.preventDefault(); focusConversationSearch(); return; }
    if (event.key === 'i') { event.preventDefault(); els.prompt.focus(); return; }
    if (event.key === 'j') { event.preventDefault(); moveVisibleNode(1); return; }
    if (event.key === 'k') { event.preventDefault(); moveVisibleNode(-1); return; }
    if (event.key === 'J') { event.preventDefault(); moveMap(1); return; }
    if (event.key === 'K') { event.preventDefault(); moveMap(-1); return; }
    if (event.key === 'h') {
      const parentId = nodeById(state.activeId)?.parentId;
      if (parentId) { event.preventDefault(); activateNode(parentId); }
      return;
    }
    if (event.key === 'l') {
      const children = childrenOf(state.activeId);
      if (!children.length) return;
      event.preventDefault();
      if (state.collapsedIds.includes(state.activeId)) toggleSubtree(state.activeId, false);
      else activateNode(children[0].id);
      return;
    }
    if (event.key === ' ') {
      if (childrenOf(state.activeId).length) { event.preventDefault(); toggleSubtree(state.activeId); }
      return;
    }
    if (event.key === 'G') {
      const ids = visibleTreeNodeIds();
      if (ids.length) { event.preventDefault(); activateNode(ids.at(-1)); }
      return;
    }
    if (event.key === 'g') {
      event.preventDefault();
      if (pendingG) {
        clearTimeout(pendingGTimer);
        pendingG = false;
        const ids = visibleTreeNodeIds();
        if (ids.length) activateNode(ids[0]);
      } else {
        pendingG = true;
        pendingGTimer = setTimeout(() => { pendingG = false; }, 900);
      }
    }
  }

  function closeHistoryOnSmallScreen() {
    if (matchMedia('(max-width: 1100px)').matches) document.body.classList.remove('history-open');
    updateHistoryToggle();
  }

  function updateHistoryToggle() {
    const small = matchMedia('(max-width: 1100px)').matches;
    const open = small ? document.body.classList.contains('history-open') : !document.body.classList.contains('history-collapsed');
    els.historyToggle.setAttribute('aria-expanded', String(open));
  }

  function toggleHistory() {
    if (matchMedia('(max-width: 1100px)').matches) {
      document.body.classList.remove('history-collapsed');
      document.body.classList.toggle('history-open');
      if (document.body.classList.contains('history-open')) document.body.classList.remove('map-open');
    } else document.body.classList.toggle('history-collapsed');
    updateHistoryToggle();
  }

  function clearChatHistory(message = 'Clear all saved conversations? Your API key and usage records will be kept. Uploaded API files will not be deleted.') {
    if (!workspace.maps.some(map => map.nodes.length || map.attachments.length)) { showToast('Chat history is already empty'); return false; }
    if (!confirm(message)) return false;
    if (activeRequest) activeRequest.abort();
    const map = blankMap();
    workspace = { version: 2, maps: [map], activeMapId: map.id };
    state = map;
    searchIndex = null;
    els.conversationSearch.value = '';
    persistNow();
    renderAll();
    showToast('All conversations cleared');
    return true;
  }

  function deleteMap(mapId) {
    const map = workspace.maps.find(candidate => candidate.id === mapId);
    if (!map) return;
    if (uploadingFiles && uploadTargetMapId === map.id) { showToast('Wait for this map’s file upload to finish'); return; }
    const remoteNote = map.attachments.length ? ' Uploaded API files will not be deleted.' : '';
    if (!confirm(`Delete “${map.title}” and its entire conversation? This cannot be undone.${remoteNote}`)) return;
    if (activeRequest && map.nodes.some(node => node.status === 'loading')) activeRequest.abort();

    workspace.maps = workspace.maps.filter(candidate => candidate.id !== map.id);
    searchIndex = null;
    if (!workspace.maps.length) workspace.maps.push(blankMap());
    if (state === map) {
      const next = [...workspace.maps]
        .filter(candidate => candidate.nodes.length || candidate.attachments.length)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] || workspace.maps[0];
      workspace.activeMapId = next.id;
      state = next;
      state.activeId = state.nodes.at(-1)?.id || null;
      revealNode(state, state.activeId);
    }
    persistNow();
    renderAll({ scroll: state.activeId ? 'bottom' : false });
    showToast('Conversation deleted');
  }

  function renameMap(mapId) {
    const map = workspace.maps.find(candidate => candidate.id === mapId);
    if (!map) return;
    const value = prompt('Rename this conversation. Leave blank to restore its automatic title.', map.title);
    if (value === null) return;
    const title = value.replace(/\s+/g, ' ').trim();
    if (title) {
      map.title = title.slice(0, 120);
      map.titleCustom = true;
    } else {
      map.titleCustom = false;
      refreshMapTitle(map);
    }
    touchMap(map);
    persistNow();
    renderHistory();
    showToast(title ? 'Conversation renamed' : 'Automatic title restored');
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
    const historyItem = event.target.closest('.history-item');
    if (historyItem) { switchMap(historyItem.dataset.mapId); return; }
    const searchResult = event.target.closest('.search-result');
    if (searchResult) {
      const { mapId, nodeId } = searchResult.dataset;
      clearSearch();
      switchMap(mapId, nodeId || null);
      return;
    }
    const renameConversation = event.target.closest('.rename-map');
    if (renameConversation) { renameMap(renameConversation.dataset.mapId); return; }
    const deleteConversation = event.target.closest('.delete-map');
    if (deleteConversation) { deleteMap(deleteConversation.dataset.mapId); return; }
    const removeFile = event.target.closest('.remove-attachment');
    if (removeFile) { removeAttachment(removeFile.dataset.fileId); return; }
    const subtreeToggle = event.target.closest('.toggle-subtree');
    if (subtreeToggle) { toggleSubtree(subtreeToggle.dataset.nodeId); return; }
    const treeNode = event.target.closest('.tree-node');
    if (treeNode) { activateNode(treeNode.dataset.nodeId); return; }
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
  els.activeConnection.addEventListener('click', openSettings);
  $('#open-usage').addEventListener('click', openUsage);
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#toggle-history').addEventListener('click', toggleHistory);
  els.conversationSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearchResults, 110);
  });
  els.conversationSearch.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const first = $('.search-result', els.searchResults);
    if (first) { event.preventDefault(); first.click(); }
  });
  $('#study-lab-home').addEventListener('click', event => { event.preventDefault(); createNewMap(); });
  $('#new-map-sidebar').addEventListener('click', createNewMap);
  els.uploadFile.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => uploadFiles(els.fileInput.files));
  $('#close-settings').addEventListener('click', () => els.settings.close());
  els.settings.addEventListener('close', () => { settingsDraft = null; });
  $('#close-usage').addEventListener('click', () => els.usageDialog.close());
  $('#open-shortcuts').addEventListener('click', () => els.shortcutsDialog.showModal());
  $('#close-shortcuts').addEventListener('click', () => els.shortcutsDialog.close());
  $('#expand-all-nodes').addEventListener('click', () => setAllSubtrees(false));
  $('#collapse-all-nodes').addEventListener('click', () => setAllSubtrees(true));
  $('#zoom-out-tree').addEventListener('click', () => updateTreeZoom(-.1));
  $('#zoom-in-tree').addEventListener('click', () => updateTreeZoom(.1));
  $('#reset-usage').addEventListener('click', () => {
    if (!usageRecords.length || confirm('Reset the locally tracked API usage history? This cannot be undone.')) {
      usageRecords = [];
      localStorage.removeItem(USAGE_KEY);
      updateUsageButton();
      renderUsage();
      showToast('Local usage history reset');
    }
  });
  document.querySelectorAll('.toggle-key').forEach(button => button.addEventListener('click', event => {
    const input = document.getElementById(event.currentTarget.dataset.keyInput);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    event.currentTarget.textContent = show ? 'Hide' : 'Show';
    event.currentTarget.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${input.id === 'openrouter-api-key' ? 'OpenRouter' : 'OpenAI'} API key`);
  }));
  $('#add-model').addEventListener('click', () => {
    captureSettingsForm();
    const id = uid();
    settingsDraft.models.push({ id, provider: 'openai', model: PROVIDERS.openai.model, apiUrl: PROVIDERS.openai.apiUrl });
    renderModelCards();
    $('.model-name-input', els.modelConfigs.lastElementChild)?.focus();
  });
  els.modelConfigs.addEventListener('change', event => {
    if (event.target.matches('.default-model-radio')) { updateModelCardSelection(); return; }
    if (!event.target.matches('.model-provider')) return;
    const card = event.target.closest('[data-model-card]');
    const previousProvider = card.dataset.provider;
    const provider = event.target.value;
    captureSettingsForm();
    const connection = settingsDraft.models.find(model => model.id === card.dataset.modelId);
    if (connection.model === PROVIDERS[previousProvider].model) connection.model = PROVIDERS[provider].model;
    if (connection.apiUrl === PROVIDERS[previousProvider].apiUrl) connection.apiUrl = PROVIDERS[provider].apiUrl;
    connection.provider = provider;
    renderModelCards();
  });
  els.modelConfigs.addEventListener('click', event => {
    const button = event.target.closest('.remove-model');
    if (!button || button.disabled) return;
    const id = button.closest('[data-model-card]').dataset.modelId;
    captureSettingsForm();
    settingsDraft.models = settingsDraft.models.filter(model => model.id !== id);
    if (settingsDraft.activeModelId === id) settingsDraft.activeModelId = settingsDraft.models[0].id;
    renderModelCards();
  });
  $('#settings-form').addEventListener('submit', event => {
    event.preventDefault();
    captureSettingsForm();
    settings = normalizeSettings({ ...settingsDraft, systemPrompt: els.systemPrompt.value.trim() });
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    settingsDraft = null;
    updateKeyStatus(); renderAttachments(); els.settings.close(); showToast(`${providerLabel()} settings saved`);
  });
  $('#clear-history').addEventListener('click', () => clearChatHistory());
  $('#clear-branch').addEventListener('click', () => { state.activeId = state.nodes.at(-1)?.id || null; revealNode(state, state.activeId); persistSoon(); renderAll({ scroll: true }); });
  $('#collapse-map').addEventListener('click', () => { document.body.classList.remove('map-open'); document.body.classList.add('map-collapsed'); $('#expand-map').hidden = false; });
  $('#expand-map').addEventListener('click', () => { document.body.classList.remove('map-collapsed', 'history-open'); document.body.classList.add('map-open'); $('#expand-map').hidden = true; updateHistoryToggle(); });
  addEventListener('resize', updateHistoryToggle, { passive: true });
  document.addEventListener('keydown', handleVimNavigation);

  updateKeyStatus();
  updateThemeButton();
  updateUsageButton();
  updateHistoryToggle();
  updateTreeZoom();
  state.activeId = state.nodes.at(-1)?.id || null;
  revealNode(state, state.activeId);
  renderAll();
})();
