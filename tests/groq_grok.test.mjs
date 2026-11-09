import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GroqDriver, GROQ_SELECTORS, GROQ_MODEL_FALLBACK_CHAIN, GROQ_BLOCKED_MODELS } from '../src/drivers/groq.mjs';
import { GrokDriver, GROK_SELECTORS, GROK_FREE_MODES, GROK_PAYWALL_MODES } from '../src/drivers/grok.mjs';
import { DRIVERS, PROVIDER_NAMES, PROVIDER_SELECTOR_MAP, normalizeProvider, getDriver } from '../src/doctor.mjs';
import { createBridgeServer, ALL_MCP_TOOLS, SUPPORTED_PROVIDERS } from '../src/server.mjs';
import { ProviderQueueManager } from '../src/queue.mjs';
import { MetadataLogger } from '../src/logger.mjs';
import { ERROR_CODES } from '../src/errors.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Cria ambiente simulado de DOM sobre fixture HTML para testes isolados e seguros sem Chrome real.
 */
function createMockPageFromHtml(html, initialUrl = 'https://chat.groq.com/?model=qwen/qwen3.8-27b') {
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

    // Has-text :has-text("...")
    const hasTextMatch = s.match(/:has-text\((?:"([^"]*)"|'([^']*)')\)/);
    if (hasTextMatch) {
      const expectedText = (hasTextMatch[1] ?? hasTextMatch[2] ?? '').toLowerCase();
      const rest = s.replace(hasTextMatch[0], '');
      const actualText = (el.textContent || '').toLowerCase();
      if (!actualText.includes(expectedText)) return false;
      if (rest) return matchesSimple(el, rest);
      return true;
    }

    // Pseudo-class :visible
    if (s.includes(':visible')) {
      s = s.replace(':visible', '');
      const style = el.style;
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }

    // Pseudo-class :disabled
    if (s.includes(':disabled')) {
      s = s.replace(':disabled', '');
      if (!el.disabled && el.getAttribute('disabled') === null) return false;
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

    // Classes
    while (s.startsWith('.')) {
      const cMatch = s.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!cMatch) break;
      if (!el.classList.contains(cMatch[1])) return false;
      s = s.slice(cMatch[0].length);
    }

    // Attributes
    while (s.startsWith('[')) {
      const aMatch = s.match(/^\[([a-zA-Z0-9_:-]+)(?:([*^$]?=)(?:"([^"]*)"|'([^']*)'|([^\]]+?)))?(?:\s+i)?\]/i);
      if (!aMatch) break;
      const attrName = aMatch[1].toLowerCase();
      const op = aMatch[2] || '';
      let expected = aMatch[3] ?? aMatch[4] ?? aMatch[5] ?? '';
      const isCaseInsensitive = aMatch[0].toLowerCase().endsWith('i]');

      let actual = el.getAttribute(attrName);
      if (actual === null) return false;

      if (isCaseInsensitive) {
        actual = actual.toLowerCase();
        expected = expected.toLowerCase();
      }

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
    createElement: (tag) => new MockNode(tag),
    execCommand: () => true,
    dispatchEvent: () => {}
  };

  let pageUrl = initialUrl;

  const windowMock = {
    get location() {
      try {
        return new URL(pageUrl);
      } catch (e) {
        return { href: pageUrl, hostname: 'chat.groq.com', origin: 'https://chat.groq.com' };
      }
    },
    document: documentMock,
    getComputedStyle: (el) => el.style || { display: 'block', visibility: 'visible', opacity: '1' },
    Event: class { constructor(type) { this.type = type; } },
    KeyboardEvent: class { constructor(type, opts) { this.type = type; Object.assign(this, opts); } }
  };

  const navHistory = [];

  const page = {
    _targetId: 'mock-target-' + Math.random().toString(36).slice(2, 7),
    url: () => pageUrl,
    goto: async (dest) => {
      pageUrl = dest;
      navHistory.push(dest);
    },
    evaluate: async (fn, ...args) => {
      const prevDoc = globalThis.document;
      const prevWin = globalThis.window;
      const prevEv = globalThis.Event;
      const prevKb = globalThis.KeyboardEvent;
      try {
        globalThis.document = documentMock;
        globalThis.window = windowMock;
        globalThis.Event = windowMock.Event;
        globalThis.KeyboardEvent = windowMock.KeyboardEvent;

        if (typeof fn === 'function') {
          return await fn(...args);
        }
        return null;
      } finally {
        globalThis.document = prevDoc;
        globalThis.window = prevWin;
        globalThis.Event = prevEv;
        globalThis.KeyboardEvent = prevKb;
      }
    },
    keyboard: {
      press: async () => {}
    },
    getNavHistory: () => navHistory,
    setMockUrl: (u) => { pageUrl = u; }
  };

  return { page, root, document: documentMock };
}

// ---------------------------------------------------------------------------
// 1. GroqDriver e GROQ_SELECTORS
// ---------------------------------------------------------------------------

test('1. GroqDriver e GROQ_SELECTORS - estrutura em 3 niveis, cadeia de fallback 429 e modelos bloqueados', () => {
  const driver = new GroqDriver();
  assert.equal(driver.provider, 'groq');
  assert.equal(driver.targetUrl, 'https://chat.groq.com/?model=qwen/qwen3.8-27b');
  assert.equal(driver.preferredModel, 'qwen/qwen3.8-27b');
  assert.equal(driver.activeModel, 'qwen/qwen3.8-27b');

  // GROQ_MODEL_FALLBACK_CHAIN
  assert.deepEqual(GROQ_MODEL_FALLBACK_CHAIN, [
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
    'qwen/qwen3.6-27b',
    'openai/gpt-oss-20b'
  ]);

  // GROQ_BLOCKED_MODELS
  assert.deepEqual(GROQ_BLOCKED_MODELS, ['canopylabs/orpheus-arabic-saudi']);

  // Estrutura de seletores em 3 niveis
  for (const group of ['input', 'sendBtn', 'stopBtn', 'response', 'responseBlock', 'responseText', 'newChatBtn']) {
    assert.ok(GROQ_SELECTORS[group], `Grupo ${group} deve existir em GROQ_SELECTORS`);
    assert.ok(GROQ_SELECTORS[group].level1?.selector, `${group} deve ter level1.selector`);
    assert.ok(GROQ_SELECTORS[group].level2?.selector, `${group} deve ter level2.selector`);
    assert.ok(GROQ_SELECTORS[group].level3?.selector, `${group} deve ter level3.selector`);
  }
});

// ---------------------------------------------------------------------------
// 2. GroqDriver.matchesUrl
// ---------------------------------------------------------------------------

test('2. GroqDriver.matchesUrl aceita dominios do Groq e rejeita dominios externos', () => {
  const driver = new GroqDriver();
  assert.equal(driver.matchesUrl('https://chat.groq.com/?model=qwen/qwen3.8-27b'), true);
  assert.equal(driver.matchesUrl('https://chat.groq.com/'), true);
  assert.equal(driver.matchesUrl('https://groq.com/chat'), true);
  assert.equal(driver.matchesUrl('https://sub.groq.com/'), true);
  assert.equal(driver.matchesUrl('https://google.com'), false);
  assert.equal(driver.matchesUrl('https://x.ai'), false);
  assert.equal(driver.matchesUrl('https://grok.com'), false);
  assert.equal(driver.matchesUrl(null), false);
  assert.equal(driver.matchesUrl(''), false);
});

// ---------------------------------------------------------------------------
// 3. GroqDriver.ensureValidModel
// ---------------------------------------------------------------------------

test('3. GroqDriver.ensureValidModel redireciona para modelo valido se model ausente ou se for modelo arabe bloqueado', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'groq.html'), 'utf8');
  const driver = new GroqDriver();

  // Caso A: URL sem model=
  const { page: pageNoModel } = createMockPageFromHtml(html, 'https://chat.groq.com/');
  await driver.ensureValidModel(pageNoModel);
  assert.equal(pageNoModel.url(), 'https://chat.groq.com/?model=qwen%2Fqwen3.8-27b');

  // Caso B: URL com modelo arabe bloqueado
  const { page: pageBlocked } = createMockPageFromHtml(html, 'https://chat.groq.com/?model=canopylabs/orpheus-arabic-saudi');
  await driver.ensureValidModel(pageBlocked);
  assert.equal(pageBlocked.url(), 'https://chat.groq.com/?model=qwen%2Fqwen3.8-27b');

  // Caso C: URL ja possui modelo valido
  const { page: pageValid } = createMockPageFromHtml(html, 'https://chat.groq.com/?model=qwen/qwen3.8-27b');
  const historyBefore = pageValid.getNavHistory().length;
  await driver.ensureValidModel(pageValid);
  assert.equal(pageValid.getNavHistory().length, historyBefore, 'Nao deve navegar se ja estiver em modelo valido');
});

