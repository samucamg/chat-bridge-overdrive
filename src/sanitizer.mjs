import { ERROR_CODES, BridgeError } from './errors.mjs';

/**
 * Limite maximo de caracteres permitidos para envio ao chat web.
 */
export const MAX_PROMPT_CHARS = 32000;

/**
 * Padroes de arquivos proibidos por politica de seguranca e retencao zero.
 */
export const DENY_FILE_PATTERNS = Object.freeze([
  { id: 'env_file', pattern: /(?:^|[\\/])\.env(?:\.[a-zA-Z0-9_-]+)*$/i, label: 'Arquivo .env' },
  { id: 'pem_file', pattern: /\.pem$/i, label: 'Certificado ou chave PEM (*.pem)' },
  { id: 'key_file', pattern: /\.(?:key|p12|pfx)$/i, label: 'Chave privada ou certificado (*.key, *.p12, *.pfx)' },
  { id: 'sql_file', pattern: /\.sql$/i, label: 'Script ou dump SQL (*.sql)' },
  { id: 'privado_file', pattern: /_privado/i, label: 'Arquivo com sufixo ou marcador _privado' },
  { id: 'jsonl_file', pattern: /\.jsonl$/i, label: 'Arquivo de log ou dataset (*.jsonl)' },
  { id: 'ssh_id_rsa', pattern: /(?:^|[\\/])id_rsa[a-zA-Z0-9_-]*$/i, label: 'Chave SSH id_rsa' },
  { id: 'ssh_id_ed25519', pattern: /(?:^|[\\/])id_ed25519[a-zA-Z0-9_-]*$/i, label: 'Chave SSH id_ed25519' },
  { id: 'secret_name', pattern: /secret/i, label: 'Nome de arquivo contendo "secret"' },
  { id: 'credential_name', pattern: /credential/i, label: 'Nome de arquivo contendo "credential"' },
  { id: 'token_name', pattern: /token/i, label: 'Nome de arquivo contendo "token"' },
  { id: 'password_name', pattern: /password/i, label: 'Nome de arquivo contendo "password"' }
]);

/**
 * Padroes regex para deteccao de segredos e dados sensiveis (PII).
 */
export const SECRET_PATTERNS = Object.freeze([
  {
    id: 'private_key',
    label: 'Chave privada PEM / SSH',
    regex: /-----BEGIN(?: [A-Z0-9_-]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9_-]+)? PRIVATE KEY-----|-----BEGIN(?: [A-Z0-9_-]+)? PRIVATE KEY-----/i
  },
  {
    id: 'google_api_key',
    label: 'Chave de API do Google / Gemini',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/
  },
  {
    id: 'openai_key',
    label: 'Chave de API da OpenAI',
    regex: /\bsk-(?:proj-|live-|test-)?[0-9A-Za-z_-]{20,}\b/
  },
  {
    id: 'groq_api_key',
    label: 'Chave de API do Groq',
    regex: /\bgsk_[0-9A-Za-z_-]{20,}\b/
  },
  {
    id: 'xai_api_key',
    label: 'Chave de API da xAI / Grok',
    regex: /\bxai-[0-9A-Za-z_-]{20,}\b/
  },
  {
    id: 'github_token',
    label: 'Token de acesso do GitHub',
    regex: /\b(?:gh[pousr]_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,})\b/
  },
  {
    id: 'aws_access_key',
    label: 'Chave de acesso AWS',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/
  },
  {
    id: 'jwt_token',
    label: 'Token JWT estruturado',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
  },
  {
    id: 'bearer_token',
    label: 'Token de autorizacao Bearer',
    regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i
  },
  {
    id: 'db_connection_string',
    label: 'String de conexao com credenciais de banco de dados',
    regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|mssql):\/\/[^\s"'<>]+:[^\s"'<>]+@[^\s"'<>]+\b/i
  },
  {
    id: 'generic_secret_assignment',
    label: 'Atribuicao generica de chave, token ou senha',
    regex: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|pwd|client[_-]?secret)\s*[:=]\s*["']?[^\s"']{8,}["']?/i
  },
  {
    id: 'env_file_block',
    label: 'Definicao de segredo em formato de arquivo .env',
    regex: /^[A-Z][A-Z0-9_]{2,}=(?:sk-|AIza|ghp_|eyJ|postgres:\/\/|mysql:\/\/)[^\r\n]+/m
  },
  {
    id: 'sql_dump',
    label: 'Comando ou dump de definicao/insercao SQL',
    regex: /\b(?:INSERT\s+INTO|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b[\s\S]{0,200}?\b(?:VALUES|PRIMARY\s+KEY)\b/i
  },
  {
    id: 'cpf_br',
    label: 'CPF brasileiro',
    regex: /(?:\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\bCPF\s*[:=]?\s*\d{11}\b)/i
  },
  {
    id: 'email_pii',
    label: 'Endereco de e-mail PII',
    regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/
  },
  {
    id: 'phone_br',
    label: 'Telefone celular brasileiro com DDD',
    regex: /(?:\+55\s*)?(?:\(\d{2}\)\s*|\b\d{2}\s*)9\d{4}[-\s]?\d{4}\b/
  },
  {
    id: 'veroclass_student_data',
    label: 'Dado sensivel ou identificador educacional VeroClass',
    regex: /\b(?:veroclass|aluno_id|matricula_aluno|ra_aluno|nota_aluno|diario_classe|boletim_escolar)\b/i
  }
]);

