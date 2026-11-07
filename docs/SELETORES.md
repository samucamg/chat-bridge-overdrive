# Mapeamento de Seletores DOM e Contrato dos Drivers

English version: [SELECTORS.en.md](SELECTORS.en.md)

Documentacao tecnica de seletores em 3 niveis de resiliencia para os provedores suportados pelo `chat-overdrive-bridge` e mecanismos de deteccao de anomalias/desafios.

---

## Estrategia de Selecao em 3 Niveis

Para garantir maxima estabilidade contra atualizacoes de layout das interfaces web, os drivers devem buscar elementos aplicando a seguinte cascata:

1. **Nivel 1 (Semantico e Dados):** Atributos de dados estaveis (`data-testid`, `data-workflow-*`, `data-lexical-editor`), roles W3C e IDs semanticos.
2. **Nivel 2 (Aria Multi-idioma):** Atributos de acessibilidade (`aria-label`, `title`) contemplando variantes de idioma (pt-BR, en-US, es).
3. **Nivel 3 (Estrutural e Fallback):** Hierarquia de tags de container, icones SVG conhecidos e classes CSS secundarias.

---

## 1. Perplexity (perplexity.ai)

Provedor verificado com inspecao ao vivo via Chrome DevTools.

| Acao / Elemento | Nivel 1 (Semantico) | Nivel 2 (Aria / I18n) | Nivel 3 (Estrutural / SVG) | Grau de Confianca | Observacoes |
|---|---|---|---|---|---|
| Campo de entrada (Prompt) | `div[role="textbox"][data-lexical-editor="true"]` | `div[contenteditable="true"][aria-label*="Ask"]`, `div[contenteditable="true"][aria-label*="Pergunte"]` | `textarea[placeholder*="Ask"]`, `div[contenteditable="true"]` | Alta | Baseado no editor Lexical. Exige foco e `Input.insertText` via CDP. |
| Botao Enviar (Submit) | `button[type="submit"]` | `button[aria-label="Enviar"]`, `button[aria-label="Submit"]` | `button:has(svg path[d*="M"])` no rodape da caixa de texto | Alta | Habilitado apenas quando ha texto preenchido. |
| Botao Parar (Stop) | `button[data-testid="stop-button"]` | `button[aria-label*="Interromper"]` (validado ao vivo), `button[aria-label="Parar"]`, `button[aria-label="Stop"]` | `button svg use[href*="player-stop"]`, `#pplx-icon-player-stop` | Media (Inferido) | Presente durante streaming de resposta. Desaparecimento sinaliza conclusao. |
| Bloco de Resposta | `div[data-workflow-final-text] div[data-renderer="lm"]` | `div[data-testid="answer-content"]` | `div.prose[data-renderer="lm"]`, `div[data-workflow-entry]` | Alta | Contem o Markdown renderizado da resposta final. |
| Citacoes / Fontes | `span[data-pplx-citation]`, `a[data-pplx-citation-url]` | `a[target="_blank"][rel*="noreferrer"]` dentro da resposta | `div[data-testid="sources-list"] a` | Alta | Extrair texto da ancora e atributo `href`. |
| Nova Conversa (New Thread) | `a[href="/"]` com icone de edicao | `a[aria-label="Novo"]`, `a[aria-label="New Thread"]` | `button:has(svg[aria-label*="New"])`, `nav a[href="/"]` | Alta | Limpa o contexto e inicia novo chat. |
| Indicador de Pensamento | `div[data-workflow-thought]`, `div[data-testid="thinking"]` | `details[aria-label*="Thinking"]` | `div:has(svg.animate-spin)` | Media | Deve ser filtrado para nao poluir o texto final. |

### Regras Criticas do Perplexity
- **Insercao de texto:** Nao atribuir `.value` nem `.innerText` diretamente no elemento Lexical, pois o React/Lexical ignora alteracoes sinteticas no DOM e o botao de envio permanece desabilitado. O procedimento correto e:
  1. Realizar `.focus()` no seletor do campo de entrada.
  2. Disparar o comando CDP `Input.insertText` ou `page.keyboard.type(prompt)`.

---

## 2. Gemini (gemini.google.com)

Provedor adaptado a partir do Argon e antigravity-bridge (reutilizacao de seletores comprovados).

