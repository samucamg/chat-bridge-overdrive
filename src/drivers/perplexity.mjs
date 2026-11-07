import { BaseDriver } from './base.mjs';
import { BridgeError, ERROR_CODES } from '../errors.mjs';

/**
 * Mapeamento de seletores em 3 niveis para o Perplexity AI (secao 5 do plano).
 */
export const PERPLEXITY_SELECTORS = Object.freeze({
  input: {
    level1: {
      selector: 'div[role="textbox"][data-lexical-editor="true"], #ask-input[data-lexical-editor="true"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div[contenteditable="true"][role="textbox"]',
      confidence: 'Alta'
    },
    level3: {
      selector: 'textarea[placeholder], div[contenteditable="true"]',
      confidence: 'Media'
    }
  },
  sendBtn: {
    level1: {
      selector: 'button[data-testid="submit-button"], button[aria-label="Submit"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'button[aria-label="Enviar"], button[aria-label*="Submit"], button[aria-label*="Enviar"]',
      confidence: 'Alta'
    },
    level3: {
      selector: 'button[type="submit"]:has(svg)',
      confidence: 'Media'
    }
  },
  stopBtn: {
    level1: {
      selector: 'button:has(use[href="#pplx-icon-player-stop"]), button[data-testid="stop-button"]',
      confidence: 'Media'
    },
    level2: {
      selector: 'button[aria-label*="Interromper"], button[aria-label="Parar"], button[aria-label="Stop"], button[aria-label*="Stop"], button[aria-label*="Parar"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'button:has(svg rect)',
      confidence: 'Baixa'
    }
  },
  response: {
    level1: {
      selector: 'div[data-workflow-final-text] div[data-renderer="lm"], div[data-renderer="lm"].prose',
      confidence: 'Alta'
    },
    level2: {
      selector: '.prose[class*="dark:prose-invert"], [class*="markdown"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'main article div.prose',
      confidence: 'Baixa'
    }
  },
  citations: {
    level1: {
      selector: 'span[data-pplx-citation] a, a[data-pplx-citation-url], a.citation',
      confidence: 'Alta'
    },
    level2: {
      selector: 'div[data-workflow-entry] a[href^="http"]:not([href*="perplexity.ai"])',
      confidence: 'Media'
    },
    level3: {
      selector: 'article a[target="_blank"][href^="http"]',
      confidence: 'Baixa'
    }
  },
  newChatBtn: {
    level1: {
      selector: 'a[href="/"][aria-label="Novo"], a[href="/"][aria-label="New Thread"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'a[aria-label*="New Thread"], a[aria-label*="Novo"], button[aria-label*="New Thread"]',
      confidence: 'Alta'
    },
    level3: {
      selector: 'nav a[href="/"]',
      confidence: 'Media'
    }
  }
});

/**
 * Driver para automacao e consulta ao Perplexity AI via CDP.
 */
export class PerplexityDriver extends BaseDriver {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    super({
      provider: 'perplexity',
      targetUrl: 'https://www.perplexity.ai/',
      debounceMs: 400,
      selectors: PERPLEXITY_SELECTORS,
      defaultModel: 'perplexity-web',
      ...options
    });
    this.defaultModel = 'perplexity-web';
  }


  /**
   * Verifica se ha sessao autenticada e ausência de bloqueios ou modal restritivo.
   * @param {any} page
   * @returns {Promise<boolean>}
   */
  async isLoggedIn(page) {
    try {
      await this.checkAnomalies(page);
    } catch (err) {
      if (err.code === ERROR_CODES.AUTH_REQUIRED) {
        return false;
      }
      throw err;
    }

    if (!page || typeof page.evaluate !== 'function') return false;

    const inputSel = this.getSelectorString(this.selectors.input);
    const result = await page.evaluate((sel) => {
      const loginWallSelectors = [
        '[data-testid="auth-modal"]',
        'div[role="dialog"]:has(a[href*="/api/auth/signin"])',
        'div[role="dialog"]:has(button[data-testid="login-button"])'
      ];
      for (const wallSel of loginWallSelectors) {
        try {
          const el = document.querySelector(wallSel);
          if (el) {
            const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
            if (!style || (style.display !== 'none' && style.visibility !== 'hidden')) {
              return { hasLoginWall: true, hasInput: false };
            }
          }
        } catch (e) {}
      }

      let hasInput = false;
      try {
        const inputEl = document.querySelector(sel);
        if (inputEl) {
          hasInput = true;
        }
      } catch (e) {}

      return { hasLoginWall: false, hasInput };
    }, inputSel).catch(() => ({ hasLoginWall: false, hasInput: false }));

    if (result.hasLoginWall) return false;
    return Boolean(result.hasInput);
  }

  /**
   * Envia o texto da consulta para o editor Lexical do Perplexity.
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
        'Editor de texto do Perplexity nao encontrado'
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
   * Extrai o texto final e as fontes da resposta do Perplexity.
   * @param {any} page
   * @returns {Promise<{ text: string, sources: Array<{ title: string, url: string, index: number }>, model: string }>}
   */
  async extractAnswer(page) {
    if (!page || typeof page.evaluate !== 'function') {
      return { text: '', sources: [], model: 'perplexity-web' };
    }

    const respSel = this.getSelectorString(this.selectors.response);
    const citSel = this.getSelectorString(this.selectors.citations);

    const data = await page.evaluate(({ rSel, cSel }) => {
      let answerText = '';
      const respElements = document.querySelectorAll(rSel);
      if (respElements.length > 0) {
        const target = respElements[respElements.length - 1];
        const clone = target.cloneNode(true);
        const thinkingSelectors = [
          'model-thoughts',
          'thinking-panel',
          '[data-testid*="thinking"]',
          '.thinking-container',
          '[data-workflow-thought]'
        ];
        for (const tSel of thinkingSelectors) {
          try {
            const thoughts = clone.querySelectorAll(tSel);
            thoughts.forEach(el => el.remove());
          } catch (e) {}
        }
        answerText = (clone.textContent || '').trim();
      }

      const sources = [];
      const seenUrls = new Set();
      const citElements = document.querySelectorAll(cSel);
      let idx = 1;
      for (const el of citElements) {
        const href = el.getAttribute('href') || el.dataset?.pplxCitationUrl || '';
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

      return { text: answerText, sources };
    }, { rSel: respSel, cSel: citSel }).catch(() => ({ text: '', sources: [] }));

    return {
      text: data.text || '',
      sources: data.sources || [],
      model: 'perplexity-web'
    };
  }
}
