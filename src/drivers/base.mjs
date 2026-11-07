import { BridgeError, ERROR_CODES } from '../errors.mjs';

/**
 * Seletores globais para deteccao imediata de desafios anti-bot, Cloudflare Turnstile e CAPTCHA.
 */
export const ANOMALY_SELECTORS = Object.freeze([
  'iframe[src*="challenges.cloudflare.com"]',
  '#challenge-running',
  '#cf-challenge-running',
  '[data-sitekey]',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]'
]);

/**
 * Seletores globais para deteccao de telas de login ou sessao expirada.
 */
export const SESSION_EXPIRED_SELECTORS = Object.freeze([
  'form[action*="/auth/login"]',
  'form[action*="/login"]',
  'input[type="password"]',
  '[data-testid="login-button"]',
  'a[href*="/auth/login"]',
  '[data-testid="auth-wall"]'
]);

/**
 * Avalia no DOM se ha desafio Cloudflare ou CAPTCHA visivel.
 * Lanca AUTH_REQUIRED imediatamente caso detectado.
 * @param {any} page
 * @returns {Promise<void>}
 */
export async function checkAnomalies(page) {
  if (!page || typeof page.evaluate !== 'function') return;

  const detected = await page.evaluate((selectors) => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          if (!style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0')) {
            return sel;
          }
        }
      } catch (e) {}
    }
    return null;
  }, ANOMALY_SELECTORS).catch(() => null);

  if (detected) {
    throw new BridgeError(
      ERROR_CODES.AUTH_REQUIRED,
      'Desafio anti-bot ou CAPTCHA detectado; abortando imediatamente: ' + detected
    );
  }
}

/**
 * Avalia no DOM se ha tela de login, sessao expirada ou auth-wall visivel sem o editor de chat.
 * Lanca AUTH_REQUIRED imediatamente caso detectado.
 * @param {any} page
 * @param {string|object|null} [inputSelector=null]
 * @returns {Promise<void>}
 */
export async function checkSessionExpired(page, inputSelector = null) {
  if (!page || typeof page.evaluate !== 'function') return;

  const inSel = typeof inputSelector === 'string'
    ? inputSelector
    : (inputSelector && typeof inputSelector === 'object'
      ? Object.values(inputSelector).map(v => typeof v === 'string' ? v : v?.selector).filter(Boolean).join(', ')
      : '');

  const isExpired = await page.evaluate(({ authSelectors, inputSel }) => {
    let hasAuthElement = false;
    for (const sel of authSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          if (!style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0')) {
            hasAuthElement = true;
            break;
          }
        }
      } catch (e) {}
    }

    if (!hasAuthElement) {
      return false;
    }

    // Se houver elemento de login, verifica se o editor de input esta presente e visivel
    if (inputSel) {
      try {
        const inputEl = document.querySelector(inputSel);
        if (inputEl) {
          const style = window.getComputedStyle ? window.getComputedStyle(inputEl) : null;
          if (!style || (style.display !== 'none' && style.visibility !== 'hidden')) {
            return false;
          }
        }
      } catch (e) {}
    }

    return true;
  }, { authSelectors: SESSION_EXPIRED_SELECTORS, inputSel: inSel }).catch(() => false);

  if (isExpired) {
    throw new BridgeError(
      ERROR_CODES.AUTH_REQUIRED,
      'Sessao de login expirada ou autenticacao necessaria'
    );
  }
}

/**
 * Classe base abstrata definindo o contrato unico de driver para provedores web.
 */
export class BaseDriver {
  /**
   * @param {object} options
   * @param {string} options.provider Identificador do provedor (ex: perplexity, gemini)
   * @param {string} options.targetUrl URL base do servico
   * @param {number} [options.debounceMs=400] Janela de estabilizacao do texto em ms
   * @param {object} [options.selectors={}] Mapeamento de seletores em 3 niveis
   * @param {string|null} [options.defaultModel=null] Nome padrao do modelo
   */
  constructor({ provider, targetUrl, debounceMs = 400, selectors = {}, defaultModel = null } = {}) {
    this.provider = provider;
    this.targetUrl = targetUrl;
    this.debounceMs = debounceMs;
    this.selectors = selectors;
    this.defaultModel = defaultModel || `${provider}-web`;
  }

