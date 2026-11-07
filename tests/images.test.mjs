import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseDriver } from '../src/drivers/base.mjs';
import { ChatGPTDriver } from '../src/drivers/chatgpt.mjs';
import { GeminiDriver } from '../src/drivers/gemini.mjs';
import { BridgeServer } from '../src/server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('driver sem imageScope nao devolve imagens', async () => {
  const d = new BaseDriver({ name: 'x' });
  assert.deepEqual(await d.extractImages({ evaluate: async () => [{ index: 1 }] }), []);
});

test('driver com imageScope repassa o resultado e tolera falha', async () => {
  const d = new ChatGPTDriver();
  const ok = await d.extractImages({ evaluate: async () => [{ index: 1, mimeType: 'image/png', bytes: 3, data: 'AAA=' }] });
  assert.equal(ok.length, 1);
  const bad = await d.extractImages({ evaluate: async () => { throw new Error('x'); } });
  assert.deepEqual(bad, []);
});

test('callTool entrega imagem como conteudo MCP e tira o base64 do texto', async () => {
  const s = new BridgeServer();
  s.invoke = async () => ({ text: 'ok', images: [{ index: 1, alt: 'a', mimeType: 'image/png', bytes: 3, data: 'AAA=' }] });
  const r = await s.callTool('ask_chatgpt', { prompt: 'x' });
  assert.equal(r.content[1].type, 'image');
  assert.equal(r.content[1].data, 'AAA=');
  assert.ok(!r.content[0].text.includes('AAA='));
  assert.ok(r.content[0].text.includes('"delivered": true'));
});

/**
 * Elemento DOM simulado para testes sem navegador real.
 */
class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = Object.create(null);
    this.children = [];
    this.parent = null;
  }
  getAttribute(name) {
    return this.attributes[name.toLowerCase()] ?? null;
  }
  setAttribute(name, val) {
    this.attributes[name.toLowerCase()] = String(val);
  }
  get width() {
    return Number(this.attributes['width']) || 0;
  }
  get height() {
    return Number(this.attributes['height']) || 0;
  }
  get naturalWidth() {
    return this.width;
  }
  get naturalHeight() {
    return this.height;
  }
  get complete() {
    return true;
  }
  get src() {
    return this.attributes['src'] || '';
  }
  get currentSrc() {
    return this.src;
  }
  closest(sel) {
    let cur = this;
    while (cur) {
      if (matchesSel(cur, sel)) return cur;
      cur = cur.parent;
    }
    return null;
  }
  querySelectorAll(sel) {
    return queryTree(this, sel);
  }
  querySelector(sel) {
    return queryTree(this, sel)[0] || null;
  }
}

/**
 * Avalia se o MockElement atende ao seletor CSS simples.
 */
