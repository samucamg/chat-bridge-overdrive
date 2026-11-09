import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CopilotDriver, COPILOT_SELECTORS } from '../src/drivers/copilot.mjs';
import { MetaDriver, META_SELECTORS } from '../src/drivers/meta.mjs';
import { BaseDriver } from '../src/drivers/base.mjs';
import { DRIVERS, PROVIDER_NAMES, normalizeProvider, getDriver } from '../src/doctor.mjs';
import { createBridgeServer, ALL_MCP_TOOLS } from '../src/server.mjs';
import { ProviderQueueManager } from '../src/queue.mjs';
import { MetadataLogger } from '../src/logger.mjs';
import { ERROR_CODES } from '../src/errors.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createMockPageFromHtml(html, url = 'https://copilot.cloud.microsoft/chat', customFetch = null) {
  class MockNode {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.attributes = {};
      this.children = [];
      this.parent = null;
      this.dataset = {};
      this._textContent = '';
      this._value = '';
      this.focused = false;
      this.clicked = false;
      this.disabled = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.width = 0;
      this.height = 0;
      this.complete = true;
    }
    getAttribute(name) {
      return this.attributes[name.toLowerCase()] ?? null;
    }
    setAttribute(name, val) {
      const lower = name.toLowerCase();
      this.attributes[lower] = String(val);
      if (lower.startsWith('data-')) {
        const camel = lower.slice(5).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
        this.dataset[camel] = String(val);
      }
    }
    get id() {
      return this.attributes['id'] || '';
    }
    get className() {
      return this.attributes['class'] || '';
    }
    get classList() {
      const classes = (this.attributes['class'] || '').split(/\s+/).filter(Boolean);
      return {
        contains: (c) => classes.includes(c)
      };
    }
    get textContent() {
      if (this.children.length === 0) return this._textContent;
      return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
    }
    set textContent(val) {
      this.children = [];
      this._textContent = String(val);
    }
    get value() {
      return this._value || this.attributes['value'] || '';
    }
    set value(v) {
      this._value = String(v);
    }
    get isContentEditable() {
      return this.getAttribute('contenteditable') === 'true';
    }
    get src() {
      return this.attributes['src'] || '';
    }
    set src(val) {
      this.attributes['src'] = String(val);
    }
    get currentSrc() {
      return this.src;
    }
    get style() {
      const rawStyle = this.attributes['style'] || '';
      const isNone = /display\s*:\s*none/i.test(rawStyle);
      const isHidden = /visibility\s*:\s*hidden/i.test(rawStyle);
      return {
        display: isNone ? 'none' : 'block',
        visibility: isHidden ? 'hidden' : 'visible',
        opacity: '1'
      };
    }
    focus() {
      this.focused = true;
      documentMock.activeElement = this;
    }
    click() {
      this.clicked = true;
    }
    dispatchEvent(event) {
      return true;
    }
    remove() {
      if (this.parent) {
        const idx = this.parent.children.indexOf(this);
        if (idx !== -1) {
          this.parent.children.splice(idx, 1);
        }
      }
    }
    cloneNode(deep = true) {
      const copy = new MockNode(this.tagName);
      copy.attributes = { ...this.attributes };
      copy.dataset = { ...this.dataset };
      copy._textContent = this._textContent;
      copy._value = this._value;
      copy.naturalWidth = this.naturalWidth;
      copy.naturalHeight = this.naturalHeight;
      copy.width = this.width;
      copy.height = this.height;
      copy.complete = this.complete;
      for (const k of Object.keys(this)) {
        if (k.startsWith('__reactProps$')) {
          copy[k] = this[k];
        }
      }
      if (deep) {
        copy.children = this.children.map((c) => {
          if (typeof c === 'string') return c;
          const childCopy = c.cloneNode(true);
          childCopy.parent = copy;
          return childCopy;
        });
      }
      return copy;
    }
    closest(selector) {
      let curr = this;
      while (curr && curr.tagName !== 'HTML') {
        if (matchesSimple(curr, selector)) return curr;
        curr = curr.parent;
      }
      return null;
    }
    querySelectorAll(selector) {
      return querySelectorAll(this, selector);
    }
    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    }
  }

  function parseHTML(str) {
    const root = new MockNode('HTML');
    const stack = [root];
    const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9_-]+)([^>]*?)(\/)?>|([^<]+)/g;
    let match;
    while ((match = tagRegex.exec(str)) !== null) {
      if (match[0].startsWith('<!--')) continue;
      if (match[5]) {
        const text = match[5];
        if (text) {
          stack[stack.length - 1].children.push(text);
        }
        continue;
      }
      const isClosing = Boolean(match[1]);
      const tagName = match[2];
      const rawAttrs = match[3] || '';
      const isSelfClosing =
        Boolean(match[4]) ||
        ['META', 'LINK', 'INPUT', 'IMG', 'BR', 'HR', 'PATH', 'USE', 'RECT', 'SVG'].includes(tagName.toUpperCase());

      if (isClosing) {
        if (stack.length > 1) {
          stack.pop();
        }
      } else {
        const el = new MockNode(tagName);
        const attrRegex = /([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let aMatch;
        while ((aMatch = attrRegex.exec(rawAttrs)) !== null) {
          const aName = aMatch[1];
          const aVal = aMatch[2] ?? aMatch[3] ?? aMatch[4] ?? '';
          el.setAttribute(aName, aVal);
        }
        const parent = stack[stack.length - 1];
        el.parent = parent;
        parent.children.push(el);
        if (!isSelfClosing) {
          stack.push(el);
        }
      }
    }
    return root;
  }

  function matchesSimple(el, sel) {
    if (typeof el === 'string' || !el || !el.tagName) return false;
    let s = sel.trim();
    if (!s) return false;

    const notMatch = s.match(/:not\(([^)]+)\)/);
    if (notMatch) {
      const inner = notMatch[1];
      const rest = s.replace(notMatch[0], '');
      if (matchesSimple(el, inner)) return false;
      if (rest) return matchesSimple(el, rest);
      return true;
    }

    const hasMatch = s.match(/:has\(([^)]+)\)/);
    if (hasMatch) {
      const inner = hasMatch[1];
      const rest = s.replace(hasMatch[0], '');
      const sub = el.querySelectorAll(inner);
      if (sub.length === 0) return false;
      if (rest) return matchesSimple(el, rest);
      return true;
    }

    const tagMatch = s.match(/^([a-zA-Z0-9_-]+)/);
    if (tagMatch) {
      if (el.tagName !== tagMatch[1].toUpperCase()) return false;
      s = s.slice(tagMatch[1].length);
    }

    const idMatch = s.match(/^#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      if (el.id !== idMatch[1]) return false;
      s = s.slice(idMatch[0].length);
    }

    while (s.startsWith('.')) {
      const cMatch = s.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!cMatch) break;
      if (!el.classList.contains(cMatch[1])) return false;
      s = s.slice(cMatch[0].length);
    }

    while (s.startsWith('[')) {
      const aMatch = s.match(/^\[([a-zA-Z0-9_-]+)(?:([*^$]?=)(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/);
      if (!aMatch) break;
      const attrName = aMatch[1].toLowerCase();
      const op = aMatch[2] || '';
      const expected = aMatch[3] ?? aMatch[4] ?? aMatch[5] ?? '';

      const actual = el.getAttribute(attrName);
      if (actual === null) return false;

      if (op === '=') {
        if (actual !== expected) return false;
      } else if (op === '*=') {
        if (!actual.includes(expected)) return false;
      } else if (op === '^=') {
        if (!actual.startsWith(expected)) return false;
      } else if (op === '$=') {
        if (!actual.endsWith(expected)) return false;
      }
      s = s.slice(aMatch[0].length);
    }

    return true;
  }

  function splitSelectorParts(sub) {
    const parts = [];
    let current = '';
    let inBracket = false;
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < sub.length; i++) {
      const ch = sub[i];
      if ((ch === '"' || ch === "'") && inBracket) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = ch;
        } else if (ch === quoteChar) {
          inQuotes = false;
        }
      } else if (ch === '[' && !inQuotes) {
        inBracket = true;
      } else if (ch === ']' && !inQuotes) {
        inBracket = false;
      }

      if (/\s/.test(ch) && !inBracket && !inQuotes) {
        if (current.trim()) {
          parts.push(current.trim());
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current.trim()) {
      parts.push(current.trim());
    }
    return parts;
  }

  function querySelectorAll(node, selector) {
    const results = [];
    const subSelectors = selector.split(',').map((s) => s.trim()).filter(Boolean);

    for (const sub of subSelectors) {
      const parts = splitSelectorParts(sub);

      function search(current, partIndex) {
        if (partIndex >= parts.length) return;
        const targetPart = parts[partIndex];
        const isLast = partIndex === parts.length - 1;

        for (const child of current.children) {
          if (typeof child === 'string') continue;
          if (matchesSimple(child, targetPart)) {
            if (isLast) {
              if (!results.includes(child)) results.push(child);
            } else {
              search(child, partIndex + 1);
            }
          }
          search(child, partIndex);
        }
      }

      search(node, 0);
    }
    return results;
  }

  const root = parseHTML(html);

  const documentMock = {
    body: root,
    documentElement: root,
    activeElement: null,
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    createElement: (tag) => {
      if (tag.toLowerCase() === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: () => {} }),
          toDataURL: () => 'data:image/png;base64,QUJDRA=='
        };
      }
      return new MockNode(tag);
    },
    execCommand: (cmd, showUi, val) => true,
    dispatchEvent: () => {}
  };

  const windowMock = {
    location: new URL(url),
    origin: new URL(url).origin,
    document: documentMock,
    getComputedStyle: (el) => el.style || { display: 'block', visibility: 'visible', opacity: '1' },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    KeyboardEvent: class {
      constructor(type, opts) {
        this.type = type;
        Object.assign(this, opts);
      }
    }
  };

  const page = {
    _targetId: 'mock-target-' + Math.random().toString(36).slice(2, 7),
    url: () => url,
    evaluate: async (fn, ...args) => {
      const prevDoc = globalThis.document;
      const prevWin = globalThis.window;
      const prevEv = globalThis.Event;
      const prevKb = globalThis.KeyboardEvent;
      const prevFetch = globalThis.fetch;
      try {
        globalThis.document = documentMock;
        globalThis.window = windowMock;
        globalThis.Event = windowMock.Event;
        globalThis.KeyboardEvent = windowMock.KeyboardEvent;
        if (customFetch) {
          globalThis.fetch = customFetch;
        }

        if (typeof fn === 'function') {
          return await fn(...args);
        }
        return null;
      } finally {
        globalThis.document = prevDoc;
        globalThis.window = prevWin;
        globalThis.Event = prevEv;
        globalThis.KeyboardEvent = prevKb;
        globalThis.fetch = prevFetch;
      }
    },
    keyboard: {
      press: async () => {}
    }
  };

  return { page, root, document: documentMock };
}

