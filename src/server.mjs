import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { BridgeError, ERROR_CODES, isBridgeError } from './errors.mjs';
import { inspectPayload, assertPayloadAllowed } from './sanitizer.mjs';
import { MetadataLogger } from './logger.mjs';
import { ProviderQueueManager } from './queue.mjs';
import { SessionManager } from './sessions.mjs';
import { CdpManager } from './cdp.mjs';
import { getDriver, runDoctor, DRIVERS, normalizeProvider, PROVIDER_NAMES } from './doctor.mjs';

/**
 * Ferramentas autorizadas expostas pelo chat-overdrive-bridge.
 * Runtime.evaluate NUNCA e exposto como tool.
 */
export const MCP_TOOLS = Object.freeze([
  {
    name: 'ask_web_chat',
    description: "Ask a web chat (Perplexity, Gemini, ChatGPT, Claude or DeepSeek) using the user's own signed-in browser session, and return its answer with sources. Use it when the user names one of these chats, for example \"ask Gemini\", \"use ChatGPT web\", \"pergunte ao Perplexity\", \"consulte o Claude web\", or says \"use the bridge\". Prefer the ask_<provider> tools when a single chat is named. The prompt is checked for secrets and personal data first and blocked (BLOCKED_BY_POLICY) if any is found. / Consulta um chat web (Perplexity, Gemini, ChatGPT, Claude ou DeepSeek) usando a sessao logada do proprio navegador do usuario e devolve a resposta com fontes. Via Chrome CDP local 127.0.0.1:9222, com sanitizacao previa e fila por provedor.",
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['perplexity', 'gemini', 'chatgpt', 'claude', 'deepseek'],
          description: 'Identificador do provedor de chat web (perplexity, gemini, chatgpt, claude, deepseek)'
        },
        prompt: {
          type: 'string',
          description: 'Texto do prompt a ser enviado ao chat web'
        },
        session: {
          type: 'string',
          description: 'Chave identificadora da sessao/aba para continuidade de contexto (opcional)'
        },
        new_chat: {
          type: 'boolean',
          description: 'Se true, inicia uma nova conversa limpando o contexto da aba (padrao: true sem session)'
        },
        timeout_s: {
          type: 'number',
          description: 'Tempo limite maximo de espera pela resposta em segundos (padrao: 120)'
        },
        context_files: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } }
            ]
          },
          description: 'Lista de arquivos de contexto para injecao com envio delta inteligente por hash SHA-256'
        },
        filePaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alias para context_files'
        },
        attachments: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, size: { type: 'number' } } }
            ]
          },
          description: 'Lista de arquivos para anexo via input[type=file] / DOM.setFileInputFiles'
        },
        mode: {
          type: 'string',
          description: 'Modo operacional do provedor (ex: search, deep-research)'
        },
        model: {
          type: 'string',
          description: 'Modelo especifico a ser selecionado no provedor'
        }
      },
      required: ['provider', 'prompt']
    }
  },
  {
    name: 'list_chat_sessions',
    description: 'Lista todas as sessoes ativas, abas ocupadas e leases em andamento.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'cancel_chat',
    description: 'Interrompe a execucao ou streaming de resposta de uma sessao em andamento.',
    inputSchema: {
      type: 'object',
      properties: {
        session: {
          type: 'string',
          description: 'Identificador da sessao a cancelar'
        },
        session_id: {
          type: 'string',
          description: 'Alias de session para compatibilidade'
        }
      }
    }
  },
  {
    name: 'chat_bridge_status',
    description: "Check whether the web chats are reachable and signed in, without sending any prompt: the Chrome connection, the queues and, with doctor: true, the login state and page health of each chat. Use it when the user says things like \"check the bridge\", \"are my chats signed in?\", \"verifique se os meus chats web estao logados\", \"status da ponte\". / Verifica a conexao com o Chrome e as filas (CDP 127.0.0.1:9222); com doctor: true informa, por chat, se esta logado e saudavel.",
    inputSchema: {
      type: 'object',
      properties: {
        doctor: {
          type: 'boolean',
          description: 'Se true, verifica o login e a saude da pagina de cada chat (sem enviar prompt). Use true para saber se os chats estao logados.'
        }
      }
    }
  },
  {
    name: 'preview_payload',
    description: 'Modo dry-run para inspecao de segredos, PII, arquivos proibidos e tamanho antes do envio.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['perplexity', 'gemini', 'chatgpt', 'claude', 'deepseek'],
          description: 'Identificador do provedor (opcional)'
        },
        prompt: {
          type: 'string',
          description: 'Texto a ser inspecionado pelo sanitizador de segredos'
        },
        filePaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista opcional de caminhos de arquivos para validacao contra a deny-list'
        }
      },
      required: ['prompt']
    }
  }
]);

