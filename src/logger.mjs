import fs from 'node:fs';
import path from 'node:path';

/**
 * Chaves estritamente permitidas no registro de metadados.
 * Qualquer conteudo textual de prompt ou resposta e categoricamente descartado.
 */
const SAFE_METADATA_KEYS = Object.freeze([
  'timestamp',
  'event',
  'provider',
  'model',
  'session',
  'targetId',
  'duration_ms',
  'payload_bytes',
  'response_bytes',
  'sources_count',
  'status',
  'error_code'
]);

/**
 * Filtra e higieniza um objeto de log para garantir retencao zero e privacidade.
 * @param {Record<string, any>} entry
 * @returns {Record<string, any>}
 */
export function sanitizeLogMetadata(entry) {
  if (!entry || typeof entry !== 'object') {
    return {
      timestamp: new Date().toISOString(),
      event: 'unknown',
      status: 'unknown'
    };
  }

  const sanitized = {};

  for (const key of SAFE_METADATA_KEYS) {
    if (entry[key] !== undefined && entry[key] !== null) {
      sanitized[key] = entry[key];
    }
  }

  if (!sanitized.timestamp) {
    sanitized.timestamp = new Date().toISOString();
  }

  return sanitized;
}

/**
 * Logger estruturado exclusivo para metadados operacionais.
 */
export class MetadataLogger {
  /**
   * @param {{ logFilePath?: string | null, maxBytes?: number }} options
   */
  constructor({ logFilePath = null, maxBytes = 5 * 1024 * 1024 } = {}) {
    this.logFilePath = logFilePath;
    this.maxBytes = maxBytes;
    this.recent = [];
    this.maxMemoryEntries = 200;
  }

  /**
   * Registra um evento higienizado em memoria e opcionalmente em disco JSONL.
   * @param {Record<string, any>} entry
   * @returns {Record<string, any>}
   */
  log(entry) {
    const safe = sanitizeLogMetadata(entry);

    // Buffer em memoria limitado aos ultimos 200 eventos
    this.recent.push(safe);
    if (this.recent.length > this.maxMemoryEntries) {
      this.recent.shift();
    }

    // Persistencia em disco JSONL se caminho fornecido
    if (this.logFilePath) {
      this._writeToFile(safe);
    }

    return safe;
  }

  /**
   * Retorna os eventos mais recentes da memoria.
   * @param {number} limit
   * @returns {Array<Record<string, any>>}
   */
  getRecent(limit = 50) {
    const safeLimit = Math.max(1, Math.min(limit, this.maxMemoryEntries));
    return this.recent.slice(-safeLimit).map((item) => ({ ...item }));
  }

  /**
   * Escreve linha em arquivo JSONL com rotacao controlada por tamanho maximo.
   * @private
   * @param {Record<string, any>} safeEntry
   */
  _writeToFile(safeEntry) {
    try {
      const line = JSON.stringify(safeEntry) + '\n';
      const dir = path.dirname(this.logFilePath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Rotacao quando o arquivo atual exceder maxBytes
      if (fs.existsSync(this.logFilePath)) {
        const stats = fs.statSync(this.logFilePath);
        if (stats.size + line.length > this.maxBytes) {
          const rotatedPath = `${this.logFilePath}.1`;
          if (fs.existsSync(rotatedPath)) {
            fs.unlinkSync(rotatedPath);
          }
          fs.renameSync(this.logFilePath, rotatedPath);
        }
      }

      fs.appendFileSync(this.logFilePath, line, 'utf8');
    } catch {
      // Falhas de I/O em disco nao devem derrubar a operacao em producao
    }
  }
}
