import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeServer } from '../src/server.mjs';
import { DRIVERS } from '../src/doctor.mjs';
import { CdpManager } from '../src/cdp.mjs';
import { ChatGPTDriver } from '../src/drivers/chatgpt.mjs';
import { ProviderQueueManager } from '../src/queue.mjs';
import { MetadataLogger } from '../src/logger.mjs';
import { SessionManager } from '../src/sessions.mjs';

// Regressoes da auditoria de codigo (CLAUDE-#13): baseline do turno, modelo e anexo honestos,
// preparacao do envio delta dentro da fila e isolamento de conversa entre sessoes.

// ---------- B. baseline do turno em waitDone ----------

function timedPage(script) {
  // script(elapsedMs) -> { isStopVisible, currentText, count }
  const t0 = Date.now();
  const seen = { lastText: '' };
  return {
    seen,
    evaluate: async (fn, arg) => {
      if (arg && typeof arg === 'object' && 'stopSel' in arg) {
        const st = script(Date.now() - t0);
        seen.lastText = st.currentText;
        return { isStopVisible: Boolean(st.isStopVisible), currentText: st.currentText, count: st.count, lastMutation: Date.now() };
      }
      return false;
    }
  };
}

async function withFastDebounce(driver, fn) {
  const saved = driver.debounceMs;
  driver.debounceMs = 20;
  try {
    return await fn();
  } finally {
    driver.debounceMs = saved;
  }
}

test('captureBaseline - le quantidade e texto da ultima resposta', async () => {
  const d = DRIVERS.perplexity;
  const page = { evaluate: async () => ({ count: 2, lastText: 'ALFA' }) };
  assert.deepEqual(await d.captureBaseline(page), { count: 2, lastText: 'ALFA' });
  assert.deepEqual(await d.captureBaseline({}), { count: 0, lastText: '' });
  assert.deepEqual(await d.captureBaseline({ evaluate: async () => { throw new Error('x'); } }), { count: 0, lastText: '' });
});

test('waitDone com baseline - nao devolve a resposta antiga de uma conversa continuada', async () => {
  const d = DRIVERS.perplexity;
  await withFastDebounce(d, async () => {
    // O texto antigo (ALFA) fica estavel e sem botao parar. Sem baseline isto concluiria na hora.
    const page = timedPage(() => ({ currentText: 'ALFA', count: 1 }));
    await assert.rejects(
      () => d.waitDone(page, 600, null, null, { count: 1, lastText: 'ALFA' }),
      (err) => err.code === 'PROMPT_TIMEOUT'
    );
  });
});

test('waitDone com baseline - espera o novo bloco de resposta e conclui com o texto novo', async () => {
  const d = DRIVERS.perplexity;
  await withFastDebounce(d, async () => {
    const page = timedPage((ms) => (ms < 300 ? { currentText: 'ALFA', count: 1 } : { currentText: 'BETA', count: 2 }));
    const t0 = Date.now();
    assert.equal(await d.waitDone(page, 5000, null, null, { count: 1, lastText: 'ALFA' }), true);
    assert.ok(Date.now() - t0 >= 280, 'nao pode concluir antes de a nova resposta aparecer');
    assert.equal(page.seen.lastText, 'BETA');
  });
});

test('waitDone com baseline - resposta nova igual a antiga e reconhecida pelo botao parar', async () => {
  const d = DRIVERS.perplexity;
  await withFastDebounce(d, async () => {
    const page = timedPage((ms) => {
      if (ms < 150) return { currentText: 'OK.', count: 1 };
      if (ms < 350) return { currentText: 'OK.', count: 1, isStopVisible: true };
      return { currentText: 'OK.', count: 1 };
    });
    const t0 = Date.now();
    assert.equal(await d.waitDone(page, 5000, null, null, { count: 1, lastText: 'OK.' }), true);
    assert.ok(Date.now() - t0 >= 330, 'so conclui depois de a geracao (botao parar) ter acontecido');
  });
});

test('waitDone sem baseline mantem o comportamento anterior (texto presente conta como iniciado)', async () => {
  const d = DRIVERS.perplexity;
  await withFastDebounce(d, async () => {
    const page = timedPage(() => ({ currentText: 'qualquer', count: 1 }));
    assert.equal(await d.waitDone(page, 2000), true);
  });
});

// ---------- ambiente simulado para o servidor ----------

