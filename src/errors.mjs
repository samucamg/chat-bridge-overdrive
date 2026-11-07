/**
 * Codigos de erro padronizados do chat-overdrive-bridge.
 */
export const ERROR_CODES = Object.freeze({
  CDP_UNAVAILABLE: 'CDP_UNAVAILABLE',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  TAB_BUSY: 'TAB_BUSY',
  PROMPT_TIMEOUT: 'PROMPT_TIMEOUT',
  CANCELLED: 'CANCELLED',
  BLOCKED_BY_POLICY: 'BLOCKED_BY_POLICY',
  ATTACHMENT_FAILED: 'ATTACHMENT_FAILED'
});

/**
 * Erro customizado estruturado para comunicacao MCP e controle de fluxo do bridge.
 */
export class BridgeError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'BridgeError';
    this.code = code;
    this.details = details && typeof details === 'object' ? details : {};

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BridgeError);
    }
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

/**
 * Verifica se um objeto de erro e um BridgeError valido ou possui codigo mapeado.
 * @param {any} err
 * @returns {boolean}
 */
export function isBridgeError(err) {
  return Boolean(err && (err instanceof BridgeError || Boolean(err.code && ERROR_CODES[err.code])));
}
