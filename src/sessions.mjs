import { createHash, randomUUID } from 'node:crypto';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { BridgeError, ERROR_CODES } from './errors.mjs';
import { checkFilePathAllowed, assertPayloadAllowed, MAX_PROMPT_CHARS } from './sanitizer.mjs';

/**
 * Calcula o hash SHA-256 em formato hexadecimal de um conteudo.
 * @param {string|Buffer|any} content
 * @returns {string} Hash SHA-256 hexadecimal (64 caracteres)
 */
export function computeContentHash(content) {
  const text = typeof content === 'string'
    ? content
    : (content instanceof Buffer ? content : String(content ?? ''));
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Normaliza caminho de arquivo para formato absoluto com barras normais.
 * @param {string} filePath
 * @returns {string}
 */
export function normalizePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }
  return resolve(filePath).replace(/\\/g, '/');
}

/**
 * Gerenciador de sessoes nomeadas, abas dedicadas, envio delta e anexos seguros.
 */
export class SessionManager {
  /**
   * @param {object} [options]
   * @param {number} [options.defaultMaxFileBytes=128000]
   * @param {number} [options.defaultMaxAttachmentBytes=5242880]
   */
  constructor({ defaultMaxFileBytes = 128000, defaultMaxAttachmentBytes = 5 * 1024 * 1024 } = {}) {
    /** @type {Map<string, object>} */
    this.sessions = new Map();
    this.defaultMaxFileBytes = defaultMaxFileBytes;
    this.defaultMaxAttachmentBytes = defaultMaxAttachmentBytes;
  }

  /**
   * Obtem ou cria uma sessao nomeada para o provedor especificado.
   * Se forceNew for true ou a sessao nao existir, cria ou reinicializa a sessao.
   * Se a sessao ja existir com outro provedor, lanca BLOCKED_BY_POLICY.
   * @param {string} provider
   * @param {string|object|null} [sessionKey=null]
   * @param {{ forceNew?: boolean }} [options]
   * @returns {object} Objeto de sessao
   */
  getOrCreateSession(provider, sessionKey = null, { forceNew = false } = {}) {
    const prov = String(provider || '').trim().toLowerCase();
    if (!prov) {
      throw new BridgeError(ERROR_CODES.BLOCKED_BY_POLICY, 'Provedor obrigatorio para gerenciar sessao');
    }

    const rawKey = typeof sessionKey === 'object' && sessionKey !== null ? sessionKey.id : sessionKey;
    const key = rawKey ? String(rawKey).trim() : null;

    if (key && this.sessions.has(key)) {
      const existing = this.sessions.get(key);
      if (!forceNew) {
        if (existing.provider && existing.provider !== prov) {
          throw new BridgeError(
            ERROR_CODES.BLOCKED_BY_POLICY,
            'Sessao ja vinculada a outro provedor',
            { sessionKey: key, existingProvider: existing.provider, requestedProvider: prov }
          );
        }
        return existing;
      }

      // forceNew: reseta estado de turnos e hashes mantendo a chave
      const now = Date.now();
      existing.provider = prov;
      existing.targetId = null;
      existing.conversationUrl = null;
      existing.updatedAt = now;
      existing.turnCount = 0;
      existing.fileHashes = new Map();
      existing.promptHashes = new Set();
      return existing;
    }

    // Cria nova sessao
    const now = Date.now();
    const finalKey = key || `sess_${randomUUID()}`;
    const session = {
      id: finalKey,
      provider: prov,
      targetId: null,
      conversationUrl: null,
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
      fileHashes: new Map(),
      promptHashes: new Set(),
      toJSON() {
        return {
          id: this.id,
          provider: this.provider,
          targetId: this.targetId,
          createdAt: this.createdAt,
          updatedAt: this.updatedAt,
          turnCount: this.turnCount,
          hasConversation: Boolean(this.conversationUrl),
          filesCount: this.fileHashes.size,
          promptsCount: this.promptHashes.size
        };
      }
    };

    this.sessions.set(finalKey, session);
    return session;
  }

