import { BaseDriver } from './base.mjs';
import { BridgeError, ERROR_CODES } from '../errors.mjs';

/**
 * Modos gratuitos suportados no Grok sem assinatura SuperGrok.
 */
export const GROK_FREE_MODES = Object.freeze(['Fast', 'Build']);

/**
 * Modos que exigem paywall ou assinatura SuperGrok paga.
 */
export const GROK_PAYWALL_MODES = Object.freeze(['Auto', 'Expert', 'Heavy']);

/**
 * Mapeamento de seletores em 3 niveis para o Grok (grok.com).
 * Utiliza exclusivamente seletores CSS W3C validos (sem pseudoclasses proprietarias).
 */
export const GROK_SELECTORS = Object.freeze({
  composer: {
    level1: {
      selector: 'div.tiptap.ProseMirror[contenteditable="true"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div.tiptap.ProseMirror, div[contenteditable="true"][role="textbox"]',
      confidence: 'Media'
    },
    level3: {
      selector: '[contenteditable="true"]',
      confidence: 'Baixa'
    }
  },
  input: {
    level1: {
      selector: 'div.tiptap.ProseMirror[contenteditable="true"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div.tiptap.ProseMirror, div[contenteditable="true"][role="textbox"]',
      confidence: 'Media'
    },
    level3: {
      selector: '[contenteditable="true"]',
      confidence: 'Baixa'
    }
  },
  sendBtn: {
    level1: {
      selector: 'button[data-testid="chat-submit"], button[data-composer-action="send"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'button[type="submit"], button[aria-label*="Send" i], button[aria-label*="Enviar" i]',
      confidence: 'Media'
    },
    level3: {
      selector: 'button[type="submit"], footer button',
      confidence: 'Baixa'
    }
  },
  stopBtn: {
    level1: {
      selector: 'button[data-composer-action="stop"], button[aria-label*="Parar" i], button[aria-label*="Stop" i]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'button[data-composer-action="stop"], button[aria-label*="Stop" i]',
      confidence: 'Media'
    },
    level3: {
      selector: 'button.stop-button, button:has(svg rect)',
      confidence: 'Baixa'
    }
  },
  responseBlock: {
    level1: {
      selector: 'div[data-testid="assistant-message"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div.message-bubble[role="article"][data-testid="assistant-message"]',
      confidence: 'Media'
    },
    level3: {
      selector: '.assistant-message',
      confidence: 'Baixa'
    }
  },
  responseText: {
    level1: {
      selector: 'div.response-content-markdown',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div.streamdown-chat-md, .markdown',
      confidence: 'Media'
    },
    level3: {
      selector: 'p, pre, table, ul, ol',
      confidence: 'Baixa'
    }
  },
  response: {
    level1: {
      selector: 'div[data-testid="assistant-message"] div.response-content-markdown, div.response-content-markdown',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div[data-testid="assistant-message"] div.streamdown-chat-md, div[data-testid="assistant-message"] .markdown',
      confidence: 'Media'
    },
    level3: {
      selector: 'div[data-testid="assistant-message"]',
      confidence: 'Baixa'
    }
  },
  thinkingBlock: {
    level1: {
      selector: 'div[data-testid="conversation-thought"], div[data-testid="conversation-trace-slot"], button[data-testid="conversation-thought-toggle"]',
      confidence: 'Alta'
    },
    level2: {
      selector: '[class*="thought"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'details',
      confidence: 'Baixa'
    }
  },
  thoughtFilter: 'div[data-testid="conversation-thought"], div[data-testid="conversation-trace-slot"], button[data-testid="conversation-thought-toggle"], [class*="thought"], details',
  citationLinks: {
    level1: {
      selector: 'div[data-testid="assistant-message"] div.response-content-markdown a[href^="http"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div[data-testid="assistant-message"] a[href^="http"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'div.response-content-markdown a[href^="http"]',
      confidence: 'Baixa'
    }
  },
  citations: {
    level1: {
      selector: 'div[data-testid="assistant-message"] div.response-content-markdown a[href^="http"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div[data-testid="assistant-message"] a[href^="http"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'div.response-content-markdown a[href^="http"]',
      confidence: 'Baixa'
    }
  },
  newChatBtn: {
    level1: {
      selector: 'button[aria-label="Novo bate-papo"], button[aria-label="New chat"], a[href="/"][aria-label*="New" i]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'button[aria-label*="bate-papo" i], button[aria-label*="chat" i]',
      confidence: 'Media'
    },
    level3: {
      selector: 'a[href="/"], nav a[href="/"]',
      confidence: 'Baixa'
    }
  },
  modelSelectorBtn: {
    level1: {
      selector: 'button#model-select-trigger, button[aria-label^="Modelo:"], button[aria-label^="Model:"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'button#model-select-trigger, [data-testid="model-select-trigger"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'button[aria-haspopup="menu"]',
      confidence: 'Baixa'
    }
  },
  fileInput: {
    level1: {
      selector: 'input[type="file"][name="files"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'input[type="file"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'input[accept]',
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
      selector: 'a[href*="/login"], a[href*="/signin"], a[href*="/sign-in"], a[href*="/i/flow/login"], button[aria-label*="Sign in" i]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'form input[type="password"], form input[type="email"]',
      confidence: 'Media'
    },
    level3: {
      selector: '.auth-wall, [data-testid="auth-wall"]',
      confidence: 'Baixa'
    }
  }
});

/**
 * Driver para automacao e consulta ao Grok (xAI) via CDP.
 */
export class GrokDriver extends BaseDriver {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    super({
      provider: 'grok',
      targetUrl: 'https://grok.com/',
      debounceMs: 400,
      selectors: GROK_SELECTORS,
      ...options
    });
    this.name = 'grok';
    this.urlMatch = 'grok.com';
    this.preferredMode = options.mode || 'Fast';
    this.defaultModel = options.model || 'grok-fast';
  }

  /**
   * Verifica se uma URL pertence ao ecossistema do Grok.
   * @param {string} url
   * @returns {boolean}
   */
  matchesUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      return host === 'grok.com' || host.endsWith('.grok.com') || host === 'x.ai' || host.endsWith('.x.ai');
    } catch (e) {
      return url.includes('grok.com') || url.includes('x.ai');
    }
  }

  /**
   * Verifica se ha sessao ativa no Grok.
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
      if (url.includes('/login') || url.includes('/signin') || url.includes('/auth') || url.includes('/i/flow/login')) {
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
   * Garante modo gratuito ('Fast' ou preferredMode), fechando dialogos de paywall se presentes.
   * @param {any} page
   * @returns {Promise<void>}
   */
  async ensureFreeMode(page) {
    if (!page || typeof page.evaluate !== 'function') return;

    try {
      await page.evaluate(({ preferredMode }) => {
        // 1. Fecha modal de paywall SuperGrok se presente
        try {
          const dialog = document.querySelector('div[role="dialog"]');
          if (dialog) {
            const text = (dialog.textContent || '').toLowerCase();
            if (text.includes('supergrok')) {
              const btns = Array.from(dialog.querySelectorAll('button'));
              const closeBtn = btns.find((b) => {
                const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
                return label.includes('close') || label.includes('fechar') || label.trim().toLowerCase() === 'x';
              }) || btns[0];
              if (closeBtn) {
                closeBtn.click();
              } else if (typeof document.dispatchEvent === 'function') {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
              }
            }
          }
        } catch (e) {}

        // 2. Seletor de modelo para modo gratuito
        try {
          const trigger = document.querySelector('button#model-select-trigger, button[aria-label^="Modelo:"], button[aria-label^="Model:"]');
          if (trigger) {
            const label = (trigger.getAttribute('aria-label') || trigger.textContent || '').toLowerCase();
            const isPaywall = ['auto', 'expert', 'heavy'].some((m) => label.includes(m));
            if (isPaywall) {
              trigger.click();
              const items = Array.from(document.querySelectorAll('div[role="menuitemcheckbox"], div[role="menuitem"], [role="menuitem"]'));
              const option = items.find((el) => (el.textContent || '').includes(preferredMode));
              if (option) option.click();
            }
          }
        } catch (e) {}
      }, { preferredMode: this.preferredMode });
    } catch (e) {
      // Bloco seguro para nao quebrar em mocks sem modelSelectorBtn
    }
  }

  /**
   * Envia prompt de texto para o editor do Grok.
   * @param {any} page
   * @param {string} prompt
   * @param {any} [cdpManager]
   * @returns {Promise<void>}
   */
  async send(page, prompt, cdpManager = null) {
    await this.checkAnomalies(page);

    const loggedIn = await this.isLoggedIn(page);
    if (!loggedIn) {
      throw new BridgeError(
        ERROR_CODES.AUTH_REQUIRED,
        'Sessao deslogada ou editor de texto do Grok nao encontrado'
      );
    }

    await this.ensureFreeMode(page);

    const inputSel = this.getSelectorString(this.selectors.input, { maxLevel: 2 }) || 'div.tiptap.ProseMirror[contenteditable="true"]';
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
        'Editor de texto do Grok nao encontrado para foco'
      );
    }

    // Limpeza previa do editor TipTap
    await page.evaluate((sel) => {
      try {
        const el = document.querySelector(sel);
        if (el) {
          if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
            el.textContent = '';
            if (typeof el.dispatchEvent === 'function') {
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } else if ('value' in el) {
            el.value = '';
            if (typeof el.dispatchEvent === 'function') {
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        }
      } catch (e) {}
    }, inputSel);

    // Inserir texto via CDP ou fallback
    if (cdpManager && typeof cdpManager.insertTextViaCDP === 'function') {
      await cdpManager.insertTextViaCDP(page, prompt);
    } else {
      await page.evaluate((val) => {
        const el = document.activeElement;
        if (!el) return;
        if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
          const inserted = typeof document.execCommand === 'function' ? document.execCommand('insertText', false, val) : false;
          if (!inserted) {
            el.textContent = (el.textContent || '') + val;
            if (typeof el.dispatchEvent === 'function') {
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        } else if ('value' in el) {
          el.value = (el.value || '') + val;
          if (typeof el.dispatchEvent === 'function') {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }, prompt);
    }

    // Clica no botao de envio com limite maxLevel: 2 (aguarda ate 1500ms para o TipTap habilitar o botao)
    const sendSel = this.getSelectorString(this.selectors.sendBtn, { maxLevel: 2 });
    if (sendSel && typeof page.evaluate === 'function') {
      const startTime = Date.now();
      while (Date.now() - startTime < 1500) {
        const ready = await page.evaluate((sel) => {
          try {
            const btn = document.querySelector(sel);
            if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
              return true;
            }
          } catch (e) {}
          return false;
        }, sendSel).catch(() => false);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 80));
      }
    }
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
  }

  /**
   * Extrai o texto da resposta gerada pelo Grok.
   * @param {any} page
   * @returns {Promise<string>}
   */
  async extractResponse(page) {
    if (!page || typeof page.evaluate !== 'function') return '';

    const rL1 = this.selectors?.responseText?.level1?.selector || 'div.response-content-markdown';
    const rL2 = this.selectors?.responseText?.level2?.selector || 'div.streamdown-chat-md, .markdown';
    const rL3 = this.selectors?.responseText?.level3?.selector || 'p, pre, table, ul, ol';
    const blockSel = this.getSelectorString(this.selectors?.responseBlock) || 'div[data-testid="assistant-message"]';
    const tSel = this.selectors?.thoughtFilter || 'div[data-testid="conversation-thought"], div[data-testid="conversation-trace-slot"], button[data-testid="conversation-thought-toggle"], [class*="thought"], details';

    return await page.evaluate(({ blockSel, rL1, rL2, rL3, tSel }) => {
      let block = null;
      try {
        const blocks = document.querySelectorAll(blockSel);
        if (blocks && blocks.length > 0) {
          block = blocks[blocks.length - 1];
        }
      } catch (e) {}

      const scope = block || document;
      let target = null;
      for (const sel of [rL1, rL2, rL3]) {
        if (!sel) continue;
        try {
          const els = scope.querySelectorAll(sel);
          if (els && els.length > 0) {
            target = els[els.length - 1];
            break;
          }
        } catch (e) {}
      }

      const elToExtract = target || block;
      if (!elToExtract) return '';

      const clone = elToExtract.cloneNode(true);
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
    }, { blockSel, rL1, rL2, rL3, tSel }).catch(() => '');
  }

  /**
   * Extrai fontes e citacoes da resposta do Grok.
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
   * Extrai a resposta completa (texto, fontes e modelo) do Grok.
   * @param {any} page
   * @returns {Promise<{ text: string, sources: Array<{ title: string, url: string, index: number }>, model: string }>}
   */
  async extractAnswer(page) {
    const text = await this.extractResponse(page);
    const sources = await this.extractSources(page);
    return {
      text,
      sources,
      model: this.defaultModel || 'grok-fast'
    };
  }

  /**
   * Inicia nova conversa no Grok.
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
          const candidates = Array.from(document.querySelectorAll('button, a'));
          const target = candidates.find((el) => {
            const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
            return label.includes('new chat') || label.includes('novo bate-papo') || label.includes('novo chat');
          });
          if (target) {
            target.click();
            return true;
          }
        } catch (e) {}
        return false;
      }, newChatSel);
    }

    if (!clicked && typeof page.goto === 'function') {
      await page.goto(this.targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    if (typeof this.waitForComposer === 'function') {
      await this.waitForComposer(page);
    }
  }

  /**
   * Configura o modo operacional do Grok (ex: Fast, Build).
   * @param {any} page
   * @param {string} mode
   * @returns {Promise<{ supported: boolean, applied: boolean, requested: string, mode?: string, message?: string }>}
   */
  async setMode(page, mode) {
    if (!mode) return { supported: true, applied: false, mode: this.preferredMode };
    if (GROK_PAYWALL_MODES.includes(mode)) {
      return { supported: false, applied: false, requested: mode, message: 'Modo requer assinatura SuperGrok (paywall)' };
    }
    if (GROK_FREE_MODES.includes(mode)) {
      this.preferredMode = mode;
      return { supported: true, applied: true, requested: mode, mode: this.preferredMode };
    }
    return { supported: false, applied: false, requested: mode };
  }
}