test('1. DRIVERS e PROVIDER_NAMES contem copilot e meta, e ALL_MCP_TOOLS expoem ask_copilot e ask_meta bilingues sem provider no schema', () => {
  assert.ok(DRIVERS.copilot instanceof CopilotDriver, 'DRIVERS.copilot deve ser instancia de CopilotDriver');
  assert.ok(DRIVERS.meta instanceof MetaDriver, 'DRIVERS.meta deve ser instancia de MetaDriver');
  assert.ok(PROVIDER_NAMES.includes('copilot'), 'PROVIDER_NAMES deve incluir copilot');
  assert.ok(PROVIDER_NAMES.includes('meta'), 'PROVIDER_NAMES deve incluir meta');

  const names = ALL_MCP_TOOLS.map((t) => t.name);
  assert.ok(names.includes('ask_copilot'), 'ALL_MCP_TOOLS deve expor ask_copilot');
  assert.ok(names.includes('ask_meta'), 'ALL_MCP_TOOLS deve expor ask_meta');

  const askCopilot = ALL_MCP_TOOLS.find((t) => t.name === 'ask_copilot');
  assert.match(askCopilot.description, /Copilot/i);
  assert.match(askCopilot.description, /pergunte ao Copilot/i);
  assert.equal(askCopilot.inputSchema.properties.provider, undefined, 'ask_copilot nao deve pedir provider no schema');
  assert.ok(askCopilot.inputSchema.properties.prompt, 'ask_copilot exige prompt');

  const askMeta = ALL_MCP_TOOLS.find((t) => t.name === 'ask_meta');
  assert.match(askMeta.description, /Meta AI/i);
  assert.match(askMeta.description, /pergunte ao Meta AI/i);
  assert.equal(askMeta.inputSchema.properties.provider, undefined, 'ask_meta nao deve pedir provider no schema');
  assert.ok(askMeta.inputSchema.properties.prompt, 'ask_meta exige prompt');
});

