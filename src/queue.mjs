import { ERROR_CODES, BridgeError } from './errors.mjs';

/**
 * Gerenciador de fila por provedor e leases de abas (targetId).
 * Garante execucao paralela entre provedores diferentes (Perplexity vs Gemini vs ChatGPT)
 * e execucao estritamente serial dentro do mesmo provedor, com jitter configuravel.
 */
export class ProviderQueueManager {
  /**
   * @param {{ minDelayMs?: number, maxDelayMs?: number, sleepFn?: ((ms: number) => Promise<void>) | null }} options
   */
  constructor({ minDelayMs = 0, maxDelayMs = 0, sleepFn = null } = {}) {
    this.minDelayMs = Math.max(0, minDelayMs);
    this.maxDelayMs = Math.max(this.minDelayMs, maxDelayMs);
    this.sleepFn = sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    /** @type {Map<string, { items: Array<object>, running: boolean }>} */
    this.queues = new Map();

    /** @type {Map<string, { targetId: string, provider: string, sessionId: string, acquiredAt: number, expiresAt: number }>} */
    this.leases = new Map();

    /** @type {Map<string, object>} */
    this.activeTasks = new Map();
  }

  /**
   * Retorna ou instancia a fila associada a um provedor.
   * @private
   * @param {string} provider
   */
  _getProviderQueue(provider) {
    const key = String(provider || 'default').toLowerCase();
    if (!this.queues.has(key)) {
      this.queues.set(key, { items: [], running: false });
    }
    return this.queues.get(key);
  }

  /**
   * Remove registros de leases cujo TTL expirou.
   * @private
   * @param {number} now
   */
  _cleanExpiredLeases(now = Date.now()) {
    for (const [targetId, lease] of this.leases.entries()) {
      if (lease.expiresAt <= now) {
        this.leases.delete(targetId);
      }
    }
  }

  /**
   * Adquire ou renova o lease de uma aba para uma sessao.
   * @param {string} provider
   * @param {string} targetId
   * @param {string} sessionId
   * @param {number} ttlMs
   * @returns {{ targetId: string, provider: string, sessionId: string, acquiredAt: number, expiresAt: number }}
   */
  acquireLease(provider, targetId, sessionId, ttlMs = 1800000) {
    if (!targetId || !sessionId) {
      throw new BridgeError(ERROR_CODES.TAB_BUSY, 'targetId e sessionId sao obrigatorios para adquirir lease');
    }

    const now = Date.now();
    this._cleanExpiredLeases(now);

    const existing = this.leases.get(targetId);
    if (existing && existing.sessionId !== sessionId && existing.expiresAt > now) {
      throw new BridgeError(
        ERROR_CODES.TAB_BUSY,
        `Aba ${targetId} em uso pela sessao ${existing.sessionId} no provedor ${existing.provider}`,
        { targetId, currentSession: existing.sessionId, provider: existing.provider }
      );
    }

    const lease = {
      targetId,
      provider: String(provider).toLowerCase(),
      sessionId,
      acquiredAt: now,
      expiresAt: now + ttlMs
    };

    this.leases.set(targetId, lease);
    return lease;
  }

  /**
   * Libera o lease de uma aba.
   * @param {string} targetId
   * @param {string | null} sessionId
   * @returns {boolean}
   */
  releaseLease(targetId, sessionId = null) {
    if (!targetId) return false;
    const existing = this.leases.get(targetId);
    if (!existing) return false;

    if (sessionId && existing.sessionId !== sessionId) {
      return false;
    }

    this.leases.delete(targetId);
    return true;
  }

  /**
   * Lista todos os leases atualmente validos.
   * @returns {Array<object>}
   */
  getLeases() {
    this._cleanExpiredLeases();
    return Array.from(this.leases.values()).map((l) => ({ ...l }));
  }

  /**
   * Calcula delay com jitter entre tarefas do mesmo provedor.
   * @private
   * @returns {number}
   */
  _calculateDelay() {
    if (this.maxDelayMs <= 0) return 0;
    if (this.maxDelayMs === this.minDelayMs) return this.minDelayMs;
    const range = this.maxDelayMs - this.minDelayMs;
    return Math.floor(this.minDelayMs + Math.random() * range);
  }

