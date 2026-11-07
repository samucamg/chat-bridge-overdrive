import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeServer, ALL_MCP_TOOLS } from '../src/server.mjs';
import { normalizeProvider, PROVIDER_NAMES } from '../src/doctor.mjs';
import { ProviderQueueManager } from '../src/queue.mjs';
import { MetadataLogger } from '../src/logger.mjs';

// Tools em linguagem natural: ask_<provedor>, compare_web_chats e apelidos de provedor.

function makeEnv(providers, { failing = {} } = {}) {
  const sent = {};
  const pages = {};
  const drivers = {};
  for (const p of providers) {
    pages[p] = { url: () => `https://${p}.example/` };
    drivers[p] = {
      provider: p,
      defaultModel: `${p}-model`,
      ensureTab: async () => pages[p],
      isLoggedIn: async () => !failing[p],
      newChat: async () => {},
      send: async (_page, prompt) => {
        sent[p] = prompt;
      },
      waitDone: async () => true,
      extractAnswer: async () => ({
        text: `resposta de ${p}`,
        sources: [{ title: 'Fonte', url: `https://${p}.example/fonte`, index: 1 }],
        model: `${p}-model`
      }),
      stop: async () => true
    };
  }
  const cdpManager = {
    connect: async () => {},
    getContext: () => ({ pages: () => Object.values(pages) }),
    getTargetId: async (page) => `target-${page.url()}`,
    insertTextViaCDP: async () => {},
    getStatus: async () => ({ cdpConnected: true })
  };
  const server = createBridgeServer({
    cdpManager,
    drivers,
    logger: new MetadataLogger(),
    queueManager: new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 })
  });
  return { server, sent, drivers };
}

test('Tools - uma tool ask_<provedor> por provedor, mais compare_web_chats, todas documentadas', () => {
  const names = ALL_MCP_TOOLS.map((t) => t.name);
  for (const p of PROVIDER_NAMES) {
    assert.ok(names.includes(`ask_${p}`), `deve existir ask_${p}`);
  }
  assert.ok(names.includes('compare_web_chats'));
  assert.ok(names.includes('ask_web_chat'), 'a tool generica continua existindo');

  for (const tool of ALL_MCP_TOOLS) {
    assert.ok(tool.description && tool.description.length > 40, `${tool.name} precisa de descricao`);
    assert.equal(tool.inputSchema.type, 'object');
    const required = tool.inputSchema.required || [];
    if (tool.name.startsWith('ask_') || tool.name === 'compare_web_chats') {
      assert.ok(required.includes('prompt'), `${tool.name} exige prompt`);
    }
  }
  // Regra inegociavel continua valendo para as tools novas
  assert.equal(names.some((n) => /eval|exec|script/i.test(n)), false);
});

test('Tools - descricao de cada ask_<provedor> traz as frases que o usuario diria, em EN e PT', () => {
  const gemini = ALL_MCP_TOOLS.find((t) => t.name === 'ask_gemini');
  assert.match(gemini.description, /ask Gemini/i);
  assert.match(gemini.description, /pergunte ao Gemini/i);
  const chatgpt = ALL_MCP_TOOLS.find((t) => t.name === 'ask_chatgpt');
  assert.match(chatgpt.description, /use ChatGPT web/i);
  assert.match(chatgpt.description, /not a generic web search/i);
  const compare = ALL_MCP_TOOLS.find((t) => t.name === 'compare_web_chats');
  assert.match(compare.description, /second opinion/i);
  assert.match(compare.description, /pergunte a todos/i);
});

test('Tools - schema de ask_<provedor> nao pede o provedor (ja fixo no nome)', () => {
  const t = ALL_MCP_TOOLS.find((x) => x.name === 'ask_claude');
  assert.equal(t.inputSchema.properties.provider, undefined);
  assert.ok(t.inputSchema.properties.prompt);
  assert.ok(t.inputSchema.properties.session);
});

test('normalizeProvider - apelidos comuns viram o nome canonico', () => {
  const cases = {
    'ChatGPT Web': 'chatgpt',
    'chat-gpt': 'chatgpt',
    GPT: 'chatgpt',
    OpenAI: 'chatgpt',
    'Google Gemini': 'gemini',
    'gemini.google.com': 'gemini',
    'perplexity.ai': 'perplexity',
    Perplexity: 'perplexity',
    'Claude AI': 'claude',
    'claude.ai': 'claude',
    'deep seek': 'deepseek',
    'chat.deepseek.com': 'deepseek'
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(normalizeProvider(input), expected, input);
  }
  assert.equal(normalizeProvider('desconhecido'), 'desconhecido');
  assert.equal(normalizeProvider(null), '');
});