test('2. normalizeProvider converte todos os apelidos do Copilot para copilot', () => {
  const aliases = [
    'Microsoft Copilot',
    'copilot.cloud.microsoft',
    'copilot.microsoft.com',
    'ms-copilot',
    'Bing Chat',
    'copilot',
    'copilot web',
    'COPILOT'
  ];
  for (const alias of aliases) {
    assert.equal(normalizeProvider(alias), 'copilot', `Apelido "${alias}" deve normalizar para "copilot"`);
  }
});

test('3. normalizeProvider converte todos os apelidos de Meta AI para meta', () => {
  const aliases = [
    'Meta AI',
    'meta.ai',
    'Meta AI Web',
    'llama',
    'meta',
    'Meta',
    'meta-ai',
    'metaaichat'
  ];
  for (const alias of aliases) {
    assert.equal(normalizeProvider(alias), 'meta', `Apelido "${alias}" deve normalizar para "meta"`);
  }
});

test('4. CopilotDriver.matchesUrl aceita dominios do Copilot e rejeita dominios alheios', () => {
  const driver = new CopilotDriver();
  assert.equal(driver.matchesUrl('https://copilot.cloud.microsoft/chat'), true);
  assert.equal(driver.matchesUrl('https://copilot.microsoft.com/'), true);
  assert.equal(driver.matchesUrl('https://m365.cloud.microsoft/chat'), true);
  assert.equal(driver.matchesUrl('https://sub.copilot.cloud.microsoft/page'), true);
  assert.equal(driver.matchesUrl('https://google.com'), false);
  assert.equal(driver.matchesUrl('https://openai.com'), false);
  assert.equal(driver.matchesUrl('https://meta.ai'), false);
  assert.equal(driver.matchesUrl(null), false);
  assert.equal(driver.matchesUrl(''), false);
});

