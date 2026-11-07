import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager, computeContentHash } from '../src/sessions.mjs';
import { ChatGPTDriver, CHATGPT_SELECTORS } from '../src/drivers/chatgpt.mjs';
import { PerplexityDriver } from '../src/drivers/perplexity.mjs';
import { GeminiDriver } from '../src/drivers/gemini.mjs';
import { BaseDriver } from '../src/drivers/base.mjs';
import { CdpManager } from '../src/cdp.mjs';
import { createBridgeServer } from '../src/server.mjs';
import { ProviderQueueManager } from '../src/queue.mjs';
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
// 1. Testes do ChatGPTDriver (src/drivers/chatgpt.mjs e fixtures/chatgpt.html)
// ---------------------------------------------------------------------------

test('ChatGPTDriver - diagnose sobre fixtures/chatgpt.html identifica seletores em level1 com confianca Media', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'chatgpt.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://chatgpt.com/');

  const driver = new ChatGPTDriver();
  const diagnosis = await driver.diagnose(page);

  assert.equal(diagnosis.provider, 'chatgpt');
  assert.equal(diagnosis.healthy, true);
  assert.equal(diagnosis.loggedIn, true);

  // Verificacao dos seletores em level1 com confianca Media
  assert.equal(diagnosis.selectors.input.level, 'level1');
  assert.equal(diagnosis.selectors.input.confidence, 'Media');
  assert.ok(diagnosis.selectors.input.count > 0, 'input deve ser encontrado');

  assert.equal(diagnosis.selectors.sendBtn.level, 'level1');
  assert.equal(diagnosis.selectors.sendBtn.confidence, 'Media');
  assert.ok(diagnosis.selectors.sendBtn.count > 0, 'sendBtn deve ser encontrado');

  assert.equal(diagnosis.selectors.response.level, 'level1');
  assert.equal(diagnosis.selectors.response.confidence, 'Media');
  assert.ok(diagnosis.selectors.response.count > 0, 'response deve ser encontrado');

  assert.equal(diagnosis.selectors.citations.level, 'level1');
  assert.equal(diagnosis.selectors.citations.confidence, 'Media');
  assert.ok(diagnosis.selectors.citations.count > 0, 'citations deve ser encontrado');

  assert.equal(diagnosis.selectors.newChatBtn.level, 'level1');
  assert.equal(diagnosis.selectors.newChatBtn.confidence, 'Media');
  assert.ok(diagnosis.selectors.newChatBtn.count > 0, 'newChatBtn deve ser encontrado');

  assert.equal(diagnosis.selectors.fileInput.level, 'level1');
  assert.equal(diagnosis.selectors.fileInput.confidence, 'Media');
  assert.ok(diagnosis.selectors.fileInput.count > 0, 'fileInput deve ser encontrado');
});

test('ChatGPTDriver - send invoca insertTextViaCDP e aciona envio', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'chatgpt.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://chatgpt.com/');

  let insertedText = null;
  const mockCdpManager = {
    insertTextViaCDP: async (_p, text) => {
      insertedText = text;
    }
  };

  const driver = new ChatGPTDriver();
  await driver.send(page, 'Pergunta ChatGPT', mockCdpManager);

  assert.equal(insertedText, 'Pergunta ChatGPT', 'Deve invocar insertTextViaCDP com o texto');
});

test('ChatGPTDriver - extractAnswer descarta reasoning-panel, extrai modelo ChatGPT 4o e citacao web', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'chatgpt.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://chatgpt.com/');

  const driver = new ChatGPTDriver();
  const answer = await driver.extractAnswer(page);

  // 1. Deve conter o texto util renderizado em Markdown
  assert.ok(
    answer.text.includes('O envio delta por hash SHA-256 reduz drasticamente o consumo de contexto'),
    'Deve conter o conteudo util de markdown'
  );

  // 2. Nao deve conter o bloco interno de raciocinio
  assert.equal(
    answer.text.includes('Pensamento interno o1/o3'),
    false,
    'Nao pode conter conteudo de reasoning-panel'
  );
  assert.equal(
    answer.text.includes('reasoning-panel'),
    false,
    'Nao pode conter marcas de reasoning-panel'
  );

  // 3. Deve extrair modelo detectado
  assert.equal(answer.model, 'ChatGPT 4o');

  // 4. Deve extrair citacao estruturada com URL correta
  assert.equal(answer.sources.length, 1);
  assert.equal(
    answer.sources[0].url,
    'https://platform.openai.com/docs/guides/prompt-engineering'
  );
});

