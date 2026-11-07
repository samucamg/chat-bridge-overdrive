import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PerplexityDriver } from '../src/drivers/perplexity.mjs';
import { GeminiDriver } from '../src/drivers/gemini.mjs';
import { checkAnomalies } from '../src/drivers/base.mjs';
import { validateCdpEndpoint, CdpManager } from '../src/cdp.mjs';
import { ERROR_CODES, BridgeError, isBridgeError } from '../src/errors.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Cria um ambiente de DOM simulado sobre a fixture HTML para testes seguros sem navegador real.
 * @param {string} html
 * @param {string} url
 */
function createMockPageFromHtml(html, url = 'http://127.0.0.1/') {
  class MockNode {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.attributes = {};
      this.children = [];
      this.parent = null;
      this.dataset = {};
      this._textContent = '';
      this.focused = false;
      this.clicked = false;
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
    get style() {
      const rawStyle = this.attributes['style'] || '';
      const isNone = /display\s*:\s*none/i.test(rawStyle);
      return {
        display: isNone ? 'none' : 'block',
        visibility: 'visible',
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
        ['META', 'LINK', 'INPUT', 'IMG', 'BR', 'HR', 'PATH', 'USE'].includes(tagName.toUpperCase());

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
    if (typeof el === 'string') return false;
    let s = sel.trim();
    if (!s) return false;

    // Negation :not(...)
    const notMatch = s.match(/:not\(([^)]+)\)/);
    if (notMatch) {
      const inner = notMatch[1];
      const rest = s.replace(notMatch[0], '');
      if (matchesSimple(el, inner)) return false;
      if (rest) return matchesSimple(el, rest);
      return true;
    }

    // Has :has(...)
    const hasMatch = s.match(/:has\(([^)]+)\)/);
    if (hasMatch) {
      const inner = hasMatch[1];
      const rest = s.replace(hasMatch[0], '');
      const sub = el.querySelectorAll(inner);
      if (sub.length === 0) return false;
      if (rest) return matchesSimple(el, rest);
      return true;
    }

    // Tag name
    const tagMatch = s.match(/^([a-zA-Z0-9_-]+)/);
    if (tagMatch) {
      if (el.tagName !== tagMatch[1].toUpperCase()) return false;
      s = s.slice(tagMatch[1].length);
    }

    // ID
    const idMatch = s.match(/^#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      if (el.id !== idMatch[1]) return false;
      s = s.slice(idMatch[0].length);
    }

    // Classes (.class)
    while (s.startsWith('.')) {
      const cMatch = s.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!cMatch) break;
      if (!el.classList.contains(cMatch[1])) return false;
      s = s.slice(cMatch[0].length);
    }

    // Attributes [attr], [attr=val], [attr^=val], [attr*=val]
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

  function querySelectorAll(node, selector) {
    const results = [];
    const subSelectors = selector.split(',').map((s) => s.trim()).filter(Boolean);

    for (const sub of subSelectors) {
      const parts = sub.split(/\s+/).filter(Boolean);

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
    dispatchEvent: () => {}
  };

  const windowMock = {
    location: { href: url },
    document: documentMock,
    getComputedStyle: (el) => el.style,
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
      try {
        globalThis.document = documentMock;
        globalThis.window = windowMock;
        globalThis.Event = windowMock.Event;
        globalThis.KeyboardEvent = windowMock.KeyboardEvent;

        if (typeof fn === 'function') {
          return fn(...args);
        }
        return null;
      } finally {
        globalThis.document = prevDoc;
        globalThis.window = prevWin;
      }
    },
    keyboard: {
      press: async () => {}
    }
  };

  return { page, root, document: documentMock };
}

test('PerplexityDriver - diagnose identifica seletores em level1 e stopBtn com confianca Media', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'perplexity.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://www.perplexity.ai/');

  const driver = new PerplexityDriver();
  const diagnosis = await driver.diagnose(page);

  assert.equal(diagnosis.provider, 'perplexity');
  assert.equal(diagnosis.healthy, true);
  assert.equal(diagnosis.loggedIn, true);

  // Seletores semanticos identificados em level1 com confianca Alta
  assert.equal(diagnosis.selectors.input.level, 'level1');
  assert.equal(diagnosis.selectors.input.confidence, 'Alta');
  assert.ok(diagnosis.selectors.input.count > 0);

  assert.equal(diagnosis.selectors.sendBtn.level, 'level1');
  assert.equal(diagnosis.selectors.sendBtn.confidence, 'Alta');
  assert.ok(diagnosis.selectors.sendBtn.count > 0);

  // Stop button identificado com confianca Media
  assert.equal(diagnosis.selectors.stopBtn.level, 'level1');
  assert.equal(diagnosis.selectors.stopBtn.confidence, 'Media');
  assert.ok(diagnosis.selectors.stopBtn.count > 0);

  assert.equal(diagnosis.selectors.response.level, 'level1');
  assert.equal(diagnosis.selectors.response.confidence, 'Alta');
  assert.ok(diagnosis.selectors.response.count > 0);

  assert.equal(diagnosis.selectors.citations.level, 'level1');
  assert.equal(diagnosis.selectors.citations.confidence, 'Alta');
  assert.equal(diagnosis.selectors.citations.count, 2);

  assert.equal(diagnosis.selectors.newChatBtn.level, 'level1');
  assert.equal(diagnosis.selectors.newChatBtn.confidence, 'Alta');
  assert.ok(diagnosis.selectors.newChatBtn.count > 0);
});