test('5. MetaDriver.matchesUrl aceita dominios do Meta AI e rejeita dominios alheios', () => {
  const driver = new MetaDriver();
  assert.equal(driver.matchesUrl('https://meta.ai/'), true);
  assert.equal(driver.matchesUrl('https://www.meta.ai/prompt/123'), true);
  assert.equal(driver.matchesUrl('https://sub.meta.ai/chat'), true);
  assert.equal(driver.matchesUrl('https://facebook.com'), false);
  assert.equal(driver.matchesUrl('https://instagram.com'), false);
  assert.equal(driver.matchesUrl('https://copilot.microsoft.com'), false);
  assert.equal(driver.matchesUrl(null), false);
  assert.equal(driver.matchesUrl(''), false);
});

test('6. CopilotDriver - isLoggedIn retorna true na fixture copilot.html e false em URLs de login', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'copilot.html'), 'utf8');
  const { page: loggedInPage } = createMockPageFromHtml(html, 'https://copilot.cloud.microsoft/chat');
  const driver = new CopilotDriver();

  assert.equal(await driver.isLoggedIn(loggedInPage), true, 'Deve estar logado na fixture');

  const { page: loginOnlinePage } = createMockPageFromHtml(html, 'https://login.microsoftonline.com/common/oauth2');
  assert.equal(await driver.isLoggedIn(loginOnlinePage), false, 'Deve detectar URL login.microsoftonline.com como deslogado');

  const { page: loginLivePage } = createMockPageFromHtml(html, 'https://login.live.com/login.srf');
  assert.equal(await driver.isLoggedIn(loginLivePage), false, 'Deve detectar URL login.live.com como deslogado');
});