| Acao / Elemento | Nivel 1 (Semantico) | Nivel 2 (Aria / I18n) | Nivel 3 (Estrutural / Classes) | Grau de Confianca | Observacoes |
|---|---|---|---|---|---|
| Campo de entrada (Composer) | `rich-textarea [contenteditable="true"]` | `[contenteditable="true"][role="textbox"]` | `div.input-area [contenteditable="true"]` | Media | Google renderiza dentro de custom element `rich-textarea`. |
| Botao Enviar | `button[data-test-id="send-button"]` | `button[aria-label="Send message"]`, `button[aria-label="Enviar mensagem"]` | `button.send-button` | Media | Habilitado quando ha rascunho preenchido. |
| Botao Parar (Stop) | `button[data-test-id="stop-button"]` | `button[aria-label*="Stop"]`, `button[aria-label*="Parar"]` | `button.stop-button` | Media | Visivel durante a geracao da resposta. |
| Bloco de Resposta | `model-response` | `div[role="region"][aria-label*="Response"]` | `div.model-response-text`, `message-content` | Media | Filtrar blocos de pensamento aninhados. |
| Filtro de Raciocinio | `model-thoughts`, `thinking-panel` | `[data-test-id="thinking-content"]` | `details.thinking-details` | Media | Deve ser expressamente excluido da extracao de texto final. |
| Seletor de Modelo | `[data-test-id="bard-mode-menu-button"]` | `button[aria-label*="model"]`, `button[aria-label*="modelo"]` | `.model-switcher` | Media | Utilizado para auditoria e confirmacao do modelo ativo. |
| Nova Conversa | `a[data-test-id="new-chat-button"]` | `button[aria-label*="New chat"]`, `button[aria-label*="Novo chat"]` | `nav a[href="/app"]` | Media | Reseta o contexto da conversa. |

### Regras Criticas do Gemini
- **Raciocinio e cabecalhos variaveis:** Algumas respostas do Gemini contem blocos de `model-thoughts` ou `thinking-panel` que mudam de estado continuamente durante a geracao. A extracao de texto final deve varrer `.model-response-text` ignorando qualquer no ancestral ou descendente pertencente a `model-thoughts` ou `[data-test-id="thinking-content"]`.

---

## 3. ChatGPT (https://chatgpt.com/)

Provedor adaptado a partir do Argon e chat-bridge (seletores extraidos dos projetos base, aguardando conferencia ao vivo).

| Acao / Elemento | Nivel 1 (Semantico) | Nivel 2 (Aria / I18n) | Nivel 3 (Estrutural / Classes) | Grau de Confianca | Observacoes |
|---|---|---|---|---|---|
| Campo de entrada (`input`) | `#prompt-textarea.ProseMirror`, `#prompt-textarea[contenteditable="true"]` | `div[id="prompt-textarea"][role="textbox"]`, `[contenteditable="true"][aria-label*="mensagem"]`, `[contenteditable="true"][aria-label*="message"]` | `div.ProseMirror[contenteditable="true"]`, `#prompt-textarea` | Media | Editor baseado em ProseMirror. Exige foco no elemento antes do envio. |
| Botao Enviar (`sendBtn`) | `button[data-testid="send-button"]` | `button[aria-label="Enviar prompt"]`, `button[aria-label="Send prompt"]`, `button[aria-label*="Enviar"]`, `button[aria-label*="Send"]` | `button:has(svg path[d*="M"])` | Media | Habilitado quando ha conteudo no editor ProseMirror. |
| Botao Parar (`stopBtn`) | `button[data-testid="stop-button"]` | `button[aria-label="Parar geracao"]`, `button[aria-label="Stop generating"]`, `button[aria-label*="Parar"]`, `button[aria-label*="Stop"]` | `button:has(rect)`, `button[aria-label*="stop"]` | Media | Visivel durante a geracao da resposta. Desaparecimento sinaliza conclusao. |
| Bloco de Resposta (`response`) | `[data-markdown-text-style="assistant-message"]`, `[data-message-author-role="assistant"] .markdown.prose`, `[data-message-author-role="assistant"] .markdown` | `article [data-message-author-role="assistant"] div.markdown` | `div[data-message-author-role="assistant"]` | Media | Conteudo principal da resposta renderizada do assistente em Markdown. |
| Filtro de Raciocinio (`thoughtFilter`) | `details[data-testid="reasoning-panel"]`, `.result-thinking` | `details[aria-label*="Thinking"]`, `details[aria-label*="Raciocinio"]` | `details.thinking-details`, `.reasoning-content` | Media | Pensamento interno dos modelos o1/o3; deve ser expressamente descartado na extracao. |
| Citacoes / Fontes (`citations`) | `a[data-testid="webpage-citation"]`, `a.citation-pill` | `[data-message-author-role="assistant"] a[target="_blank"][href^="http"]` | `article a[target="_blank"]` | Media | Links externos de busca na web integrados a resposta. |
| Nova Conversa (`newChatBtn`) | `a[data-testid="create-new-chat-button"]`, `button[data-testid="create-new-chat-button"]` | `a[aria-label="Novo chat"]`, `a[aria-label="New chat"]`, `button[aria-label*="Novo chat"]` | `a[href="/"]` | Media | Redireciona para sessao limpa na raiz da aplicacao. |
| Anexo de Arquivo (`fileInput`) | `input#file-upload[type="file"]` | `input[type="file"][multiple]` | `input[type="file"]` | Media | Input oculto utilizado para anexo de arquivos via CDP `page.setInputFiles`. |
| Seletor de Modelo (`modelBadge`) | `button[data-testid="model-switcher-dropdown-button"]` | `button[aria-label*="model"]`, `button[aria-label*="modelo"]` | `header button:has-text("ChatGPT")` | Media | Identificador e seletor do modelo ativo (ex: ChatGPT 4o). |

