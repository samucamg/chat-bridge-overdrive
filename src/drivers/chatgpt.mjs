import { BaseDriver } from './base.mjs';
import { BridgeError, ERROR_CODES } from '../errors.mjs';

/**
 * Mapeamento de seletores em 3 niveis para o ChatGPT Web (OpenAI).
 * Grau de confianca Media para level1/level2 aguardando homologacao ao vivo.
 */
export const CHATGPT_SELECTORS = Object.freeze({
  input: {
    level1: {
      selector: '#prompt-textarea, div#prompt-textarea[contenteditable="true"], textarea#prompt-textarea',
      confidence: 'Media'
    },
    level2: {
      selector: 'div.ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'form textarea, form div[contenteditable="true"]',
      confidence: 'Baixa'
    }
  },
  sendBtn: {
    level1: {
      selector: 'button[data-testid="send-button"], button[data-testid="fruitjuice-send-button"]',
      confidence: 'Media'
    },
    level2: {
      selector: 'button[aria-label="Send prompt"], button[aria-label="Enviar prompt"], button[aria-label*="Send"], button[aria-label*="Enviar"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'form button[type="submit"]',
      confidence: 'Baixa'
    }
  },
  stopBtn: {
    level1: {
      selector: 'button[data-testid="stop-button"]',
      confidence: 'Media'
    },
    level2: {
      selector: 'button[aria-label="Stop streaming"], button[aria-label="Parar geracao"], button[aria-label*="Stop"], button[aria-label*="Parar"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'form button:has(svg rect)',
      confidence: 'Baixa'
    }
  },
  response: {
    level1: {
      selector: '[data-markdown-text-style="assistant-message"], div[data-message-author-role="assistant"] .markdown, article [data-message-author-role="assistant"]',
      confidence: 'Media'
    },
    level2: {
      selector: 'div[data-message-author-role="assistant"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'main article .prose',
      confidence: 'Baixa'
    }
  },
  thoughtFilter: '[data-testid*="thought"], .thinking-panel, details[data-testid*="reasoning"], .result-thinking',
  citations: {
    level1: {
      selector: 'div[data-message-author-role="assistant"] a[data-testid*="webpage-citation"], div[data-message-author-role="assistant"] a.citation-pill',
      confidence: 'Media'
    },
    level2: {
      selector: 'div[data-message-author-role="assistant"] a[href^="http"]:not([href*="chatgpt.com"]):not([href*="openai.com"])',
      confidence: 'Media'
    },
    level3: {
      selector: 'article a[target="_blank"][href^="http"]',
      confidence: 'Baixa'
    }
  },
  newChatBtn: {
    level1: {
      selector: 'a[data-testid="create-new-chat-button"], button[data-testid="create-new-chat-button"]',
      confidence: 'Media'
    },
    level2: {
      selector: 'a[aria-label*="New chat"], a[aria-label*="Novo chat"], button[aria-label*="New chat"]',
      confidence: 'Media'
    },
    level3: {
      selector: 'nav a[href="/"]',
      confidence: 'Baixa'
    }
  },
  fileInput: {
    level1: {
      selector: 'input[type="file"][multiple], input[type="file"]',
      confidence: 'Media'
    },
    level2: {
      selector: 'form input[type="file"]',
      confidence: 'Baixa'
    },
    level3: {
      selector: 'input[accept]',
      confidence: 'Baixa'
    }
  },
  modelBadge: {
    level1: {
      selector: 'button[data-testid="model-switcher-dropdown-button"], [data-testid="model-switcher"]',
      confidence: 'Media'
    },
    level2: {
      selector: 'button[aria-label*="Model"], button[aria-label*="Modelo"]',
      confidence: 'Baixa'
    },
    level3: {
      selector: 'header button',
      confidence: 'Baixa'
    }
  }
});

/**
 * Driver para automacao e consulta ao ChatGPT (OpenAI) via CDP.
 */
