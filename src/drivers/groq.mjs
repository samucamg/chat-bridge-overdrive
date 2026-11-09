import { BaseDriver } from './base.mjs';
import { BridgeError, ERROR_CODES } from '../errors.mjs';

/**
 * Cadeia oficial de fallback de modelos do Groq em caso de rate limit (429).
 */
export const GROQ_MODEL_FALLBACK_CHAIN = Object.freeze([
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-20b'
]);

/**
 * Modelos bloqueados no Groq (ex: dialetos nao autorizados).
 */
export const GROQ_BLOCKED_MODELS = Object.freeze([
  'canopylabs/orpheus-arabic-saudi'
]);

/**
 * Mapeamento de seletores em 3 niveis para o Groq (chat.groq.com).
 * Utiliza exclusivamente seletores CSS W3C validos (sem pseudoclasses proprietarias).
 */
export const GROQ_SELECTORS = Object.freeze({
  composer: {
    level1: {
      selector: 'textarea#chat[rows], textarea#chat',
      confidence: 'Alta'
    },
    level2: {
      selector: 'textarea#chat',
      confidence: 'Alta'
    },
    level3: {
      selector: 'textarea[placeholder="Try it"], textarea[placeholder*="Ask"], textarea',
      confidence: 'Baixa'
    }
  },
  input: {
    level1: {
      selector: 'textarea#chat[rows], textarea#chat',
      confidence: 'Alta'
    },
    level2: {
      selector: 'textarea#chat',
      confidence: 'Alta'
    },
    level3: {
      selector: 'textarea[placeholder="Try it"], textarea[placeholder*="Ask"], textarea',
      confidence: 'Baixa'
    }
  },
  sendBtn: {
    level1: {
      selector: 'button[type="submit"]:has(svg path[d*="M120-160v-240l320-80"]), button[type="submit"]:has(svg)',
      confidence: 'Alta'
    },
    level2: {
      selector: 'button[type="submit"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'button[type="submit"], form button',
      confidence: 'Baixa'
    }
  },
  stopBtn: {
    level1: {
      selector: 'button[aria-label*="Stop" i], button[aria-label*="stop" i]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'button[data-testid*="stop" i]',
      confidence: 'Media'
    },
    level3: {
      selector: 'button:has(svg rect)',
      confidence: 'Baixa'
    }
  },
  responseBlock: {
    level1: {
      selector: 'div.font-inter.pl-10px',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div.font-inter',
      confidence: 'Media'
    },
    level3: {
      selector: 'main div.flex.flex-col.font-normal',
      confidence: 'Baixa'
    }
  },
  responseText: {
    level1: {
      selector: 'div.font-inter.pl-10px',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div.font-inter',
      confidence: 'Media'
    },
    level3: {
      selector: 'p, pre, table, ul, ol',
      confidence: 'Baixa'
    }
  },
  response: {
    level1: {
      selector: 'div.font-inter.pl-10px',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div.font-inter',
      confidence: 'Media'
    },
    level3: {
      selector: 'main div.flex.flex-col.font-normal',
      confidence: 'Baixa'
    }
  },
  thinkingBlock: {
    level1: {
      selector: '[class*="think"], [class*="reason"], details',
      confidence: 'Alta'
    },
    level2: {
      selector: 'summary',
      confidence: 'Media'
    },
    level3: {
      selector: '.thinking',
      confidence: 'Baixa'
    }
  },
  thoughtFilter: '[class*="think"], [class*="reason"], details, summary, .thinking',
  citationLinks: {
    level1: {
      selector: 'div.font-inter a[href^="http"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div.font-inter a[target="_blank"][href^="http"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'main div.font-inter a[href^="http"]',
      confidence: 'Baixa'
    }
  },
  citations: {
    level1: {
      selector: 'div.font-inter a[href^="http"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div.font-inter a[target="_blank"][href^="http"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'main div.font-inter a[href^="http"]',
      confidence: 'Baixa'
    }
  },
  newChatBtn: {
    level1: {
      selector: 'button[aria-label*="Clear" i], button[aria-label*="New" i], a[href*="/?model="]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'header button, nav button, button[data-testid*="clear"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'a[href*="/?model="], button',
      confidence: 'Baixa'
    }
  },
  modelSelectorBtn: {
    level1: {
      selector: 'button:has(svg.lucide-chevrons-up-down), button:has(svg[class*="chevrons"])',
      confidence: 'Alta'
    },
    level2: {
      selector: 'header button:has(p.truncate), button:has(p.truncate)',
      confidence: 'Media'
    },
    level3: {
      selector: 'header button',
      confidence: 'Baixa'
    }
  },
  rateLimitBanner: {
    level1: {
      selector: '[data-sonner-toast], [data-sonner-toaster], [role="alert"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div.toast-error, .toast-error, div[class*="toast"]',
      confidence: 'Media'
    },
    level3: {
      selector: '[role="status"], div[class*="alert"]',
      confidence: 'Baixa'
    }
  },
  fileInput: {
    level1: {
      selector: 'input[type="file"]',
      confidence: 'Media'
    },
    level2: {
      selector: 'input[accept]',
      confidence: 'Media'
    },
    level3: {
      selector: 'input[type="file"]',
      confidence: 'Baixa'
    }
  },
  captcha: {
    level1: {
      selector: 'iframe[src*="challenges.cloudflare.com"], #cf-challenge-running',
      confidence: 'Alta'
    },
    level2: {
      selector: '#challenge-running, [data-sitekey]',
      confidence: 'Media'
    },
    level3: {
      selector: 'iframe[src*="turnstile"]',
      confidence: 'Baixa'
    }
  },
  loginIndicator: {
    level1: {
      selector: 'a[href*="/login"], a[href*="/signin"], a[href*="/auth"], button[aria-label*="Log in" i]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'form input[type="email"], form input[type="password"]',
      confidence: 'Media'
    },
    level3: {
      selector: '.login-page, [data-testid*="login"]',
      confidence: 'Baixa'
    }
  }
});

/**
 * Driver para automacao e consulta ao Groq via CDP.
 */
export class GroqDriver extends BaseDriver {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    super({
      provider: 'groq',
      targetUrl: 'https://chat.groq.com/?model=qwen/qwen3.8-27b',
      debounceMs: 400,
      selectors: GROQ_SELECTORS,
      ...options
    });
    this.name = 'groq';
    this.urlMatch = 'chat.groq.com';
    this.preferredModel = options.model || 'qwen/qwen3.8-27b';
    this.activeModel = this.preferredModel;
    this.defaultModel = this.activeModel;
  }

  /**
   * Verifica se uma URL pertence ao dominio do Groq.
   * @param {string} url
   * @returns {boolean}
   */
  matchesUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      return host === 'chat.groq.com' || host === 'groq.com' || host.endsWith('.groq.com');
    } catch (e) {
      return url.includes('groq.com');
    }
  }

  /**
   * Verifica se ha sessao ativa no Groq.
   * @param {any} page
   * @returns {Promise<boolean>}
   */
  async isLoggedIn(page) {
    try {
      await this.checkAnomalies(page);
    } catch (err) {
      if (err.code === ERROR_CODES.AUTH_REQUIRED) return false;
      throw err;
    }

    if (!page || typeof page.evaluate !== 'function') return false;

    const inputSel = this.getSelectorString(this.selectors.input);
    const result = await page.evaluate((sel) => {
      const url = window.location ? (window.location.href || '') : '';
      if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) {
        return { loggedIn: false };
      }

      let hasInput = false;
      try {
        const inputEl = document.querySelector(sel);
        if (inputEl) {
          const style = window.getComputedStyle ? window.getComputedStyle(inputEl) : null;
          if (!style || (style.display !== 'none' && style.visibility !== 'hidden')) {
            hasInput = true;
          }
        }
      } catch (e) {}

      return { loggedIn: hasInput };
    }, inputSel).catch(() => ({ loggedIn: false }));

    return Boolean(result && (result.loggedIn || result === true));
  }

  /**
   * Verifica a URL atual do Groq. Se nao tiver model= ou se for modelo arabe bloqueado,
   * navega para o modelo ativo e aguarda o composer.
   * @param {any} page
   * @returns {Promise<void>}
   */
  async ensureValidModel(page) {
    if (!page) return;
    const currentUrl = typeof page.url === 'function' ? page.url() : (page.url || '');
    const isBlocked = GROQ_BLOCKED_MODELS.some((m) => currentUrl.includes(m));
    const hasModel = currentUrl.includes('model=');

    if (!hasModel || isBlocked) {
      const target = `https://chat.groq.com/?model=${encodeURIComponent(this.activeModel)}`;
      if (typeof page.goto === 'function') {
        await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
      if (typeof this.waitForComposer === 'function') {
        await this.waitForComposer(page, 5000).catch(() => {});
      }
    }
  }

  /**
   * Detecta defensivamente se apareceu mensagem de Rate Limit (429) no DOM via JS puro.
   * @param {any} page
   * @returns {Promise<boolean>}
   */
  async detectRateLimit429(page) {
    if (!page || typeof page.evaluate !== 'function') return false;

    try {
      const detected = await page.evaluate(() => {
        const candidates = document.querySelectorAll('[data-sonner-toast], [role="alert"], div.toast-error, [data-sonner-toaster], div');
        for (const el of candidates) {
          const text = (el.textContent || '').toLowerCase();
          if (text.includes('429') || text.includes('rate limit') || text.includes('too many requests')) {
            const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
            if (!style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0')) {
              return true;
            }
          }
        }
        return false;
      });
      return Boolean(detected);
    } catch (e) {
      return false;
    }
  }

  /**
   * Alterna o modelo selecionado no dropdown ou via URL.
   * @param {any} page
   * @param {string} nextModel
   * @returns {Promise<void>}
   */
  async switchModel(page, nextModel) {
    if (!nextModel) return;

    if (page && typeof page.evaluate === 'function') {
      const btnSel = this.getSelectorString(this.selectors.modelSelectorBtn, { maxLevel: 2 });
      await page.evaluate(async ({ btnSel, nextModel }) => {
        try {
          const btn = btnSel ? document.querySelector(btnSel) : null;
          if (btn) {
            btn.click();
            await new Promise((r) => setTimeout(r, 50));
            let option = document.querySelector(`[role="option"][data-value="${nextModel}"], [role="menuitem"][data-value="${nextModel}"]`);
            if (!option) {
              const options = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], button'));
              option = options.find((el) => (el.textContent || '').includes(nextModel));
            }
            if (option) {
              option.click();
            }
          }
        } catch (e) {}
      }, { btnSel, nextModel }).catch(() => {});
    }

    if (page && typeof page.goto === 'function') {
      const targetUrl = `https://chat.groq.com/?model=${encodeURIComponent(nextModel)}`;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      if (typeof this.waitForComposer === 'function') {
        await this.waitForComposer(page, 5000).catch(() => {});
      }
    }

    this.activeModel = nextModel;
    this.defaultModel = nextModel;
  }

  /**
   * Envia prompt de texto para o editor do Groq com protecao e fallback 429 sequencial.
   * @param {any} page
   * @param {string} prompt
   * @param {any} [cdpManager]
   * @param {number} [retryCount=0]
   * @returns {Promise<void>}
   */
  async send(page, prompt, cdpManager = null, retryCount = 0) {
    await this.checkAnomalies(page);

    const loggedIn = await this.isLoggedIn(page);
    if (!loggedIn) {
      throw new BridgeError(
        ERROR_CODES.AUTH_REQUIRED,
        'Sessao deslogada ou editor de texto do Groq nao encontrado'
      );
    }

    await this.ensureValidModel(page);

    const inputSel = this.getSelectorString(this.selectors.input, { maxLevel: 2 }) || 'textarea#chat';
    const focused = await page.evaluate((sel) => {
      try {
        const el = document.querySelector(sel);
        if (el) {
          el.focus();
          return true;
        }
      } catch (e) {}
      return false;
    }, inputSel);

    if (!focused) {
      throw new BridgeError(
        ERROR_CODES.AUTH_REQUIRED,
        'Editor de texto do Groq nao encontrado para foco'
      );
    }

    // Limpeza previa de rascunho residual
    await page.evaluate((sel) => {
      try {
        const el = document.querySelector(sel);
        if (el) {
          el.value = '';
          if (typeof el.dispatchEvent === 'function') {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      } catch (e) {}
    }, inputSel);

    // Inserir texto
    if (cdpManager && typeof cdpManager.insertTextViaCDP === 'function') {
      await cdpManager.insertTextViaCDP(page, prompt);
    } else if (typeof page.fill === 'function') {
      try {
        await page.fill(inputSel, prompt);
      } catch (e) {
        await page.evaluate(({ sel, val }) => {
          const el = document.querySelector(sel) || document.activeElement;
          if (el) {
            el.value = (el.value || '') + val;
            if (typeof el.dispatchEvent === 'function') {
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        }, { sel: inputSel, val: prompt });
      }
    } else {
      await page.evaluate(({ sel, val }) => {
        const el = document.querySelector(sel) || document.activeElement;
        if (el) {
          el.value = (el.value || '') + val;
          if (typeof el.dispatchEvent === 'function') {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }, { sel: inputSel, val: prompt });
    }

    // Clica no botao de envio com limite estrito maxLevel: 2
    const sendSel = this.getSelectorString(this.selectors.sendBtn, { maxLevel: 2 });
    const submitted = await page.evaluate((sel) => {
      if (sel) {
        try {
          const btn = document.querySelector(sel);
          if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
            btn.click();
            return true;
          }
        } catch (e) {}
      }
      return false;
    }, sendSel).catch(() => false);

    if (!submitted) {
      if (typeof page.keyboard?.press === 'function') {
        await page.keyboard.press('Enter');
      } else {
        await page.evaluate(() => {
          const el = document.activeElement;
          if (el && typeof el.dispatchEvent === 'function') {
            el.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true
            }));
          }
        });
      }
    }

    // Checagem imediata de Rate Limit 429 nos primeiros ~600ms com rotacao sequencial
    await new Promise((r) => setTimeout(r, 600));
    const is429 = await this.detectRateLimit429(page);
    if (is429 && retryCount < GROQ_MODEL_FALLBACK_CHAIN.length) {
      const currentIdx = GROQ_MODEL_FALLBACK_CHAIN.indexOf(this.activeModel);
      const candidates = currentIdx >= 0
        ? GROQ_MODEL_FALLBACK_CHAIN.slice(currentIdx + 1)
        : GROQ_MODEL_FALLBACK_CHAIN;
      const nextModel = candidates.find(
        (m) => !GROQ_BLOCKED_MODELS.includes(m)
      );
      if (nextModel) {
        await this.switchModel(page, nextModel);
        return await this.send(page, prompt, cdpManager, retryCount + 1);
      }
    }
  }

  /**
   * Inicia nova conversa no Groq.
   * @param {any} page
   * @returns {Promise<void>}
   */
  async newChat(page) {
    if (!page) return;
    const newChatSel = this.getSelectorString(this.selectors.newChatBtn, { maxLevel: 2 });
    let clicked = false;
    if (page && typeof page.evaluate === 'function') {
      clicked = await page.evaluate((sel) => {
        try {
          if (sel) {
            const btn = document.querySelector(sel);
            if (btn) {
              btn.click();
              return true;
            }
          }
          const allBtns = Array.from(document.querySelectorAll('button, a'));
          const target = allBtns.find((b) => {
            const t = (b.textContent || '').trim().toLowerCase();
            const a = (b.getAttribute('aria-label') || '').toLowerCase();
            return t.includes('clear chat') || t.includes('new chat') || a.includes('clear chat');
          });
          if (target) {
            target.click();
            return true;
          }
        } catch (e) {}
        return false;
      }, newChatSel);
    }

    const currentUrl = typeof page.url === 'function' ? page.url() : (page.url || '');
    const isBlocked = GROQ_BLOCKED_MODELS.some((m) => currentUrl.includes(m));

    if (!clicked || isBlocked) {
      if (typeof page.goto === 'function') {
        const targetUrl = `https://chat.groq.com/?model=${encodeURIComponent(this.preferredModel)}`;
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }

    if (typeof this.waitForComposer === 'function') {
      await this.waitForComposer(page);
    }
  }

  /**
   * Extrai o texto da ultima resposta do assistente.
   * @param {any} page
   * @returns {Promise<string>}
   */
  async extractResponse(page) {
    if (!page || typeof page.evaluate !== 'function') return '';

    const rL1 = this.selectors?.responseBlock?.level1?.selector || 'div.font-inter.pl-10px';
    const rL2 = this.selectors?.responseBlock?.level2?.selector || 'div.font-inter';
    const rL3 = this.selectors?.responseBlock?.level3?.selector || 'main div.flex.flex-col.font-normal';
    const tSel = this.selectors?.thoughtFilter || '[class*="think"], [class*="reason"], details, summary, .thinking';

    return await page.evaluate(({ rL1, rL2, rL3, tSel }) => {
      let target = null;
      for (const sel of [rL1, rL2, rL3]) {
        if (!sel) continue;
        try {
          const els = document.querySelectorAll(sel);
          if (els && els.length > 0) {
            target = els[els.length - 1];
            break;
          }
        } catch (e) {}
      }

      if (!target) return '';

      const clone = target.cloneNode(true);
      if (tSel) {
        try {
          const thoughts = clone.querySelectorAll(tSel);
          thoughts.forEach((el) => el.remove());
        } catch (e) {}
      }

      try {
        const btns = clone.querySelectorAll('button');
        btns.forEach((b) => b.remove());
      } catch (e) {}

      return (clone.textContent || '').trim();
    }, { rL1, rL2, rL3, tSel }).catch(() => '');
  }

  /**
   * Extrai links de citacao e fontes da pagina.
   * @param {any} page
   * @returns {Promise<Array<{ title: string, url: string, index: number }>>}
   */
  async extractSources(page) {
    if (!page || typeof page.evaluate !== 'function') return [];
    const citSel = this.getSelectorString(this.selectors.citationLinks);

    return await page.evaluate((cSel) => {
      const sources = [];
      const seenUrls = new Set();
      if (!cSel) return sources;
      try {
        const links = document.querySelectorAll(cSel);
        let idx = 1;
        for (const a of links) {
          const href = (a.getAttribute('href') || '').trim();
          if (href && /^https?:\/\//i.test(href) && !href.startsWith('javascript:') && href !== '#') {
            if (!seenUrls.has(href)) {
              seenUrls.add(href);
              sources.push({
                title: (a.textContent || '').trim() || href,
                url: href,
                index: idx++
              });
            }
          }
        }
      } catch (e) {}
      return sources;
    }, citSel).catch(() => []);
  }

  /**
   * Extrai a resposta completa (texto, fontes e modelo) gerada pelo Groq.
   * @param {any} page
   * @returns {Promise<{ text: string, sources: Array<{ title: string, url: string, index: number }>, model: string }>}
   */
  async extractAnswer(page) {
    const text = await this.extractResponse(page);
    const sources = await this.extractSources(page);
    return {
      text,
      sources,
      model: this.activeModel || this.defaultModel || 'qwen/qwen3.8-27b'
    };
  }

  /**
   * Configura o modelo no Groq.
   * @param {any} page
   * @param {string} model
   * @returns {Promise<{ supported: boolean, applied: boolean, requested: string, model: string }>}
   */
  async setModel(page, model) {
    if (!model) {
      return { supported: true, applied: false, requested: null, model: this.activeModel };
    }
    if (GROQ_BLOCKED_MODELS.includes(model)) {
      return { supported: false, applied: false, requested: model, model: this.activeModel };
    }
    await this.switchModel(page, model);
    return { supported: true, applied: true, requested: model, model: this.activeModel };
  }
}
