import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ClaudeDriver } from '../src/drivers/claude.mjs';
import { DeepSeekDriver } from '../src/drivers/deepseek.mjs';
import { PerplexityDriver } from '../src/drivers/perplexity.mjs';
import { GeminiDriver } from '../src/drivers/gemini.mjs';
import { ChatGPTDriver } from '../src/drivers/chatgpt.mjs';
import { runLiveHomologation, ALLOWED_LIVE_TEST_PROMPTS } from '../src/live_runner.mjs';
import { ERROR_CODES, isBridgeError, BridgeError } from '../src/errors.mjs';

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

    // Attributes [attr], [attr=val], [attr^=val], [attr*=val], [attr$=val]
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

// ---------------------------------------------------------------------------
// 1. ClaudeDriver (src/drivers/claude.mjs e fixtures/claude.html)
// ---------------------------------------------------------------------------

test('ClaudeDriver - diagnose sobre fixtures/claude.html identifica seletores em level1 com confianca Media', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'claude.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://claude.ai/');

  const driver = new ClaudeDriver();
  const diagnosis = await driver.diagnose(page);

  assert.equal(diagnosis.provider, 'claude');
  assert.equal(diagnosis.healthy, true);
  assert.equal(diagnosis.loggedIn, true);

  assert.equal(diagnosis.selectors.input.level, 'level1');
  assert.equal(diagnosis.selectors.input.confidence, 'Media');
  assert.ok(diagnosis.selectors.input.count > 0, 'input deve ser encontrado');

  assert.equal(diagnosis.selectors.sendBtn.level, 'level1');
  assert.equal(diagnosis.selectors.sendBtn.confidence, 'Media');
  assert.ok(diagnosis.selectors.sendBtn.count > 0, 'sendBtn deve ser encontrado');

  assert.equal(diagnosis.selectors.response.level, 'level1');
  assert.equal(diagnosis.selectors.response.confidence, 'Media');
  assert.ok(diagnosis.selectors.response.count > 0, 'response deve ser encontrado');

  assert.ok(['level1', 'level2'].includes(diagnosis.selectors.citations.level), 'citations deve ser nivel 1 ou 2');
  assert.equal(diagnosis.selectors.citations.confidence, 'Media');
  assert.ok(diagnosis.selectors.citations.count > 0, 'citations deve ser encontrado');

  assert.equal(diagnosis.selectors.newChatBtn.level, 'level1');
  assert.equal(diagnosis.selectors.newChatBtn.confidence, 'Media');
  assert.ok(diagnosis.selectors.newChatBtn.count > 0, 'newChatBtn deve ser encontrado');

  assert.equal(diagnosis.selectors.fileInput.level, 'level1');
  assert.equal(diagnosis.selectors.fileInput.confidence, 'Media');
  assert.ok(diagnosis.selectors.fileInput.count > 0, 'fileInput deve ser encontrado');

  assert.equal(diagnosis.selectors.modelBadge.level, 'level1');
  assert.equal(diagnosis.selectors.modelBadge.confidence, 'Media');
  assert.ok(diagnosis.selectors.modelBadge.count > 0, 'modelBadge deve ser encontrado');
});

test('ClaudeDriver - send invoca insertTextViaCDP e aciona envio', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'claude.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://claude.ai/');

  let insertedText = null;
  const mockCdpManager = {
    insertTextViaCDP: async (_p, text) => {
      insertedText = text;
    }
  };

  const driver = new ClaudeDriver();
  await driver.send(page, 'Pergunta Claude', mockCdpManager);

  assert.equal(insertedText, 'Pergunta Claude', 'Deve invocar insertTextViaCDP com o texto');
});

test('ClaudeDriver - extractAnswer descarta thinking-block, extrai modelo Claude 3.7 Sonnet e citacao web', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'claude.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://claude.ai/');

  const driver = new ClaudeDriver();
  const answer = await driver.extractAnswer(page);

  assert.ok(
    answer.text.includes('O servidor MCP opera via stdio sem expor portas de rede locais'),
    'Deve conter o conteudo util de texto'
  );
  assert.equal(
    answer.text.includes('Pensamento estendido do Claude'),
    false,
    'Nao pode conter conteudo de thinking-block'
  );
  assert.equal(
    answer.text.includes('thinking-block'),
    false,
    'Nao pode conter marcas de thinking-block'
  );

  assert.equal(answer.model, 'Claude 3.7 Sonnet');
  assert.equal(answer.sources.length, 1);
  assert.equal(
    answer.sources[0].url,
    'https://docs.anthropic.com/en/docs/agents-and-tools/mcp'
  );
});

