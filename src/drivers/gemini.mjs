import { BaseDriver } from './base.mjs';
import { BridgeError, ERROR_CODES } from '../errors.mjs';

/**
 * Mapeamento de seletores em 3 niveis para o Google Gemini Web.
 */
export const GEMINI_SELECTORS = Object.freeze({
  input: {
    level1: {
      selector: 'rich-textarea [contenteditable="true"], div.ql-editor[contenteditable="true"]',
      confidence: 'Media'
    },
    level2: {
      selector: '[contenteditable="true"][role="textbox"], div[aria-label*="prompt"], div[aria-label*="mensagem"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'div[contenteditable="true"]',
      confidence: 'Baixa'
    }
  },
  sendBtn: {
    level1: {
      selector: 'button.send-button, button[data-test-id="send-button"]',
      confidence: 'Media'
    },
    level2: {
      selector: 'button[aria-label="Send message"], button[aria-label="Enviar mensagem"], button[aria-label*="Send"], button[aria-label*="Enviar"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'button[mat-icon-button]:has(mat-icon)',
      confidence: 'Baixa'
    }
  },
  stopBtn: {
    level1: {
      selector: 'button.stop-button, button[data-test-id="stop-button"]',
      confidence: 'Media'
    },
    level2: {
      selector: 'button[aria-label*="Stop"], button[aria-label*="Parar"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'button:has(.stop-icon)',
      confidence: 'Baixa'
    }
  },
  response: {
    level1: {
      selector: 'model-response .model-response-text, model-response message-content, model-response .markdown-main-panel',
      confidence: 'Media'
    },
    level2: {
      selector: 'message-content, .model-response-text',
      confidence: 'Media'
    },
    level3: {
      selector: '.response-container .markdown',
      confidence: 'Baixa'
    }
  },
  thoughtFilter: 'model-thoughts, model-thoughts-content, thinking-panel, [data-test-id="thinking-content"]',
  citations: {
    level1: {
      selector: 'model-response a[href^="http"]:not([href*="google.com"])',
      confidence: 'Media'
    },
    level2: {
      selector: 'message-content a[target="_blank"][href^="http"]:not([href*="google.com/search"])',
      confidence: 'Baixa'
    },
    level3: {
      selector: '.sources-list a[href^="http"]:not([href*="google.com/search"])',
      confidence: 'Baixa'
    }
  },
  newChatBtn: {
    level1: {
      selector: 'a[data-test-id="new-chat-button"], button[data-test-id="new-chat-button"]',
      confidence: 'Media'
    },
    level2: {
      selector: 'button[aria-label*="New chat"], button[aria-label*="Nova conversa"], a[aria-label*="Nova conversa"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'a[href="/app"]',
      confidence: 'Baixa'
    }
  }
});

/**
 * Driver para automacao e consulta ao Google Gemini Web via CDP.
 */
export class GeminiDriver extends BaseDriver {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    super({
      provider: 'gemini',
      targetUrl: 'https://gemini.google.com/app',
      debounceMs: 400,
      selectors: GEMINI_SELECTORS,
      defaultModel: 'gemini-web',
      ...options
    });
    this.defaultModel = 'gemini-web';
  }


  /**
   * Verifica se ha sessao autenticada ativa no Google Gemini.
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
      const url = window.location.href;
      if (url.includes('accounts.google.com')) {
        return { loggedIn: false };
      }

      const signInBtn = document.querySelector('a[href*="accounts.google.com"], button[aria-label*="Sign in"], button[aria-label*="Fazer login"]');
      if (signInBtn) {
        const style = window.getComputedStyle ? window.getComputedStyle(signInBtn) : null;
        if (!style || (style.display !== 'none' && style.visibility !== 'hidden')) {
          return { loggedIn: false };
        }
      }

      const inputEl = document.querySelector(sel);
      return { loggedIn: Boolean(inputEl) };
    }, inputSel).catch(() => ({ loggedIn: false }));

    return Boolean(result.loggedIn);
  }

  /**
   * Envia o prompt para a area de texto do Gemini.
   * @param {any} page
   * @param {string} text
   * @param {any} [cdpManager]
   * @returns {Promise<void>}
   */
  async send(page, text, cdpManager = null) {
    await this.checkAnomalies(page);

    const inputSel = this.getSelectorString(this.selectors.input);
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
        'Editor de texto do Gemini nao encontrado'
      );
    }

    if (cdpManager && typeof cdpManager.insertTextViaCDP === 'function') {
      await cdpManager.insertTextViaCDP(page, text);
    } else {
      await page.evaluate((val) => {
        const el = document.activeElement;
        if (!el) return;
        const inserted = document.execCommand('insertText', false, val);
        if (!inserted) {
          el.textContent = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, text);
    }

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
    }, sendSel);

    if (!submitted) {
      if (typeof page.keyboard?.press === 'function') {
        await page.keyboard.press('Enter');
      } else {
        await page.evaluate(() => {
          const el = document.activeElement;
          if (el) {
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
   * Extrai a resposta gerada, excluindo blocos de raciocinio intermediario.
   * @param {any} page
   * @returns {Promise<{ text: string, sources: Array<{ title: string, url: string, index: number }>, model: string }>}
   */
  async extractAnswer(page) {
    if (!page || typeof page.evaluate !== 'function') {
      return { text: '', sources: [], model: 'gemini-web' };
    }

    const respSel = this.getSelectorString(this.selectors.response);
    const citSel = this.getSelectorString(this.selectors.citations);
    const thoughtSel = this.selectors.thoughtFilter || 'model-thoughts, model-thoughts-content, thinking-panel, [data-test-id="thinking-content"]';

    const data = await page.evaluate(({ rSel, cSel, tSel }) => {
      let answerText = '';
      const respElements = document.querySelectorAll(rSel);
      if (respElements.length > 0) {
        const target = respElements[respElements.length - 1];
        const clone = target.cloneNode(true);
        try {
          const thoughts = clone.querySelectorAll(tSel);
          thoughts.forEach(el => el.remove());
        } catch (e) {}
        answerText = (clone.textContent || '').trim();
      }

      const sources = [];
      const seenUrls = new Set();
      const citElements = document.querySelectorAll(cSel);
      let idx = 1;
      for (const el of citElements) {
        const href = el.getAttribute('href') || '';
        if (!href || href.startsWith('javascript:') || href === '#') continue;
        if (seenUrls.has(href)) continue;
        seenUrls.add(href);

        let title = (el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent || '').trim();
        if (!title) {
          try {
            title = new URL(href).hostname;
          } catch (e) {
            title = `Fonte ${idx}`;
          }
        }
        sources.push({
          title,
          url: href,
          index: idx++
        });
      }

      let detectedModel = '';
      try {
        const modelEl = document.querySelector('[data-test-id="bard-mode-menu-button"], .model-switcher');
        if (modelEl) {
          detectedModel = (modelEl.textContent || '').trim();
        }
      } catch (e) {}

      return { text: answerText, sources, model: detectedModel };
    }, { rSel: respSel, cSel: citSel, tSel: thoughtSel }).catch(() => ({
      text: '',
      sources: [],
      model: ''
    }));

    return {
      text: data.text || '',
      sources: data.sources || [],
      model: data.model || 'gemini-web'
    };
  }
}
