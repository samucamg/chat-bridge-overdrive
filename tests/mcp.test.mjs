import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeServer, MCP_TOOLS } from '../src/server.mjs';
import { ERROR_CODES, BridgeError, isBridgeError } from '../src/errors.mjs';
import { MetadataLogger } from '../src/logger.mjs';
import { ProviderQueueManager } from '../src/queue.mjs';

test('MCP Tools - exposicao estrita e proibicao de Runtime.evaluate', () => {
  const toolNames = MCP_TOOLS.map((t) => t.name);

  // Deve expor exatamente as 5 ferramentas especificadas
  assert.ok(toolNames.includes('ask_web_chat'), 'Deve conter ask_web_chat');
  assert.ok(toolNames.includes('list_chat_sessions'), 'Deve conter list_chat_sessions');
  assert.ok(toolNames.includes('cancel_chat'), 'Deve conter cancel_chat');
  assert.ok(toolNames.includes('chat_bridge_status'), 'Deve conter chat_bridge_status');
  assert.ok(toolNames.includes('preview_payload'), 'Deve conter preview_payload');

  // Regra inegociavel: Runtime.evaluate ou execucao arbitraria NUNCA e tool MCP
  assert.equal(
    toolNames.includes('Runtime.evaluate'),
    false,
    'Runtime.evaluate NUNCA pode ser exposto como ferramenta MCP'
  );
  assert.equal(
    toolNames.some((n) => n.toLowerCase().includes('eval') || n.toLowerCase().includes('exec')),
    false,
    'Nenhuma ferramenta de avaliacao ou execucao de script pode ser exposta'
  );
});

test('MCP Server - preview_payload em modo dry-run com prompt seguro e com prompt com segredo', async () => {
  const logger = new MetadataLogger();
  const server = createBridgeServer({ logger });

  // 1. Prompt limpo e seguro
  const safeRes = await server.invoke('preview_payload', {
    provider: 'perplexity',
    prompt: 'Explique como funciona a arquitetura de microservicos com gRPC'
  });

  assert.equal(safeRes.allowed, true);
  assert.equal(safeRes.violations.length, 0);
  assert.ok(safeRes.payloadBytes > 0);
  assert.ok(safeRes.sanitizedPrompt.includes('gRPC'));

  // 2. Prompt com chave da OpenAI (sk-...)
  const dirtyRes = await server.invoke('preview_payload', {
    provider: 'perplexity',
    prompt: 'Use esta chave sk-proj-1234567890abcdefghijklmnopqrstuv para chamar o chat'
  });

  assert.equal(dirtyRes.allowed, false);
  assert.ok(dirtyRes.violations.length > 0);
  assert.equal(dirtyRes.violations[0].matchPreview, '[REDACTED]');
  assert.ok(dirtyRes.sanitizedPrompt.includes('[REDACTED:openai_key]'));

  // 3. Verifica que o preview foi registrado apenas com metadados no logger
  const logs = logger.getRecent(10);
  assert.ok(logs.length >= 2);
  for (const log of logs) {
    assert.equal(log.event, 'preview_payload');
    assert.equal(log.prompt, undefined, 'Logger nao pode conter prompt');
    assert.equal(log.text, undefined, 'Logger nao pode conter text');
  }
});

test('MCP Server - ask_web_chat bloqueia segredo com BLOCKED_BY_POLICY sem tocar no CDP ou Driver', async () => {
  let cdpConnected = false;
  let driverCalled = false;

  const mockCdpManager = {
    connect: async () => {
      cdpConnected = true;
    },
    getContext: () => ({}),
    getTargetId: async () => 'mock-target',
    getStatus: async () => ({ cdpConnected: false, endpointUrl: 'http://127.0.0.1:9222' })
  };

  const mockDriver = {
    ensureTab: async () => {
      driverCalled = true;
      return {};
    },
    isLoggedIn: async () => true,
    newChat: async () => {},
    send: async () => {
      driverCalled = true;
    },
    waitDone: async () => true,
    extractAnswer: async () => ({ text: 'mock', sources: [], model: 'mock' })
  };

  const logger = new MetadataLogger();
  const queueManager = new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 });

  const server = createBridgeServer({
    cdpManager: mockCdpManager,
    queueManager,
    logger,
    drivers: { perplexity: mockDriver }
  });

  // Chamada via callTool com chave secreta sk-...
  const callRes = await server.callTool('ask_web_chat', {
    provider: 'perplexity',
    prompt: 'Minha chave e sk-proj-1234567890abcdefghijklmnopqrstuv me ajude'
  });

  assert.equal(callRes.isError, true);
  assert.equal(callRes.errorCode, ERROR_CODES.BLOCKED_BY_POLICY);

  // Prova de que o sanitizador barrou antes do CDP e do Driver
  assert.equal(cdpConnected, false, 'CDP nao deve ser conectado se o payload for barrado');
  assert.equal(driverCalled, false, 'Driver nao deve ser acionado se o payload for barrado');
});