// ---------------------------------------------------------------------------
// 4. GroqDriver.send e rotatividade em 429
// ---------------------------------------------------------------------------

test('4. GroqDriver.send detecta 429 no 1o envio, rotaciona para openai/gpt-oss-120b e reenvia com sucesso', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'groq.html'), 'utf8');
  const { page, document } = createMockPageFromHtml(html, 'https://chat.groq.com/?model=qwen/qwen3.8-27b');
  const driver = new GroqDriver();

  assert.equal(driver.activeModel, 'qwen/qwen3.8-27b');

  let sendAttempt = 0;
  const originalDetect = driver.detectRateLimit429.bind(driver);

  // Simula que na 1a tentativa detecta toast de 429; na 2a (reenvio), o toast desapareceu
  driver.detectRateLimit429 = async (_p) => {
    sendAttempt += 1;
    if (sendAttempt === 1) {
      return true; // 1a tentativa: 429 disparado
    }
    return false; // 2a tentativa: sem 429
  };

  const sentTexts = [];
  const mockCdpManager = {
    insertTextViaCDP: async (_p, text) => {
      sentTexts.push(text);
    }
  };

  await driver.send(page, 'Teste de inferencia ultra-rapida', mockCdpManager);

  // Deve ter executado 2 tentativas
  assert.equal(sendAttempt, 2, 'Deve ter tentado 2 vezes devido a rotatividade 429');
  assert.equal(sentTexts.length, 2, 'Deve ter inserido texto nas 2 tentativas');
  assert.equal(driver.activeModel, 'openai/gpt-oss-120b', 'Deve ter alternado para o 2o modelo da cadeia');
});