function makeEnv({ drivers: driverOverrides = {}, pageUrlState = null } = {}) {
  const state = { url: 'https://chatgpt.example/', gotos: [], sent: [], waitArgs: [] };
  const page = {
    url: () => state.url,
    goto: async (u) => {
      state.gotos.push(u);
      state.url = u;
    }
  };
  const driver = {
    provider: 'chatgpt',
    defaultModel: 'chatgpt-web',
    matchesUrl: (u) => String(u).startsWith('https://chatgpt.example/'),
    waitForComposer: async () => true,
    ensureTab: async () => page,
    isLoggedIn: async () => true,
    newChat: async () => {
      state.url = 'https://chatgpt.example/';
    },
    captureBaseline: async () => ({ count: 7, lastText: 'anterior' }),
    send: async (_p, prompt) => {
      state.sent.push(prompt);
      const m = /\[(\w+)\]/.exec(prompt);
      if (m) state.url = `https://chatgpt.example/c/${m[1]}`;
    },
    waitDone: async (...args) => {
      state.waitArgs.push(args);
      return true;
    },
    extractAnswer: async () => ({ text: 'resposta', sources: [], model: 'gpt-observado' }),
    stop: async () => true,
    ...driverOverrides
  };
  const server = createBridgeServer({
    cdpManager: {
      connect: async () => {},
      getContext: () => ({ pages: () => [page] }),
      getTargetId: async () => 'target-1',
      insertTextViaCDP: async () => {},
      getStatus: async () => ({ cdpConnected: true })
    },
    drivers: { chatgpt: driver },
    logger: new MetadataLogger(),
    queueManager: new ProviderQueueManager({ minDelayMs: 0, maxDelayMs: 0 }),
    sessionManager: new SessionManager()
  });
  return { server, state, page, driver };
}

test('servidor - passa o baseline capturado antes do envio ao waitDone', async () => {
  const { server, state } = makeEnv();
  await server.invoke('ask_web_chat', { provider: 'chatgpt', prompt: 'ola [A]', session: 's1', new_chat: true });
  assert.equal(state.waitArgs.length, 1);
  assert.deepEqual(state.waitArgs[0][4], { count: 7, lastText: 'anterior' });
});

// ---------- C. modelo, modo e anexos honestos ----------

test('servidor - modelo ou modo nao aplicados viram avisos, nunca sucesso falso', async () => {
  const { server } = makeEnv({
    drivers: {
      setMode: async (_p, mode) => ({ supported: false, applied: false, requested: mode }),
      setModel: async (_p, model) => ({ supported: false, applied: false, requested: model, model: 'chatgpt-web' })
    }
  });
  const res = await server.invoke('ask_web_chat', {
    provider: 'chatgpt', prompt: 'ola [A]', session: 's1', new_chat: true, mode: 'deep', model: 'gpt-9'
  });
  assert.equal(res.model, 'gpt-observado', 'o modelo informado e o observado, nao o solicitado');
  assert.equal(res.model_requested, 'gpt-9');
  assert.deepEqual(res.warnings.map((w) => w.code).sort(), ['MODEL_NOT_APPLIED', 'MODE_NOT_APPLIED']);
});

test('servidor - sem aviso quando o driver realmente aplica modo e modelo', async () => {
  const { server } = makeEnv({
    drivers: {
      setMode: async () => ({ supported: true, applied: true }),
      setModel: async () => ({ supported: true, applied: true, model: 'gpt-9' })
    }
  });
  const res = await server.invoke('ask_web_chat', {
    provider: 'chatgpt', prompt: 'ola [A]', session: 's1', new_chat: true, mode: 'deep', model: 'gpt-9'
  });
  assert.equal(res.warnings, undefined);
});

test('servidor - anexo que nao subiu aborta com ATTACHMENT_FAILED e nenhum prompt e enviado', async () => {
  const { server, state } = makeEnv({ drivers: { attachFiles: async () => false } });
  await assert.rejects(
    () => server.invoke('ask_web_chat', {
      provider: 'chatgpt', prompt: 'veja o anexo [A]', session: 's1', new_chat: true,
      attachments: [{ path: 'nota.txt', content: 'conteudo simples' }]
    }),
    (err) => err.code === 'ATTACHMENT_FAILED'
  );
  assert.deepEqual(state.sent, [], 'nenhum prompt pode sair sem o anexo');
});