  /**
   * Enfileira execucao de tarefa na fila dedicada do provedor.
   * @param {string} provider
   * @param {string} sessionId
   * @param {(signal: AbortSignal) => Promise<any>} taskFn
   * @param {{ targetId?: string | null, timeoutMs?: number }} options
   * @returns {Promise<any>}
   */
  enqueue(provider, sessionId, taskFn, { targetId = null, timeoutMs = 120000 } = {}) {
    const provKey = String(provider || 'default').toLowerCase();
    const abortController = new AbortController();

    // Se targetId fornecido, tenta validar lease imediatamente
    if (targetId) {
      this.acquireLease(provKey, targetId, sessionId);
    }

    const taskId = `${provKey}_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    return new Promise((resolve, reject) => {
      const taskItem = {
        id: taskId,
        provider: provKey,
        sessionId,
        targetId,
        taskFn,
        timeoutMs,
        abortController,
        resolve,
        reject,
        status: 'pending',
        enqueuedAt: Date.now()
      };

      const q = this._getProviderQueue(provKey);
      q.items.push(taskItem);

      this.activeTasks.set(sessionId, {
        id: taskId,
        provider: provKey,
        sessionId,
        targetId,
        status: 'pending',
        startedAt: null,
        abortController
      });

      this._drainQueue(provKey);
    });
  }

  /**
   * Processa a fila sequencialmente para o provedor especificado.
   * @private
   * @param {string} provider
   */
  async _drainQueue(provider) {
    const q = this._getProviderQueue(provider);
    if (q.running) {
      return;
    }

    q.running = true;

    try {
      while (q.items.length > 0) {
        const item = q.items.shift();

        if (item.status === 'cancelled') {
          continue;
        }

        if (item.abortController.signal.aborted) {
          item.reject(new BridgeError(ERROR_CODES.CANCELLED, 'Operacao cancelada antes do inicio da execucao'));
          this.activeTasks.delete(item.sessionId);
          continue;
        }

        item.status = 'running';
        const startedAt = Date.now();

        this.activeTasks.set(item.sessionId, {
          id: item.id,
          provider: item.provider,
          sessionId: item.sessionId,
          targetId: item.targetId,
          status: 'running',
          startedAt,
          abortController: item.abortController
        });

        // Garantir lease caso tenha sido informado targetId
        if (item.targetId) {
          try {
            this.acquireLease(item.provider, item.targetId, item.sessionId);
          } catch (err) {
            item.status = 'failed';
            item.reject(err);
            this.activeTasks.delete(item.sessionId);
            continue;
          }
        }

        let timeoutTimer = null;
        let timedOut = false;

        if (item.timeoutMs > 0) {
          timeoutTimer = setTimeout(() => {
            timedOut = true;
            item.status = 'timed_out';
            item.abortController.abort();
          }, item.timeoutMs);
        }

        try {
          const result = await item.taskFn(item.abortController.signal);

          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
          }

          if (timedOut) {
            item.reject(
              new BridgeError(
                ERROR_CODES.PROMPT_TIMEOUT,
                `Tempo limite de ${item.timeoutMs}ms excedido aguardando resposta`
              )
            );
          } else if (item.abortController.signal.aborted) {
            item.reject(
              new BridgeError(ERROR_CODES.CANCELLED, 'Operacao cancelada durante a execucao')
            );
          } else {
            item.status = 'completed';
            item.resolve(result);
          }
        } catch (err) {
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
          }

          if (timedOut) {
            item.reject(
              new BridgeError(
                ERROR_CODES.PROMPT_TIMEOUT,
                `Tempo limite de ${item.timeoutMs}ms excedido aguardando resposta`
              )
            );
          } else if (item.abortController.signal.aborted) {
            item.reject(
              new BridgeError(ERROR_CODES.CANCELLED, 'Operacao cancelada durante a execucao')
            );
          } else {
            item.status = 'failed';
            item.reject(err);
          }
        } finally {
          this.activeTasks.delete(item.sessionId);
        }

        // Delay com jitter se houver cooldown configurado
        const delay = this._calculateDelay();
        if (delay > 0) {
          await this.sleepFn(delay);
        }
      }
    } finally {
      q.running = false;
    }
  }

  /**
   * Cancela a sessao ativa ou em espera na fila.
   * @param {string} sessionId
   * @returns {{ cancelled: boolean, sessionId: string }}
   */
  cancelSession(sessionId) {
    if (!sessionId) {
      return { cancelled: false, sessionId };
    }

    let found = false;

    // Cancela tarefa ativa
    const active = this.activeTasks.get(sessionId);
    if (active) {
      found = true;
      active.status = 'cancelled';
      active.abortController.abort();
      this.activeTasks.delete(sessionId);
    }

    // Cancela e remove de itens pendentes na fila
    for (const q of this.queues.values()) {
      for (let i = q.items.length - 1; i >= 0; i--) {
        const item = q.items[i];
        if (item.sessionId === sessionId) {
          found = true;
          item.status = 'cancelled';
          item.abortController.abort();
          item.reject(new BridgeError(ERROR_CODES.CANCELLED, 'Operacao cancelada pelo usuario'));
          q.items.splice(i, 1);
        }
      }
    }

    return { cancelled: found, sessionId };
  }

  /**
   * Retorna o estado atual das filas, sessoes ativas e leases.
   * @returns {{ queues: Record<string, { pending: number, running: boolean }>, activeSessions: Array<object>, leases: Array<object> }}
   */
  getStatus() {
    const queuesStatus = {};
    for (const [p, q] of this.queues.entries()) {
      queuesStatus[p] = {
        pending: q.items.length,
        running: Boolean(q.running)
      };
    }

    const activeSessions = [];
    for (const [sId, task] of this.activeTasks.entries()) {
      activeSessions.push({
        sessionId: sId,
        provider: task.provider,
        targetId: task.targetId,
        status: task.status,
        startedAt: task.startedAt
      });
    }

    return {
      queues: queuesStatus,
      activeSessions,
      leases: this.getLeases()
    };
  }
}