test('MCP Server - ask_web_chat com prompt limpo executa consulta e grava apenas metadados no logger', async () => {
  const mockPage = { url: () => 'https://www.perplexity.ai/' };
  let cdpConnected = false;
  let sentPrompt = null;

  const mockCdpManager = {
    connect: async () => {
      cdpConnected = true;
    },
    getContext: () => ({
      pages: () => [mockPage]
    }),
    getTargetId: async () => 'target-perplexity-clean',
    insertTextViaCDP: async (_p, text) => {
      sentPrompt = text;
    },
    getStatus: async () => ({ cdpConnected: true, endpointUrl: 'http://127.0.0.1:9222' })
  };

  const mockDriver = {
    provider: 'perplexity',
    ensureTab: async () => mockPage,
    isLoggedIn: async () => true,
    newChat: async () => {},
    send: async (_page, prompt, cdpManager) => {
      sentPrompt = prompt;
      await cdpManager.insertTextViaCDP(mockPage, prompt);
    },
    waitDone: async () => true,
    extractAnswer: async () => ({
      text: 'Resposta tecnica sobre Node.js e ESM',
      sources: [
        { title: 'Doc Node.js', url: 'https://nodejs.org/api/esm.html', index: 1 }
      ],
      model: 'sonar-pro'
    }),
    stop: async () => true
  };

  const logger = new MetadataLogger();
  const queueManager = new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 });

  const server = createBridgeServer({
    cdpManager: mockCdpManager,
    queueManager,
    logger,
    drivers: { perplexity: mockDriver }
  });

  const cleanPrompt = 'Como carregar modulos ESM nativamente no Node.js?';
  const result = await server.invoke('ask_web_chat', {
    provider: 'perplexity',
    prompt: cleanPrompt,
    session: 'sess-test-clean'
  });

  assert.equal(cdpConnected, true);
  assert.equal(sentPrompt, cleanPrompt);
  assert.equal(result.provider, 'perplexity');
  assert.equal(result.model, 'sonar-pro');
  assert.equal(result.session, 'sess-test-clean');
  assert.equal(result.text, 'Resposta tecnica sobre Node.js e ESM');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, 'https://nodejs.org/api/esm.html');
  assert.ok(result.duration_ms >= 0);

  // Verifica que o logger registrou estritamente metadados
  const logs = logger.getRecent(10);
  const askLog = logs.find((l) => l.event === 'ask_web_chat');
  assert.ok(askLog, 'Deve existir log do evento ask_web_chat');
  assert.equal(askLog.provider, 'perplexity');
  assert.equal(askLog.model, 'sonar-pro');
  assert.equal(askLog.session, 'sess-test-clean');
  assert.equal(askLog.targetId, 'target-perplexity-clean');
  assert.equal(askLog.status, 'ok');
  assert.ok(askLog.payload_bytes > 0);
  assert.ok(askLog.response_bytes > 0);
  assert.equal(askLog.sources_count, 1);

  // Prova de privacidade e retencao zero: NUNCA grava prompt ou text
  assert.equal(askLog.prompt, undefined, 'Log de ask_web_chat NUNCA pode gravar prompt');
  assert.equal(askLog.text, undefined, 'Log de ask_web_chat NUNCA pode gravar text');
  assert.equal(askLog.answer, undefined, 'Log de ask_web_chat NUNCA pode gravar answer');
  assert.equal(askLog.response, undefined, 'Log de ask_web_chat NUNCA pode gravar response');
});

test('MCP Server - list_chat_sessions e cancel_chat operam corretamente', async () => {
  const queueManager = new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 });
  const server = createBridgeServer({ queueManager });

  // Cria uma tarefa ativa para ser cancelada
  const taskPromise = queueManager.enqueue('perplexity', 'session-to-cancel', async (signal) => {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve('done'), 500);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new BridgeError(ERROR_CODES.CANCELLED, 'Cancelado'));
      });
    });
  });

  // Aguarda a tarefa iniciar
  await new Promise((r) => setTimeout(r, 20));

  const listRes = await server.invoke('list_chat_sessions');
  assert.ok(Array.isArray(listRes.sessions));
  assert.ok(Array.isArray(listRes.activeTasks));
  assert.equal(listRes.activeTasks.length, 1);
  assert.equal(listRes.activeTasks[0].sessionId, 'session-to-cancel');

  const cancelRes = await server.invoke('cancel_chat', { session: 'session-to-cancel' });
  assert.equal(cancelRes.success, true);
  assert.equal(cancelRes.session, 'session-to-cancel');

  await assert.rejects(
    async () => {
      await taskPromise;
    },
    (err) => {
      assert.ok(isBridgeError(err));
      assert.equal(err.code, ERROR_CODES.CANCELLED);
      return true;
    }
  );
});
