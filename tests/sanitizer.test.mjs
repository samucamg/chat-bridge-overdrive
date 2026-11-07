import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PROMPT_CHARS,
  DENY_FILE_PATTERNS,
  SECRET_PATTERNS,
  isValidCPF,
  checkFilePathAllowed,
  inspectPayload,
  assertPayloadAllowed
} from '../src/sanitizer.mjs';
import { ERROR_CODES, BridgeError, isBridgeError } from '../src/errors.mjs';
import { MetadataLogger, sanitizeLogMetadata } from '../src/logger.mjs';

test('Sanitizer - permite prompt tecnico seguro e limpo', () => {
  const safePrompt = 'Como implementar um loop de eventos assincrono em Node.js com Worker Threads?';
  const result = inspectPayload(safePrompt);

  assert.equal(result.allowed, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.sanitizedPrompt, safePrompt);
  assert.ok(result.payloadBytes > 0);

  const asserted = assertPayloadAllowed(safePrompt);
  assert.equal(asserted.allowed, true);
});

test('Sanitizer - bloqueia chaves de API e credenciais conhecidas', () => {
  const testCases = [
    {
      name: 'Google API key',
      prompt: 'Minha chave e AIza' + 'SyD_1234567890abcdefghijklmnopqrstu para o Gemini',
      ruleId: 'google_api_key'
    },
    {
      name: 'OpenAI API key',
      prompt: 'Use esta chave sk-proj-1234567890abcdefghijklmnopqrstuv na OpenAI',
      ruleId: 'openai_key'
    },
    {
      name: 'GitHub token',
      prompt: 'Clone usando o token ghp_' + '1234567890abcdefghijklmnopqrstuv do GitHub',
      ruleId: 'github_token'
    },
    {
      name: 'JWT token',
      prompt: 'Token de sessao eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c expirado',
      ruleId: 'jwt_token'
    },
    {
      name: 'RSA Private Key',
      prompt: 'Chave do servidor:\n-----BEGIN RSA ' + 'PRIVATE KEY-----\nMIIEowIBAAKCAQEA0mockkey...\n-----END RSA PRIVATE KEY-----',
      ruleId: 'private_key'
    },
    {
      name: 'Database connection string',
      prompt: 'Acesse o banco em postgres://user:pass@host:5432/db para rodar migracao',
      ruleId: 'db_connection_string'
    }
  ];

  for (const tc of testCases) {
    const result = inspectPayload(tc.prompt);
    assert.equal(result.allowed, false, `Deveria ter bloqueado ${tc.name}`);
    const violation = result.violations.find((v) => v.ruleId === tc.ruleId);
    assert.ok(violation, `Violacao ${tc.ruleId} esperada para ${tc.name}`);
    assert.equal(violation.matchPreview, '[REDACTED]', 'Nunca deve vazar segredo no matchPreview');
  }
});

test('Sanitizer - bloqueia PII e identificadores sensiveis', () => {
  const testCases = [
    {
      name: 'CPF formatado',
      prompt: 'O cliente com CPF 123.456.789-09 solicitou cancelamento',
      ruleId: 'cpf_br'
    },
    {
      name: 'E-mail real',
      prompt: 'Envie o relatorio para aluno@escola.com.br urgente',
      ruleId: 'email_pii'
    },
    {
      name: 'Telefone BR com DDD',
      prompt: 'Contato de confirmacao: (11) 98765-4321',
      ruleId: 'phone_br'
    },
    {
      name: 'Termo VeroClass',
      prompt: 'Atualize os dados na tabela veroclass de turmas',
      ruleId: 'veroclass_student_data'
    },
    {
      name: 'Matricula de aluno',
      prompt: 'Localize a matricula_aluno no sistema academico',
      ruleId: 'veroclass_student_data'
    },
    {
      name: 'Diario de classe',
      prompt: 'Gere o arquivo do diario_classe do terceiro bimestre',
      ruleId: 'veroclass_student_data'
    }
  ];

  for (const tc of testCases) {
    const result = inspectPayload(tc.prompt);
    assert.equal(result.allowed, false, `Deveria ter bloqueado ${tc.name}`);
    const violation = result.violations.find((v) => v.ruleId === tc.ruleId);
    assert.ok(violation, `Violacao ${tc.ruleId} esperada para ${tc.name}`);
    assert.equal(violation.matchPreview, '[REDACTED]');
  }
});