test('ChatGPTDriver - attachFiles invoca setFileInputFiles via cdpManager ou sessao CDP', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'chatgpt.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { page } = createMockPageFromHtml(html, 'https://chatgpt.com/');

  // 1. Teste com cdpManager fornecendo setFileInputFiles
  let attachedViaManager = null;
  const mockCdpManager = {
    setFileInputFiles: async (_page, selector, files) => {
      attachedViaManager = { selector, files };
      return true;
    }
  };

  const driver = new ChatGPTDriver();
  const res1 = await driver.attachFiles(page, ['d:/ficticio/doc.txt'], mockCdpManager);
  assert.equal(res1, true);
  assert.deepEqual(attachedViaManager.files, ['d:/ficticio/doc.txt']);

  // 2. Teste via sessao CDP direta (DOM.setFileInputFiles)
  const cdpSessionCalls = [];
  const pageWithCdp = {
    ...page,
    newCDPSession: async () => ({
      send: async (method, params) => {
        cdpSessionCalls.push({ method, params });
        if (method === 'DOM.getDocument') return { root: { nodeId: 10 } };
        if (method === 'DOM.querySelector') return { nodeId: 25 };
        if (method === 'DOM.setFileInputFiles') return {};
        return {};
      },
      detach: async () => {}
    })
  };

  const res2 = await driver.attachFiles(pageWithCdp, ['d:/ficticio/dados.csv'], null);
  assert.equal(res2, true);
  assert.ok(
    cdpSessionCalls.some(
      (c) => c.method === 'DOM.setFileInputFiles' && c.params?.nodeId === 25 && c.params.files.includes('d:/ficticio/dados.csv')
    ),
    'Deve disparar DOM.setFileInputFiles na sessao CDP'
  );
});

// ---------------------------------------------------------------------------
// 2. Testes do SessionManager (src/sessions.mjs)
// ---------------------------------------------------------------------------

test('SessionManager - cria e reutiliza sessao nomeada mantendo vinculo com targetId e incrementando turnCount', () => {
  const sessionManager = new SessionManager();

  const s1 = sessionManager.getOrCreateSession('chatgpt', 'tarefa-autenticacao');
  assert.equal(s1.id, 'tarefa-autenticacao');
  assert.equal(s1.provider, 'chatgpt');
  assert.equal(s1.turnCount, 0);

  sessionManager.bindTarget('tarefa-autenticacao', 'target-chatgpt-001');
  assert.equal(s1.targetId, 'target-chatgpt-001');

  sessionManager.recordTurn('tarefa-autenticacao');
  assert.equal(s1.turnCount, 1);

  // Segunda chamada com mesma chave de sessao deve reutilizar instancia
  const s2 = sessionManager.getOrCreateSession('chatgpt', 'tarefa-autenticacao');
  assert.equal(s2.id, 'tarefa-autenticacao');
  assert.equal(s2.targetId, 'target-chatgpt-001');
  assert.equal(s2.turnCount, 1);
});

test('SessionManager - impede reutilizar a mesma sessionKey em provedor diferente', () => {
  const sessionManager = new SessionManager();
  sessionManager.getOrCreateSession('chatgpt', 'tarefa-autenticacao');

  assert.throws(
    () => {
      sessionManager.getOrCreateSession('perplexity', 'tarefa-autenticacao');
    },
    (err) => {
      return isBridgeError(err) && err.code === ERROR_CODES.BLOCKED_BY_POLICY;
    }
  );
});

test('SessionManager - buildDeltaPayload envia arquivo completo no 1o turno, UNCHANGED no 2o e novo conteudo no 3o', () => {
  const sessionManager = new SessionManager();
  sessionManager.getOrCreateSession('chatgpt', 'sessao-delta');

  // Turno 1: Arquivo virtual enviado pela primeira vez
  const fileV1 = { path: 'src/app.js', content: 'export const x = 10;' };
  const delta1 = sessionManager.buildDeltaPayload('sessao-delta', 'Explique o codigo', {
    contextFiles: [fileV1]
  });

  assert.equal(delta1.deltaStats.changedFiles, 1);
  assert.equal(delta1.deltaStats.unchangedFiles, 0);
  assert.ok(delta1.finalPrompt.includes('export const x = 10;'));
  sessionManager.recordTurn('sessao-delta');

  // Turno 2: Mesmo conteudo sem alteracao
  const delta2 = sessionManager.buildDeltaPayload('sessao-delta', 'Faca uma sugestao', {
    contextFiles: [fileV1]
  });

  assert.equal(delta2.deltaStats.changedFiles, 0);
  assert.equal(delta2.deltaStats.unchangedFiles, 1);
  assert.ok(delta2.deltaStats.savedBytes > 0);
  assert.ok(delta2.finalPrompt.includes('UNCHANGED_SHA256:'));
  assert.equal(delta2.finalPrompt.includes('export const x = 10;'), false);
  sessionManager.recordTurn('sessao-delta');

  // Turno 3: Arquivo com conteudo modificado
  const fileV2 = { path: 'src/app.js', content: 'export const x = 20;' };
  const delta3 = sessionManager.buildDeltaPayload('sessao-delta', 'Refatore a funcao', {
    contextFiles: [fileV2]
  });

  assert.equal(delta3.deltaStats.changedFiles, 1);
  assert.equal(delta3.deltaStats.unchangedFiles, 0);
  assert.ok(delta3.finalPrompt.includes('export const x = 20;'));
});