/**
 * Metadados de cada provedor, usados para gerar tools com nome e descricao em linguagem
 * natural (o cliente de IA decide qual tool usar lendo estas descricoes).
 */
const PROVIDER_INFO = Object.freeze({
  perplexity: {
    label: 'Perplexity',
    site: 'perplexity.ai',
    say: ['ask Perplexity', 'search with Perplexity', 'pergunte ao Perplexity', 'pesquise no Perplexity'],
    note: 'Best for web research with cited sources.'
  },
  gemini: {
    label: 'Google Gemini',
    site: 'gemini.google.com',
    say: ['ask Gemini', 'use Gemini web', 'pergunte ao Gemini', 'use o Gemini Chat web'],
    note: 'Google Gemini answer.'
  },
  chatgpt: {
    label: 'ChatGPT',
    site: 'chatgpt.com',
    say: ['ask ChatGPT', 'use ChatGPT web', 'pergunte ao ChatGPT', 'use o ChatGPT web'],
    note: 'OpenAI ChatGPT answer.'
  },
  claude: {
    label: 'Claude (claude.ai)',
    site: 'claude.ai',
    say: ['ask Claude web', 'use Claude on the web', 'pergunte ao Claude web', 'consulte o Claude no navegador'],
    note: 'Anthropic Claude answer from the web app.'
  },
  deepseek: {
    label: 'DeepSeek',
    site: 'chat.deepseek.com',
    say: ['ask DeepSeek', 'use DeepSeek web', 'pergunte ao DeepSeek', 'consulte o DeepSeek'],
    note: 'DeepSeek answer.'
  }
});

const ASK_WEB_CHAT_SCHEMA = MCP_TOOLS.find((t) => t.name === 'ask_web_chat').inputSchema;

const PROVIDER_TOOLS = PROVIDER_NAMES.map((provider) => {
  const info = PROVIDER_INFO[provider];
  const { provider: _omit, ...properties } = ASK_WEB_CHAT_SCHEMA.properties;
  return {
    name: `ask_${provider}`,
    description:
      `Ask ${info.label} on the web (${info.site}), using the user's own signed-in browser session, ` +
      `and return its answer with sources. Use it when the user says things like ` +
      `"${info.say.join('", "')}". This consults the ${info.label} chat itself; it is not a generic ` +
      `web search. ${info.note} The prompt is checked for secrets and personal data first. / ` +
      `Pergunta ao ${info.label} na web, usando a sessao logada do navegador do usuario, e devolve ` +
      `a resposta com fontes.`,
    inputSchema: { type: 'object', properties, required: ['prompt'] }
  };
});

const COMPARE_TOOL = {
  name: 'compare_web_chats',
  description:
    'Ask several web chats the same question at once (default: Perplexity, Gemini, ChatGPT, Claude and ' +
    'DeepSeek) and return every answer side by side, so the user can compare or get a second opinion. ' +
    'Use it for "compare Gemini and ChatGPT", "ask all the chats", "get a second opinion", ' +
    '"pergunte a todos", "compare as respostas". Different providers run in parallel; a provider that is ' +
    'not signed in returns its own error without stopping the others. / Pergunta a varios chats web ao ' +
    'mesmo tempo e devolve as respostas lado a lado.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Question sent to every selected chat / Pergunta enviada a cada chat' },
      providers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Chats to ask: perplexity, gemini, chatgpt, claude, deepseek (aliases like "ChatGPT web" are accepted). Default: all five.'
      },
      new_chat: { type: 'boolean', description: 'Start a new conversation in each chat (default true)' },
      timeout_s: { type: 'number', description: 'Maximum wait per chat in seconds (default 120)' }
    },
    required: ['prompt']
  }
};

/**
 * Lista completa de tools expostas ao cliente MCP: a generica, uma por provedor e a de comparacao.
 */