function matchesSel(node, sel) {
  if (!node || !node.tagName) return false;
  const s = sel.trim();
  if (s.includes(',')) {
    return s.split(',').some((part) => matchesSel(node, part.trim()));
  }

  const notMatch = s.match(/:not\(([^)]+)\)/);
  if (notMatch) {
    const inner = notMatch[1];
    const rest = s.replace(notMatch[0], '');
    if (matchesSel(node, inner)) return false;
    return rest ? matchesSel(node, rest) : true;
  }

  const tagMatch = s.match(/^([a-zA-Z0-9_-]+)/);
  if (tagMatch) {
    if (node.tagName !== tagMatch[1].toUpperCase()) return false;
  }

  const attrRegex = /\[([a-zA-Z0-9_-]+)(?:([*^$]?=)(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g;
  let m;
  while ((m = attrRegex.exec(s)) !== null) {
    const attrName = m[1].toLowerCase();
    const op = m[2];
    const expected = m[3] ?? m[4] ?? m[5];
    const actual = node.getAttribute(attrName);
    if (actual === null) return false;
    if (op === '=') {
      if (actual !== expected) return false;
    } else if (op === '^=') {
      if (!actual.startsWith(expected)) return false;
    } else if (op === '*=') {
      if (!actual.includes(expected)) return false;
    } else if (op === '$=') {
      if (!actual.endsWith(expected)) return false;
    }
  }

  const idMatch = s.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch && node.getAttribute('id') !== idMatch[1]) return false;

  return true;
}

/**
 * Busca descendentes que casam com o seletor.
 */
function queryTree(root, sel) {
  const parts = sel.trim().split(/\s+/).filter(Boolean);
  const results = [];
  function search(current, index) {
    for (const child of current.children) {
      if (typeof child === 'string') continue;
      if (matchesSel(child, parts[index])) {
        if (index === parts.length - 1) {
          if (!results.includes(child)) results.push(child);
        } else {
          search(child, index + 1);
        }
      }
      search(child, index);
    }
  }
  search(root, 0);
  return results;
}

/**
 * Analisa string HTML em arvore de MockElements.
 */
function parseHtmlToMockTree(html) {
  const root = new MockElement('ROOT');
  const stack = [root];
  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9_-]+)([^>]*?)(\/)?>|([^<]+)/g;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    if (match[0].startsWith('<!--') || match[5]) continue;
    const isClosing = Boolean(match[1]);
    const tagName = match[2];
    const rawAttrs = match[3] || '';
    const isSelfClosing = Boolean(match[4]) || ['IMG', 'INPUT', 'META', 'LINK', 'BR', 'HR'].includes(tagName.toUpperCase());

    if (isClosing) {
      if (stack.length > 1) stack.pop();
    } else {
      const el = new MockElement(tagName);
      const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = attrRegex.exec(rawAttrs)) !== null) {
        el.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? '');
      }
      const parent = stack[stack.length - 1];
      el.parent = parent;
      parent.children.push(el);
      if (!isSelfClosing) {
        stack.push(el);
      }
    }
  }
  return root;
}

/**
 * Cria ambiente simulado de page.evaluate para exercitar a logica real de extractImages.
 */
function createMockPage({ html, url = 'https://chatgpt.com/', fetchFn = null, canvasDataUrl = 'data:image/png;base64,QUJD' }) {
  const root = parseHtmlToMockTree(html);

  const documentMock = {
    querySelectorAll: (sel) => queryTree(root, sel),
    querySelector: (sel) => queryTree(root, sel)[0] || null,
    createElement: (tag) => {
      if (tag.toLowerCase() === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => {}
          }),
          toDataURL: (mime) => {
            if (canvasDataUrl === null) return '';
            return typeof canvasDataUrl === 'function' ? canvasDataUrl(mime) : canvasDataUrl;
          }
        };
      }
      return new MockElement(tag);
    }
  };

  const windowMock = {
    location: new URL(url),
    origin: new URL(url).origin
  };

  const page = {
    evaluate: async (fn, arg) => {
      const prevDoc = globalThis.document;
      const prevWin = globalThis.window;
      const prevFetch = globalThis.fetch;
      try {
        globalThis.document = documentMock;
        globalThis.window = windowMock;
        if (fetchFn) {
          globalThis.fetch = fetchFn;
        }
        return await fn(arg);
      } finally {
        globalThis.document = prevDoc;
        globalThis.window = prevWin;
        globalThis.fetch = prevFetch;
      }
    }
  };

  return { page, root, documentMock };
}

test('Caso (a) - ChatGPTDriver extrai imagem do turno inteiro com fixture HTML', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'chatgpt_image_turn.html');
  const html = fs.readFileSync(fixturePath, 'utf8');

  const fakePngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const mock = createMockPage({
    html,
    url: 'https://chatgpt.com/',
    fetchFn: async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob([fakePngBuffer], { type: 'image/png' })
    })
  });

  const driver = new ChatGPTDriver();
  const images = await driver.extractImages(mock.page);

  // Na fixture, div[data-message-author-role="assistant"] so tem icone de 32px (< 256).
  // O fallback para article[data-testid^="conversation-turn"] localiza 512x512 e 1024x1024.
  assert.equal(images.length, 2);
  assert.equal(images[0].index, 1);
  assert.equal(images[0].alt, 'Imagem gerada fora do div assistant');
  assert.equal(images[0].mimeType, 'image/png');
  assert.equal(images[0].bytes, fakePngBuffer.length);
  assert.ok(images[0].data);
  assert.equal(images[0].skipped, undefined);

  assert.equal(images[1].index, 2);
  assert.equal(images[1].alt, 'Segunda imagem gerada');
  assert.equal(images[1].mimeType, 'image/png');
  assert.equal(images[1].bytes, fakePngBuffer.length);
  assert.ok(images[1].data);
  assert.equal(images[1].skipped, undefined);
});