test('SessionManager - validateAttachments bloqueia arquivos proibidos e chave secreta, e permite anexo limpo', () => {
  const sessionManager = new SessionManager();

  // 1. Arquivos proibidos por deny-list
  const prohibited = ['.env', 'chave.pem', 'dump.sql', 'alunos_privado.csv'];
  for (const item of prohibited) {
    assert.throws(
      () => {
        sessionManager.validateAttachments([item]);
      },
      (err) => isBridgeError(err) && err.code === ERROR_CODES.BLOCKED_BY_POLICY,
      `Deveria bloquear ${item}`
    );
  }

  // 2. Anexo com conteudo contendo chave de API (sk-...)
  assert.throws(
    () => {
      sessionManager.validateAttachments([
        { path: 'config.txt', content: 'SECRET_KEY=sk-proj-1234567890abcdefghijklmnopqrstuv' }
      ]);
    },
    (err) => isBridgeError(err) && err.code === ERROR_CODES.BLOCKED_BY_POLICY,
    'Deveria bloquear anexo com chave da OpenAI'
  );

  // 3. Anexo tecnico limpo permitido
  const allowed = sessionManager.validateAttachments([
    { path: 'arquitetura.md', content: '# Arquitetura Tecnica\nDescricao de servicos.' }
  ]);
  assert.equal(allowed.length, 1);
});

// ---------------------------------------------------------------------------
// 3. Testes de regressao e contratos dos drivers
// ---------------------------------------------------------------------------

test('MCP Server - duas sessoes sequenciais diferentes executam no mesmo provedor sem TAB_BUSY (validando releaseLease no finally)', async () => {
  const mockPage = { url: () => 'https://www.perplexity.ai/' };
  let calls = 0;

  const mockCdpManager = {
    connect: async () => {},
    getContext: () => ({
      pages: () => [mockPage]
    }),
    getTargetId: async () => 'target-shared-tab-perplexity',
    insertTextViaCDP: async () => {},
    getStatus: async () => ({ cdpConnected: true, endpointUrl: 'http://127.0.0.1:9222' })
  };

  const mockDriver = {
    provider: 'perplexity',
    defaultModel: 'sonar',
    ensureTab: async () => mockPage,
    isLoggedIn: async () => true,
    newChat: async () => {},
    send: async () => {},
    waitDone: async () => true,
    extractAnswer: async () => {
      calls += 1;
      return { text: `Resposta ${calls}`, sources: [], model: 'sonar' };
    },
    stop: async () => true
  };

  const queueManager = new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 });
  const server = createBridgeServer({
    cdpManager: mockCdpManager,
    queueManager,
    drivers: { perplexity: mockDriver }
  });

  // Chamada 1 com 'sessao-1'
  const res1 = await server.invoke('ask_web_chat', {
    provider: 'perplexity',
    prompt: 'Pergunta da sessao 1',
    session: 'sessao-1'
  });
  assert.equal(res1.session, 'sessao-1');
  assert.equal(res1.text, 'Resposta 1');

  // Chamada 2 com 'sessao-2' na mesma aba (targetId) sequencialmente
  // Se o lease nao for liberado no finally, esta chamada lanca TAB_BUSY!
  const res2 = await server.invoke('ask_web_chat', {
    provider: 'perplexity',
    prompt: 'Pergunta da sessao 2',
    session: 'sessao-2'
  });
  assert.equal(res2.session, 'sessao-2');
  assert.equal(res2.text, 'Resposta 2');
});