// ---------------------------------------------------------------------------
// 5. GroqDriver - extractResponse, extractSources e extractAnswer contra fixture groq.html
// ---------------------------------------------------------------------------

test('5. GroqDriver - extractResponse, extractSources e extractAnswer contra fixture groq.html', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'groq.html'), 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://chat.groq.com/?model=qwen/qwen3.8-27b');
  const driver = new GroqDriver();

  const text = await driver.extractResponse(page);
  assert.ok(text.includes('Resposta final do Groq Chat com inferencia de ultrabaixa latencia.'));
  assert.ok(text.includes('qwen3.8-27b'));
  assert.ok(text.includes('ok_groq'));

  const sources = await driver.extractSources(page);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, 'https://groq.com/docs');
  assert.equal(sources[0].title, 'Documentacao Groq');

  const answer = await driver.extractAnswer(page);
  assert.equal(answer.text, text);
  assert.deepEqual(answer.sources, sources);
  assert.equal(answer.model, 'qwen/qwen3.8-27b');
});

// ---------------------------------------------------------------------------
// 6. GrokDriver e GROK_SELECTORS
// ---------------------------------------------------------------------------

test('6. GrokDriver e GROK_SELECTORS - estrutura de seletores, modos gratuitos e paywall', () => {
  const driver = new GrokDriver();
  assert.equal(driver.provider, 'grok');
  assert.equal(driver.targetUrl, 'https://grok.com/');
  assert.equal(driver.preferredMode, 'Fast');
  assert.equal(driver.defaultModel, 'grok-fast');

  // Modos gratuitos e paywall
  assert.deepEqual(GROK_FREE_MODES, ['Fast', 'Build']);
  assert.deepEqual(GROK_PAYWALL_MODES, ['Auto', 'Expert', 'Heavy']);

  // Estrutura de seletores em 3 niveis
  for (const group of ['input', 'sendBtn', 'stopBtn', 'response', 'responseBlock', 'responseText', 'newChatBtn']) {
    assert.ok(GROK_SELECTORS[group], `Grupo ${group} deve existir em GROK_SELECTORS`);
    assert.ok(GROK_SELECTORS[group].level1?.selector, `${group} deve ter level1.selector`);
    assert.ok(GROK_SELECTORS[group].level2?.selector, `${group} deve ter level2.selector`);
    assert.ok(GROK_SELECTORS[group].level3?.selector, `${group} deve ter level3.selector`);
  }
});