test('Sanitizer - bloqueia caminhos de arquivos proibidos via checkFilePathAllowed e inspectPayload', () => {
  const deniedPaths = [
    '.env',
    '.env.local',
    'C:/Projetos/app/.env.production',
    'cert.pem',
    'certs/privkey.key',
    'database/dump.sql',
    'dados/clientes_privado.txt',
    'logs/historico.jsonl'
  ];

  for (const filePath of deniedPaths) {
    const check = checkFilePathAllowed(filePath);
    assert.equal(check.allowed, false, `Caminho deveria ser bloqueado: ${filePath}`);
    assert.ok(check.reason, 'Deve fornecer razao de bloqueio');

    const result = inspectPayload('Analise este arquivo', { filePaths: [filePath] });
    assert.equal(result.allowed, false, `Payload com caminho ${filePath} deveria ser bloqueado`);
    const violation = result.violations.find((v) => v.ruleId === 'denied_file_path');
    assert.ok(violation, 'Deveria conter violacao denied_file_path');
  }

  // Caminho seguro deve ser permitido
  const safeCheck = checkFilePathAllowed('src/components/Button.jsx');
  assert.equal(safeCheck.allowed, true);
});

test('Sanitizer - garante que violations nunca vaza o segredo em texto claro', () => {
  const secretKey = 'sk-proj-supersecrettoken1234567890abcdefghijk';
  const prompt = `Use minha chave ${secretKey} agora`;
  const result = inspectPayload(prompt);

  assert.equal(result.allowed, false);
  for (const violation of result.violations) {
    assert.equal(violation.matchPreview, '[REDACTED]');
    assert.equal(JSON.stringify(violation).includes(secretKey), false, 'Nenhum campo de violation pode conter o segredo');
  }

  assert.equal(result.sanitizedPrompt.includes(secretKey), false, 'sanitizedPrompt nao deve conter o segredo');
  assert.ok(result.sanitizedPrompt.includes('[REDACTED:openai_key]'));
});

test('Sanitizer - assertPayloadAllowed lanca BridgeError com BLOCKED_BY_POLICY', () => {
  const badPrompt = 'Token de acesso: ghp_' + '1234567890abcdefghijklmnopqrstuv';

  assert.throws(
    () => {
      assertPayloadAllowed(badPrompt);
    },
    (err) => {
      assert.ok(isBridgeError(err));
      assert.equal(err.code, ERROR_CODES.BLOCKED_BY_POLICY);
      assert.ok(Array.isArray(err.details?.violations));
      assert.ok(err.details.violations.length > 0);
      return true;
    }
  );
});

test('Logger - sanitizeLogMetadata e MetadataLogger descartam prompt e text retendo apenas metadados', () => {
  const unsafeEntry = {
    timestamp: '2026-11-07T00:00:00.000Z',
    event: 'ask_web_chat',
    provider: 'perplexity',
    model: 'sonar-medium',
    session: 'sess-123',
    targetId: 'target-abc',
    duration_ms: 420,
    payload_bytes: 58,
    response_bytes: 256,
    sources_count: 2,
    status: 'ok',
    // Campos sensiveis que devem ser descartados
    prompt: 'Pergunta secreta com dados confidenciais',
    text: 'Resposta confidencial gerada pelo chat',
    answer: 'Outro campo com texto',
    response: 'Texto completo de resposta',
    content: 'Mais conteudo confidencial'
  };

  const sanitized = sanitizeLogMetadata(unsafeEntry);

  assert.equal(sanitized.provider, 'perplexity');
  assert.equal(sanitized.duration_ms, 420);
  assert.equal(sanitized.payload_bytes, 58);
  assert.equal(sanitized.response_bytes, 256);
  assert.equal(sanitized.status, 'ok');

  // Verifica que nenhuma chave textual proibida sobreviveu
  assert.equal(sanitized.prompt, undefined);
  assert.equal(sanitized.text, undefined);
  assert.equal(sanitized.answer, undefined);
  assert.equal(sanitized.response, undefined);
  assert.equal(sanitized.content, undefined);

  // Testa classe MetadataLogger
  const logger = new MetadataLogger();
  logger.log(unsafeEntry);

  const recent = logger.getRecent(10);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].provider, 'perplexity');
  assert.equal(recent[0].duration_ms, 420);
  assert.equal(recent[0].prompt, undefined);
  assert.equal(recent[0].text, undefined);
});
