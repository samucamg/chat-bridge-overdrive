import { BaseDriver } from './base.mjs';
import { BridgeError, ERROR_CODES } from '../errors.mjs';

/**
 * Mapeamento de seletores em 3 niveis para o Microsoft Copilot (copilot.cloud.microsoft / copilot.microsoft.com).
 * Niveis separados sem uniao de pai e filho no mesmo nivel.
 */
export const COPILOT_SELECTORS = Object.freeze({
  input: {
    level1: {
      selector: '#m365-chat-editor-target-element, #m365-chat-editor-target-element[contenteditable="true"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'span.fai-EditorInput__input[contenteditable="true"], [data-lexical-editor="true"][role="textbox"]',
      confidence: 'Alta'
    },
    level3: {
      selector: '.fai-BebopLiteChatInput [contenteditable="true"], [role="textbox"][contenteditable="true"]',
      confidence: 'Media'
    }
  },
  sendBtn: {
    level1: {
      selector: 'button.fai-SendButton.fai-BebopLiteChatInput__send, button.fai-SendButton[aria-label="Enviar"], button.fai-SendButton[aria-label="Send"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'button.fai-SendButton, button[type="submit"][aria-label="Enviar"], button[type="submit"][aria-label="Send"]',
      confidence: 'Alta'
    },
    level3: {
      selector: 'button[type="submit"]:has(.fai-SendButton__sendIcon)',
      confidence: 'Baixa'
    }
  },
  stopBtn: {
    level1: {
      selector: 'button.fai-SendButton[aria-label="Parar de gerar"], button.fai-SendButton[aria-label="Stop generating"], button.fai-SendButton[aria-label*="Parar"], button.fai-SendButton[aria-label*="Stop"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'button[aria-label="Parar de gerar"], button[aria-label="Stop generating"]',
      confidence: 'Alta'
    },
    level3: {
      selector: 'button.fai-SendButton:has(svg rect), button:has(.fai-SendButton__stopBackground)',
      confidence: 'Baixa'
    }
  },
  response: {
    level1: {
      selector: '[data-testid="copilot-message-div"] [data-testid="markdown-reply"], [data-testid="markdown-reply"]',
      confidence: 'Alta'
    },
    level2: {
      selector: '[data-testid="copilot-message-div"] .fai-CopilotMessage__content, .fai-CopilotMessage__content',
      confidence: 'Alta'
    },
    level3: {
      selector: '[data-testid="copilot-message-div"]',
      confidence: 'Media'
    }
  },
  thoughtFilter: '.fai-CopilotMessage__accessibleHeading, .fai-CopilotMessage__disclaimer, .fai-Suggestion, [data-testid="loading-message"]',
  citations: {
    level1: {
      selector: '[data-testid="copilot-message-div"] a[data-testid*="citation"], [data-testid="markdown-reply"] a.fui-Link[href^="http"], .fai-CopilotMessage__content a.fui-Link[href^="http"]',
      confidence: 'Alta'
    },
    level2: {
      selector: '[data-testid="markdown-reply"] a[href^="http"], .fai-CopilotMessage__content a[href^="http"]',
      confidence: 'Alta'
    },
    level3: {
      selector: '[data-testid="copilot-message-div"] a[target="_blank"][href^="http"]',
      confidence: 'Media'
    }
  },
  newChatBtn: {
    level1: {
      selector: 'a.fui-NavItem[aria-label="Novo chat"], a.fui-NavItem[aria-label="New chat"], a[aria-label="Novo chat"], a[aria-label="New chat"]',
      confidence: 'Alta'
    },
    level2: {
      selector: 'a.fui-NavItem[aria-label*="Novo chat"], a.fui-NavItem[aria-label*="New chat"], button[aria-label="Novo chat"], button[aria-label="New chat"]',
      confidence: 'Alta'
    },
    level3: {
      selector: 'nav a[href*="/chat"]',
      confidence: 'Baixa'
    }
  },
  fileInput: {
    level1: {
      selector: 'input#upload-file-button[type="file"], input[type="file"]#upload-file-button',
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
  }
});

/**
 * Driver para automacao e consulta ao Microsoft Copilot via CDP.
 */
export class CopilotDriver extends BaseDriver {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    super({
      provider: 'copilot',
      targetUrl: 'https://copilot.cloud.microsoft/chat',
      debounceMs: 400,
      selectors: COPILOT_SELECTORS,
      imageScope: '[data-testid="copilot-message-div"] .fai-CopilotMessage__content',
      imageFallbackScope: ['[data-testid="copilot-message-div"]', '.fai-CopilotMessage__content'],
      ...options
    });
    this.defaultModel = 'copilot-web';
    this.imageScope = '[data-testid="copilot-message-div"] .fai-CopilotMessage__content';
    this.imageFallbackScope = ['[data-testid="copilot-message-div"]', '.fai-CopilotMessage__content'];
  }

  /**
   * Verifica se uma URL pertence ao ecossistema do Microsoft Copilot.
   * Aceita copilot.cloud.microsoft, copilot.microsoft.com e m365.cloud.microsoft (e subdominios).
   * @param {string} url
   * @returns {boolean}
   */
  matchesUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      return (
        host === 'copilot.cloud.microsoft' ||
        host.endsWith('.copilot.cloud.microsoft') ||
        host === 'copilot.microsoft.com' ||
        host.endsWith('.copilot.microsoft.com') ||
        host === 'm365.cloud.microsoft' ||
        host.endsWith('.m365.cloud.microsoft')
      );
    } catch (e) {
      return (
        url.includes('copilot.cloud.microsoft') ||
        url.includes('copilot.microsoft.com') ||
        url.includes('m365.cloud.microsoft')
      );
    }
  }

  /**
   * Verifica se ha sessao autenticada ativa no Microsoft Copilot.
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
      if (url.includes('/login') || url.includes('/auth') || url.includes('login.microsoftonline.com') || url.includes('login.live.com')) {
        return { loggedIn: false };
      }

      let hasInput = false;
      try {
        const inputEl = document.querySelector(sel);
        if (inputEl) {
          hasInput = true;
        }
      } catch (e) {}

      const loginBlockerSelectors = [
        'a[href*="login.microsoftonline.com"]',
        'a[href*="login.live.com"]',
        '[data-testid="login-button"]',
        'button[aria-label*="Sign in"]',
        'button[aria-label*="Entrar"]',
        'a[aria-label*="Sign in"]',
        'a[aria-label*="Entrar"]'
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

    return Boolean(result && (result.loggedIn || result === true));
  }

  /**
   * Inicia nova conversa no Microsoft Copilot.
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

    if (cdpManager && typeof cdpManager.setFileInputFiles === 'function') {
      try {
        const ok = await cdpManager.setFileInputFiles(page, fileInputSel, files);
        if (ok === true) return true;
      } catch (e) {}
    }

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

    if (typeof page.setInputFiles === 'function') {
      try {
        await page.setInputFiles(fileInputSel, files);
        return true;
      } catch (err) {}
    }

    return false;
  }

  /**
   * Envia prompt de texto para o editor do Microsoft Copilot.
   * Realiza limpeza previa de composer, insere o texto, aguarda ate 1500ms pelo aparecimento
   * do sendBtn (maxLevel: 2) e efetua o envio.
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
        'Sessao deslogada ou editor de texto do Copilot nao encontrado'
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
        'Editor de texto do Copilot nao encontrado para foco'
      );
    }

    // Limpeza previa de composer caso haja rascunho residual
    await page.evaluate((sel) => {
      try {
        const el = document.querySelector(sel);
        if (el) {
          if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
            el.textContent = '';
            if (typeof el.dispatchEvent === 'function' && typeof Event === 'function') {
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } else if ('value' in el) {
            el.value = '';
            if (typeof el.dispatchEvent === 'function' && typeof Event === 'function') {
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        }
      } catch (e) {}
    }, inputSel);

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
            if (typeof el.dispatchEvent === 'function' && typeof Event === 'function') {
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        } else if ('value' in el) {
          el.value = (el.value || '') + val;
          if (typeof el.dispatchEvent === 'function' && typeof Event === 'function') {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }, text);
    }

    // Espera curta de ate 1500ms pelo aparecimento do sendBtn usando apenas maxLevel: 2
    const sendSel = this.getSelectorString(this.selectors.sendBtn, { maxLevel: 2 });
    if (sendSel && typeof page.evaluate === 'function') {
      const startTime = Date.now();
      while (Date.now() - startTime < 1500) {
        const ready = await page.evaluate((sel) => {
          try {
            const btn = document.querySelector(sel);
            if (btn) {
              const style = window.getComputedStyle ? window.getComputedStyle(btn) : null;
              const isVisible = !style || (style.display !== 'none' && style.visibility !== 'hidden');
              const isEnabled = !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
              if (isVisible && isEnabled) return true;
            }
          } catch (e) {}
          return false;
        }, sendSel).catch(() => false);
        if (ready) break;
        if (typeof page.waitForTimeout === 'function') {
          await page.waitForTimeout(100);
        } else {
          await new Promise((r) => setTimeout(r, 100));
        }
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
          if (el && typeof el.dispatchEvent === 'function' && typeof KeyboardEvent === 'function') {
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
   * Interrompe a geracao em andamento clicando no stopBtn (maxLevel: 2).
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
    return super.diagnose(page);
  }

  /**
   * Extrai a resposta gerada, resolvendo por prioridade de nivel (level1 -> level2 -> level3)
   * sem duplicar pai e filho, e coletando citacoes sem excluir microsoft.com.
   * @param {any} page
   * @returns {Promise<{ text: string, sources: Array<{ title: string, url: string, index: number }>, model: string }>}
   */
  async extractAnswer(page) {
    if (!page || typeof page.evaluate !== 'function') {
      return { text: '', sources: [], model: this.defaultModel || 'copilot-web' };
    }

    const rL1 = this.selectors?.response?.level1?.selector || '';
    const rL2 = this.selectors?.response?.level2?.selector || '';
    const rL3 = this.selectors?.response?.level3?.selector || '';
    const citSel = this.getSelectorString(this.selectors.citations);
    const thoughtSel = this.selectors?.thoughtFilter || '';

    const data = await page.evaluate(({ rL1, rL2, rL3, cSel, tSel }) => {
      let answerText = '';
      let target = null;

      // 1. Resolve resposta por prioridade de nivel para nao duplicar pai e filho
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

      if (target) {
        const clone = target.cloneNode(true);
        if (tSel) {
          try {
            const thoughts = clone.querySelectorAll(tSel);
            thoughts.forEach((el) => el.remove());
          } catch (e) {}
        }
        answerText = (clone.textContent || '').trim();
      }

      // 2. Extrai citacoes
      const sources = [];
      const seenUrls = new Set();
      if (cSel) {
        try {
          const scopeEl = (target && typeof target.closest === 'function')
            ? (target.closest('[data-testid="copilot-message-div"]') || target)
            : (target || document);
          let citElements = scopeEl.querySelectorAll(cSel);
          if ((!citElements || citElements.length === 0) && scopeEl !== document) {
            citElements = document.querySelectorAll(cSel);
          }

          let idx = 1;
          for (const el of citElements) {
            const href = el.getAttribute('href') || el.dataset?.citationUrl || '';
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
        } catch (e) {}
      }

      return { text: answerText, sources };
    }, { rL1, rL2, rL3, cSel: citSel, tSel: thoughtSel }).catch(() => ({ text: '', sources: [] }));

    return {
      text: data.text || '',
      sources: data.sources || [],
      model: this.defaultModel || 'copilot-web'
    };
  }
}
