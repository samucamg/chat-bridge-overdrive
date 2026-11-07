import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createBridgeServer, buildProgressMessage, makeProgressNotifier } from '../src/server.mjs';
import { DRIVERS } from '../src/doctor.mjs';
import { ProviderQueueManager } from '../src/queue.mjs';
import { MetadataLogger } from '../src/logger.mjs';

// Progresso (streaming aproximado): texto parcial enviado como notificacao MCP de progresso.

test('buildProgressMessage - modo text traz rotulo do provedor e o texto parcial', () => {
  assert.equal(buildProgressMessage({ provider: 'gemini', text: 'Ola mundo' }, 'text'), '[gemini] Ola mundo');
  assert.equal(buildProgressMessage({ text: 'sem rotulo' }, 'text'), 'sem rotulo');
});

test('buildProgressMessage - texto longo envia so o final, com reticencias', () => {
  const long = 'a'.repeat(3000) + 'FIM';
  const msg = buildProgressMessage({ provider: 'chatgpt', text: long }, 'text');
  assert.ok(msg.startsWith('[chatgpt] ...'));
  assert.ok(msg.endsWith('FIM'));
  assert.ok(msg.length < 2100);
});

test('buildProgressMessage - modos chars e off; texto vazio nao gera mensagem', () => {
  assert.equal(buildProgressMessage({ provider: 'claude', text: 'abcde' }, 'chars'), '[claude] 5 characters received');
  assert.equal(buildProgressMessage({ provider: 'claude', text: 'abcde' }, 'off'), null);
  assert.equal(buildProgressMessage({ provider: 'claude', text: '' }, 'text'), null);
});

test('makeProgressNotifier - sem progressToken ou em modo off nao cria notificador', () => {
  assert.equal(makeProgressNotifier(undefined, async () => {}, 'text'), undefined);
  assert.equal(makeProgressNotifier(null, async () => {}, 'text'), undefined);
  assert.equal(makeProgressNotifier('tok', async () => {}, 'off'), undefined);
});

test('makeProgressNotifier - envia notifications/progress com token, contador crescente e mensagem', async () => {
  const sent = [];
  const notify = makeProgressNotifier('tok-1', async (n) => { sent.push(n); }, 'text');
  await notify({ provider: 'gemini', text: 'um' });
  await notify({ provider: 'gemini', text: 'um dois' });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].method, 'notifications/progress');
  assert.equal(sent[0].params.progressToken, 'tok-1');
  assert.deepEqual(sent.map((n) => n.params.progress), [1, 2]);
  assert.equal(sent[1].params.message, '[gemini] um dois');
});

test('makeProgressNotifier - progressToken 0 e valido; falha no envio nunca propaga', async () => {
  const notify = makeProgressNotifier(0, async () => { throw new Error('transporte caiu'); }, 'text');
  assert.equal(typeof notify, 'function');
  await assert.doesNotReject(() => notify({ provider: 'x', text: 'abc' }));
});

function mockPageGrowing(texts) {
  let i = 0;
  return {
    evaluate: async (fn, arg) => {
      if (arg && typeof arg === 'object' && 'stopSel' in arg) {
        const t = texts[Math.min(i, texts.length - 1)];
        i += 1;
        return { isStopVisible: false, currentText: t, lastMutation: Date.now() };
      }
      return false;
    }
  };
}

test('waitDone - repassa o texto parcial a cada mudanca e conclui com o texto final', async () => {
  const d = DRIVERS.perplexity;
  const saved = [d.debounceMs, d.progressIntervalMs];
  d.debounceMs = 20;
  d.progressIntervalMs = 0;
  try {
    const partials = [];
    const page = mockPageGrowing(['Ola', 'Ola mundo', 'Ola mundo!', 'Ola mundo!']);
    const ok = await d.waitDone(page, 5000, null, (text) => partials.push(text));
    assert.equal(ok, true);
    assert.ok(partials.length >= 2, 'deve haver varios parciais');
    assert.equal(partials[0], 'Ola');
    assert.ok(partials.includes('Ola mundo'));
    assert.equal(partials[partials.length - 1], 'Ola mundo!');
    assert.equal(new Set(partials).size, partials.length, 'sem repetir o mesmo texto');
  } finally {
    [d.debounceMs, d.progressIntervalMs] = saved;
  }
});

test('waitDone - callback de progresso que lanca ou rejeita nao derruba a espera', async () => {
  const d = DRIVERS.perplexity;
  const saved = [d.debounceMs, d.progressIntervalMs];
  d.debounceMs = 20;
  d.progressIntervalMs = 0;
  try {
    const page = mockPageGrowing(['a', 'ab', 'ab']);
    assert.equal(await d.waitDone(page, 5000, null, () => { throw new Error('boom'); }), true);
    const page2 = mockPageGrowing(['a', 'ab', 'ab']);
    assert.equal(await d.waitDone(page2, 5000, null, async () => { throw new Error('boom async'); }), true);
  } finally {
    [d.debounceMs, d.progressIntervalMs] = saved;
  }
});

test('waitDone - respeita o intervalo minimo entre parciais', async () => {
  const d = DRIVERS.perplexity;
  const saved = [d.debounceMs, d.progressIntervalMs];
  d.debounceMs = 20;
  d.progressIntervalMs = 60000; // intervalo enorme: o primeiro parcial sai logo, os demais esperam
  try {
    const partials = [];
    const page = mockPageGrowing(['a', 'ab', 'abc', 'abc']);
    await d.waitDone(page, 5000, null, (t) => partials.push(t));
    assert.deepEqual(partials, ['a'], 'so o primeiro parcial sai; os demais ficam retidos pelo intervalo');
  } finally {
    [d.debounceMs, d.progressIntervalMs] = saved;
  }
});

