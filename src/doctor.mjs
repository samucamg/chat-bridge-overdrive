import { BridgeError, ERROR_CODES } from './errors.mjs';
import { PerplexityDriver, PERPLEXITY_SELECTORS } from './drivers/perplexity.mjs';
import { GeminiDriver, GEMINI_SELECTORS } from './drivers/gemini.mjs';
import { ChatGPTDriver, CHATGPT_SELECTORS } from './drivers/chatgpt.mjs';
import { ClaudeDriver, CLAUDE_SELECTORS } from './drivers/claude.mjs';
import { DeepSeekDriver, DEEPSEEK_SELECTORS } from './drivers/deepseek.mjs';
import { CopilotDriver, COPILOT_SELECTORS } from './drivers/copilot.mjs';
import { MetaDriver, META_SELECTORS } from './drivers/meta.mjs';
import { GroqDriver, GROQ_SELECTORS } from './drivers/groq.mjs';
import { GrokDriver, GROK_SELECTORS } from './drivers/grok.mjs';

/**
 * Mapa de drivers instanciados para os 9 provedores suportados.
 */
export const DRIVERS = Object.freeze({
  perplexity: new PerplexityDriver(),
  gemini: new GeminiDriver(),
  chatgpt: new ChatGPTDriver(),
  claude: new ClaudeDriver(),
  deepseek: new DeepSeekDriver(),
  copilot: new CopilotDriver(),
  meta: new MetaDriver(),
  groq: new GroqDriver(),
  grok: new GrokDriver()
});

/**
 * Mapa unificado de seletores por provedor em 3 niveis.
 */
export const PROVIDER_SELECTOR_MAP = Object.freeze({
  perplexity: PERPLEXITY_SELECTORS,
  gemini: GEMINI_SELECTORS,
  chatgpt: CHATGPT_SELECTORS,
  claude: CLAUDE_SELECTORS,
  deepseek: DEEPSEEK_SELECTORS,
  copilot: COPILOT_SELECTORS,
  meta: META_SELECTORS,
  groq: GROQ_SELECTORS,
  grok: GROK_SELECTORS
});

/**
 * Nomes canonicos dos provedores suportados.
 */
export const PROVIDER_NAMES = Object.freeze(Object.keys(DRIVERS));

/**
 * Apelidos aceitos para cada provedor (chave ja normalizada: minuscula, sem espacos, hifens,
 * underscores nem pontos). Permite que o cliente diga "ChatGPT Web", "Google Gemini" etc.
 */
const PROVIDER_ALIASES = Object.freeze({
  perplexity: ['perplexity', 'perplexityai', 'perplexityweb', 'perplexitychat', 'pplx'],
  gemini: ['gemini', 'geminigooglecom', 'geminiweb', 'geminichat', 'geminichatweb', 'googlegemini', 'bard'],
  chatgpt: ['chatgpt', 'chatgptweb', 'chatgptchat', 'chatgptchatweb', 'chatgptcom', 'gpt', 'openai'],
  claude: ['claude', 'claudeai', 'claudeweb', 'claudechat', 'claudechatweb', 'anthropic'],
  deepseek: ['deepseek', 'chatdeepseekcom', 'deepseekweb', 'deepseekchat', 'deepseekchatweb', 'deepseekcom'],
  copilot: ['copilot', 'microsoftcopilot', 'mscopilot', 'copilotweb', 'copilotchat', 'copilotmicrosoftcom', 'copilotcloudmicrosoft', 'bingchat'],
  meta: ['meta', 'metaai', 'metaaiweb', 'metaaichat', 'metaaicom', 'llama'],
  groq: ['groq', 'chatgroqcom', 'groqchat', 'groqweb', 'groqcom'],
  grok: ['grok', 'grokcom', 'grokchat', 'grokweb', 'xai', 'xaigrok']
});

/**
 * Converte um nome ou apelido de provedor para o nome canonico.
 * Se nao for um apelido conhecido, devolve o texto em minusculas sem espacos nas pontas.
 * @param {string} name
 * @returns {string}
 */
export function normalizeProvider(name) {
  const trimmed = String(name ?? '').toLowerCase().trim();
  const key = trimmed.replace(/[\s._-]+/g, '');
  for (const [canonical, aliases] of Object.entries(PROVIDER_ALIASES)) {
    if (aliases.includes(key)) return canonical;
  }
  return trimmed;
}

/**
 * Obtem a instancia do driver para um provedor especifico.
 * @param {string} provider
 * @returns {any}
 */
export function getDriver(provider) {
  if (!provider || typeof provider !== 'string') {
    throw new BridgeError(
      ERROR_CODES.BLOCKED_BY_POLICY,
      'Provedor invalido especificado'
    );
  }
  const key = normalizeProvider(provider);
  const driver = DRIVERS[key];
  if (!driver) {
    throw new BridgeError(
      ERROR_CODES.BLOCKED_BY_POLICY,
      'Provedor nao suportado: ' + provider
    );
  }
  return driver;
}

/**
 * Executa auto-diagnostico dos provedores e conectividade CDP.
 * Nao envia prompts nem altera estado do usuario.
 * @param {object} [options]
 * @param {any} [options.cdpManager=null]
 * @param {Array<string>} [options.providers=['perplexity', 'gemini', 'chatgpt', 'claude', 'deepseek', 'copilot', 'meta', 'groq', 'grok']]
 * @param {object|null} [options.pagesByProvider=null] Mapeamento direto de paginas para testes ou fixtures
 * @returns {Promise<{ timestamp: string, cdpConnected: boolean, providers: object }>}
 */
export async function runDoctor({
  cdpManager = null,
  providers = ['perplexity', 'gemini', 'chatgpt', 'claude', 'deepseek', 'copilot', 'meta', 'groq', 'grok'],
  pagesByProvider = null
} = {}) {
  const timestamp = new Date().toISOString();
  let cdpConnected = false;

  if (cdpManager) {
    try {
      const status = await cdpManager.getStatus();
      cdpConnected = Boolean(status?.cdpConnected);
    } catch (err) {
      cdpConnected = false;
    }
  }

  const providersReport = {};

  for (const provName of providers) {
    const key = (provName || '').toLowerCase().trim();
    const driver = DRIVERS[key];

    if (!driver) {
      providersReport[provName] = {
        healthy: false,
        loggedIn: false,
        error: 'Provedor ' + provName + ' nao suportado',
        selectors: {}
      };
      continue;
    }

    let page = null;
    if (pagesByProvider && pagesByProvider[key]) {
      page = pagesByProvider[key];
    } else if (pagesByProvider && pagesByProvider[provName]) {
      page = pagesByProvider[provName];
    } else if (cdpManager && cdpConnected) {
      try {
        const context = cdpManager.getContext();
        const pages = typeof context.pages === 'function' ? context.pages() : [];
        for (const p of pages) {
          const u = typeof p.url === 'function' ? p.url() : (p.url || '');
          if (driver.matchesUrl(u)) {
            page = p;
            break;
          }
        }
      } catch (e) {
        page = null;
      }
    }

    if (!page) {
      providersReport[provName] = {
        healthy: false,
        loggedIn: false,
        message: 'Nenhuma aba ativa encontrada para o provedor',
        selectors: {}
      };
      continue;
    }

    try {
      const diagnosis = await driver.diagnose(page);
      providersReport[provName] = diagnosis;
    } catch (err) {
      providersReport[provName] = {
        healthy: false,
        loggedIn: false,
        error: err.message,
        selectors: {}
      };
    }
  }

  return {
    timestamp,
    cdpConnected,
    providers: providersReport
  };
}