test('7. CopilotDriver - diagnose sobre fixtures/copilot.html resolve seletores em level1 com confianca Alta', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'copilot.html'), 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://copilot.cloud.microsoft/chat');
  const driver = new CopilotDriver();

  const diagnosis = await driver.diagnose(page);
  assert.equal(diagnosis.provider, 'copilot');
  assert.equal(diagnosis.healthy, true);
  assert.equal(diagnosis.loggedIn, true);

  assert.equal(diagnosis.selectors.input.level, 'level1');
  assert.equal(diagnosis.selectors.input.confidence, 'Alta');
  assert.ok(diagnosis.selectors.input.count > 0, 'input deve ser encontrado');

  assert.equal(diagnosis.selectors.sendBtn.level, 'level1');
  assert.equal(diagnosis.selectors.sendBtn.confidence, 'Alta');
  assert.ok(diagnosis.selectors.sendBtn.count > 0, 'sendBtn deve ser encontrado');

  assert.equal(diagnosis.selectors.response.level, 'level1');
  assert.equal(diagnosis.selectors.response.confidence, 'Alta');
  assert.ok(diagnosis.selectors.response.count > 0, 'response deve ser encontrado');

  assert.equal(diagnosis.selectors.citations.level, 'level1');
  assert.equal(diagnosis.selectors.citations.confidence, 'Alta');
  assert.ok(diagnosis.selectors.citations.count > 0, 'citations deve ser encontrado');

  assert.equal(diagnosis.selectors.newChatBtn.level, 'level1');
  assert.equal(diagnosis.selectors.newChatBtn.confidence, 'Alta');
  assert.ok(diagnosis.selectors.newChatBtn.count > 0, 'newChatBtn deve ser encontrado');
});

test('8. CopilotDriver - extractAnswer extrai ultimo turno, filtra acessibleHeading/Suggestion e preserva citacoes legitimas', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'copilot.html'), 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://copilot.cloud.microsoft/chat');
  const driver = new CopilotDriver();

  const answer = await driver.extractAnswer(page);

  assert.ok(answer.text.includes('Resposta final do Microsoft Copilot sobre HTTP/3.'));
  assert.equal(answer.text.includes('Resposta inicial do Microsoft Copilot sobre HTTP/2.'), false, 'Nao deve conter turno anterior');
  assert.equal(answer.text.includes('Copilot said:'), false, 'Deve filtrar heading acessivel');
  assert.equal(answer.text.includes('Sugestao extra'), false, 'Deve filtrar sugestao extra');

  assert.ok(answer.sources.length >= 2, 'Deve encontrar pelo menos 2 citacoes');
  const rfcSource = answer.sources.find((s) => s.url.includes('rfc9114'));
  assert.ok(rfcSource, 'Deve preservar citacao RFC 9114');

  const msSource = answer.sources.find((s) => s.url.includes('learn.microsoft.com'));
  assert.ok(msSource, 'Deve preservar citacao legitima da Microsoft (learn.microsoft.com)');
});

test('9. CopilotDriver - send limpa rascunho, injeta texto via CDP e nunca usa seletor level3 para envio', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'copilot.html'), 'utf8');
  const { page, document } = createMockPageFromHtml(html, 'https://copilot.cloud.microsoft/chat');
  const driver = new CopilotDriver();

  const editor = document.querySelector('#m365-chat-editor-target-element');
  editor.textContent = 'rascunho anterior a ser limpo';

  let cdpInjectedText = null;
  const mockCdpManager = {
    insertTextViaCDP: async (_page, text) => {
      cdpInjectedText = text;
      editor.textContent = text;
    }
  };

  const level3 = driver.selectors.sendBtn.level3.selector;
  assert.ok(level3, 'Level 3 deve existir');

  const clickedSelectors = [];
  const origEval = page.evaluate;
  page.evaluate = async (fn, ...args) => {
    if (args.length > 0 && typeof args[0] === 'string') {
      clickedSelectors.push(args[0]);
    }
    return origEval(fn, ...args);
  };

  await driver.send(page, 'Prompt de teste HTTP/3', mockCdpManager);

  assert.equal(cdpInjectedText, 'Prompt de teste HTTP/3', 'Deve injetar prompt via CDP');
  assert.equal(
    clickedSelectors.some((s) => s.includes(level3)),
    false,
    'Nunca deve usar seletor level3 (Baixa) para envio'
  );
});