  /**
   * Verifica anomalias e expiracao de sessao no DOM da pagina ativa.
   * @param {any} page
   * @returns {Promise<void>}
   */
  async checkAnomalies(page) {
    await checkAnomalies(page);
    await this.checkSessionExpired(page);
  }

  /**
   * Verifica se ha tela de login/senha sem o editor de chat presente na pagina.
   * @param {any} page
   * @returns {Promise<void>}
   */
  async checkSessionExpired(page) {
    const inputSel = this.getSelectorString(this.selectors?.input);
    return checkSessionExpired(page, inputSel);
  }

  /**
   * Converte um grupo de seletores de 3 niveis em uma string CSS combinada.
   * @param {object|string} selectorGroup
   * @returns {string}
   */
  getSelectorString(selectorGroup, { maxLevel = 3 } = {}) {
    if (!selectorGroup) return '';
    if (typeof selectorGroup === 'string') return selectorGroup;
    const parts = [];
    for (const level of ['level1', 'level2', 'level3'].slice(0, maxLevel)) {
      const item = selectorGroup[level];
      if (!item) continue;
      const sel = typeof item === 'string' ? item : item.selector;
      if (sel) parts.push(sel);
    }
    return parts.join(', ');
  }

  /**
   * Verifica se uma URL pertence ao provedor alvo.
   * @param {string} url
   * @returns {boolean}
   */
  matchesUrl(url) {
    if (!url || !this.targetUrl) return false;
    try {
      const u1 = new URL(url);
      const u2 = new URL(this.targetUrl);
      return u1.origin === u2.origin;
    } catch (e) {
      return url.includes(this.provider);
    }
  }

  /**
   * Tenta resolver o seletor na ordem level1 -> level2 -> level3 no DOM.
   * Retorna metadados de correspondencia com grau de confianca.
   * @param {any} page
   * @param {object} selectorGroup
   * @returns {Promise<{ matchedSelector: string|null, level: string, confidence: string, count: number }>}
   */
  async resolveSelector(page, selectorGroup) {
    if (!page || !selectorGroup) {
      return { matchedSelector: null, level: 'none', confidence: 'Nenhuma', count: 0 };
    }
    const levels = ['level1', 'level2', 'level3'];
    for (const level of levels) {
      const item = selectorGroup[level];
      if (!item) continue;
      const sel = typeof item === 'string' ? item : item.selector;
      const confidence = typeof item === 'object' && item.confidence
        ? item.confidence
        : (level === 'level1' ? 'Alta' : (level === 'level2' ? 'Media' : 'Baixa'));
      if (!sel) continue;

      try {
        const count = await page.evaluate((s) => {
          try {
            return document.querySelectorAll(s).length;
          } catch (e) {
            return 0;
          }
        }, sel);

        if (count > 0) {
          return { matchedSelector: sel, level, confidence, count };
        }
      } catch (e) {
        // Ignora seletores nao suportados ou erro de DOM
      }
    }
    return { matchedSelector: null, level: 'none', confidence: 'Nenhuma', count: 0 };
  }

  /**
   * Localiza uma aba aberta correspondente ou abre uma nova.
   * @param {any} context Contexto do navegador Playwright
   * @param {object} [options]
   * @returns {Promise<any>}
   */
  async ensureTab(context, options = {}) {
    if (!context) {
      throw new BridgeError(ERROR_CODES.CDP_UNAVAILABLE, 'Contexto do navegador nao fornecido');
    }
    const pages = typeof context.pages === 'function' ? context.pages() : [];
    for (const page of pages) {
      const pageUrl = typeof page.url === 'function' ? page.url() : (page.url || '');
      if (this.matchesUrl(pageUrl)) {
        if (typeof page.bringToFront === 'function') {
          await page.bringToFront().catch(() => {});
        }
        return page;
      }
    }

    if (typeof context.newPage !== 'function') {
      throw new BridgeError(ERROR_CODES.CDP_UNAVAILABLE, 'Contexto nao suporta abertura de abas');
    }
    const newPage = await context.newPage();
    if (this.targetUrl && typeof newPage.goto === 'function') {
      await newPage.goto(this.targetUrl, { waitUntil: 'domcontentloaded', ...options });
    }
    return newPage;
  }

