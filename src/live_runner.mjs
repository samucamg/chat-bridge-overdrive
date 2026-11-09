import { BridgeError, ERROR_CODES } from './errors.mjs';
import { assertPayloadAllowed } from './sanitizer.mjs';
import { runDoctor, DRIVERS } from './doctor.mjs';

/**
 * Prompts ficticios de teste e diagnostico estritamente permitidos para homologacao ao vivo.
 */
export const ALLOWED_LIVE_TEST_PROMPTS = Object.freeze([
  'Responda apenas OK em uma palavra.',
  'Responda OK.',
  'ping',
  'OK'
]);

/**
 * Executa homologacao de testes ao vivo de forma estritamente opt-in, serial e segura.
 * @param {object} [options]
 * @param {any} [options.cdpManager=null]
 * @param {Array<string>} [options.providers=['perplexity', 'gemini', 'chatgpt']]
 * @param {string} [options.mode='doctor_only'] 'doctor_only' ou 'single_prompt'
 * @param {string} [options.testPrompt='Responda apenas OK em uma palavra.']
 * @param {number} [options.delayMs=1000] Intervalo obrigatorio entre testes de cada provedor
 * @param {boolean} [options.optIn=false] Flag opt-in explicita
 * @param {object|null} [options.drivers=null] Mapa customizado de drivers
 * @param {object|null} [options.pagesByProvider=null] Paginas injetadas para teste
 * @returns {Promise<object>} Relatorio detalhado da homologacao
 */
export async function runLiveHomologation({
  cdpManager = null,
  providers = ['perplexity', 'gemini', 'chatgpt', 'claude', 'deepseek', 'copilot', 'meta', 'groq', 'grok'],
  mode = 'doctor_only',
  testPrompt = 'Responda apenas OK em uma palavra.',
  delayMs = 1000,
  optIn = false,
  drivers = null,
  pagesByProvider = null
} = {}) {
  // 1. Verificacao inegociavel de Opt-in explicito
  const hasOptIn = optIn === true || process.env.CHAT_BRIDGE_LIVE_OPT_IN === '1';
  if (!hasOptIn) {
    throw new BridgeError(
      ERROR_CODES.BLOCKED_BY_POLICY,
      'Teste ao vivo desabilitado por padrao. Requer autorizacao explicita do operador e CHAT_BRIDGE_LIVE_OPT_IN=1'
    );
  }

  // 2. Validacao do modo de execucao
  const validModes = ['doctor_only', 'single_prompt'];
  if (!validModes.includes(mode)) {
    throw new BridgeError(
      ERROR_CODES.BLOCKED_BY_POLICY,
      'Modo de teste ao vivo invalido: ' + mode + '. Permitidos: doctor_only, single_prompt'
    );
  }

  // 3. Se mode for 'doctor_only', executa apenas verificacao passiva sem envio de prompts
  if (mode === 'doctor_only') {
    const doctorResult = await runDoctor({
      cdpManager,
      providers,
      pagesByProvider
    });
    return {
      timestamp: new Date().toISOString(),
      optInVerified: true,
      mode: 'doctor_only',
      doctor: doctorResult
    };
  }

  // 4. Validacao estrita do prompt ficticio contra sanitizador e lista permitida
  assertPayloadAllowed(testPrompt);

  const isAllowedPrompt = ALLOWED_LIVE_TEST_PROMPTS.some(
    (allowed) => allowed.trim().toLowerCase() === testPrompt.trim().toLowerCase()
  );
  if (!isAllowedPrompt) {
    throw new BridgeError(
      ERROR_CODES.BLOCKED_BY_POLICY,
      'Prompt para teste ao vivo deve pertencer exclusivamente a lista de prompts ficticios autorizados'
    );
  }

  // 5. Execucao estritamente serial provedor por provedor
  const activeDrivers = drivers || DRIVERS;
  const results = {};
  const startTime = Date.now();

  for (let i = 0; i < providers.length; i++) {
    const provName = providers[i];
    const key = (provName || '').toLowerCase().trim();
    const driver = activeDrivers[key];

    if (!driver) {
      results[provName] = {
        success: false,
        error: 'Provedor ' + provName + ' nao suportado no mapa de drivers'
      };
      continue;
    }

    // Delay serial entre provedores para evitar sobrecarga ou concorrencia
    if (i > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const provStartTime = Date.now();
    try {
      let page = null;
      if (pagesByProvider && (pagesByProvider[key] || pagesByProvider[provName])) {
        page = pagesByProvider[key] || pagesByProvider[provName];
      } else if (cdpManager) {
        const context = cdpManager.getContext();
        page = await driver.ensureTab(context);
      }

      if (!page) {
        results[provName] = {
          success: false,
          error: 'Nao foi possivel obter aba ativa para ' + provName
        };
        continue;
      }

      // Checa sessao antes de enviar
      const loggedIn = await driver.isLoggedIn(page);
      if (!loggedIn) {
        results[provName] = {
          success: false,
          error: 'Provedor deslogado ou desafio de seguranca ativo (AUTH_REQUIRED)'
        };
        continue;
      }

      // Abre conversa nova para nao escrever dentro de um chat existente do usuario
      if (typeof driver.newChat === 'function') {
        await driver.newChat(page);
      }

      // Envia prompt ficticio seguro
      await driver.send(page, testPrompt, cdpManager);

      // Aguarda conclusao da resposta
      await driver.waitDone(page, 30000);

      // Extrai resposta
      const answer = await driver.extractAnswer(page);

      results[provName] = {
        success: true,
        provider: provName,
        model: answer.model || driver.defaultModel || 'unknown',
        textLength: (answer.text || '').length,
        sourcesCount: (answer.sources || []).length,
        durationMs: Date.now() - provStartTime
      };
    } catch (err) {
      results[provName] = {
        success: false,
        provider: provName,
        error: err.message,
        code: err.code || 'UNKNOWN_ERROR',
        durationMs: Date.now() - provStartTime
      };
    }
  }

  return {
    timestamp: new Date().toISOString(),
    optInVerified: true,
    mode: 'single_prompt',
    totalDurationMs: Date.now() - startTime,
    results
  };
}

export { runLiveHomologation as runLiveTest };
export default runLiveHomologation;