test('Caso (a) - GeminiDriver mantem escopo em model-response e nao busca article conversation-turn', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'chatgpt_image_turn.html');
  const html = fs.readFileSync(fixturePath, 'utf8');

  const mock = createMockPage({
    html,
    url: 'https://gemini.google.com/app',
    fetchFn: async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob([Buffer.from([1, 2, 3])], { type: 'image/png' })
    })
  });

  const gemini = new GeminiDriver();
  assert.equal(gemini.imageScope, 'model-response');
  assert.ok(!gemini.imageFallbackScope);

  const images = await gemini.extractImages(mock.page);
  // Na fixture do ChatGPT nao ha model-response, e o Gemini nao tem fallback para conversation-turn
  assert.deepEqual(images, []);
});

test('Caso (b) - Fallback CORS: fetch com credentials include falha, mas fetch com omit recupera bytes', async () => {
  const html = `
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">
        <img id="img-cross-origin" src="https://external-cdn.com/generated.png" width="512" height="512" alt="Foto teste" />
      </div>
    </article>
  `;

  const fakePngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03, 0x04]);
  const credentialsUsed = [];

  const mock = createMockPage({
    html,
    url: 'https://chatgpt.com/',
    fetchFn: async (src, opts = {}) => {
      credentialsUsed.push(opts.credentials);
      if (opts.credentials === 'include') {
        throw new TypeError('Failed to fetch due to CORS restrictions');
      }
      if (opts.credentials === 'omit') {
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob([fakePngBuffer], { type: 'image/png' })
        };
      }
      throw new Error('Opcao de credentials inesperada');
    }
  });

  const driver = new ChatGPTDriver();
  const images = await driver.extractImages(mock.page);

  assert.equal(images.length, 1);
  assert.equal(images[0].index, 1);
  assert.equal(images[0].mimeType, 'image/png');
  assert.equal(images[0].bytes, fakePngBuffer.length);
  assert.ok(images[0].data);
  assert.equal(images[0].skipped, undefined);
  assert.ok(credentialsUsed.includes('include'));
  assert.ok(credentialsUsed.includes('omit'));
});

test('Caso (b) - Fallback CORS: fetch include falha, mas canvas toDataURL same-origin recupera bytes', async () => {
  const html = `
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">
        <img id="img-same-origin" src="https://chatgpt.com/backend-api/image.png" width="512" height="512" alt="Same origin image" />
      </div>
    </article>
  `;

  const sameOriginBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const mock = createMockPage({
    html,
    url: 'https://chatgpt.com/',
    canvasDataUrl: `data:image/png;base64,${sameOriginBase64}`,
    fetchFn: async () => {
      throw new TypeError('CORS failed on fetch');
    }
  });

  const driver = new ChatGPTDriver();
  const images = await driver.extractImages(mock.page);

  assert.equal(images.length, 1);
  assert.equal(images[0].index, 1);
  assert.equal(images[0].mimeType, 'image/png');
  assert.ok(images[0].bytes > 0);
  assert.equal(images[0].data, sameOriginBase64);
  assert.equal(images[0].skipped, undefined);
});

test('Caso (b) - Quando fetch com credentials e fallbacks falham, registra FETCH_FAILED sem vazar texto', async () => {
  const html = `
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">
        <p>Texto confidencial de negocio da pagina</p>
        <img id="img-fail" src="https://files.oaiusercontent.com/broken-img" width="512" height="512" alt="Imagem que falha" />
      </div>
    </article>
  `;

  const mock = createMockPage({
    html,
    url: 'https://chatgpt.com/',
    canvasDataUrl: null,
    fetchFn: async () => {
      throw new Error('Network failure');
    }
  });

  const driver = new ChatGPTDriver();
  const images = await driver.extractImages(mock.page);

  assert.equal(images.length, 1);
  assert.equal(images[0].index, 1);
  assert.equal(images[0].skipped, 'FETCH_FAILED');
  assert.equal(images[0].data, undefined);

  const serialized = JSON.stringify(images[0]);
  assert.ok(!serialized.includes('Texto confidencial'));
  assert.ok(!serialized.includes('Network failure'));
});