### Regras Criticas do ChatGPT
- **Filtragem de raciocinio (o1/o3):** O painel de raciocinio (`details[data-testid="reasoning-panel"]` ou `.result-thinking`) deve ser filtrado e removido do texto final durante a extracao para que apenas o conteudo util do assistente seja retornado.
- **Editor ProseMirror:** O elemento `#prompt-textarea` utiliza ProseMirror com `contenteditable="true"`. A interacao segura requer foco no elemento e digitacao via CDP/Playwright para acionar eventos sinteticos do framework.
- **Grau de Confianca:** Todos os seletores do ChatGPT foram inicialmente classificados como `Media`, aguardando conferencia ao vivo com navegador real via rotina `doctor`.

---

## 4. Claude Web (https://claude.ai/)

Provedor adaptado a partir do antigravity-bridge (seletores extraidos dos projetos base, aguardando conferencia ao vivo).

| Acao / Elemento | Nivel 1 (Semantico) | Nivel 2 (Aria / I18n) | Nivel 3 (Estrutural / Classes) | Grau de Confianca | Observacoes |
|---|---|---|---|---|---|
| Campo de entrada (`input`) | `fieldset div.ProseMirror[contenteditable="true"]`, `div.ProseMirror[contenteditable="true"]` | `div[contenteditable="true"][role="textbox"]`, `[aria-label*="Claude"]`, `[aria-label*="mensagem"]` | `div.ProseMirror`, `fieldset [contenteditable="true"]` | Media | Editor ProseMirror contido em `fieldset`. Requer foco e digitacao via CDP. |
| Botao Enviar (`sendBtn`) | `button[data-testid="send-button"]` | `button[aria-label="Enviar mensagem"], button[aria-label="Send Message"]`, `button[aria-label*="Enviar"]`, `button[aria-label*="Send"]` | `fieldset button:has(svg)` | Media | Habilitado quando ha texto preenchido no editor. |
| Botao Parar (`stopBtn`) | `button[data-testid="stop-button"]` | `button[aria-label="Parar resposta"], button[aria-label="Stop Response"]`, `button[aria-label*="Parar"]`, `button[aria-label*="Stop"]` | `button:has(svg rect)`, `button.stop-btn` | Media | Visivel durante streaming da resposta do Claude. Desaparecimento sinaliza conclusao. |
| Bloco de Resposta (`response`) | `.font-claude-message`, `[data-testid="chat-message-text"]`, `div.font-claude-message` | `div[data-is-streaming] .font-claude-message`, `article .font-claude-message` | `div.font-user-message ~ div.font-claude-message`, `.grid .font-claude-message` | Media | Bloco principal da resposta gerada pelo Claude. |
| Filtro de Raciocinio (`thoughtFilter`) | `div.thinking-block`, `[data-testid="thinking-block"]`, `div[data-testid="thinking-block"]` | `div[aria-label*="thinking"]`, `div[class*="thinking"]` | `details.thinking-details`, `.thinking-block` | Media | Bloco de raciocinio estendido (extended thinking); deve ser expressamente descartado na extracao. |
| Citacoes / Fontes (`citations`) | `.font-claude-message a[target="_blank"][href^="http"]` | `article a[target="_blank"][href^="http"]` | `a[href^="http"]:not([href*="claude.ai"])` | Media | Links e fontes externas citadas no corpo da resposta. |
| Nova Conversa (`newChatBtn`) | `a[href="/new"]`, `a[data-testid="new-chat-button"]` | `a[aria-label="Nova conversa"]`, `a[aria-label="New chat"]`, `button[aria-label*="Nova conversa"]` | `nav a[href="/new"]`, `header a[href="/new"]` | Media | Limpa a conversa atual e abre uma nova janela de chat. |
| Anexo de Arquivo (`fileInput`) | `input[type="file"][data-testid="file-upload"]` | `input[type="file"][multiple]`, `input[type="file"]` | `input[type="file"]` | Media | Input oculto manipulado diretamente via CDP `page.setInputFiles`. |
| Seletor de Modelo (`modelBadge`) | `button[data-testid="model-selector-dropdown"]` | `button[aria-label*="model"]`, `button[aria-label*="modelo"]` | `button:has-text("Claude")` | Media | Identificador e menu suspenso de selecao do modelo ativo (ex: Claude 3.7 Sonnet). |