test('10. MetaDriver - isLoggedIn retorna true na fixture meta.html e false com modal de login sem editor', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'meta.html'), 'utf8');
  const { page: loggedInPage } = createMockPageFromHtml(html, 'https://www.meta.ai/');
  const driver = new MetaDriver();

  assert.equal(await driver.isLoggedIn(loggedInPage), true, 'Deve retornar true na fixture autenticada');

  const loggedOutHtml = `
    <html>
      <body>
        <div class="login-prompt">
          <a href="https://facebook.com/login" aria-label="Log in">Log in</a>
        </div>
      </body>
    </html>
  `;
  const { page: loggedOutPage } = createMockPageFromHtml(loggedOutHtml, 'https://www.meta.ai/');
  assert.equal(await driver.isLoggedIn(loggedOutPage), false, 'Deve retornar false quando ha modal de login sem editor');
});

test('11. MetaDriver - diagnose sobre fixtures/meta.html resolve seletores em level1 com confianca Alta', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'meta.html'), 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://www.meta.ai/');
  const driver = new MetaDriver();

  const diagnosis = await driver.diagnose(page);
  assert.equal(diagnosis.provider, 'meta');
  assert.equal(diagnosis.healthy, true);
  assert.equal(diagnosis.loggedIn, true);

  assert.equal(diagnosis.selectors.input.level, 'level1');
  assert.equal(diagnosis.selectors.input.confidence, 'Alta');
  assert.ok(diagnosis.selectors.input.count > 0, 'input deve ser encontrado');

  assert.equal(diagnosis.selectors.sendBtn.level, 'level1');
  assert.equal(diagnosis.selectors.sendBtn.confidence, 'Alta');
  assert.ok(diagnosis.selectors.sendBtn.count > 0, 'sendBtn deve ser encontrado');

  assert.equal(diagnosis.selectors.response.level, 'level1');
  assert.equal(diagnosis.selectors.response.confidence, 'Alta');
  assert.ok(diagnosis.selectors.response.count > 0, 'response deve ser encontrado');

  assert.equal(diagnosis.selectors.citations.level, 'level1');
  assert.equal(diagnosis.selectors.citations.confidence, 'Alta');
  assert.ok(diagnosis.selectors.citations.count > 0, 'citations deve ser encontrado');

  assert.equal(diagnosis.selectors.newChatBtn.level, 'level1');
  assert.equal(diagnosis.selectors.newChatBtn.confidence, 'Alta');
  assert.ok(diagnosis.selectors.newChatBtn.count > 0, 'newChatBtn deve ser encontrado');
});