test('Caso (c) - Conversao de image/webp para image/png via canvas', async () => {
  const html = `
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">
        <img id="img-webp" src="https://chatgpt.com/test.webp" width="512" height="512" alt="Imagem em formato WebP" />
      </div>
    </article>
  `;

  const fakeWebpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  const convertedPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const mock = createMockPage({
    html,
    url: 'https://chatgpt.com/',
    canvasDataUrl: `data:image/png;base64,${convertedPngBase64}`,
    fetchFn: async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob([fakeWebpBytes], { type: 'image/webp' })
    })
  });

  const driver = new ChatGPTDriver();
  const images = await driver.extractImages(mock.page);

  assert.equal(images.length, 1);
  assert.equal(images[0].index, 1);
  assert.equal(images[0].mimeType, 'image/png');
  assert.equal(images[0].data, convertedPngBase64);
  assert.ok(images[0].bytes > 0);
  assert.equal(images[0].skipped, undefined);
});

test('Caso (d) - Limites e filtros: ignora imagens menores que 256 px e marca TOO_LARGE acima de maxBytes', async () => {
  const html = `
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">
        <img id="icon-small" src="https://chatgpt.com/avatar.png" width="64" height="64" alt="Icone pequeno" />
        <img id="banner-narrow" src="https://chatgpt.com/divider.png" width="512" height="100" alt="Separador estreito" />
        <img id="huge-img" src="https://chatgpt.com/huge.png" width="512" height="512" alt="Imagem muito grande" />
      </div>
    </article>
  `;

  const origMax = process.env.CHAT_BRIDGE_MAX_IMAGE_BYTES;
  process.env.CHAT_BRIDGE_MAX_IMAGE_BYTES = '100';

  try {
    const hugeBuffer = Buffer.alloc(200, 0x41);
    const mock = createMockPage({
      html,
      url: 'https://chatgpt.com/',
      fetchFn: async () => ({
        ok: true,
        status: 200,
        blob: async () => new Blob([hugeBuffer], { type: 'image/png' })
      })
    });

    const driver = new ChatGPTDriver();
    const images = await driver.extractImages(mock.page);

    assert.equal(images.length, 1);
    assert.equal(images[0].index, 1);
    assert.equal(images[0].alt, 'Imagem muito grande');
    assert.equal(images[0].bytes, 200);
    assert.equal(images[0].skipped, 'TOO_LARGE');
    assert.equal(images[0].data, undefined);
  } finally {
    if (origMax !== undefined) {
      process.env.CHAT_BRIDGE_MAX_IMAGE_BYTES = origMax;
    } else {
      delete process.env.CHAT_BRIDGE_MAX_IMAGE_BYTES;
    }
  }
});

test('ChatGPT DOM real 2026-11: imagem na generated-image-gallery dentro de div[data-turn-key]', async () => {
  const html = `
    <div data-turn-key="u1"><div><p>pedido</p></div></div>
    <div data-turn-key="a1">
      <div data-talvt-turn-state="complete">
        <div data-testid="generated-image-gallery">
          <div data-web-image-tile="true">
            <button data-testid="generated-image-preview">
              <img src="https://chatgpt.com/abc/file.png" width="1536" height="1024" alt="Imagem gerada">
            </button>
          </div>
        </div>
      </div>
    </div>`;
  const mock = createMockPage({
    html,
    fetchFn: async () => ({ ok: true, status: 200, blob: async () => new Blob([Buffer.from([1, 2, 3])], { type: 'image/png' }) })
  });
  const images = await new ChatGPTDriver().extractImages(mock.page);
  assert.equal(images.length, 1);
  assert.equal(images[0].alt, 'Imagem gerada');
  assert.ok(images[0].data);
});