### Regras Criticas do Claude Web
- **Filtragem de raciocinio estendido:** O container `div.thinking-block` ou `[data-testid="thinking-block"]` abriga o raciocinio intermediario do modelo. Ele deve ser filtrado e removido do texto final antes de entregar o retorno ao cliente MCP.
- **Estrutura com Fieldset:** O editor ProseMirror do Claude costuma residir dentro de um elemento `<fieldset>`. A navegacao pelo DOM deve respeitar essa hierarquia sem assumir formulários padrao.

---

## 5. DeepSeek (https://chat.deepseek.com/)

Provedor adaptado a partir do antigravity-bridge (seletores extraidos dos projetos base, aguardando conferencia ao vivo).

| Acao / Elemento | Nivel 1 (Semantico) | Nivel 2 (Aria / I18n) | Nivel 3 (Estrutural / Classes) | Grau de Confianca | Observacoes |
|---|---|---|---|---|---|
| Campo de entrada (`input`) | `textarea#chat-input`, `textarea[placeholder*="DeepSeek"]` | `textarea[role="textbox"]`, `textarea[placeholder*="mensagem"]`, `textarea[placeholder*="message"]` | `textarea`, `div.chat-input textarea` | Media | Elemento textarea padrao. Suporta foco e insercao via CDP. |
| Botao Enviar (`sendBtn`) | `div[data-testid="send-button"][role="button"]`, `button[data-testid="send-button"]` | `div[role="button"][aria-label="Enviar"]`, `div[role="button"][aria-label="Send"]`, `div.ds-icon-button[aria-label*="Enviar"]` | `div.ds-icon-button:has(svg)`, `button:has(svg)` | Media | Div customizada com `role="button"` e `aria-disabled="false"` quando ativa. |
| Botao Parar (`stopBtn`) | `button[data-testid="stop-button"]`, `div[data-testid="stop-button"]` | `button[aria-label="Parar"]`, `button[aria-label="Stop"]`, `div[role="button"][aria-label*="Parar"]` | `button:has(rect)`, `.ds-stop-button` | Media | Visivel durante a execucao do raciocinio ou geracao da resposta. |
| Bloco de Resposta (`response`) | `.ds-markdown`, `div.ds-markdown` | `div.ds-message .ds-markdown`, `.ds-answer-content` | `div[class*="markdown"]`, `div.ds-message` | Media | Bloco Markdown contendo a resposta estruturada do DeepSeek. |
| Filtro de Raciocinio (`thoughtFilter`) | `div.ds-think-content`, `.ds-think-content` | `div[class*="think-content"]`, `div.ds-think` | `details.think`, `div:has(.ds-think)` | Media | Cadeia de pensamento do DeepSeek R1; deve ser expressamente descartada da resposta final. |
| Citacoes / Fontes (`citations`) | `a.ds-citation`, `a[data-testid="ds-citation"]` | `.ds-markdown a[target="_blank"][href^="http"]` | `a[target="_blank"][href^="http"]` | Media | Links e fontes externas referenciadas na resposta. |
| Nova Conversa (`newChatBtn`) | `div[data-testid="new-chat-button"]`, `button[data-testid="new-chat-button"]` | `div[role="button"][aria-label="New chat"]`, `div[role="button"][aria-label="Novo chat"]`, `div[aria-label*="Novo chat"]` | `div.ds-new-chat`, `a[href="/"]` | Media | Cria uma nova sessao de conversa na interface web. |
| Seletor de Modelo (`modelBadge`) | `div[data-testid="model-selector"]`, `div.ds-model-switch` | `div[aria-label*="model"]`, `div[aria-label*="modelo"]` | `div:has-text("DeepSeek")` | Media | Indicador e badge do modelo ativo (ex: DeepSeek R1). |