  /**
   * Helper interno para buscar sessao por ID ou objeto.
   * @private
   * @param {string|object} sessionId
   * @returns {object|null}
   */
  _getSession(sessionId) {
    if (!sessionId) return null;
    if (typeof sessionId === 'object') {
      if (sessionId.fileHashes instanceof Map) return sessionId;
      if (sessionId.id) return this.sessions.get(String(sessionId.id)) || null;
    }
    return this.sessions.get(String(sessionId)) || null;
  }

  /**
   * Obtem sessao existente sem criar.
   * @param {string|object} sessionId
   * @returns {object|null}
   */
  getSession(sessionId) {
    return this._getSession(sessionId);
  }

  /**
   * Vincula o targetId da aba dedicada a sessao.
   * @param {string|object} sessionId
   * @param {string} targetId
   * @returns {object} Sessao atualizada
   */
  bindTarget(sessionId, targetId) {
    const session = this._getSession(sessionId);
    if (!session) {
      throw new BridgeError(
        ERROR_CODES.BLOCKED_BY_POLICY,
        `Sessao nao encontrada: ${typeof sessionId === 'object' ? sessionId?.id : sessionId}`
      );
    }
    session.targetId = targetId ? String(targetId) : null;
    session.updatedAt = Date.now();
    return session;
  }

  /**
   * Incrementa o contador de turnos da sessao.
   * @param {string|object} sessionId
   * @returns {object} Sessao atualizada
   */
  recordTurn(sessionId) {
    const session = this._getSession(sessionId);
    if (!session) {
      throw new BridgeError(
        ERROR_CODES.BLOCKED_BY_POLICY,
        `Sessao nao encontrada: ${typeof sessionId === 'object' ? sessionId?.id : sessionId}`
      );
    }
    session.turnCount += 1;
    session.updatedAt = Date.now();
    return session;
  }