  /**
   * Verifica se ha sessao autenticada ativa.
   * @param {any} page
   * @returns {Promise<boolean>}
   */
  async isLoggedIn(page) {
    await this.checkAnomalies(page);
    if (!page || !this.selectors?.input) return false;
    const resolved = await this.resolveSelector(page, this.selectors.input);
    return resolved.count > 0;
  }

  /**
   * Aguarda o editor de texto aparecer (ex.: apos recarregar a pagina em newChat).
   * Melhor esforco: nunca lanca; retorna true se o editor foi encontrado.
   * @param {any} page
   * @param {number} [timeoutMs=10000]
   * @returns {Promise<boolean>}
   */
  async waitForComposer(page, timeoutMs = 10000) {
    if (!page || typeof page.waitForSelector !== 'function') return false;
    const sel = this.getSelectorString(this.selectors?.input);
    if (!sel) return false;
    try {
      await page.waitForSelector(sel, { state: 'attached', timeout: timeoutMs });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Inicia nova conversa no provedor.
   * @param {any} page
   * @returns {Promise<void>}
   */
  async newChat(page) {
    if (!page) return;
    const newChatSel = this.getSelectorString(this.selectors?.newChatBtn, { maxLevel: 2 });
    let clicked = false;
    if (newChatSel && typeof page.evaluate === 'function') {
      clicked = await page.evaluate((sel) => {
        try {
          const btn = document.querySelector(sel);
          if (btn) {
            btn.click();
            return true;
          }
        } catch (e) {}
        return false;
      }, newChatSel);
    }
    if (!clicked && typeof page.goto === 'function' && this.targetUrl) {
      await page.goto(this.targetUrl, { waitUntil: 'domcontentloaded' });
    }
    await this.waitForComposer(page);
  }

  /**
   * Define o modo de operacao do modelo se aplicavel.
   * @param {any} page
   * @param {string} mode
   * @returns {Promise<string>}
   */
  async setMode(page, mode) {
    return { supported: false, applied: false, requested: mode ?? null };
  }

  /**
   * Define o modelo de operacao do provedor se suportado.
   * @param {any} page
   * @param {string} model
   * @returns {Promise<{ supported: boolean, model: string }>}
   */
  async setModel(page, model) {
    return { supported: false, applied: false, requested: model ?? null, model: this.defaultModel };
  }

  /**
   * Indica se a aba esta gerando uma resposta agora (botao parar visivel). Usado para nao tomar uma
   * aba em uso: uso manual do usuario ou outro cliente MCP.
   * @param {any} page
   * @returns {Promise<boolean>}
   */
  async isGenerating(page) {
    const stopSel = this.getSelectorString(this.selectors?.stopBtn, { maxLevel: 2 });
    if (!page || typeof page.evaluate !== 'function' || !stopSel) return false;
    try {
      return Boolean(await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (!btn) return false;
        const style = window.getComputedStyle ? window.getComputedStyle(btn) : null;
        return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
      }, stopSel));
    } catch (e) {
      return false;
    }
  }

  /**
   * Registra o estado das respostas ANTES do envio (quantidade e texto da ultima). O waitDone usa
   * esse baseline para nao confundir a resposta do turno anterior com a do turno atual em
   * conversas continuadas.
   * @param {any} page
   * @returns {Promise<{ count: number, lastText: string }>}
   */
  async captureBaseline(page) {
    const sel = this.getSelectorString(this.selectors?.response);
    if (!page || typeof page.evaluate !== 'function' || !sel) return { count: 0, lastText: '' };
    try {
      const base = await page.evaluate((s) => {
        const els = document.querySelectorAll(s);
        return {
          count: els.length,
          lastText: els.length ? (els[els.length - 1].textContent || '').trim() : ''
        };
      }, sel);
      return base && typeof base === 'object' ? base : { count: 0, lastText: '' };
    } catch (e) {
      return { count: 0, lastText: '' };
    }
  }