const IGNORED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'testing.com',
  'localhost',
  'local',
  'invalid'
]);

/**
 * Valida os digitos verificadores de um CPF brasileiro conforme regra da Receita Federal.
 * @param {string} value
 * @returns {boolean}
 */
export function isValidCPF(value) {
  if (typeof value !== 'string') return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits.charAt(i), 10) * (10 - i);
  }
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(digits.charAt(9), 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(digits.charAt(i), 10) * (11 - i);
  }
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(digits.charAt(10), 10)) return false;

  return true;
}

/**
 * Verifica se um dominio de e-mail e reservado para documentacao/testes.
 * @param {string} email
 * @returns {boolean}
 */
function isIgnoredEmail(email) {
  if (!email || typeof email !== 'string') return true;
  const parts = email.toLowerCase().split('@');
  if (parts.length !== 2) return false;
  return IGNORED_EMAIL_DOMAINS.has(parts[1]);
}

/**
 * Verifica se um caminho de arquivo e permitido pela politica de seguranca.
 * @param {string} filePath
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkFilePathAllowed(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { allowed: false, reason: 'Caminho de arquivo invalido ou vazio' };
  }

  const normalized = filePath.trim().replace(/\\/g, '/');
  const baseName = normalized.split('/').pop();

  for (const item of DENY_FILE_PATTERNS) {
    if (item.pattern.test(baseName) || item.pattern.test(normalized)) {
      return {
        allowed: false,
        reason: `Arquivo proibido por politica de seguranca (${item.label})`
      };
    }
  }

  return { allowed: true };
}

/**
 * Inspeciona o payload a procura de violacoes de politica, segredos e dados sensiveis.
 * @param {string} prompt
 * @param {{ filePaths?: string[], maxChars?: number }} options
 * @returns {{ allowed: boolean, sanitizedPrompt: string, violations: Array<{ ruleId: string, label: string, matchPreview: string }>, payloadBytes: number }}
 */