  /**
   * Constroi o payload de envio delta, reenviando apenas arquivos novos/modificados
   * e substituindo arquivos inalterados por marcadores leves de hash.
   * @param {string|object} sessionId
   * @param {string} prompt
   * @param {{ contextFiles?: Array<string|{ path: string, content?: string }>, maxFileBytes?: number }} [options]
   * @returns {{ finalPrompt: string, deltaStats: { changedFiles: number, unchangedFiles: number, savedBytes: number, turnCount: number } }}
   */
  buildDeltaPayload(sessionId, prompt, { contextFiles = [], maxFileBytes = 128000 } = {}) {
    const session = this._getSession(sessionId);
    if (!session) {
      throw new BridgeError(
        ERROR_CODES.BLOCKED_BY_POLICY,
        `Sessao nao encontrada: ${typeof sessionId === 'object' ? sessionId?.id : sessionId}`
      );
    }

    const filesList = Array.isArray(contextFiles) ? contextFiles : [];

    // Extrai strings de caminhos para validacao de caminho no assertPayloadAllowed do prompt
    const pathStrings = filesList.map((f) => {
      if (typeof f === 'string') return f;
      if (f && typeof f === 'object' && f.path) return String(f.path);
      return '';
    }).filter(Boolean);

    // 1. Valida o prompt principal e caminhos referenciados
    assertPayloadAllowed(prompt, { filePaths: pathStrings });

    let changedFiles = 0;
    let unchangedFiles = 0;
    let savedBytes = 0;
    const fileBlocks = [];

    // 2. Itera sobre cada arquivo de contexto
    for (const item of filesList) {
      let filePath = '';
      let rawContent = null;
      let providedInMemory = false;

      if (typeof item === 'string') {
        filePath = item;
      } else if (item && typeof item === 'object') {
        filePath = item.path || '';
        if (typeof item.content === 'string' || item.content instanceof Buffer) {
          rawContent = item.content;
          providedInMemory = true;
        }
      }

      // Verifica se o caminho e permitido pela politica
      const pathCheck = checkFilePathAllowed(filePath);
      if (!pathCheck.allowed) {
        throw new BridgeError(
          ERROR_CODES.BLOCKED_BY_POLICY,
          pathCheck.reason || `Arquivo proibido por politica de seguranca: ${filePath}`,
          { filePath }
        );
      }

      let contentStr = '';
      let fileByteSize = 0;

      if (providedInMemory) {
        contentStr = String(rawContent ?? '');
        fileByteSize = Buffer.byteLength(contentStr, 'utf8');
      } else {
        const resolvedPath = resolve(filePath);
        if (!existsSync(resolvedPath)) {
          throw new BridgeError(
            ERROR_CODES.BLOCKED_BY_POLICY,
            `Arquivo de contexto nao encontrado no disco: ${filePath}`,
            { filePath: resolvedPath }
          );
        }
        const stat = statSync(resolvedPath);
        fileByteSize = stat.size;
        if (fileByteSize > maxFileBytes) {
          throw new BridgeError(
            ERROR_CODES.BLOCKED_BY_POLICY,
            `Arquivo de contexto excede o limite maximo de ${maxFileBytes} bytes (${fileByteSize} bytes): ${filePath}`,
            { filePath, size: fileByteSize, maxFileBytes }
          );
        }
        contentStr = readFileSync(resolvedPath, 'utf8');
      }

      if (providedInMemory && fileByteSize > maxFileBytes) {
        throw new BridgeError(
          ERROR_CODES.BLOCKED_BY_POLICY,
          `Arquivo de contexto excede o limite maximo de ${maxFileBytes} bytes (${fileByteSize} bytes): ${filePath}`,
          { filePath, size: fileByteSize, maxFileBytes }
        );
      }

      // Inspeciona conteudo textual no sanitizador para impedir vazamento de segredos/PII
      if (contentStr.trim().length > 0) {
        assertPayloadAllowed(contentStr, {
          filePaths: [filePath],
          maxChars: Math.max(MAX_PROMPT_CHARS, maxFileBytes)
        });
      }

      const hash = computeContentHash(contentStr);
      const normPath = normalizePath(filePath) || filePath;
      const fileName = basename(filePath) || filePath;

      if (session.fileHashes.get(normPath) === hash) {
        // Arquivo inalterado: envia apenas marcador com hash truncado
        fileBlocks.push(`--- FILE: ${fileName} (UNCHANGED_SHA256:${hash.slice(0, 12)}) ---`);
        unchangedFiles += 1;
        savedBytes += fileByteSize;
      } else {
        // Arquivo novo ou modificado: envia bloco completo e atualiza hash na sessao
        fileBlocks.push(`--- FILE: ${fileName} (SHA256:${hash.slice(0, 12)}) ---\n${contentStr}`);
        session.fileHashes.set(normPath, hash);
        changedFiles += 1;
      }
    }

    // Registra hash do prompt na sessao
    session.promptHashes.add(computeContentHash(prompt));
    session.updatedAt = Date.now();

    const finalPrompt = fileBlocks.length > 0
      ? `${prompt}\n\n${fileBlocks.join('\n\n')}`
      : prompt;

    return {
      finalPrompt,
      deltaStats: {
        changedFiles,
        unchangedFiles,
        savedBytes,
        turnCount: session.turnCount
      }
    };
  }