export const ALL_MCP_TOOLS = Object.freeze([...MCP_TOOLS, ...PROVIDER_TOOLS, COMPARE_TOOL]);

/**
 * Cria uma instancia do servidor MCP do chat-overdrive-bridge.
 * Suporta execucao nativa JSON-RPC 2.0 stdio e compatibilidade com @modelcontextprotocol/sdk.
 * @param {object} [options]
 * @param {CdpManager} [options.cdpManager]
 * @param {ProviderQueueManager} [options.queueManager]
 * @param {SessionManager} [options.sessionManager]
 * @param {MetadataLogger} [options.logger]
 * @param {object} [options.drivers]
 * @returns {BridgeServer}
 */
export function createBridgeServer({
  cdpManager = null,
  queueManager = null,
  sessionManager = null,
  logger = null,
  drivers = null
} = {}) {
  return new BridgeServer({ cdpManager, queueManager, sessionManager, logger, drivers });
}

/**
 * Monta a mensagem de uma notificacao de progresso MCP.
 * Modo (variavel CHAT_BRIDGE_PROGRESS): "text" (padrao) envia o texto parcial recebido ate agora
 * (ultimos 2000 caracteres), "chars" envia so a contagem de caracteres, "off" desliga.
 * @param {{ provider?: string, text?: string }} update
 * @param {string} [mode]
 * @returns {string|null}
 */
export function buildProgressMessage(update, mode = process.env.CHAT_BRIDGE_PROGRESS || 'text') {
  const text = String(update?.text ?? '');
  if (mode === 'off' || !text) return null;
  const label = update?.provider ? `[${update.provider}] ` : '';
  if (mode === 'chars') return `${label}${text.length} characters received`;
  const MAX = 2000;
  const body = text.length > MAX ? `...${text.slice(-MAX)}` : text;
  return `${label}${body}`;
}

/**
 * Cria o notificador de progresso de uma chamada de tool. Retorna undefined quando o cliente nao
 * pediu progresso (sem progressToken) ou o modo e "off". Falhas de envio nunca afetam a tool.
 * @param {string|number|undefined} progressToken
 * @param {(notification: { method: string, params: object }) => any} send
 * @param {string} [mode]
 * @returns {((update: { provider?: string, text?: string }) => Promise<void>)|undefined}
 */
export function makeProgressNotifier(progressToken, send, mode = process.env.CHAT_BRIDGE_PROGRESS || 'text', stats = null) {
  if (progressToken === undefined || progressToken === null || mode === 'off') return undefined;
  let counter = 0;
  return async (update) => {
    const message = buildProgressMessage(update, mode);
    if (!message) return;
    counter += 1;
    try {
      await send({
        method: 'notifications/progress',
        params: { progressToken, progress: counter, message }
      });
      if (stats) stats.progress_notifications_sent += 1;
    } catch (e) {
      // progresso e opcional: ignora, mas conta para diagnostico
      if (stats) stats.progress_send_errors += 1;
    }
  };
}