function makeServerWithStreamingDriver(providers) {
  const pages = {};
  const drivers = {};
  for (const p of providers) {
    pages[p] = { url: () => `https://${p}.example/` };
    drivers[p] = {
      provider: p,
      defaultModel: `${p}-model`,
      ensureTab: async () => pages[p],
      isLoggedIn: async () => true,
      newChat: async () => {},
      send: async () => {},
      waitDone: async (_page, _timeout, _signal, onProgress) => {
        if (onProgress) {
          await onProgress(`${p} parcial 1`);
          await onProgress(`${p} parcial 1 e 2`);
        }
        return true;
      },
      extractAnswer: async () => ({ text: `final de ${p}`, sources: [], model: `${p}-model` }),
      stop: async () => true
    };
  }
  const logger = new MetadataLogger();
  const server = createBridgeServer({
    cdpManager: {
      connect: async () => {},
      getContext: () => ({ pages: () => Object.values(pages) }),
      getTargetId: async (page) => `t-${page.url()}`,
      insertTextViaCDP: async () => {},
      getStatus: async () => ({ cdpConnected: true })
    },
    drivers,
    logger,
    queueManager: new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 })
  });
  return { server, logger };
}

test('ask_<provedor> encaminha parciais ao onProgress com o rotulo do provedor', async () => {
  const { server } = makeServerWithStreamingDriver(['gemini']);
  const updates = [];
  const res = await server.invoke('ask_gemini', { prompt: 'ola' }, { onProgress: (u) => updates.push(u) });
  assert.equal(res.text, 'final de gemini');
  assert.deepEqual(updates, [
    { provider: 'gemini', text: 'gemini parcial 1' },
    { provider: 'gemini', text: 'gemini parcial 1 e 2' }
  ]);
});

test('compare_web_chats encaminha parciais de cada provedor com o seu rotulo', async () => {
  const { server } = makeServerWithStreamingDriver(['gemini', 'chatgpt']);
  const updates = [];
  await server.invoke(
    'compare_web_chats',
    { prompt: 'ola', providers: ['gemini', 'chatgpt'] },
    { onProgress: (u) => updates.push(u) }
  );
  for (const p of ['gemini', 'chatgpt']) {
    assert.ok(updates.some((u) => u.provider === p && u.text === `${p} parcial 1 e 2`), p);
  }
});

test('sem onProgress nada muda: waitDone recebe null e a resposta final e a mesma', async () => {
  const { server } = makeServerWithStreamingDriver(['claude']);
  const res = await server.invoke('ask_claude', { prompt: 'ola' });
  assert.equal(res.text, 'final de claude');
});

test('privacidade - o texto parcial nunca chega ao logger', async () => {
  const { server, logger } = makeServerWithStreamingDriver(['deepseek']);
  await server.invoke('ask_deepseek', { prompt: 'segredo-do-usuario' }, { onProgress: () => {} });
  const dump = JSON.stringify(logger.getRecent(50));
  assert.equal(dump.includes('parcial'), false, 'parcial nao pode ir para o log');
  assert.equal(dump.includes('segredo-do-usuario'), false, 'prompt nao pode ir para o log');
  assert.equal(dump.includes('final de deepseek'), false, 'resposta nao pode ir para o log');
});

test('servidor stdio real - tools/call com progressToken em _meta responde normalmente', async () => {
  const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.mjs');
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      lines.push(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  });
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
  try {
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'teste', version: '0' } }
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'preview_payload', arguments: { prompt: 'Explique ESM em uma frase.' }, _meta: { progressToken: 'tok' } }
    });
    const deadline = Date.now() + 15000;
    let response = null;
    while (Date.now() < deadline && !response) {
      await new Promise((r) => setTimeout(r, 50));
      response = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m && m.id === 2) || null;
    }
    assert.ok(response, 'deve responder ao tools/call');
    assert.ok(response.result, 'resultado esperado');
    assert.notEqual(response.result.isError, true);
  } finally {
    child.kill();
  }
});

test('diagnostico - makeProgressNotifier conta avisos enviados e erros de envio', async () => {
  const stats = { progress_notifications_sent: 0, progress_send_errors: 0 };
  const ok = makeProgressNotifier('tok', async () => {}, 'text', stats);
  await ok({ provider: 'x', text: 'a' });
  await ok({ provider: 'x', text: 'ab' });
  const bad = makeProgressNotifier('tok2', async () => { throw new Error('falhou'); }, 'text', stats);
  await bad({ provider: 'x', text: 'a' });
  assert.deepEqual(stats, { progress_notifications_sent: 2, progress_send_errors: 1 });
});

test('diagnostico - chat_bridge_status mostra os contadores de progresso, so numeros', async () => {
  const { server } = makeServerWithStreamingDriver(['gemini']);
  // simula uma chamada que pediu progresso e outra que nao pediu
  const sent = [];
  const withToken = server._progressFor('t1', async (n) => { sent.push(n); });
  await withToken({ provider: 'gemini', text: 'parcial secreto' });
  server._progressFor(undefined, async () => {});
  const status = await server.invoke('chat_bridge_status', {});
  assert.equal(status.progress.tool_calls_with_progress_token, 1);
  assert.equal(status.progress.tool_calls_without_progress_token, 1);
  assert.equal(status.progress.progress_notifications_sent, 1);
  assert.equal(status.progress.progress_send_errors, 0);
  assert.equal(JSON.stringify(status.progress).includes('parcial secreto'), false, 'nunca texto no diagnostico');
});