// ---------------------------------------------------------------------------
// 7. GrokDriver.matchesUrl
// ---------------------------------------------------------------------------

test('7. GrokDriver.matchesUrl aceita grok.com e x.ai e rejeita dominios externos', () => {
  const driver = new GrokDriver();
  assert.equal(driver.matchesUrl('https://grok.com/'), true);
  assert.equal(driver.matchesUrl('https://grok.com/c/123'), true);
  assert.equal(driver.matchesUrl('https://sub.grok.com/chat'), true);
  assert.equal(driver.matchesUrl('https://x.ai/grok'), true);
  assert.equal(driver.matchesUrl('https://sub.x.ai/'), true);
  assert.equal(driver.matchesUrl('https://groq.com/'), false);
  assert.equal(driver.matchesUrl('https://openai.com/'), false);
  assert.equal(driver.matchesUrl(null), false);
  assert.equal(driver.matchesUrl(''), false);
});

// ---------------------------------------------------------------------------
// 8. GrokDriver.ensureFreeMode
// ---------------------------------------------------------------------------

test('8. GrokDriver.ensureFreeMode fecha dialogo de paywall SuperGrok e seleciona modo gratuito', async () => {
  const driver = new GrokDriver();

  // Simula paywall modal aberto
  const paywallHtml = `
    <html>
      <body>
        <div role="dialog">
          <p>SuperGrok Subscription Required</p>
          <button aria-label="Close modal">X</button>
        </div>
        <button id="model-select-trigger" aria-label="Modelo: Auto">Auto</button>
      </body>
    </html>
  `;
  const { page, document } = createMockPageFromHtml(paywallHtml, 'https://grok.com/');
  const closeBtn = document.querySelector('button[aria-label="Close modal"]');

  await driver.ensureFreeMode(page);
  assert.equal(closeBtn.clicked, true, 'Deve ter clicado no botao de fechar o paywall');
});

// ---------------------------------------------------------------------------
// 9. GrokDriver.setMode
// ---------------------------------------------------------------------------

test('9. GrokDriver.setMode aceita modos gratuitos (Fast, Build) e rejeita modos paywall (Auto, Expert, Heavy)', async () => {
  const driver = new GrokDriver();
  const page = {};

  // Modos gratuitos
  const fastRes = await driver.setMode(page, 'Fast');
  assert.equal(fastRes.supported, true);
  assert.equal(fastRes.applied, true);
  assert.equal(fastRes.mode, 'Fast');

  const buildRes = await driver.setMode(page, 'Build');
  assert.equal(buildRes.supported, true);
  assert.equal(buildRes.applied, true);
  assert.equal(buildRes.mode, 'Build');

  // Modos paywall
  for (const paywallMode of ['Auto', 'Expert', 'Heavy']) {
    const res = await driver.setMode(page, paywallMode);
    assert.equal(res.supported, false, `${paywallMode} nao deve ser suportado no plano gratuito`);
    assert.equal(res.applied, false);
    assert.match(res.message, /paywall|SuperGrok/i);
  }
});

// ---------------------------------------------------------------------------
// 10. GrokDriver - extractResponse, extractSources e extractAnswer contra fixture grok.html
// ---------------------------------------------------------------------------

test('10. GrokDriver - extractResponse, extractSources e extractAnswer contra fixture grok.html isolando resposta sem thought', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'grok.html'), 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://grok.com/');
  const driver = new GrokDriver();

  const text = await driver.extractResponse(page);
  assert.ok(text.includes('Resposta Grok Fast'));
  assert.ok(text.includes('Zephyria'));
  assert.ok(text.includes('Tempestuoso'));
  assert.ok(text.includes('ok_grok'));
  // conversation-thought deve ser removido
  assert.equal(text.includes('Pensou por 2 s'), false, 'Deve descartar conversation-thought');

  const sources = await driver.extractSources(page);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, 'https://x.ai/grok');
  assert.equal(sources[0].title, 'Fonte xAI');

  const answer = await driver.extractAnswer(page);
  assert.equal(answer.text, text);
  assert.deepEqual(answer.sources, sources);
  assert.equal(answer.model, 'grok-fast');
});