export class BridgeServer {
  constructor({
    cdpManager = null,
    queueManager = null,
    sessionManager = null,
    logger = null,
    drivers = null
  } = {}) {
    this.cdpManager = cdpManager || new CdpManager();
    this.queueManager = queueManager || new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 });
    this.sessionManager = sessionManager || new SessionManager();
    this.logger = logger || new MetadataLogger();
    this.drivers = drivers || DRIVERS;
    // Contadores de diagnostico do progresso (so numeros, nunca texto). Aparecem em chat_bridge_status.
    this.progressStats = {
      tool_calls_with_progress_token: 0,
      tool_calls_without_progress_token: 0,
      progress_notifications_sent: 0,
      progress_send_errors: 0
    };
  }

  /**
   * Retorna a lista de ferramentas MCP registradas.
   * @returns {{ tools: typeof MCP_TOOLS }}
   */
  listTools() {
    return { tools: [...ALL_MCP_TOOLS] };
  }

  /**
   * Resolve o driver configurado para o provedor solicitado.
   * @private
   * @param {string} provider
   * @returns {any}
   */
  _resolveDriver(provider) {
    const key = normalizeProvider(provider);
    if (this.drivers && this.drivers[key]) {
      return this.drivers[key];
    }
    return getDriver(provider);
  }

  /**
   * Executa diretamente a ferramenta retornando o dado bruto ou lancando erro.
   * Utilizado para testes unitarios e integracao programatica.
   * @param {string} name
   * @param {object} args
   * @returns {Promise<any>}
   */
  async invoke(name, args = {}, ctx = {}) {
    // ask_<provedor>: atalho em linguagem natural para ask_web_chat com o provedor fixo
    if (typeof name === 'string' && name.startsWith('ask_') && name !== 'ask_web_chat') {
      const target = name.slice(4);
      if (PROVIDER_NAMES.includes(target)) {
        return this.invoke('ask_web_chat', { ...(args || {}), provider: target }, ctx);
      }
    }

    switch (name) {
      case 'compare_web_chats': {
        const { prompt, providers, timeout_s, new_chat } = args || {};
        if (typeof prompt !== 'string' || !prompt.trim()) {
          throw new BridgeError(ERROR_CODES.BLOCKED_BY_POLICY, 'Prompt e obrigatorio e nao pode ser vazio');
        }
        // Falha rapida e unica: um prompt bloqueado nao e enviado a nenhum provedor
        assertPayloadAllowed(prompt);

        const requested = Array.isArray(providers) && providers.length > 0 ? providers : PROVIDER_NAMES;
        const targets = [...new Set(requested.map((p) => normalizeProvider(String(p))))];
        const unknown = targets.filter((p) => !PROVIDER_NAMES.includes(p));
        if (unknown.length > 0) {
          throw new BridgeError(
            ERROR_CODES.BLOCKED_BY_POLICY,
            `Provedor nao suportado: ${unknown.join(', ')}`
          );
        }

        // Provedores diferentes rodam em paralelo; a fila garante serie dentro de cada provedor
        const settled = await Promise.allSettled(
          targets.map((p) => this.invoke('ask_web_chat', { provider: p, prompt, timeout_s, new_chat }, ctx))
        );
        const results = settled.map((s, i) => {
          if (s.status === 'fulfilled') {
            return {
              provider: targets[i],
              ok: true,
              text: s.value.text,
              sources: s.value.sources,
              model: s.value.model,
              duration_ms: s.value.duration_ms
            };
          }
          return {
            provider: targets[i],
            ok: false,
            error_code: s.reason?.code || 'INTERNAL_ERROR',
            message: s.reason?.message || String(s.reason)
          };
        });
        return { asked: targets, results };
      }

      case 'ask_web_chat': {
        const {
          provider: providerRaw,
          prompt,
          session,
          new_chat,
          timeout_s,
          context_files,
          filePaths,
          attachments,
          mode,
          model: requestedModel
        } = args || {};

        if (!providerRaw || typeof providerRaw !== 'string') {
          throw new BridgeError(ERROR_CODES.BLOCKED_BY_POLICY, 'Provedor e obrigatorio');
        }
        // Aceita apelidos ("ChatGPT Web", "Google Gemini") e converte para o nome canonico
        const provider = normalizeProvider(providerRaw);
        if (typeof prompt !== 'string' || !prompt.trim()) {
          throw new BridgeError(ERROR_CODES.BLOCKED_BY_POLICY, 'Prompt e obrigatorio e nao pode ser vazio');
        }

        // Helper para extrair caminhos de arquivos para verificacao de segredos e deny-list
        const extractPathStrings = (items) => {
          if (!items) return [];
          const list = Array.isArray(items) ? items : [items];
          return list.map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && item.path) return String(item.path);
            return '';
          }).filter(Boolean);
        };

        const allReferencedFiles = [
          ...extractPathStrings(context_files),
          ...extractPathStrings(filePaths),
          ...extractPathStrings(attachments)
        ];

        // 1. Sanitizacao de segredos, PII e arquivos restritos antes de qualquer toque no CDP
        assertPayloadAllowed(prompt, { filePaths: allReferencedFiles });

        // 2. Localizacao do driver correspondente
        const driver = this._resolveDriver(provider);

        // 3. Identificacao de sessao e comportamento de nova conversa
        const sessionKey = session || `${provider.toLowerCase().trim()}-default`;
        const newChat = session ? Boolean(new_chat) : (new_chat !== false);
        const timeoutMs = (Number(timeout_s) || 120) * 1000;

        // 4. Validacao previa de anexos locais (le o disco e sanitiza; nao toca em estado compartilhado)
        const rawContextFiles = context_files || filePaths || [];
        let validatedAttachments = [];
        if (attachments && (Array.isArray(attachments) ? attachments.length > 0 : Boolean(attachments))) {
          validatedAttachments = this.sessionManager.validateAttachments(attachments);
        }

        let payloadBytes = Buffer.byteLength(String(prompt), 'utf8');

        // 5. Enfileiramento serial por provedor. Todo o estado compartilhado da sessao (sessao
        //    nomeada, hashes do envio delta, URL da conversa) e preparado DENTRO da fila, para que
        //    chamadas simultaneas da mesma sessao nao disputem o estado nem desfacam o trabalho
        //    umas das outras ao reverter uma falha.
        return await this.queueManager.enqueue(provider, sessionKey, async (signalOrCtx) => {
          const signal = (signalOrCtx && signalOrCtx.signal) ? signalOrCtx.signal : signalOrCtx;
          const startTime = Date.now();
          let targetId = null;
          let model = 'unknown';
          let conversationRestored = false;
          const warnings = [];

          // Gerenciamento de sessao nomeada
          const sessionState = this.sessionManager.getOrCreateSession(provider, sessionKey, { forceNew: newChat });

          // Snapshot dos hashes: se a montagem ou o envio falhar, restaura para nao marcar como
          // UNCHANGED um arquivo que nunca chegou ao chat.
          const hashSnapshot = new Map(sessionState.fileHashes);
          const restoreHashes = () => {
            sessionState.fileHashes = new Map(hashSnapshot);
          };

          try {
            // Envio delta por hash SHA-256: o conteudo dos arquivos e sanitizado aqui, antes de
            // qualquer toque no CDP.
            let finalPrompt = prompt;
            let deltaStats = null;
            if (Array.isArray(rawContextFiles) && rawContextFiles.length > 0) {
              const deltaResult = this.sessionManager.buildDeltaPayload(sessionKey, prompt, {
                contextFiles: rawContextFiles
              });
              finalPrompt = deltaResult.finalPrompt;
              deltaStats = deltaResult.deltaStats;
              payloadBytes = Buffer.byteLength(String(finalPrompt), 'utf8');
            }

            await this.cdpManager.connect();
            const context = this.cdpManager.getContext();
            const page = await driver.ensureTab(context);

            targetId = await this.cdpManager.getTargetId(page);
            if (targetId) {
              this.queueManager.acquireLease(provider, targetId, sessionKey);
              this.sessionManager.bindTarget(sessionKey, targetId);
            }

            const loggedIn = await driver.isLoggedIn(page);
            if (!loggedIn) {
              throw new BridgeError(
                ERROR_CODES.AUTH_REQUIRED,
                `Sessao deslogada ou autenticacao/desafio pendente no provedor ${provider}`
              );
            }

            // Nunca toma uma aba que esta gerando resposta (uso manual do usuario ou outro cliente MCP):
            // navegar ou enviar agora interromperia ou misturaria a conversa dele.
            if (typeof driver.isGenerating === 'function' && (await driver.isGenerating(page))) {
              throw new BridgeError(
                ERROR_CODES.TAB_BUSY,
                `A aba do ${provider} esta gerando uma resposta (uso manual ou outro cliente). Aguarde terminar e tente de novo.`,
                { provider, reason: 'generation_in_progress' }
              );
            }

            const currentUrl = () => (typeof page.url === 'function' ? String(page.url() || '') : '');
            let homeUrl = null;

            if (newChat) {
              await driver.newChat(page);
              homeUrl = currentUrl();
            } else if (sessionState.conversationUrl) {
              // Sessao continuada: a aba e unica por provedor. Se outra sessao usou a aba no meio,
              // volta para a conversa desta sessao antes de enviar.
              const target = sessionState.conversationUrl;
              const sameProvider = typeof driver.matchesUrl !== 'function' || driver.matchesUrl(target);
              if (sameProvider && currentUrl() !== target && typeof page.goto === 'function') {
                await page.goto(target, { waitUntil: 'domcontentloaded' });
                if (typeof driver.waitForComposer === 'function') {
                  await driver.waitForComposer(page);
                }
                conversationRestored = true;
              }
            }

            // Selecao opcional de modo e modelo. Nenhum provedor tem selecao real implementada
            // ainda: o resultado diz a verdade em vez de fingir que aplicou.
            if (mode && typeof driver.setMode === 'function') {
              const modeRes = await driver.setMode(page, mode);
              if (!modeRes || modeRes.applied !== true) {
                warnings.push({
                  code: 'MODE_NOT_APPLIED',
                  message: `O modo "${mode}" nao pode ser selecionado pela interface web; o chat respondeu no modo atual.`
                });
              }
            }
            if (requestedModel && typeof driver.setModel === 'function') {
              const modelRes = await driver.setModel(page, requestedModel);
              if (!modelRes || modelRes.applied !== true) {
                warnings.push({
                  code: 'MODEL_NOT_APPLIED',
                  message: `O modelo "${requestedModel}" nao pode ser selecionado pela interface web; o chat respondeu com o modelo atual.`
                });
              }
            }

            // Anexos locais: sem upload real o envio e abortado (nenhum prompt sai).
            if (validatedAttachments.length > 0) {
              let attached = false;
              if (typeof driver.attachFiles === 'function') {
                attached = await driver.attachFiles(page, validatedAttachments, this.cdpManager);
              } else if (typeof this.cdpManager.setFileInputFiles === 'function') {
                attached = await this.cdpManager.setFileInputFiles(page, 'input[type="file"]', validatedAttachments);
              }
              if (attached !== true) {
                throw new BridgeError(
                  ERROR_CODES.ATTACHMENT_FAILED,
                  'Nao foi possivel anexar os arquivos pela interface web; nenhum prompt foi enviado.',
                  { attachments: validatedAttachments.length }
                );
              }
            }

            // Baseline do turno: evita devolver a resposta do turno anterior em conversas continuadas.
            const baseline = typeof driver.captureBaseline === 'function'
              ? await driver.captureBaseline(page)
              : null;

            await driver.send(page, finalPrompt, this.cdpManager);
            this.sessionManager.recordTurn(sessionKey);

            await driver.waitDone(
              page,
              timeoutMs,
              signal,
              ctx && typeof ctx.onProgress === 'function'
                ? (text) => ctx.onProgress({ provider, text })
                : null,
              baseline
            );

            const answer = await driver.extractAnswer(page);

            // Guarda a URL da conversa para esta sessao (so se mudou em relacao a pagina inicial)
            const afterUrl = currentUrl();
            if (
              afterUrl &&
              (homeUrl === null || afterUrl !== homeUrl) &&
              (typeof driver.matchesUrl !== 'function' || driver.matchesUrl(afterUrl))
            ) {
              sessionState.conversationUrl = afterUrl;
            }

            const durationMs = Date.now() - startTime;
            const responseBytes = Buffer.byteLength(String(answer?.text || ''), 'utf8');
            const sourcesCount = Array.isArray(answer?.sources) ? answer.sources.length : 0;
            model = answer?.model || driver.defaultModel || 'unknown';

            // Registro exclusivo de metadados
            this.logger.log({
              event: 'ask_web_chat',
              provider,
              model,
              session: sessionKey,
              targetId,
              duration_ms: durationMs,
              payload_bytes: payloadBytes,
              response_bytes: responseBytes,
              sources_count: sourcesCount,
              status: 'ok'
            });

            return {
              text: answer?.text || '',
              sources: answer?.sources || [],
              provider,
              model,
              ...(requestedModel ? { model_requested: requestedModel } : {}),
              duration_ms: durationMs,
              session: sessionKey,
              ...(conversationRestored ? { conversation_restored: true } : {}),
              ...(warnings.length > 0 ? { warnings } : {}),
              ...(deltaStats ? { delta_stats: deltaStats } : {})
            };
          } catch (err) {
            const durationMs = Date.now() - startTime;
            this.logger.log({
              event: 'ask_web_chat',
              provider,
              session: sessionKey,
              targetId,
              duration_ms: durationMs,
              payload_bytes: payloadBytes,
              status: 'error',
              error_code: err.code || 'UNKNOWN'
            });
            restoreHashes();
            throw err;
          } finally {
            if (targetId) {
              this.queueManager.releaseLease(targetId, sessionKey);
            }
          }
        }, { timeoutMs });
      }

      case 'list_chat_sessions': {
        const qStatus = this.queueManager.getStatus();
        const leases = typeof this.queueManager.getLeases === 'function'
          ? this.queueManager.getLeases()
          : (qStatus.leases || []);
        const managedSessions = typeof this.sessionManager.listSessions === 'function'
          ? this.sessionManager.listSessions().map((s) => (s.toJSON ? s.toJSON() : s))
          : [];

        return {
          sessions: leases,
          managedSessions,
          activeTasks: qStatus.activeSessions || [],
          queues: qStatus.queues || {}
        };
      }

      case 'cancel_chat': {
        const targetSession = args?.session || args?.session_id;
        if (!targetSession || typeof targetSession !== 'string') {
          throw new BridgeError(ERROR_CODES.CANCELLED, 'Parametro session obrigatorio para cancelamento');
        }

        const cancelResult = this.queueManager.cancelSession(targetSession);

        // Se houver lease associado e o driver tiver metodo stop, tenta interromper a geracao na aba
        const leases = typeof this.queueManager.getLeases === 'function' ? this.queueManager.getLeases() : [];
        const matchingLease = leases.find((l) => l.sessionId === targetSession);
        if (matchingLease) {
          try {
            const driver = this._resolveDriver(matchingLease.provider);
            const context = this.cdpManager.getContext();
            const pages = typeof context.pages === 'function' ? context.pages() : [];
            for (const p of pages) {
              const tid = await this.cdpManager.getTargetId(p);
              if (tid === matchingLease.targetId) {
                await driver.stop(p).catch(() => {});
                break;
              }
            }
          } catch (e) {
            // Cancelamento via signal ja foi acionado
          }
        }

        return {
          success: cancelResult.cancelled !== false,
          session: targetSession
        };
      }

      case 'chat_bridge_status': {
        const cdpStatus = await this.cdpManager.getStatus();
        const queueStatus = this.queueManager.getStatus();
        let doctorResult = null;

        if (args?.doctor && cdpStatus.cdpConnected) {
          try {
            doctorResult = await runDoctor({ cdpManager: this.cdpManager });
          } catch (err) {
            doctorResult = { error: err.message };
          }
        }

        return {
          cdp: cdpStatus,
          queue: queueStatus,
          // Diagnostico do texto parcial: o cliente pede progresso? quantos avisos foram enviados?
          progress: { mode: process.env.CHAT_BRIDGE_PROGRESS || 'text', ...this.progressStats },
          doctor: doctorResult
        };
      }

      case 'preview_payload': {
        const prompt = args?.prompt || '';
        const filePaths = args?.filePaths || [];
        const inspection = inspectPayload(prompt, { filePaths });

        this.logger.log({
          event: 'preview_payload',
          provider: args?.provider ? normalizeProvider(args.provider) : 'none',
          payload_bytes: inspection.payloadBytes,
          allowed: inspection.allowed,
          violations_count: inspection.violations.length,
          status: 'ok'
        });

        return {
          allowed: inspection.allowed,
          sanitizedPrompt: inspection.sanitizedPrompt,
          violations: inspection.violations,
          payloadBytes: inspection.payloadBytes
        };
      }

      default:
        throw new BridgeError(
          ERROR_CODES.BLOCKED_BY_POLICY,
          `Ferramenta desconhecida ou nao autorizada: ${name}`
        );
    }
  }

  /**
   * Executa a ferramenta e encapsula a resposta conforme o contrato padrao MCP.
   * @param {string} name
   * @param {object} args
   * @returns {Promise<{ content: Array<object>, isError?: boolean, errorCode?: string, data?: any }>}
   */
  /**
   * Cria o notificador de progresso de uma chamada e atualiza os contadores de diagnostico.
   * @private
   */
  _progressFor(progressToken, send) {
    const has = !(progressToken === undefined || progressToken === null);
    if (has) this.progressStats.tool_calls_with_progress_token += 1;
    else this.progressStats.tool_calls_without_progress_token += 1;
    return makeProgressNotifier(progressToken, send, undefined, this.progressStats);
  }

  async callTool(name, args = {}, ctx = {}) {
    try {
      const data = await this.invoke(name, args, ctx);
      return {
        content: [
          {
            type: 'text',
            text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
          }
        ],
        data
      };
    } catch (err) {
      const isKnown = isBridgeError(err);
      const errorCode = err.code || (isKnown ? ERROR_CODES.BLOCKED_BY_POLICY : 'INTERNAL_ERROR');
      const payload = err.toJSON ? err.toJSON() : {
        error: true,
        code: errorCode,
        message: err.message,
        details: err.details || {}
      };

      return {
        isError: true,
        errorCode,
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload)
          }
        ]
      };
    }
  }

  /**
   * Inicia o servidor escutando requisicoes JSON-RPC 2.0 via stdin/stdout.
   * Tenta utilizar o SDK oficial se disponivel, ou ativa fallback nativo.
   */
  async startStdio() {
    let sdkLoaded = false;

    try {
      const mcpServerModule = await import('@modelcontextprotocol/sdk/server/index.js');
      const mcpStdioModule = await import('@modelcontextprotocol/sdk/server/stdio.js');
      const mcpTypesModule = await import('@modelcontextprotocol/sdk/types.js');

      const { Server } = mcpServerModule;
      const { StdioServerTransport } = mcpStdioModule;
      const { CallToolRequestSchema, ListToolsRequestSchema } = mcpTypesModule;

      const server = new Server(
        { name: 'chat-overdrive-bridge', version: '0.1.0' },
        { capabilities: { tools: {} } }
      );

      server.setRequestHandler(ListToolsRequestSchema, async () => {
        return this.listTools();
      });

      server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        const { name, arguments: toolArgs } = request.params;
        // Progresso so e enviado se o cliente pediu (progressToken em _meta)
        const onProgress = this._progressFor(
          request.params?._meta?.progressToken,
          (notification) => extra.sendNotification(notification)
        );
        const res = await this.callTool(name, toolArgs || {}, onProgress ? { onProgress } : {});
        return {
          content: res.content,
          isError: res.isError || false
        };
      });

      const transport = new StdioServerTransport();
      await server.connect(transport);
      sdkLoaded = true;
    } catch {
      sdkLoaded = false;
    }

    if (!sdkLoaded) {
      this._startNativeStdio();
    }
  }

  /**
   * Fallback nativo robusto de protocolo JSON-RPC 2.0 stdio (MCP compativel).
   * @private
   */
  _startNativeStdio() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    const sendJsonRpc = (obj) => {
      process.stdout.write(JSON.stringify(obj) + '\n');
    };

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch (err) {
        sendJsonRpc({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error: invalid JSON' }
        });
        return;
      }

      if (msg.jsonrpc !== '2.0') {
        return;
      }

      const { id, method, params } = msg;

      // Tratamento de notificacoes sem id
      if (id === undefined || id === null) {
        return;
      }

      switch (method) {
        case 'initialize':
          sendJsonRpc({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: {
                name: 'chat-overdrive-bridge',
                version: '0.1.0'
              }
            }
          });
          break;

        case 'ping':
          sendJsonRpc({
            jsonrpc: '2.0',
            id,
            result: {}
          });
          break;

        case 'tools/list':
          sendJsonRpc({
            jsonrpc: '2.0',
            id,
            result: this.listTools()
          });
          break;

        case 'tools/call': {
          const toolName = params?.name;
          const toolArgs = params?.arguments || {};
          const onProgress = this._progressFor(
            params?._meta?.progressToken,
            (notification) => sendJsonRpc({ jsonrpc: '2.0', method: notification.method, params: notification.params })
          );
          const callRes = await this.callTool(toolName, toolArgs, onProgress ? { onProgress } : {});

          if (callRes.isError) {
            sendJsonRpc({
              jsonrpc: '2.0',
              id,
              result: {
                content: callRes.content,
                isError: true
              }
            });
          } else {
            sendJsonRpc({
              jsonrpc: '2.0',
              id,
              result: {
                content: callRes.content
              }
            });
          }
          break;
        }

        default:
          sendJsonRpc({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Metodo nao encontrado: ${method}`
            }
          });
          break;
      }
    });
  }
}

// Execucao direta como processo filho MCP stdio
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const bridge = createBridgeServer();
  bridge.startStdio().catch((err) => {
    process.stderr.write(`Falha fatal na inicializacao do chat-overdrive-bridge: ${err.message}\n`);
    process.exit(1);
  });
}