// ---------------------------------------------------------------------------
// 2. DeepSeekDriver (src/drivers/deepseek.mjs e fixtures/deepseek.html)
// ---------------------------------------------------------------------------

test('DeepSeekDriver - diagnose sobre fixtures/deepseek.html identifica seletores em level1', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'deepseek.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://chat.deepseek.com/');

  const driver = new DeepSeekDriver();
  const diagnosis = await driver.diagnose(page);

  assert.equal(diagnosis.provider, 'deepseek');
  assert.equal(diagnosis.healthy, true);
  assert.equal(diagnosis.loggedIn, true);

  assert.equal(diagnosis.selectors.input.level, 'level1');
  assert.ok(diagnosis.selectors.input.count > 0, 'input deve ser encontrado');

  assert.equal(diagnosis.selectors.sendBtn.level, 'level1');
  assert.ok(diagnosis.selectors.sendBtn.count > 0, 'sendBtn deve ser encontrado');

  assert.equal(diagnosis.selectors.response.level, 'level1');
  assert.ok(diagnosis.selectors.response.count > 0, 'response deve ser encontrado');

  assert.ok(['level1', 'level2'].includes(diagnosis.selectors.citations.level), 'citations deve ser nivel 1 ou 2');
  assert.ok(diagnosis.selectors.citations.count > 0, 'citations deve ser encontrado');

  assert.equal(diagnosis.selectors.newChatBtn.level, 'level1');
  assert.ok(diagnosis.selectors.newChatBtn.count > 0, 'newChatBtn deve ser encontrado');
});

test('DeepSeekDriver - send preenche #chat-input e aciona envio', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'deepseek.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://chat.deepseek.com/');

  let insertedText = null;
  const mockCdpManager = {
    insertTextViaCDP: async (_p, text) => {
      insertedText = text;
    }
  };

  const driver = new DeepSeekDriver();
  await driver.send(page, 'Pergunta DeepSeek', mockCdpManager);

  assert.equal(insertedText, 'Pergunta DeepSeek', 'Deve invocar insertTextViaCDP com o texto');
});

test('DeepSeekDriver - extractAnswer descarta ds-think-content (R1), extrai modelo DeepSeek R1 e citacao', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'deepseek.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://chat.deepseek.com/');

  const driver = new DeepSeekDriver();
  const answer = await driver.extractAnswer(page);

  assert.ok(
    answer.text.includes('A arquitetura serial por provedor evita bloqueios por rate limit e Turnstile'),
    'Deve conter o conteudo util'
  );
  assert.equal(
    answer.text.includes('Cadeia de pensamento R1 interna'),
    false,
    'Nao pode conter conteudo de ds-think-content'
  );
  assert.equal(
    answer.text.includes('ds-think-content'),
    false,
    'Nao pode conter marca de classe ds-think-content'
  );

  assert.equal(answer.model, 'DeepSeek R1');
  assert.equal(answer.sources.length, 1);
  assert.equal(
    answer.sources[0].url,
    'https://api-docs.deepseek.com/'
  );
});

// ---------------------------------------------------------------------------
// 3. Deteccao de Sessao de Login Expirada (session_expired.html -> AUTH_REQUIRED)
// ---------------------------------------------------------------------------