test('ask_<provedor> encaminha para o provedor certo sem precisar informar provider', async () => {
  const { server, sent } = makeEnv(['gemini', 'chatgpt']);
  const res = await server.invoke('ask_gemini', { prompt: 'Qual a capital da Franca?', session: 's-gemini' });
  assert.equal(res.provider, 'gemini');
  assert.equal(res.text, 'resposta de gemini');
  assert.equal(sent.gemini, 'Qual a capital da Franca?');
  assert.equal(sent.chatgpt, undefined, 'o outro provedor nao pode receber nada');

  // O provider informado por engano nao pode desviar o ask_<provedor>
  const res2 = await server.invoke('ask_chatgpt', { prompt: 'ola', provider: 'gemini', session: 's-gpt' });
  assert.equal(res2.provider, 'chatgpt');
});

test('ask_web_chat aceita apelido de provedor e usa o nome canonico em fila, sessao e resultado', async () => {
  const { server } = makeEnv(['chatgpt']);
  const res = await server.invoke('ask_web_chat', { provider: 'ChatGPT Web', prompt: 'ola' });
  assert.equal(res.provider, 'chatgpt');
  assert.equal(res.session, 'chatgpt-default');
});

test('compare_web_chats pergunta a varios provedores em paralelo e devolve tudo lado a lado', async () => {
  const { server, sent } = makeEnv(['perplexity', 'gemini', 'chatgpt']);
  const res = await server.invoke('compare_web_chats', {
    prompt: 'Compare REST e GraphQL em duas frases.',
    providers: ['Perplexity', 'Gemini', 'ChatGPT Web']
  });
  assert.deepEqual(res.asked, ['perplexity', 'gemini', 'chatgpt']);
  assert.equal(res.results.length, 3);
  for (const r of res.results) {
    assert.equal(r.ok, true);
    assert.equal(r.text, `resposta de ${r.provider}`);
    assert.equal(r.sources.length, 1);
  }
  for (const p of ['perplexity', 'gemini', 'chatgpt']) {
    assert.equal(sent[p], 'Compare REST e GraphQL em duas frases.');
  }
});

test('compare_web_chats - um provedor deslogado devolve o proprio erro sem derrubar os demais', async () => {
  const { server } = makeEnv(['gemini', 'claude'], { failing: { claude: true } });
  const res = await server.invoke('compare_web_chats', { prompt: 'ola', providers: ['gemini', 'claude'] });
  const byProvider = Object.fromEntries(res.results.map((r) => [r.provider, r]));
  assert.equal(byProvider.gemini.ok, true);
  assert.equal(byProvider.claude.ok, false);
  assert.equal(byProvider.claude.error_code, 'AUTH_REQUIRED');
});

test('compare_web_chats - prompt com segredo e bloqueado antes de tocar em qualquer provedor', async () => {
  const { server, sent } = makeEnv(['gemini', 'chatgpt']);
  const secret = 'ghp_' + '1234567890abcdefghijklmnopqrstuv';
  await assert.rejects(
    () => server.invoke('compare_web_chats', { prompt: `meu token ${secret}`, providers: ['gemini', 'chatgpt'] }),
    (err) => err.code === 'BLOCKED_BY_POLICY'
  );
  assert.deepEqual(sent, {}, 'nenhum provedor pode ter recebido o prompt');
});

test('compare_web_chats - provedor desconhecido e prompt vazio sao rejeitados', async () => {
  const { server } = makeEnv(['gemini']);
  await assert.rejects(
    () => server.invoke('compare_web_chats', { prompt: 'ola', providers: ['gemini', 'inexistente'] }),
    (err) => err.code === 'BLOCKED_BY_POLICY' && /inexistente/.test(err.message)
  );
  await assert.rejects(
    () => server.invoke('compare_web_chats', { prompt: '   ' }),
    (err) => err.code === 'BLOCKED_BY_POLICY'
  );
});

test('tools/list via callTool - servidor lista as tools novas e callTool executa ask_<provedor>', async () => {
  const { server } = makeEnv(['deepseek']);
  const listed = server.listTools().tools.map((t) => t.name);
  assert.ok(listed.includes('ask_deepseek'));
  assert.ok(listed.includes('compare_web_chats'));
  const out = await server.callTool('ask_deepseek', { prompt: 'ola' });
  assert.equal(out.isError, undefined);
  assert.equal(out.data.provider, 'deepseek');
});

test('chat_bridge_status - a descricao diz que serve para saber se os chats estao logados', () => {
  const t = ALL_MCP_TOOLS.find((x) => x.name === 'chat_bridge_status');
  assert.match(t.description, /signed in/i);
  assert.match(t.description, /estao logados/i);
  assert.match(t.inputSchema.properties.doctor.description, /logados/i);
});