export class ChatGPTDriver extends BaseDriver {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    super({
      provider: 'chatgpt',
      targetUrl: 'https://chatgpt.com/',
      debounceMs: 400,
      selectors: CHATGPT_SELECTORS,
      ...options
    });
    this.defaultModel = 'chatgpt-web';
  }

  /**
   * Verifica se uma URL pertence ao dominio do ChatGPT.
   * @param {string} url
   * @returns {boolean}
   */
  matchesUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      return (
        u.hostname === 'chatgpt.com' ||
        u.hostname.endsWith('.chatgpt.com') ||
        u.hostname === 'chat.openai.com'
      );
    } catch (e) {
      return url.includes('chatgpt.com') || url.includes('chat.openai.com');
    }
  }

  /**
   * Verifica se ha sessao autenticada ativa e sem bloqueios de login.
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
      if (url.includes('/auth/login') || url.includes('/login') || url.includes('auth0.openai.com')) {
        return { loggedIn: false };
      }

      let hasInput = false;
      try {
        const inputEl = document.querySelector(sel);
        if (inputEl) {
          hasInput = true;
        }
      } catch (e) {}

      // Verifica botoes bloqueantes de login obrigatorio sem composer ativo
      const loginBlockerSelectors = [
        '[data-testid="login-button"]',
        'a[href*="/auth/login"]',
        'button[data-testid="login-button"]'
      ];

      for (const blockerSel of loginBlockerSelectors) {
        try {
          const el = document.querySelector(blockerSel);
          if (el) {
            const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
            if (!style || (style.display !== 'none' && style.visibility !== 'hidden')) {
              if (!hasInput) {
                return { loggedIn: false };
              }
            }
          }
        } catch (e) {}
      }

      return { loggedIn: hasInput };
    }, inputSel).catch(() => ({ loggedIn: false }));

    return Boolean(result.loggedIn);
  }

  /**
   * Inicia nova conversa no ChatGPT clicando no botao ou navegando para targetUrl.
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
   * Anexa arquivos ao chat via sessao CDP DOM.setFileInputFiles ou fallbacks compativeis.
   * @param {any} page
   * @param {string|string[]} filePaths
   * @param {any} [cdpManager]
   * @returns {Promise<boolean>}
   */
  async attachFiles(page, filePaths, cdpManager = null) {
    if (!page || !filePaths) return false;
    const files = Array.isArray(filePaths) ? filePaths : [filePaths];
    if (files.length === 0) return false;

    await this.checkAnomalies(page);

    const fileInputSel = this.getSelectorString(this.selectors?.fileInput) || 'input[type="file"]';

    // 1. Suporte via cdpManager caso possua setFileInputFiles implementado
    if (cdpManager && typeof cdpManager.setFileInputFiles === 'function') {
      try {
        const ok = await cdpManager.setFileInputFiles(page, fileInputSel, files);
        if (ok === true) return true;
      } catch (e) {
        // Prossegue para tentativa direta via sessao CDP
      }
    }

    // 2. Sessao CDP direta via DOM.getDocument -> DOM.querySelector -> DOM.setFileInputFiles
    let cdpSuccess = false;
    try {
      let session = null;
      if (typeof page.newCDPSession === 'function') {
        session = await page.newCDPSession();
      } else if (typeof page.context === 'function') {
        const ctx = page.context();
        if (ctx && typeof ctx.newCDPSession === 'function') {
          session = await ctx.newCDPSession(page);
        }
      }

      if (session) {
        try {
          const doc = await session.send('DOM.getDocument');
          const rootNodeId = doc?.root?.nodeId;
          if (rootNodeId) {
            const queryRes = await session.send('DOM.querySelector', {
              nodeId: rootNodeId,
              selector: 'input[type="file"]'
            });
            const nodeId = queryRes?.nodeId;
            if (nodeId) {
              await session.send('DOM.setFileInputFiles', {
                files,
                nodeId
              });
              cdpSuccess = true;
            }
          }
        } finally {
          if (typeof session.detach === 'function') {
            await session.detach().catch(() => {});
          }
        }
      }
    } catch (err) {
      cdpSuccess = false;
    }

    if (cdpSuccess) return true;

    // 3. Fallback Playwright nativo via page.setInputFiles
    if (typeof page.setInputFiles === 'function') {
      try {
        await page.setInputFiles(fileInputSel, files);
        return true;
      } catch (err) {
        // Sem outra via de upload real
      }
    }

    // Sem upload real nao ha sucesso: nunca simula o anexo no DOM.

    return false;
  }

  /**
   * Envia prompt de texto para o editor do ChatGPT via CDP ou fallbacks compativeis.
   * @param {any} page
   * @param {string} text
   * @param {any} [cdpManager]
   * @returns {Promise<void>}
   */
  async send(page, text, cdpManager = null) {
    await this.checkAnomalies(page);

    const loggedIn = await this.isLoggedIn(page);
    if (!loggedIn) {
      throw new BridgeError(
        ERROR_CODES.AUTH_REQUIRED,
        'Sessao deslogada ou editor de texto do ChatGPT nao encontrado'
      );
    }

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
        'Editor de texto do ChatGPT nao encontrado para foco'
      );
    }

    if (cdpManager && typeof cdpManager.insertTextViaCDP === 'function') {
      await cdpManager.insertTextViaCDP(page, text);
    } else {
      await page.evaluate((val) => {
        const el = document.activeElement;
        if (!el) return;
        if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
          const inserted = typeof document.execCommand === 'function' ? document.execCommand('insertText', false, val) : false;
          if (!inserted) {
            el.textContent = (el.textContent || '') + val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else if ('value' in el) {
          el.value = (el.value || '') + val;
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
   * Extrai a resposta gerada, excluindo blocos de raciocinio intermediario e extraindo citacoes estruturadas.
   * @param {any} page
   * @returns {Promise<{ text: string, sources: Array<{ title: string, url: string, index: number }>, model: string }>}
   */
  async extractAnswer(page) {
    if (!page || typeof page.evaluate !== 'function') {
      return { text: '', sources: [], model: this.defaultModel || 'chatgpt-web' };
    }

    const respSel = this.getSelectorString(this.selectors.response);
    const citSel = this.getSelectorString(this.selectors.citations);
    const thoughtSel = this.selectors?.thoughtFilter || '[data-testid*="thought"], .thinking-panel, details[data-testid*="reasoning"], .result-thinking';
    const modelSel = this.getSelectorString(this.selectors?.modelBadge);

    const data = await page.evaluate(({ rSel, cSel, tSel, mSel }) => {
      let answerText = '';
      const respElements = document.querySelectorAll(rSel);
      if (respElements.length > 0) {
        const target = respElements[respElements.length - 1];
        const clone = target.cloneNode(true);
        if (tSel) {
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
      if (mSel) {
        try {
          const modelEl = document.querySelector(mSel);
          if (modelEl) {
            detectedModel = (modelEl.textContent || '').trim();
          }
        } catch (e) {}
      }

      return { text: answerText, sources, model: detectedModel };
    }, { rSel: respSel, cSel: citSel, tSel: thoughtSel, mSel: modelSel }).catch(() => ({
      text: '',
      sources: [],
      model: ''
    }));

    return {
      text: data.text || '',
      sources: data.sources || [],
      model: data.model || this.defaultModel || 'chatgpt-web'
    };
  }
}