  /**
   * Registra o estado das respostas ANTES do envio (quantidade e texto da ultima). O waitDone usa
   * esse baseline para nao confundir a resposta do turno anterior com a do turno atual em
   * conversas continuadas.
   * @param {any} page
   * @returns {Promise<{ count: number, lastText: string }>}
   */
  async captureBaseline(page) {
    const sel = this.getSelectorString(this.selectors?.response);
    if (!page || typeof page.evaluate !== 'function' || !sel) return { count: 0, lastText: '' };
    try {
      const base = await page.evaluate((s) => {
        const els = document.querySelectorAll(s);
        return {
          count: els.length,
          lastText: els.length ? (els[els.length - 1].textContent || '').trim() : ''
        };
      }, sel);
      return base && typeof base === 'object' ? base : { count: 0, lastText: '' };
    } catch (e) {
      return { count: 0, lastText: '' };
    }
  }

  /**
   * Registra o estado das respostas ANTES do envio (quantidade e texto da ultima). O waitDone usa
   * esse baseline para nao confundir a resposta do turno anterior com a do turno atual em
   * conversas continuadas.
   * @param {any} page
   * @returns {Promise<{ count: number, lastText: string }>}
   */
  async captureBaseline(page) {
    const sel = this.getSelectorString(this.selectors?.response);
    if (!page || typeof page.evaluate !== 'function' || !sel) return { count: 0, lastText: '' };
    try {
      const base = await page.evaluate((s) => {
        const els = document.querySelectorAll(s);
        return {
          count: els.length,
          lastText: els.length ? (els[els.length - 1].textContent || '').trim() : ''
        };
      }, sel);
      return base && typeof base === 'object' ? base : { count: 0, lastText: '' };
    } catch (e) {
      return { count: 0, lastText: '' };
    }
  }

  /**
   * Envia texto para o chat via CDP ou fallback.
   * @param {any} page
   * @param {string} text
   * @param {any} cdpManager
   * @returns {Promise<void>}
   */
  async send(page, text, cdpManager) {
    throw new Error('Metodo send() deve ser implementado pelo driver especifico');
  }