test('servidor - anexo que subiu de verdade segue para o envio', async () => {
  let attached = null;
  const { server, state } = makeEnv({
    drivers: { attachFiles: async (_p, files) => { attached = files; return true; } }
  });
  await server.invoke('ask_web_chat', {
    provider: 'chatgpt', prompt: 'veja o anexo [A]', session: 's1', new_chat: true,
    attachments: [{ path: 'nota.txt', content: 'conteudo simples' }]
  });
  assert.equal(attached.length, 1);
  assert.equal(state.sent.length, 1);
});

test('CdpManager.setFileInputFiles - sem upload real devolve false e nunca simula o anexo no DOM', async () => {
  const cdp = new CdpManager();
  let evaluateCalls = 0;
  const page = {
    evaluate: async () => {
      evaluateCalls += 1;
      return true;
    }
  };
  assert.equal(await cdp.setFileInputFiles(page, 'input[type="file"]', ['d:/ficticio/a.txt']), false);
  assert.equal(evaluateCalls, 0, 'nao pode gravar _attachedFiles no input para fingir sucesso');
});

test('ChatGPTDriver.attachFiles - cdpManager que falha e pagina sem upload real resulta em false', async () => {
  const driver = new ChatGPTDriver();
  const page = { evaluate: async () => false };
  const cdpManager = { setFileInputFiles: async () => false };
  assert.equal(await driver.attachFiles(page, ['d:/ficticio/a.txt'], cdpManager), false);
});

// ---------- D. preparacao do delta dentro da fila ----------

test('concorrencia - falha da 1a chamada nao faz a 2a enviar so o marcador UNCHANGED', async () => {
  let sends = 0;
  const { server, state } = makeEnv({
    drivers: {
      send: async (_p, prompt) => {
        sends += 1;
        state.sent.push(prompt);
        if (sends === 1) throw new Error('falha no envio da 1a chamada');
      }
    }
  });
  const ctxFile = { path: 'ctx.txt', content: 'CONTEUDO-DO-ARQUIVO-DE-CONTEXTO' };
  const call = (tag) => server.invoke('ask_web_chat', {
    provider: 'chatgpt', prompt: `pergunta [${tag}]`, session: 'mesma-sessao', new_chat: false, context_files: [ctxFile]
  });
  const [r1, r2] = await Promise.allSettled([call('A'), call('B')]);
  assert.equal(r1.status, 'rejected');
  assert.equal(r2.status, 'fulfilled');
  assert.equal(state.sent.length, 2);
  assert.ok(state.sent[1].includes('CONTEUDO-DO-ARQUIVO-DE-CONTEXTO'), 'a 2a chamada precisa levar o conteudo completo');
  assert.equal(state.sent[1].includes('UNCHANGED_SHA256'), false);
});

// ---------- A. isolamento de conversa entre sessoes ----------

test('sessoes - a conversa de cada sessao e restaurada quando outra sessao usou a aba no meio', async () => {
  const { server, state } = makeEnv();
  const ask = (session, tag, newChat) => server.invoke('ask_web_chat', {
    provider: 'chatgpt', prompt: `turno [${tag}]`, session, new_chat: newChat
  });

  await ask('sessao-a', 'A', true);
  assert.equal(state.url, 'https://chatgpt.example/c/A');
  await ask('sessao-b', 'B', true);
  assert.equal(state.url, 'https://chatgpt.example/c/B');
  assert.deepEqual(state.gotos, []);

  // A continua: a aba esta na conversa de B; deve voltar para a conversa de A antes de enviar
  const resA = await ask('sessao-a', 'A', false);
  assert.deepEqual(state.gotos, ['https://chatgpt.example/c/A']);
  assert.equal(resA.conversation_restored, true);

  // A continua de novo: a aba ja esta na conversa certa, nada a restaurar
  const resA2 = await ask('sessao-a', 'A', false);
  assert.equal(state.gotos.length, 1);
  assert.equal(resA2.conversation_restored, undefined);
});

test('sessoes - nova conversa descarta a URL antiga da sessao', async () => {
  const { server, state } = makeEnv();
  const ask = (tag, newChat) => server.invoke('ask_web_chat', {
    provider: 'chatgpt', prompt: `turno [${tag}]`, session: 'sessao-a', new_chat: newChat
  });
  await ask('A', true);
  await ask('Z', true); // recomeca a sessao: a URL antiga (c/A) nao pode ser restaurada depois
  state.url = 'https://chatgpt.example/c/OUTRA';
  const res = await ask('Z', false);
  assert.equal(state.gotos.at(-1), 'https://chatgpt.example/c/Z');
  assert.equal(res.conversation_restored, true);
});