// ---------------------------------------------------------------------------
// 11. GrokDriver.send
// ---------------------------------------------------------------------------

test('11. GrokDriver.send limpa editor TipTap, injeta texto via CDP e nunca usa seletor level3', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'grok.html'), 'utf8');
  const { page, document } = createMockPageFromHtml(html, 'https://grok.com/');
  const driver = new GrokDriver();

  // Injeta rascunho previo para conferir limpeza
  const editor = document.querySelector('div.tiptap.ProseMirror');
  editor.textContent = 'rascunho anterior';

  let cdpInjectedText = null;
  const mockCdpManager = {
    insertTextViaCDP: async (_p, text) => {
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

  await driver.send(page, 'Prompt de teste Grok', mockCdpManager);

  assert.equal(cdpInjectedText, 'Prompt de teste Grok', 'Deve injetar prompt via CDP');
  assert.equal(
    clickedSelectors.some((s) => s.includes(level3)),
    false,
    'Nunca deve usar seletor level3 para envio'
  );
});

// ---------------------------------------------------------------------------
// 12. src/doctor.mjs e src/server.mjs - 9 Provedores e Mapas
// ---------------------------------------------------------------------------

test('12. SUPPORTED_PROVIDERS tem os 9 provedores e PROVIDER_SELECTOR_MAP contem todos', () => {
  const expectedNine = ['perplexity', 'gemini', 'chatgpt', 'claude', 'deepseek', 'copilot', 'meta', 'groq', 'grok'];

  assert.equal(SUPPORTED_PROVIDERS.length, 9);
  assert.deepEqual([...SUPPORTED_PROVIDERS], expectedNine);

  assert.equal(PROVIDER_NAMES.length, 9);
  assert.deepEqual([...PROVIDER_NAMES], expectedNine);

  for (const p of expectedNine) {
    assert.ok(DRIVERS[p], `DRIVERS[${p}] deve existir`);
    assert.ok(PROVIDER_SELECTOR_MAP[p], `PROVIDER_SELECTOR_MAP[${p}] deve existir`);
    assert.equal(getDriver(p), DRIVERS[p]);
  }

  // Normalizacao de apelidos para Groq e Grok
  assert.equal(normalizeProvider('Groq'), 'groq');
  assert.equal(normalizeProvider('chat.groq.com'), 'groq');
  assert.equal(normalizeProvider('Grok'), 'grok');
  assert.equal(normalizeProvider('grok.com'), 'grok');
  assert.equal(normalizeProvider('xAI Grok'), 'grok');
});

// ---------------------------------------------------------------------------
// 13. src/server.mjs - ALL_MCP_TOOLS tem exatamente 15 tools
// ---------------------------------------------------------------------------

test('13. ALL_MCP_TOOLS expoem exatamente 15 tools com ask_groq e ask_grok configuradas', () => {
  assert.equal(ALL_MCP_TOOLS.length, 15, 'ALL_MCP_TOOLS deve conter exatamente 15 tools');

  const names = ALL_MCP_TOOLS.map((t) => t.name);
  assert.ok(names.includes('ask_groq'), 'Deve expor ask_groq');
  assert.ok(names.includes('ask_grok'), 'Deve expor ask_grok');

  const askGroq = ALL_MCP_TOOLS.find((t) => t.name === 'ask_groq');
  assert.match(askGroq.description, /Groq/i);
  assert.match(askGroq.description, /pergunte ao Groq/i);
  assert.equal(askGroq.inputSchema.properties.provider, undefined);
  assert.ok(askGroq.inputSchema.properties.prompt);

  const askGrok = ALL_MCP_TOOLS.find((t) => t.name === 'ask_grok');
  assert.match(askGrok.description, /Grok/i);
  assert.match(askGrok.description, /pergunte ao Grok/i);
  assert.equal(askGrok.inputSchema.properties.provider, undefined);
  assert.ok(askGrok.inputSchema.properties.prompt);
});

// ---------------------------------------------------------------------------
// 14. Servidor MCP - invoke ask_groq e ask_grok com sanitizador
// ---------------------------------------------------------------------------