test('PerplexityDriver - send invoca insertTextViaCDP e extractAnswer descarta thinking-panel', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'perplexity.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://www.perplexity.ai/');

  const driver = new PerplexityDriver();

  let cdpCalledWith = null;
  const mockCdpManager = {
    insertTextViaCDP: async (_p, text) => {
      cdpCalledWith = text;
    }
  };

  await driver.send(page, 'Pergunta teste do bridge', mockCdpManager);
  assert.equal(cdpCalledWith, 'Pergunta teste do bridge');

  const answer = await driver.extractAnswer(page);
  assert.ok(answer.text.includes('A arquitetura MCP stdio comunica diretamente'));

  // Garante que o texto de .thinking-panel foi descartado
  assert.equal(
    answer.text.includes('Raciocinio interno temporario que nao deve sair na resposta final'),
    false,
    'O texto do thinking-panel deve ser completamente removido da resposta'
  );

  // Garante que extraiu as 2 citacoes esperadas
  assert.equal(answer.sources.length, 2);
  assert.equal(answer.sources[0].url, 'https://modelcontextprotocol.io/specification');
  assert.equal(answer.sources[1].url, 'https://chromedevtools.github.io/devtools-protocol/');
  assert.equal(answer.model, 'perplexity-web');
});

test('GeminiDriver - diagnose identifica seletores e extractAnswer filtra model-thoughts', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'gemini.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://gemini.google.com/app');

  const driver = new GeminiDriver();
  const diagnosis = await driver.diagnose(page);

  assert.equal(diagnosis.provider, 'gemini');
  assert.equal(diagnosis.healthy, true);
  assert.equal(diagnosis.loggedIn, true);
  assert.ok(diagnosis.selectors.input.count > 0);
  assert.ok(diagnosis.selectors.sendBtn.count > 0);
  assert.ok(diagnosis.selectors.response.count > 0);

  const answer = await driver.extractAnswer(page);

  // Garante que o conteudo de <model-thoughts> foi descartado
  assert.equal(
    answer.text.includes('Pensamento interno do modelo Gemini que deve ser descartado pelo filtro'),
    false,
    'O texto de model-thoughts deve ser descartado'
  );
  assert.ok(answer.text.includes('O protocolo CDP na porta local 127.0.0.1'));

  // Modelo detectado e fontes
  assert.equal(answer.model, 'Gemini 2.5 Pro');
  assert.equal(answer.sources.length, 1);
  assert.ok(answer.sources[0].url.includes('playwright.dev'));
});

test('Drivers - auth_wall.html detecta Cloudflare Turnstile e lanca AUTH_REQUIRED', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'auth_wall.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://www.perplexity.ai/');

  await assert.rejects(
    async () => {
      await checkAnomalies(page);
    },
    (err) => {
      assert.ok(isBridgeError(err));
      assert.equal(err.code, ERROR_CODES.AUTH_REQUIRED);
      assert.ok(err.message.includes('Desafio anti-bot'));
      return true;
    }
  );

  const driver = new PerplexityDriver();
  const loggedIn = await driver.isLoggedIn(page);
  assert.equal(loggedIn, false);
});

test('CdpManager - validateCdpEndpoint aceita 127.0.0.1 e rejeita 0.0.0.0 ou tuneis externos', () => {
  // Endpoints validos
  assert.equal(validateCdpEndpoint('http://127.0.0.1:9222'), 'http://127.0.0.1:9222');
  assert.equal(validateCdpEndpoint('http://127.0.0.1:9223'), 'http://127.0.0.1:9223');
  assert.equal(validateCdpEndpoint('ws://127.0.0.1:9222'), 'ws://127.0.0.1:9222');

  // Endpoints proibidos pela politica de seguranca
  const blockedEndpoints = [
    'http://0.0.0.0:9222',
    'http://localhost:9222',
    'https://meu-tunel.trycloudflare.com',
    'http://192.168.1.50:9222',
    'https://api.meuservico.com'
  ];

  for (const ep of blockedEndpoints) {
    assert.throws(
      () => {
        validateCdpEndpoint(ep);
      },
      (err) => {
        assert.ok(isBridgeError(err));
        assert.equal(err.code, ERROR_CODES.BLOCKED_BY_POLICY);
        return true;
      },
      `Deveria bloquear endpoint ${ep}`
    );
  }
});
