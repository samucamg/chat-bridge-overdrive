import { BridgeError, ERROR_CODES } from './errors.mjs';

/**
 * Valida se o endpoint CDP aponta estritamente para o host local 127.0.0.1.
 * Rejeita qualquer outro host (0.0.0.0, localhost, IPs externos, tuneis).
 * @param {string} endpointUrl
 * @returns {string} endpointUrl validado
 */
export function validateCdpEndpoint(endpointUrl) {
  if (!endpointUrl || typeof endpointUrl !== 'string') {
    throw new BridgeError(
      ERROR_CODES.BLOCKED_BY_POLICY,
      'CDP endpoint deve ser uma string valida'
    );
  }

  let parsed;
  try {
    parsed = new URL(endpointUrl);
  } catch (err) {
    throw new BridgeError(
      ERROR_CODES.BLOCKED_BY_POLICY,
      'CDP endpoint com formato invalido: ' + endpointUrl
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'ws:') {
    throw new BridgeError(
      ERROR_CODES.BLOCKED_BY_POLICY,
      'Protocolo do CDP endpoint deve ser http ou ws'
    );
  }

  if (parsed.hostname !== '127.0.0.1') {
    throw new BridgeError(
      ERROR_CODES.BLOCKED_BY_POLICY,
      'CDP endpoint deve usar exclusivamente 127.0.0.1'
    );
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : 9222;
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new BridgeError(
      ERROR_CODES.BLOCKED_BY_POLICY,
      'Porta do CDP endpoint invalida'
    );
  }

  return endpointUrl;
}

/**
 * Gerenciador de conexao CDP com o Google Chrome via playwright-core.
 */
export class CdpManager {
  /**
   * @param {object} [options]
   * @param {string} [options.endpointUrl='http://127.0.0.1:9222']
   * @param {Function|null} [options.connector=null] Injetor de mock para testes
   */
  constructor({ endpointUrl = 'http://127.0.0.1:9222', connector = null } = {}) {
    this.endpointUrl = validateCdpEndpoint(endpointUrl);
    this.connector = connector;
    this.browser = null;
  }

  /**
   * Conecta ao Chrome ou reutiliza conexao ativa.
   * @returns {Promise<any>}
   */
  async connect() {
    if (this.browser) {
      try {
        if (typeof this.browser.isConnected !== 'function' || this.browser.isConnected()) {
          return this.browser;
        }
      } catch (e) {
        this.browser = null;
      }
    }

    try {
      if (this.connector) {
        this.browser = await this.connector(this.endpointUrl);
      } else {
        let pw;
        try {
          pw = await import('playwright-core');
        } catch (err) {
          throw new BridgeError(
            ERROR_CODES.CDP_UNAVAILABLE,
            'playwright-core indisponivel: ' + err.message
          );
        }
        const chromium = pw.chromium || pw.default?.chromium;
        if (!chromium || typeof chromium.connectOverCDP !== 'function') {
          throw new BridgeError(
            ERROR_CODES.CDP_UNAVAILABLE,
            'chromium.connectOverCDP nao disponivel no playwright-core'
          );
        }
        this.browser = await chromium.connectOverCDP(this.endpointUrl, { timeout: 5000 });
      }
      return this.browser;
    } catch (err) {
      if (err instanceof BridgeError) {
        throw err;
      }
      throw new BridgeError(
        ERROR_CODES.CDP_UNAVAILABLE,
        'Chrome debug indisponivel em ' + this.endpointUrl,
        { originalError: err.message }
      );
    }
  }

  /**
   * Retorna o contexto padrao do navegador.
   * @returns {any}
   */
  getContext() {
    if (!this.browser) {
      throw new BridgeError(
        ERROR_CODES.CDP_UNAVAILABLE,
        'Navegador nao conectado ao CDP. Execute connect() antes.'
      );
    }
    const contexts = typeof this.browser.contexts === 'function' ? this.browser.contexts() : [];
    if (!contexts || contexts.length === 0) {
      throw new BridgeError(
        ERROR_CODES.CDP_UNAVAILABLE,
        'Nenhum contexto de navegador disponivel'
      );
    }
    return contexts[0];
  }

  /**
   * Obtem o targetId unico da pagina via sessao CDP ou fallback seguro.
   * @param {any} page
   * @returns {Promise<string|null>}
   */
  async getTargetId(page) {
    if (!page) return null;
    if (page._targetId) return page._targetId;

    try {
      if (typeof page.context === 'function') {
        const ctx = page.context();
        if (ctx && typeof ctx.newCDPSession === 'function') {
          const session = await ctx.newCDPSession(page);
          try {
            const info = await session.send('Target.getTargetInfo');
            if (info?.targetInfo?.targetId) {
              return info.targetInfo.targetId;
            }
          } finally {
            if (typeof session.detach === 'function') {
              await session.detach().catch(() => {});
            }
          }
        }
      }
    } catch (err) {
      // Fallback silencioso para propriedades locais
    }

    if (page._guid) return page._guid;
    if (typeof page.url === 'function') {
      return 'target-' + page.url();
    }
    return 'target-default';
  }

  /**
   * Insere texto usando sessao CDP Input.insertText com fallback para page.evaluate.
   * @param {any} page
   * @param {string} text
   * @returns {Promise<void>}
   */
  async insertTextViaCDP(page, text) {
    if (!page) {
      throw new Error('Pagina invalida para insercao de texto');
    }
    let cdpSuccess = false;
    try {
      if (typeof page.context === 'function') {
        const ctx = page.context();
        if (ctx && typeof ctx.newCDPSession === 'function') {
          const session = await ctx.newCDPSession(page);
          try {
            await session.send('Input.insertText', { text });
            cdpSuccess = true;
          } finally {
            if (typeof session.detach === 'function') {
              await session.detach().catch(() => {});
            }
          }
        }
      }
    } catch (err) {
      cdpSuccess = false;
    }

    if (!cdpSuccess) {
      if (typeof page.evaluate === 'function') {
        await page.evaluate((val) => {
          const el = document.activeElement;
          if (!el) return;
          if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
            const ok = document.execCommand('insertText', false, val);
            if (!ok) {
              el.textContent = (el.textContent || '') + val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } else if ('value' in el) {
            el.value = (el.value || '') + val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, text);
      }
    }
  }

  /**
   * Define arquivos em um elemento input[type="file"] via sessao CDP DOM.setFileInputFiles
   * com fallbacks para page.setInputFiles ou manipulacao em memoria nos testes.
   * @param {any} page
   * @param {string} selector
   * @param {string|string[]} filePaths
   * @returns {Promise<boolean>}
   */
  async setFileInputFiles(page, selector, filePaths) {
    if (!page || !filePaths) return false;
    const files = Array.isArray(filePaths) ? filePaths : [filePaths];
    if (files.length === 0) return false;

    const fileSelector = selector || 'input[type="file"]';
    let cdpSuccess = false;

    // 1. Tenta via sessao CDP: DOM.getDocument -> DOM.querySelector -> DOM.setFileInputFiles
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
              selector: fileSelector
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

    // 2. Fallback Playwright page.setInputFiles
    if (typeof page.setInputFiles === 'function') {
      try {
        await page.setInputFiles(fileSelector, files);
        return true;
      } catch (err) {
        // Sem outra via de upload real
      }
    }

    // Sem upload real nao ha sucesso: nunca simula o anexo no DOM.

    return false;
  }

  /**
   * Testa a conexao sem travar e retorna status.
   * @returns {Promise<{ cdpConnected: boolean, endpointUrl: string }>}
   */
  async getStatus() {
    let isConnected = false;
    try {
      if (this.browser && typeof this.browser.isConnected === 'function') {
        isConnected = this.browser.isConnected();
      }
      if (!isConnected) {
        const b = await this.connect();
        isConnected = Boolean(b && (typeof b.isConnected !== 'function' || b.isConnected()));
      }
    } catch (err) {
      isConnected = false;
    }
    return {
      cdpConnected: isConnected,
      endpointUrl: this.endpointUrl
    };
  }

  /**
   * Desconecta de forma limpa sem encerrar o processo do Chrome.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.browser) {
      try {
        if (typeof this.browser.close === 'function') {
          await this.browser.close();
        }
      } catch (err) {
        // Ignora erro no fechamento
      } finally {
        this.browser = null;
      }
    }
  }
}