test('sessoes - URL guardada de outro provedor nunca e aberta', async () => {
  const { server, state } = makeEnv();
  await server.invoke('ask_web_chat', { provider: 'chatgpt', prompt: 'turno [A]', session: 's', new_chat: true });
  const sess = server.sessionManager._getSession('s');
  sess.conversationUrl = 'https://site-estranho.example/c/X';
  state.url = 'https://chatgpt.example/c/B';
  await server.invoke('ask_web_chat', { provider: 'chatgpt', prompt: 'turno [A]', session: 's', new_chat: false });
  assert.deepEqual(state.gotos, [], 'URL de outro dominio nao pode ser navegada');
});

test('list_chat_sessions - nao expoe a URL da conversa, so se ha conversa', async () => {
  const { server } = makeEnv();
  await server.invoke('ask_web_chat', { provider: 'chatgpt', prompt: 'turno [A]', session: 's', new_chat: true });
  const listed = await server.invoke('list_chat_sessions', {});
  const dump = JSON.stringify(listed);
  assert.equal(dump.includes('/c/A'), false, 'a URL da conversa nao pode aparecer na listagem');
  assert.ok(listed.managedSessions.some((s) => s.hasConversation === true));
});

// ---------- seletores de baixa confianca nunca sao clicados; aba em uso nunca e tomada ----------

test('getSelectorString - maxLevel limita aos niveis de maior confianca', () => {
  const d = DRIVERS.gemini;
  const all = d.getSelectorString(d.selectors.sendBtn);
  const safe = d.getSelectorString(d.selectors.sendBtn, { maxLevel: 2 });
  assert.ok(all.includes('mat-icon-button'), 'a uniao completa inclui o nivel 3 (Baixa)');
  assert.equal(safe.includes('mat-icon-button'), false, 'o nivel 3 nao pode entrar na versao segura');
  assert.ok(safe.includes('send-button'));
});

test('send - nenhum driver clica por seletor de nivel 3 (Baixa) do botao de envio', async () => {
  for (const name of ['gemini', 'perplexity', 'chatgpt', 'claude', 'deepseek', 'copilot', 'meta', 'groq', 'grok']) {
    const d = DRIVERS[name];
    const level3 = d.selectors.sendBtn.level3?.selector;
    if (!level3) continue;
    const seen = [];
    const page = {
      evaluate: async (_fn, arg) => {
        seen.push(typeof arg === 'string' ? arg : JSON.stringify(arg ?? ''));
        return typeof arg === 'string';
      },
      keyboard: { press: async () => {} },
      url: () => 'https://x.example/'
    };
    try {
      await d.send(page, 'ola', { insertTextViaCDP: async () => {} });
    } catch (e) {
      // alguns drivers fazem checagens extras; so importa o que foi enviado a pagina
    }
    assert.equal(
      seen.some((arg) => arg.includes(level3)),
      false,
      `${name}: o seletor de nivel 3 (${level3}) nao pode ser usado para clicar no envio`
    );
  }
});

test('isGenerating - detecta botao parar visivel e nunca lanca', async () => {
  const d = DRIVERS.gemini;
  assert.equal(await d.isGenerating({ evaluate: async () => true }), true);
  assert.equal(await d.isGenerating({ evaluate: async () => false }), false);
  assert.equal(await d.isGenerating({ evaluate: async () => { throw new Error('x'); } }), false);
  assert.equal(await d.isGenerating(null), false);
});

test('servidor - aba que esta gerando resposta e recusada com TAB_BUSY, sem navegar nem enviar', async () => {
  const { server, state } = makeEnv({ drivers: { isGenerating: async () => true } });
  await assert.rejects(
    () => server.invoke('ask_web_chat', { provider: 'chatgpt', prompt: 'ola [A]', session: 's1', new_chat: true }),
    (err) => err.code === 'TAB_BUSY' && /gerando/.test(err.message)
  );
  assert.deepEqual(state.sent, [], 'nada pode ser enviado a uma aba em uso');
  assert.deepEqual(state.gotos, [], 'a aba em uso nao pode ser navegada');
  assert.equal(server.queueManager.getLeases().length, 0, 'o lease deve ser liberado');
});

test('servidor - aba ociosa segue o fluxo normal', async () => {
  const { server, state } = makeEnv({ drivers: { isGenerating: async () => false } });
  await server.invoke('ask_web_chat', { provider: 'chatgpt', prompt: 'ola [A]', session: 's1', new_chat: true });
  assert.equal(state.sent.length, 1);
});
