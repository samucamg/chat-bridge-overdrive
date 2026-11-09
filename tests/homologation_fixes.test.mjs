import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVERS } from '../src/doctor.mjs';

// Regressoes encontradas na homologacao ao vivo.

test('Perplexity - seletor de resposta nao casa com a bolha da pergunta do usuario', () => {
  const sel = DRIVERS.perplexity.getSelectorString(DRIVERS.perplexity.selectors.response);
  const parts = sel.split(',').map((s) => s.trim());
  assert.ok(
    !parts.includes('div[data-renderer="lm"]'),
    'seletor generico div[data-renderer="lm"] casa com a pergunta e causa conclusao antecipada'
  );
});

test('Claude - seletores de citacao excluem o link de aviso legal do rodape', () => {
  for (const level of ['level1', 'level2', 'level3']) {
    const sel = DRIVERS.claude.selectors.citations[level].selector;
    assert.ok(sel.includes('support.anthropic.com'), `${level} deve excluir support.anthropic.com`);
    assert.ok(sel.includes('support.claude.com'), `${level} deve excluir support.claude.com`);
  }
});

test('ChatGPT - seletor de resposta inclui o atributo atual do assistente', () => {
  const sel = DRIVERS.chatgpt.getSelectorString(DRIVERS.chatgpt.selectors.response);
  assert.ok(sel.includes('[data-markdown-text-style="assistant-message"]'));
});

test('waitForComposer - espera o editor, nunca lanca e tolera pagina sem waitForSelector', async () => {
  const calls = [];
  const page = {
    waitForSelector: async (sel, opts) => {
      calls.push({ sel, opts });
    }
  };
  for (const name of ['perplexity', 'gemini', 'chatgpt', 'claude', 'deepseek', 'copilot', 'meta', 'groq', 'grok']) {
    assert.equal(await DRIVERS[name].waitForComposer(page, 50), true, name);
  }
  assert.equal(calls.length, 9);
  assert.equal(calls[0].opts.state, 'attached');

  const failing = { waitForSelector: async () => { throw new Error('timeout'); } };
  assert.equal(await DRIVERS.chatgpt.waitForComposer(failing, 50), false);
  assert.equal(await DRIVERS.chatgpt.waitForComposer({}, 50), false);
  assert.equal(await DRIVERS.chatgpt.waitForComposer(null, 50), false);
});

test('newChat - recarregar a pagina aguarda o editor antes de retornar', async () => {
  const order = [];
  const page = {
    evaluate: async () => false,
    goto: async () => { order.push('goto'); },
    waitForSelector: async () => { order.push('wait'); }
  };
  await DRIVERS.chatgpt.newChat(page);
  assert.deepEqual(order, ['goto', 'wait']);
});

test('waitDone - conclui quando o texto estabiliza mesmo com DOM mutando sem parar', async () => {
  const d = DRIVERS.perplexity;
  const savedDebounce = d.debounceMs;
  d.debounceMs = 20;
  try {
    const page = {
      evaluate: async (fn, arg) => {
        if (arg && typeof arg === 'object' && 'stopSel' in arg) {
          return { isStopVisible: false, currentText: 'resposta final', lastMutation: Date.now() };
        }
        return false;
      }
    };
    const t0 = Date.now();
    assert.equal(await d.waitDone(page, 5000), true);
    assert.ok(Date.now() - t0 < 3000, 'deve concluir bem antes do timeout');
  } finally {
    d.debounceMs = savedDebounce;
  }
});

test('waitDone - nao conclui enquanto o texto ainda muda', async () => {
  const d = DRIVERS.perplexity;
  const savedDebounce = d.debounceMs;
  d.debounceMs = 20;
  try {
    let n = 0;
    const page = {
      evaluate: async (fn, arg) => {
        if (arg && typeof arg === 'object' && 'stopSel' in arg) {
          n += 1;
          return { isStopVisible: false, currentText: 'texto ' + n, lastMutation: Date.now() };
        }
        return false;
      }
    };
    await assert.rejects(() => d.waitDone(page, 600), (err) => err.code === 'PROMPT_TIMEOUT');
  } finally {
    d.debounceMs = savedDebounce;
  }
});

test('Perplexity - seletor do botao parar inclui o rotulo observado ao vivo (Interromper resposta)', () => {
  const sel = DRIVERS.perplexity.getSelectorString(DRIVERS.perplexity.selectors.stopBtn);
  assert.ok(sel.includes('button[aria-label*="Interromper"]'));
});

test('Claude - seletor do botao parar e citacoes cobrem a UI observada ao vivo', () => {
  const stop = DRIVERS.claude.getSelectorString(DRIVERS.claude.selectors.stopBtn);
  assert.ok(stop.includes('button[data-testid="chat-input-stop"]'));
  assert.ok(DRIVERS.claude.selectors.citations.level1.selector.includes('.standard-markdown a[href^="http"]'));
});

test('Gemini - citacoes excluem links de busca do Google', () => {
  for (const level of ['level1', 'level2', 'level3']) {
    const sel = DRIVERS.gemini.selectors.citations[level].selector;
    assert.ok(sel.includes('google.com'), `${level} deve excluir google.com`);
  }
});

test('DeepSeek - resposta nao casa com paragrafos nem spans de citacao; stop cobre o botao circular', () => {
  const resp = DRIVERS.deepseek.getSelectorString(DRIVERS.deepseek.selectors.response);
  assert.ok(resp.includes('[class*="ds-markdown"]:not([class*="ds-markdown-"])'));
  assert.ok(!resp.split(',').map((s) => s.trim()).includes('[class*="ds-markdown"]'));
  const stop = DRIVERS.deepseek.getSelectorString(DRIVERS.deepseek.selectors.stopBtn);
  assert.ok(stop.includes('div[role="button"].ds-button--primary:has(svg rect)'));
});