export function inspectPayload(prompt, { filePaths = [], maxChars = MAX_PROMPT_CHARS } = {}) {
  const violations = [];
  const payloadBytes = Buffer.byteLength(String(prompt || ''), 'utf8');

  // 1. Validacao de tamanho e tipo do prompt
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    violations.push({
      ruleId: 'empty_prompt',
      label: 'Prompt nao pode ser vazio',
      matchPreview: '[REDACTED]'
    });
  } else if (prompt.length > maxChars) {
    violations.push({
      ruleId: 'payload_too_large',
      label: `Tamanho excede limite maximo de ${maxChars} caracteres (atual: ${prompt.length})`,
      matchPreview: '[REDACTED]'
    });
  }

  // 2. Validacao dos caminhos de arquivos anexados ou referenciados
  if (Array.isArray(filePaths)) {
    for (const fp of filePaths) {
      const check = checkFilePathAllowed(fp);
      if (!check.allowed) {
        violations.push({
          ruleId: 'denied_file_path',
          label: check.reason || 'Arquivo restrito',
          matchPreview: '[REDACTED]'
        });
      }
    }
  }

  let sanitizedPrompt = String(prompt || '');

  // 3. Verificacao de referencias a arquivos proibidos no corpo do texto (ex: "--- .env ---", "arquivo_privado.sql")
  const fileHeaderPattern = /(?:---|===|###|```|\bfile:\s*|\bfilename:\s*)[^\r\n]*?(?:\.env(?:\.[a-zA-Z0-9_-]+)*|\.pem|\.key|\.p12|\.pfx|\.sql|_privado|\.jsonl|id_rsa|id_ed25519)[^\r\n]*?(?:---|===|###|```|\r|\n|$)|(?:\b[a-zA-Z0-9_-]+_privado\.[a-zA-Z0-9]+|\b[a-zA-Z0-9_-]+\.sql\b|\.env(?:\.[a-zA-Z0-9_-]+)*\b)/i;
  if (fileHeaderPattern.test(sanitizedPrompt)) {
    violations.push({
      ruleId: 'denied_file_reference',
      label: 'Referencia a arquivo restrito no corpo do prompt',
      matchPreview: '[REDACTED]'
    });
  }

  // 4. Inspecao dos padroes de segredos e PII
  for (const pattern of SECRET_PATTERNS) {
    // Regex global para iteracao e substituicao segura
    const flags = pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`;
    const searcher = new RegExp(pattern.regex.source, flags);

    let match;
    let foundViolation = false;

    while ((match = searcher.exec(sanitizedPrompt)) !== null) {
      const matchedText = match[0];

      // Validacoes especificas por regra
      if (pattern.id === 'cpf_br') {
        const digits = matchedText.replace(/\D/g, '');
        // Se for pontuado ou prefixado, valida digitos
        if (digits.length === 11 && !isValidCPF(matchedText)) {
          // Nao e um CPF matematicamente valido, ignora falso-positivo
          continue;
        }
      } else if (pattern.id === 'email_pii') {
        if (isIgnoredEmail(matchedText)) {
          // Dominio de teste permitido
          continue;
        }
      }

      foundViolation = true;
      break;
    }

    if (foundViolation) {
      violations.push({
        ruleId: pattern.id,
        label: pattern.label,
        matchPreview: '[REDACTED]'
      });

      // Substitui no sanitizedPrompt mantendo o texto seguro
      const replacer = new RegExp(pattern.regex.source, flags);
      sanitizedPrompt = sanitizedPrompt.replace(replacer, (original) => {
        if (pattern.id === 'cpf_br') {
          const digits = original.replace(/\D/g, '');
          if (digits.length === 11 && !isValidCPF(original)) {
            return original;
          }
        } else if (pattern.id === 'email_pii') {
          if (isIgnoredEmail(original)) {
            return original;
          }
        }
        return `[REDACTED:${pattern.id}]`;
      });
    }
  }

  return {
    allowed: violations.length === 0,
    sanitizedPrompt,
    violations,
    payloadBytes
  };
}

/**
 * Valida o payload e lanca BridgeError(BLOCKED_BY_POLICY) caso viole politicas.
 * @param {string} prompt
 * @param {{ filePaths?: string[], maxChars?: number }} options
 * @returns {{ allowed: boolean, sanitizedPrompt: string, violations: Array<object>, payloadBytes: number }}
 */
export function assertPayloadAllowed(prompt, options = {}) {
  const result = inspectPayload(prompt, options);
  if (!result.allowed) {
    throw new BridgeError(
      ERROR_CODES.BLOCKED_BY_POLICY,
      'Payload bloqueado pela politica de seguranca e retencao zero',
      { violations: result.violations }
    );
  }
  return result;
}