test('Deteccao de Sessao Expirada - todos os 5 drivers abortam com AUTH_REQUIRED diante de tela de login', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'session_expired.html');
  const html = fs.readFileSync(fixturePath, 'utf8');

  const drivers = [
    new PerplexityDriver(),
    new GeminiDriver(),
    new ChatGPTDriver(),
    new ClaudeDriver(),
    new DeepSeekDriver()
  ];

  for (const driver of drivers) {
    const { page } = createMockPageFromHtml(html, driver.targetUrl || 'http://127.0.0.1/');

    // 1. isLoggedIn deve retornar false (ou lancar AUTH_REQUIRED)
    let loggedIn = true;
    try {
      loggedIn = await driver.isLoggedIn(page);
    } catch (err) {
      if (isBridgeError(err) && err.code === ERROR_CODES.AUTH_REQUIRED) {
        loggedIn = false;
      } else {
        throw err;
      }
    }
    assert.equal(
      loggedIn,
      false,
      `${driver.provider} deve reportar loggedIn false em session_expired.html`
    );

    // 2. send() deve abortar imediatamente com AUTH_REQUIRED
    await assert.rejects(
      async () => {
        await driver.send(page, 'Prompt de teste');
      },
      (err) => {
        return isBridgeError(err) && err.code === ERROR_CODES.AUTH_REQUIRED;
      },
      `${driver.provider} send() deve lancar AUTH_REQUIRED diante de tela de login expirada`
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Runner de Testes Ao Vivo Opt-in (src/live_runner.mjs)
// ---------------------------------------------------------------------------

test('Live Runner - sem opt-in explicito bloqueia imediatamente com BLOCKED_BY_POLICY', async () => {
  // Garante que a variavel de ambiente nao interfira
  const prevEnv = process.env.CHAT_BRIDGE_LIVE_OPT_IN;
  delete process.env.CHAT_BRIDGE_LIVE_OPT_IN;

  try {
    await assert.rejects(
      async () => {
        await runLiveHomologation({ optIn: false });
      },
      (err) => {
        return isBridgeError(err) && err.code === ERROR_CODES.BLOCKED_BY_POLICY;
      },
      'runLiveHomologation sem optIn deve lancar BLOCKED_BY_POLICY'
    );
  } finally {
    if (prevEnv !== undefined) {
      process.env.CHAT_BRIDGE_LIVE_OPT_IN = prevEnv;
    }
  }
});

test('Live Runner - com optIn: true em modo doctor_only executa inspecao sem envio de prompt', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'claude.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://claude.ai/');

  const res = await runLiveHomologation({
    optIn: true,
    mode: 'doctor_only',
    providers: ['claude'],
    pagesByProvider: { claude: page },
    drivers: { claude: new ClaudeDriver() }
  });

  assert.equal(res.optInVerified, true);
  assert.equal(res.mode, 'doctor_only');
  assert.ok(res.doctor, 'Deve conter resultado do doctor');
  assert.ok(res.doctor.providers.claude, 'Deve inspecionar o provedor claude');
});

test('Live Runner - com optIn: true bloqueia prompt que nao pertence a lista permitida', async () => {
  await assert.rejects(
    async () => {
      await runLiveHomologation({
        optIn: true,
        mode: 'single_prompt',
        testPrompt: 'Prompt desconhecido arbitrario nao permitido'
      });
    },
    (err) => isBridgeError(err) && err.code === ERROR_CODES.BLOCKED_BY_POLICY,
    'Deve bloquear prompt fora da lista de testes autorizados'
  );
});

test('Live Runner - com optIn: true bloqueia prompt contendo segredo via sanitizador', async () => {
  await assert.rejects(
    async () => {
      await runLiveHomologation({
        optIn: true,
        mode: 'single_prompt',
        testPrompt: 'sk-proj-1234567890abcdefghijklmnopqrstuv'
      });
    },
    (err) => isBridgeError(err) && err.code === ERROR_CODES.BLOCKED_BY_POLICY,
    'Deve bloquear prompt com segredo mesmo com opt-in'
  );
});

test('Live Runner - executa homologacao serial com prompt ficticio permitido e registra apenas metadados', async () => {
  const fixtureClaude = fs.readFileSync(path.join(__dirname, 'fixtures', 'claude.html'), 'utf8');
  const fixtureDeepSeek = fs.readFileSync(path.join(__dirname, 'fixtures', 'deepseek.html'), 'utf8');

  const { page: pageClaude } = createMockPageFromHtml(fixtureClaude, 'https://claude.ai/');
  const { page: pageDeepSeek } = createMockPageFromHtml(fixtureDeepSeek, 'https://chat.deepseek.com/');

  const claudeDriver = new ClaudeDriver();
  const deepseekDriver = new DeepSeekDriver();

  const res = await runLiveHomologation({
    optIn: true,
    mode: 'single_prompt',
    testPrompt: 'Responda apenas OK em uma palavra.',
    providers: ['claude', 'deepseek'],
    delayMs: 10,
    pagesByProvider: {
      claude: pageClaude,
      deepseek: pageDeepSeek
    },
    drivers: {
      claude: claudeDriver,
      deepseek: deepseekDriver
    }
  });

  assert.equal(res.optInVerified, true);
  assert.equal(res.mode, 'single_prompt');
  assert.ok(res.totalDurationMs >= 0);

  // Verificacao serial dos dois provedores
  assert.equal(res.results.claude.success, true);
  assert.equal(res.results.claude.provider, 'claude');
  assert.equal(res.results.claude.model, 'Claude 3.7 Sonnet');
  assert.ok(res.results.claude.textLength > 0);
  assert.equal(res.results.claude.sourcesCount, 1);

  assert.equal(res.results.deepseek.success, true);
  assert.equal(res.results.deepseek.provider, 'deepseek');
  assert.equal(res.results.deepseek.model, 'DeepSeek R1');
  assert.ok(res.results.deepseek.textLength > 0);
  assert.equal(res.results.deepseek.sourcesCount, 1);
});