  /**
   * Valida lista de caminhos de arquivos para anexos locais.
   * Impede anexo de arquivos proibidos (.env, .pem, .key, etc.) e verifica limites de tamanho e PII.
   * @param {Array<string|{ path: string, content?: string, size?: number }>} [attachments=[]]
   * @param {{ maxAttachmentBytes?: number }} [options]
   * @returns {string[]} Lista de caminhos validados para DOM.setFileInputFiles
   */
  validateAttachments(attachments = [], { maxAttachmentBytes = 5 * 1024 * 1024 } = {}) {
    const list = Array.isArray(attachments) ? attachments : (attachments ? [attachments] : []);
    const validatedPaths = [];

    for (const item of list) {
      let filePath = '';
      let rawContent = null;
      let specifiedSize = null;
      let providedInMemory = false;

      if (typeof item === 'string') {
        filePath = item;
      } else if (item && typeof item === 'object') {
        filePath = item.path || '';
        if (typeof item.size === 'number') {
          specifiedSize = item.size;
        }
        if (typeof item.content === 'string' || item.content instanceof Buffer) {
          rawContent = item.content;
          providedInMemory = true;
        }
      }

      // 1. Verifica deny-list de arquivos (.env*, *.pem, *.key, *.sql, *_privado*, etc.)
      const pathCheck = checkFilePathAllowed(filePath);
      if (!pathCheck.allowed) {
        throw new BridgeError(
          ERROR_CODES.BLOCKED_BY_POLICY,
          pathCheck.reason || `Anexo proibido por politica de seguranca: ${filePath}`,
          { filePath }
        );
      }

      let fileSize = specifiedSize;
      let fileBuffer = null;

      if (providedInMemory) {
        const str = String(rawContent ?? '');
        fileSize = specifiedSize !== null ? specifiedSize : Buffer.byteLength(str, 'utf8');
        if (fileSize > maxAttachmentBytes) {
          throw new BridgeError(
            ERROR_CODES.BLOCKED_BY_POLICY,
            `Anexo excede o tamanho maximo permitido de ${maxAttachmentBytes} bytes (${fileSize} bytes): ${filePath}`,
            { filePath, size: fileSize, maxAttachmentBytes }
          );
        }
        // Inspeciona conteudo textual em memoria
        if (str.trim().length > 0) {
          assertPayloadAllowed(str, {
            filePaths: [filePath],
            maxChars: Math.max(MAX_PROMPT_CHARS, maxAttachmentBytes)
          });
        }
      } else {
        const resolvedPath = resolve(filePath);
        if (!existsSync(resolvedPath)) {
          if (specifiedSize !== null) {
            if (specifiedSize > maxAttachmentBytes) {
              throw new BridgeError(
                ERROR_CODES.BLOCKED_BY_POLICY,
                `Anexo excede o tamanho maximo permitido de ${maxAttachmentBytes} bytes (${specifiedSize} bytes): ${filePath}`,
                { filePath, size: specifiedSize, maxAttachmentBytes }
              );
            }
          }
        } else {
          const stat = statSync(resolvedPath);
          fileSize = stat.size;
          if (fileSize > maxAttachmentBytes) {
            throw new BridgeError(
              ERROR_CODES.BLOCKED_BY_POLICY,
              `Anexo excede o tamanho maximo permitido de ${maxAttachmentBytes} bytes (${fileSize} bytes): ${filePath}`,
              { filePath, size: fileSize, maxAttachmentBytes }
            );
          }

          // Se for arquivo de texto, le e sanitiza conteudo
          fileBuffer = readFileSync(resolvedPath);
          let isBinary = false;
          const inspectLimit = Math.min(fileBuffer.length, 4096);
          for (let i = 0; i < inspectLimit; i++) {
            if (fileBuffer[i] === 0) {
              isBinary = true;
              break;
            }
          }

          if (!isBinary) {
            const textContent = fileBuffer.toString('utf8');
            if (textContent.trim().length > 0) {
              assertPayloadAllowed(textContent, {
                filePaths: [filePath],
                maxChars: Math.max(MAX_PROMPT_CHARS, maxAttachmentBytes)
              });
            }
          }
        }
      }

      const returnPath = existsSync(filePath) ? resolve(filePath) : filePath;
      validatedPaths.push(returnPath);
    }

    return validatedPaths;
  }

  /**
   * Remove uma sessao pelo ID.
   * @param {string|object} sessionId
   * @returns {boolean} True se a sessao foi removida, false se nao existia
   */
  removeSession(sessionId) {
    const rawId = typeof sessionId === 'object' && sessionId !== null ? sessionId.id : sessionId;
    if (!rawId) return false;
    return this.sessions.delete(String(rawId).trim());
  }

  /**
   * Lista todas as sessoes ativas.
   * @returns {object[]} Lista de sessoes
   */
  listSessions() {
    return Array.from(this.sessions.values());
  }
}