  /**
   * Aguarda conclusao da geracao de resposta sem polling cego.
   * @param {any} page
   * @param {number} [timeoutMs=60000]
   * @param {AbortSignal|null} [signal=null]
   * @returns {Promise<boolean>}
   */
  async waitDone(page, timeoutMs = 60000, signal = null, onProgress = null, baseline = null) {
    const debounceMs = this.debounceMs || 400;
    const progressIntervalMs = this.progressIntervalMs ?? 800;
    let lastReportedText = '';
    let lastReportTime = 0;
    const startTime = Date.now();
    let lastText = '';
    let lastChangeTime = Date.now();
    let hasStarted = false;

    const stopSelector = this.getSelectorString(this.selectors?.stopBtn, { maxLevel: 2 });
    const responseSelector = this.getSelectorString(this.selectors?.response);

    if (page && typeof page.evaluate === 'function') {
      await page.evaluate(() => {
        if (!window.__bridgeObserver && typeof MutationObserver !== 'undefined') {
          window.__bridgeLastMutation = Date.now();
          window.__bridgeObserver = new MutationObserver(() => {
            window.__bridgeLastMutation = Date.now();
          });
          const target = document.body || document.documentElement;
          if (target) {
            window.__bridgeObserver.observe(target, {
              childList: true,
              subtree: true,
              characterData: true
            });
          }
        } else {
          window.__bridgeLastMutation = Date.now();
        }
      }).catch(() => {});
    }

    while (true) {
      if (signal && signal.aborted) {
        await this.stop(page).catch(() => {});
        throw new BridgeError(ERROR_CODES.CANCELLED, 'Geracao cancelada');
      }

      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        throw new BridgeError(
          ERROR_CODES.PROMPT_TIMEOUT,
          'Tempo limite excedido aguardando resposta'
        );
      }

      await this.checkAnomalies(page);

      const state = await page.evaluate(({ stopSel, respSel }) => {
        let isStopVisible = false;
        if (stopSel) {
          try {
            const btn = document.querySelector(stopSel);
            if (btn) {
              const style = window.getComputedStyle ? window.getComputedStyle(btn) : null;
              if (!style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0')) {
                isStopVisible = true;
              }
            }
          } catch (e) {}
        }

        let currentText = '';
        let count = 0;
        if (respSel) {
          try {
            const elements = document.querySelectorAll(respSel);
            count = elements.length;
            if (elements.length > 0) {
              const lastEl = elements[elements.length - 1];
              currentText = (lastEl.textContent || '').trim();
            }
          } catch (e) {}
        }

        const lastMutation = window.__bridgeLastMutation || 0;

        return { isStopVisible, currentText, count, lastMutation };
      }, { stopSel: stopSelector, respSel: responseSelector }).catch(() => ({
        isStopVisible: false,
        currentText: '',
        count: 0,
        lastMutation: 0
      }));

      if (state.isStopVisible) {
        hasStarted = true;
      }
      if (baseline) {
        // Conversa continuada: so conta como "comecou" quando surge um novo bloco de resposta, o
        // texto da ultima resposta muda ou o botao parar aparece. Texto igual ao do baseline e a
        // resposta do turno anterior, nunca a deste turno.
        const grew = (state.count || 0) > (baseline.count || 0);
        const changed = state.currentText.length > 0 && state.currentText !== (baseline.lastText || '');
        if (grew || changed) {
          hasStarted = true;
        }
      } else if (state.currentText && state.currentText.length > 0) {
        hasStarted = true;
      }

      if (state.currentText !== lastText) {
        lastText = state.currentText;
        lastChangeTime = Date.now();
      }

      // Texto parcial para o cliente MCP (notificacao de progresso). Nunca bloqueia nem
      // derruba a espera: erros do callback sao ignorados.
      if (
        typeof onProgress === 'function' &&
        state.currentText &&
        state.currentText !== lastReportedText &&
        Date.now() - lastReportTime >= progressIntervalMs
      ) {
        lastReportedText = state.currentText;
        lastReportTime = Date.now();
        try {
          Promise.resolve(onProgress(state.currentText)).catch(() => {});
        } catch (e) {
          // ignora
        }
      }

      const stableByText = Date.now() - lastChangeTime;
      const stableByMutation = state.lastMutation > 0
        ? (Date.now() - state.lastMutation)
        : stableByText;
      // Paginas com animacao ou relogio mutam o DOM o tempo todo (ex.: Perplexity, ~12 mutacoes/s
      // em repouso). Se o texto da resposta nao muda ha 5x o debounce, considera estavel mesmo
      // com ruido no DOM; caso contrario exige texto e DOM quietos pelo debounce.
      const textStable = stableByText >= debounceMs;
      const domStable = stableByMutation >= debounceMs;
      const isStable = textStable && (domStable || stableByText >= debounceMs * 5);

      if (hasStarted && !state.isStopVisible && state.currentText.length > 0 && isStable) {
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Extrai a resposta gerada e fontes da pagina.
   * @param {any} page
   * @returns {Promise<{ text: string, sources: Array<{ title: string, url: string, index: number }>, model?: string }>}
   */
  async extractAnswer(page) {
    throw new Error('Metodo extractAnswer() deve ser implementado pelo driver especifico');
  }

  /**
   * Interrompe a geracao em andamento clicando no botao Stop.
   * @param {any} page
   * @returns {Promise<boolean>}
   */
  async stop(page) {
    if (!page || !this.selectors?.stopBtn) return false;
    const stopSel = this.getSelectorString(this.selectors.stopBtn, { maxLevel: 2 });
    if (!stopSel) return false;
    try {
      const clicked = await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      }, stopSel);
      return Boolean(clicked);
    } catch (e) {
      return false;
    }
  }

  /**
   * Executa auto-diagnostico na pagina verificando correspondencia de seletores e status de login.
   * @param {any} page
   * @returns {Promise<{ provider: string, healthy: boolean, loggedIn: boolean, selectors: object }>}
   */
  async diagnose(page) {
    await this.checkAnomalies(page);
    const selectorResults = {};
    let anyMatched = false;

    if (this.selectors) {
      for (const [key, group] of Object.entries(this.selectors)) {
        if (key === 'thoughtFilter') continue;
        const res = await this.resolveSelector(page, group);
        selectorResults[key] = res;
        if (res.count > 0) anyMatched = true;
      }
    }

    let loggedIn = false;
    try {
      loggedIn = await this.isLoggedIn(page);
    } catch (e) {
      loggedIn = false;
    }

    return {
      provider: this.provider,
      healthy: anyMatched && loggedIn,
      loggedIn,
      selectors: selectorResults
    };
  }
}
