import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderQueueManager } from '../src/queue.mjs';
import { ERROR_CODES, BridgeError, isBridgeError } from '../src/errors.mjs';

test('Queue - executa em paralelo entre provedores diferentes com sobreposicao temporal', async () => {
  const qm = new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 });

  let perplexityStartedAt = 0;
  let perplexityEndedAt = 0;
  let geminiStartedAt = 0;
  let geminiEndedAt = 0;

  const t1 = qm.enqueue('perplexity', 'sess-p1', async () => {
    perplexityStartedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 60));
    perplexityEndedAt = Date.now();
    return 'perplexity-done';
  });

  const t2 = qm.enqueue('gemini', 'sess-g1', async () => {
    geminiStartedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 60));
    geminiEndedAt = Date.now();
    return 'gemini-done';
  });

  const [res1, res2] = await Promise.all([t1, t2]);

  assert.equal(res1, 'perplexity-done');
  assert.equal(res2, 'gemini-done');

  // Ambas as tarefas devem ter iniciado antes que a outra terminasse (sobreposicao temporal real)
  assert.ok(perplexityStartedAt > 0);
  assert.ok(geminiStartedAt > 0);
  assert.ok(
    geminiStartedAt < perplexityEndedAt,
    `Gemini iniciou (${geminiStartedAt}) antes de Perplexity terminar (${perplexityEndedAt})`
  );
  assert.ok(
    perplexityStartedAt < geminiEndedAt,
    `Perplexity iniciou (${perplexityStartedAt}) antes de Gemini terminar (${geminiEndedAt})`
  );
});

test('Queue - executa estritamente serial no mesmo provedor', async () => {
  const qm = new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 });

  let task1FinishedAt = 0;
  let task2StartedAt = 0;

  const t1 = qm.enqueue('perplexity', 'sess-1', async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    task1FinishedAt = Date.now();
    return 'task1-ok';
  });

  const t2 = qm.enqueue('perplexity', 'sess-2', async () => {
    task2StartedAt = Date.now();
    return 'task2-ok';
  });

  const [res1, res2] = await Promise.all([t1, t2]);

  assert.equal(res1, 'task1-ok');
  assert.equal(res2, 'task2-ok');

  // Task 2 so pode iniciar estritamente apos o fim de Task 1
  assert.ok(
    task2StartedAt >= task1FinishedAt,
    `Task 2 iniciou (${task2StartedAt}) antes ou no mesmo instante de Task 1 (${task1FinishedAt})`
  );
});

test('Queue - gerencia leases por targetId e detecta TAB_BUSY', () => {
  const qm = new ProviderQueueManager();

  // Adquire lease para target-1 com session-A
  const leaseA = qm.acquireLease('perplexity', 'target-1', 'session-A');
  assert.equal(leaseA.targetId, 'target-1');
  assert.equal(leaseA.sessionId, 'session-A');
  assert.equal(leaseA.provider, 'perplexity');

  // Tentar adquirir o mesmo target-1 com session-B enquanto ativo lanca TAB_BUSY
  assert.throws(
    () => {
      qm.acquireLease('perplexity', 'target-1', 'session-B');
    },
    (err) => {
      assert.ok(isBridgeError(err));
      assert.equal(err.code, ERROR_CODES.TAB_BUSY);
      assert.equal(err.details?.targetId, 'target-1');
      assert.equal(err.details?.currentSession, 'session-A');
      return true;
    }
  );

  // Re-adquirir com a mesma session-A e permitido (renovacao)
  const leaseARenewed = qm.acquireLease('perplexity', 'target-1', 'session-A');
  assert.equal(leaseARenewed.sessionId, 'session-A');

  // Apos releaseLease, session-B consegue adquirir
  const released = qm.releaseLease('target-1', 'session-A');
  assert.equal(released, true);

  const leaseB = qm.acquireLease('perplexity', 'target-1', 'session-B');
  assert.equal(leaseB.sessionId, 'session-B');
  assert.equal(leaseB.targetId, 'target-1');

  // Lista leases ativos
  const leases = qm.getLeases();
  assert.equal(leases.length, 1);
  assert.equal(leases[0].sessionId, 'session-B');
});

test('Queue - cancelSession cancela tarefa ativa e remove da fila lancando CANCELLED', async () => {
  const qm = new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 });

  // Inicia tarefa longa
  const longTask = qm.enqueue('perplexity', 'sess-cancel-1', async (signal) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve('not-cancelled'), 500);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new BridgeError(ERROR_CODES.CANCELLED, 'Interrompido por signal'));
      });
    });
  });

  // Aguarda a tarefa iniciar
  await new Promise((resolve) => setTimeout(resolve, 20));

  // Cancela a sessao
  const cancelResult = qm.cancelSession('sess-cancel-1');
  assert.equal(cancelResult.cancelled, true);
  assert.equal(cancelResult.sessionId, 'sess-cancel-1');

  await assert.rejects(
    async () => {
      await longTask;
    },
    (err) => {
      assert.ok(isBridgeError(err));
      assert.equal(err.code, ERROR_CODES.CANCELLED);
      return true;
    }
  );
});

test('Queue - aborta e lanca PROMPT_TIMEOUT quando estoura o tempo limite', async () => {
  const qm = new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 });

  await assert.rejects(
    async () => {
      await qm.enqueue(
        'gemini',
        'sess-timeout',
        async () => {
          // Demora mais que timeoutMs (50ms)
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'should-not-reach';
        },
        { timeoutMs: 50 }
      );
    },
    (err) => {
      assert.ok(isBridgeError(err));
      assert.equal(err.code, ERROR_CODES.PROMPT_TIMEOUT);
      return true;
    }
  );
});

test('Queue - getStatus retorna metricas consistentes de filas e sessoes', async () => {
  const qm = new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 });

  qm.acquireLease('perplexity', 'target-status-1', 'sess-stat');

  const status = qm.getStatus();
  assert.ok(status.queues);
  assert.ok(Array.isArray(status.activeSessions));
  assert.ok(Array.isArray(status.leases));
  assert.equal(status.leases.length, 1);
  assert.equal(status.leases[0].targetId, 'target-status-1');
});