test('12. MetaDriver - extractAnswer remove thinking-status e pre button, preserva codigo e extrai data-citation-urls', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'meta.html'), 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://www.meta.ai/');
  const driver = new MetaDriver();

  const answer = await driver.extractAnswer(page);

  assert.ok(answer.text.includes('Resposta final do Meta AI sobre HTTP/3.'));
  assert.ok(answer.text.includes("const http = require('http');"), 'Deve preservar bloco de codigo');
  assert.equal(answer.text.includes('Mostrar raciocinio'), false, 'Deve filtrar thinking-status');
  assert.equal(answer.text.includes('Copiar'), false, 'Deve filtrar botao Copiar do pre');

  assert.equal(answer.sources.length, 1);
  assert.equal(answer.sources[0].url, 'https://datatracker.ietf.org/doc/html/rfc9114');
  assert.equal(answer.sources[0].title, 'rfc9114');

  const jsonCitationHtml = `
    <div data-testid="assistant-message">
      <div class="ur-markdown">
        <p>Texto com multiplas citacoes em JSON.</p>
        <a data-testid="citation-pill" data-citation-urls='["https://example.com/alpha", "https://example.com/beta"]' title="Fontes">docs</a>
      </div>
    </div>
  `;
  const { page: jsonPage } = createMockPageFromHtml(jsonCitationHtml, 'https://www.meta.ai/');
  const jsonAnswer = await driver.extractAnswer(jsonPage);
  assert.equal(jsonAnswer.sources.length, 2);
  assert.equal(jsonAnswer.sources[0].url, 'https://example.com/alpha');
  assert.equal(jsonAnswer.sources[1].url, 'https://example.com/beta');
});

test('13. BaseDriver.extractImages le URL via __reactProps$ sem mutar o atributo img.src no DOM vivo', async () => {
  const html = `
    <div data-testid="assistant-message">
      <div class="group/media-post-card">
        <img data-testid="ur-image-tile" src="" alt="Imagem gerada" width="512" height="512">
      </div>
    </div>
  `;

  let fetchedUrl = null;
  const mockFetch = async (url) => {
    fetchedUrl = url;
    return {
      ok: true,
      blob: async () => ({
        arrayBuffer: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).buffer
      })
    };
  };

  const { page, document } = createMockPageFromHtml(html, 'https://www.meta.ai/', mockFetch);
  const imgEl = document.querySelector('img[data-testid="ur-image-tile"]');
  imgEl.naturalWidth = 512;
  imgEl.naturalHeight = 512;
  imgEl.__reactProps$test123 = {
    src: 'https://scontent.xx.fbcdn.net/v/t39.30808-6/image.png'
  };

  const driver = new MetaDriver();
  const images = await driver.extractImages(page);

  assert.equal(imgEl.getAttribute('src'), '', 'O atributo img.src no DOM vivo NAO deve ter sido mutado');
  assert.equal(fetchedUrl, 'https://scontent.xx.fbcdn.net/v/t39.30808-6/image.png', 'Deve ter lido a URL via __reactProps$');
  assert.equal(images.length, 1);
  assert.equal(images[0].index, 1);
  assert.equal(images[0].mimeType, 'image/png');
  assert.ok(images[0].bytes > 0);
});

test('14. Servidor MCP - ask_copilot roteia para o driver certo e bloqueia segredos via sanitizador', async () => {
  let promptSent = null;
  const mockDriver = {
    provider: 'copilot',
    defaultModel: 'copilot-web',
    ensureTab: async () => ({ url: () => 'https://copilot.cloud.microsoft/chat' }),
    isLoggedIn: async () => true,
    newChat: async () => {},
    send: async (_page, prompt) => {
      promptSent = prompt;
    },
    waitDone: async () => true,
    extractAnswer: async () => ({
      text: 'Resposta autoritativa do Copilot.',
      sources: [{ title: 'RFC 9114', url: 'https://datatracker.ietf.org/doc/html/rfc9114', index: 1 }],
      model: 'copilot-web'
    }),
    stop: async () => true
  };

  const cdpManager = {
    connect: async () => {},
    getContext: () => ({ pages: () => [{ url: () => 'https://copilot.cloud.microsoft/chat' }] }),
    getTargetId: async () => 'target-copilot-1',
    insertTextViaCDP: async () => {},
    getStatus: async () => ({ cdpConnected: true })
  };

  const server = createBridgeServer({
    cdpManager,
    drivers: { copilot: mockDriver },
    logger: new MetadataLogger(),
    queueManager: new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 })
  });

  const res = await server.invoke('ask_copilot', { prompt: 'Explique HTTP/3' });
  assert.equal(res.provider, 'copilot');
  assert.equal(res.model, 'copilot-web');
  assert.equal(res.text, 'Resposta autoritativa do Copilot.');
  assert.equal(promptSent, 'Explique HTTP/3');

  await assert.rejects(
    () => server.invoke('ask_copilot', { prompt: 'minha api key sk-123456789012345678901234567890123456789012345678' }),
    (err) => err.code === ERROR_CODES.BLOCKED_BY_POLICY
  );
});