### Regras Criticas do DeepSeek
- **Cadeia de pensamento R1:** O container `div.ds-think-content` contem a cadeia de raciocinio interno do DeepSeek R1. Esta secao deve ser excluida integralmente durante a extracao de texto final (`extractAnswer`).
- **Botoes customizados com role="button":** O DeepSeek frequentemente utiliza elementos `div` estilizados com `role="button"` e atributos `aria-disabled` em vez de tags `<button>` nativas. A resolucao de seletores deve contemplar essa flexibilidade.

---

## 6. Deteccao de Anomalias e Desafios de Seguranca

Quando qualquer um destes elementos for detectado, o driver deve interromper imediatamente a execucao e retornar erro estruturado, sem entrar em loops de retentativa cega.

| Tipo de Desafio | Seletores Primarios | Codigo de Erro MCP | Acao Recomendada |
|---|---|---|---|
| Cloudflare Turnstile | `iframe[src*="challenges.cloudflare.com"]`, `div.cf-turnstile`, `#turnstile-wrapper`, `[data-sitekey]` | `AUTH_REQUIRED` | Abortar imediatamente. Exigir intervencao no navegador visivel. |
| Google reCAPTCHA | `iframe[src*="google.com/recaptcha"]`, `iframe[src*="recaptcha"]`, `div.g-recaptcha` | `AUTH_REQUIRED` | Abortar execucao. |
| Arkose FunCAPTCHA | `iframe[src*="arkoselabs.com"]`, `iframe#fc-iframe-wrap` | `AUTH_REQUIRED` | Abortar execucao. |
| hCaptcha | `iframe[src*="hcaptcha"]`, `div.h-captcha` | `AUTH_REQUIRED` | Abortar execucao. |
| Sessao Deslogada / Expirada | `form[action*="/login"]`, `form[action*="/auth"]`, `button[data-testid="login-button"]`, `a[href*="/login"]`, `a[href*="/auth"]`, `a[href*="accounts.google.com/signin"]`, `input[type="password"]` | `AUTH_REQUIRED` | Abortar imediatamente e instruir autenticacao no Chrome debug local. |
| Bloqueio Temporario / Rate Limit | `div:has-text("Too many requests")`, `div:has-text("Muitas requisicoes")` | `TAB_BUSY` | Aplicar backoff exponencial ou aguardar janela de cooldown. |

### Deteccao de Sessao Expirada (`AUTH_REQUIRED`)
A perda de sessao ou redirecionamento para tela de login e identificada por dois fatores complementares:
1. **Presenca de componentes de autenticacao:** Presenca de formulários com acao de login (`form[action*="/login"]`), botoes especificos de login (`button[data-testid="login-button"]`) ou campos de senha isolados (`input[type="password"]`).
2. **Ausencia do campo de entrada de chat:** O metodo `isLoggedIn(page)` verifica se ha correspondencia para o seletor `selectors.input`. Se a contagem for zero e/ou seletores de login estiverem visiveis, o driver determina que nao ha sessao ativa e dispara imediatamente o erro `AUTH_REQUIRED`, prevenindo timeouts desnecessarios e orientando o usuario a realizar o login na instancia dedicada do Chrome.