test('14. Servidor MCP - invoke ask_groq e ask_grok roteiam para os drivers certos e bloqueiam segredos', async () => {
  const sentPrompts = {};
  const mockGroqDriver = {
    provider: 'groq',
    defaultModel: 'qwen/qwen3.8-27b',
    ensureTab: async () => ({ url: () => 'https://chat.groq.com/' }),
    isLoggedIn: async () => true,
    newChat: async () => {},
    send: async (_page, prompt) => { sentPrompts['groq'] = prompt; },
    waitDone: async () => true,
    extractAnswer: async () => ({
      text: 'Resposta autoritativa do Groq.',
      sources: [{ title: 'Groq Docs', url: 'https://groq.com/docs', index: 1 }],
      model: 'qwen/qwen3.8-27b'
    }),
    stop: async () => true
  };

  const mockGrokDriver = {
    provider: 'grok',
    defaultModel: 'grok-fast',
    ensureTab: async () => ({ url: () => 'https://grok.com/' }),
    isLoggedIn: async () => true,
    newChat: async () => {},
    send: async (_page, prompt) => { sentPrompts['grok'] = prompt; },
    waitDone: async () => true,
    extractAnswer: async () => ({
      text: 'Resposta autoritativa do Grok.',
      sources: [{ title: 'xAI Grok', url: 'https://x.ai/grok', index: 1 }],
      model: 'grok-fast'
    }),
    stop: async () => true
  };

  const cdpManager = {
    connect: async () => {},
    getContext: () => ({ pages: () => [] }),
    getTargetId: async (page) => 'target-' + page.url(),
    insertTextViaCDP: async () => {},
    getStatus: async () => ({ cdpConnected: true })
  };

  const server = createBridgeServer({
    cdpManager,
    drivers: { groq: mockGroqDriver, grok: mockGrokDriver },
    logger: new MetadataLogger(),
    queueManager: new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 })
  });

  // ask_groq com prompt seguro
  const groqRes = await server.invoke('ask_groq', { prompt: 'Explique a arquitetura LPU' });
  assert.equal(groqRes.provider, 'groq');
  assert.equal(groqRes.text, 'Resposta autoritativa do Groq.');
  assert.equal(sentPrompts['groq'], 'Explique a arquitetura LPU');

  // ask_groq bloqueia segredo
  await assert.rejects(
    () => server.invoke('ask_groq', { prompt: 'api_key = gsk_123456789012345678901234567890123456789012345678' }),
    (err) => err.code === ERROR_CODES.BLOCKED_BY_POLICY
  );

  // ask_grok com prompt seguro
  const grokRes = await server.invoke('ask_grok', { prompt: 'Qual o sentido da vida?' });
  assert.equal(grokRes.provider, 'grok');
  assert.equal(grokRes.text, 'Resposta autoritativa do Grok.');
  assert.equal(sentPrompts['grok'], 'Qual o sentido da vida?');

  // ask_grok bloqueia segredo
  await assert.rejects(
    () => server.invoke('ask_grok', { prompt: 'minha api_key = sk-proj-123456789012345678901234567890123456789012345678' }),
    (err) => err.code === ERROR_CODES.BLOCKED_BY_POLICY
  );
});

// ---------------------------------------------------------------------------
// 15. Servidor MCP - compare_web_chats com todos os 9 provedores
// ---------------------------------------------------------------------------

test('15. Servidor MCP - compare_web_chats executa consulta em paralelo abrangendo todos os 9 provedores', async () => {
  const allNine = ['perplexity', 'gemini', 'chatgpt', 'claude', 'deepseek', 'copilot', 'meta', 'groq', 'grok'];
  const drivers = {};
  const pages = [];

  for (const p of allNine) {
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
    prompt: 'Qual a velocidade do som no ar?',
    providers: allNine
  });

  assert.ok(res.asked, 'res.asked deve existir');
  assert.equal(res.asked.length, 9, 'Deve consultar todos os 9 provedores');
  assert.equal(res.results.length, 9, 'Deve ter 9 resultados');
  for (const p of allNine) {
    const item = res.results.find((r) => r.provider === p);
    assert.ok(item, `Resultado para ${p} deve existir`);
    assert.equal(item.ok, true);
    assert.equal(item.text, `Resposta de ${p}`);
  }
});