test('Drivers - setModel e setMode sao honestos: nao fingem aplicar nem mexem na pagina', async () => {
  const drivers = [
    new PerplexityDriver(),
    new GeminiDriver(),
    new ChatGPTDriver()
  ];

  for (const driver of drivers) {
    let pageCalls = 0;
    const mockPage = {
      evaluate: async () => {
        pageCalls += 1;
      }
    };

    // 1. setMode: contrato presente, mas sem selecao real implementada
    assert.equal(typeof driver.setMode, 'function', `${driver.provider} deve implementar setMode`);
    const modeRes = await driver.setMode(mockPage, 'fast');
    assert.equal(modeRes.applied, false, `${driver.provider} nao pode afirmar que aplicou o modo`);
    assert.equal(modeRes.supported, false);
    assert.equal(modeRes.requested, 'fast');

    // 2. setModel: idem; o modelo informado e o padrao do driver, nunca o solicitado
    assert.equal(typeof driver.setModel, 'function', `${driver.provider} deve implementar setModel`);
    const defaultBefore = driver.defaultModel;
    const modelRes = await driver.setModel(mockPage, 'custom-model');
    assert.equal(modelRes.applied, false, `${driver.provider} nao pode afirmar que trocou o modelo`);
    assert.equal(modelRes.requested, 'custom-model');
    assert.equal(modelRes.model, defaultBefore, 'o modelo observado nao pode virar o solicitado');
    assert.equal(driver.defaultModel, defaultBefore, 'defaultModel nao pode ser alterado');
    assert.equal(pageCalls, 0, 'nenhum atributo pode ser escrito no DOM para simular a troca');
  }
});

test('Delta - falha no envio faz rollback de fileHashes e reenvia conteudo completo na tentativa seguinte', async () => {
  const mockPage = { url: () => 'https://chatgpt.com/' };
  let attempt = 0;
  let lastSentPrompt = null;

  const mockCdpManager = {
    connect: async () => {},
    getContext: () => ({
      pages: () => [mockPage]
    }),
    getTargetId: async () => 'target-rollback-test',
    insertTextViaCDP: async () => {},
    getStatus: async () => ({ cdpConnected: true, endpointUrl: 'http://127.0.0.1:9222' })
  };

  const mockDriver = {
    provider: 'chatgpt',
    defaultModel: 'chatgpt-web',
    ensureTab: async () => mockPage,
    isLoggedIn: async () => true,
    newChat: async () => {},
    send: async (_page, prompt) => {
      attempt += 1;
      lastSentPrompt = prompt;
      if (attempt === 1) {
        throw new BridgeError(ERROR_CODES.PROMPT_TIMEOUT, 'Falha simulada no primeiro envio');
      }
    },
    waitDone: async () => true,
    extractAnswer: async () => ({
      text: 'Resposta apos recuperacao de falha',
      sources: [],
      model: 'chatgpt-web'
    }),
    stop: async () => true
  };

  const queueManager = new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 });
  const sessionManager = new SessionManager();
  const server = createBridgeServer({
    cdpManager: mockCdpManager,
    queueManager,
    sessionManager,
    drivers: { chatgpt: mockDriver }
  });

  const virtualFiles = [
    { path: 'src/app.js', content: 'export const x = 10;' }
  ];

  // 1a chamada: deve falhar durante driver.send com PROMPT_TIMEOUT
  await assert.rejects(
    async () => {
      await server.invoke('ask_web_chat', {
        provider: 'chatgpt',
        prompt: 'Primeira tentativa',
        session: 'sessao-rollback',
        new_chat: false,
        context_files: virtualFiles
      });
    },
    (err) => isBridgeError(err) && err.code === ERROR_CODES.PROMPT_TIMEOUT
  );

  assert.equal(attempt, 1);
  assert.ok(lastSentPrompt.includes('export const x = 10;'));

  // 2a chamada na mesma session apos a falha: o rollback de fileHashes deve garantir
  // que o conteudo completo do arquivo seja reenviado (e NAO marcado como UNCHANGED_SHA256)
  const res2 = await server.invoke('ask_web_chat', {
    provider: 'chatgpt',
    prompt: 'Segunda tentativa',
    session: 'sessao-rollback',
    new_chat: false,
    context_files: virtualFiles
  });

  assert.equal(attempt, 2);
  assert.ok(
    lastSentPrompt.includes('export const x = 10;'),
    'O prompt da segunda tentativa deve conter o conteudo completo do arquivo'
  );
  assert.equal(
    lastSentPrompt.includes('UNCHANGED_SHA256'),
    false,
    'O prompt da segunda tentativa NAO pode conter UNCHANGED_SHA256'
  );
  assert.equal(res2.delta_stats?.changedFiles, 1);
  assert.equal(res2.delta_stats?.unchangedFiles, 0);
  assert.equal(res2.text, 'Resposta apos recuperacao de falha');
});