test('15. Servidor MCP - ask_meta roteia para o driver certo e bloqueia segredos via sanitizador', async () => {
  let promptSent = null;
  const mockDriver = {
    provider: 'meta',
    defaultModel: 'meta-ai-web',
    ensureTab: async () => ({ url: () => 'https://www.meta.ai/' }),
    isLoggedIn: async () => true,
    newChat: async () => {},
    send: async (_page, prompt) => {
      promptSent = prompt;
    },
    waitDone: async () => true,
    extractAnswer: async () => ({
      text: 'Resposta autoritativa do Meta AI.',
      sources: [{ title: 'RFC 9114', url: 'https://datatracker.ietf.org/doc/html/rfc9114', index: 1 }],
      model: 'meta-ai-web'
    }),
    stop: async () => true
  };

  const cdpManager = {
    connect: async () => {},
    getContext: () => ({ pages: () => [{ url: () => 'https://www.meta.ai/' }] }),
    getTargetId: async () => 'target-meta-1',
    insertTextViaCDP: async () => {},
    getStatus: async () => ({ cdpConnected: true })
  };

  const server = createBridgeServer({
    cdpManager,
    drivers: { meta: mockDriver },
    logger: new MetadataLogger(),
    queueManager: new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 })
  });

  const res = await server.invoke('ask_meta', { prompt: 'Explique QUIC' });
  assert.equal(res.provider, 'meta');
  assert.equal(res.model, 'meta-ai-web');
  assert.equal(res.text, 'Resposta autoritativa do Meta AI.');
  assert.equal(promptSent, 'Explique QUIC');

  await assert.rejects(
    () => server.invoke('ask_meta', { prompt: 'minha api key sk-123456789012345678901234567890123456789012345678' }),
    (err) => err.code === ERROR_CODES.BLOCKED_BY_POLICY
  );
});

test('16. Servidor MCP - compare_web_chats executa consulta em paralelo abrangendo os 7 provedores', async () => {
  const allSeven = ['perplexity', 'gemini', 'chatgpt', 'claude', 'deepseek', 'copilot', 'meta'];
  const drivers = {};
  const pages = [];

  for (const p of allSeven) {
    const pageUrl = `https://${p}.example/`;
    pages.push({ url: () => pageUrl });
    drivers[p] = {
      provider: p,
      defaultModel: `${p}-model`,
      ensureTab: async () => ({ url: () => pageUrl }),
      isLoggedIn: async () => true,
      newChat: async () => {},
      send: async () => {},
      waitDone: async () => true,
      extractAnswer: async () => ({
        text: `Resposta de ${p}`,
        sources: [{ title: `${p} Source`, url: `https://${p}.example/source`, index: 1 }],
        model: `${p}-model`
      }),
      stop: async () => true
    };
  }

  const cdpManager = {
    connect: async () => {},
    getContext: () => ({ pages: () => pages }),
    getTargetId: async (page) => 'target-' + page.url(),
    insertTextViaCDP: async () => {},
    getStatus: async () => ({ cdpConnected: true })
  };

  const server = createBridgeServer({
    cdpManager,
    drivers,
    logger: new MetadataLogger(),
    queueManager: new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 })
  });

  const res = await server.invoke('compare_web_chats', {
    prompt: 'Qual a velocidade da luz?',
    providers: allSeven
  });

  assert.ok(res.asked, 'res.asked deve existir');
  assert.equal(res.asked.length, 7, 'Deve consultar todos os 7 provedores');
  assert.equal(res.results.length, 7, 'Deve ter 7 resultados');
  for (const p of allSeven) {
    const item = res.results.find((r) => r.provider === p);
    assert.ok(item, `Resultado para ${p} deve existir`);
    assert.equal(item.ok, true);
    assert.equal(item.text, `Resposta de ${p}`);
  }
});