---

## 7. Ciclo de Vida de Espera de Conclusao (waitDone)

O metodo `waitDone` combina tres sinais complementares para determinar o encerramento da resposta sem depender de polling estatico longo:

1. **Aparecimento e desaparecimento do botao Stop:** Durante o streaming, o botao Stop fica visivel. O sumico do botao e o primeiro indicador de termino.
2. **Estabilizacao do MutationObserver:** Quando nenhuma nova mutacao de texto ocorre por um periodo de amortecimento (debounce de 400ms a 600ms).
3. **Timeout maximo de guarda:** Timeout configuravel (padrao 120s) com cancelamento cooperativo via `AbortSignal`.

---

## 8. Conexao CDP e Politica de Isolamento de Rede

### Nota Tecnica de Conexao
O endpoint de conexao CDP exige estritamente a notacao IPv4 loopback `http://127.0.0.1:9222` (rejeitando `0.0.0.0`, `[::1]` ou tuneis externos por politica de seguranca).

- **Motivo de Seguranca:** O Chrome DevTools Protocol concede controle irrestrito de inspecao, execucao e leitura de cookies de sessao. Expor a porta em `0.0.0.0`, vincular a interfaces IPv6 nao controladas ou utilizar tuneis externos (ex: Cloudflare Tunnels, ngrok, supergateway) viola a politica de isolamento local e exposicao zero de portas.
- **Validacao em Tempo de Execucao:** A rotina `validateCdpEndpoint` valida explicitamente que o hostname da URL seja estritamente `127.0.0.1` ou `localhost`, abortando com erro padronizado `CDP_UNAVAILABLE` caso qualquer outro endereco de host seja fornecido.

## Validacao ao vivo (homologacao de 07/11/2026)

Seletores confirmados em contas reais com prompt ficticio (resposta curta e resposta longa com fontes). A UI dos provedores muda sem aviso: reexecute `chat_bridge_status` com `doctor: true` e uma rodada curta apos mudancas visiveis.

| Provedor | Botao parar (`stopBtn`) | Resposta (`response`) | Citacoes (`citations`) |
|---|---|---|---|
| Perplexity | `button[aria-label*="Interromper"]` (rotulo "Interromper resposta (Esc)") | `div[data-workflow-final-text] div[data-renderer="lm"]`, `div[data-renderer="lm"].prose` | `span[data-pplx-citation] a` (nivel 1, Alta) |
| ChatGPT | nivel 2 (Media) | `[data-markdown-text-style="assistant-message"]` | nao validado (resposta sem busca na web) |
| Gemini | nivel 2 (`button[aria-label*="Parar"]`, rotulo "Parar resposta") | `model-response` | `model-response a[href^="http"]` sem `google.com/search` |
| Claude | `button[data-testid="chat-input-stop"]` | `main .prose` / `div[data-is-streaming] .prose` | `.standard-markdown a[href^="http"]` sem links de suporte |
| DeepSeek | `div[role="button"].ds-button--primary:has(svg rect)` | `.ds-markdown` (container, nao `ds-markdown-paragraph` nem `ds-markdown-cite`) | `.ds-markdown a` (nivel 1, Media) |

Armadilhas encontradas: (1) seletor de resposta que tambem casa com a bolha da pergunta do usuario (Perplexity); (2) seletor de resposta que casa com blocos internos e o "ultimo elemento" fica pequeno (DeepSeek); (3) link de aviso legal contado como fonte (Claude); (4) links de busca do Google contados como fonte (Gemini); (5) paginas que mutam o DOM sem parar (Perplexity), por isso a conclusao usa o texto estavel; (6) seletor de baixa confianca (nivel 3) que casa com qualquer botao de icone e clica no lugar errado (Gemini): por isso envio, nova conversa e botao parar usam so os niveis 1 e 2, e sem eles o envio usa a tecla Enter; (7) em conversa continuada o texto da resposta anterior ja esta na tela: o `waitDone` registra um baseline antes de enviar e so conclui com uma resposta nova.

`cancel_chat` validado em geracao real (Gemini e Perplexity): a chamada pendente retorna `CANCELLED`, o botao parar e acionado e o lease da aba e liberado.
