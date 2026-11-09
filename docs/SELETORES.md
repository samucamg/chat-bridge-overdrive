# Mapeamento de Seletores DOM e Contrato dos Drivers

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

## 6. Microsoft Copilot (https://copilot.cloud.microsoft/ ou https://copilot.microsoft.com/)

Provedor homologado para a interface corporativa e web do Microsoft Copilot baseada em componentes Fluent UI e editor Lexical.

| Acao / Elemento | Nivel 1 (Semantico) | Nivel 2 (Aria / I18n) | Nivel 3 (Estrutural / Classes) | Grau de Confianca | Observacoes |
|---|---|---|---|---|---|
| Campo de entrada (`input`) | `#m365-chat-editor-target-element`, `span[data-lexical-editor="true"][role="textbox"]` | `[role="textbox"][aria-label*="mensagem"]`, `[role="textbox"][aria-label*="message"]`, `[role="textbox"][aria-label*="Pergunte"]` | `.fai-BebopLiteChatInput [contenteditable="true"]`, `.fai-BebopLiteChatInput span` | Alta | Editor Lexical montado em elemento span dentro de `.fai-BebopLiteChatInput`. Requer foco e digitacao sintetica via CDP. |
| Botao Enviar (`sendBtn`) | `button.fai-BebopLiteChatInput__send`, `button[type="submit"].fai-SendButton` | `button[aria-label="Enviar"]`, `button[aria-label="Send"]`, `button[aria-label*="Enviar"]` | `.fai-BebopLiteChatInput button:has(svg.fai-SendButton__sendIcon)` | Alta | Habilitado quando ha conteudo digitado no editor Lexical. |
| Botao Parar (`stopBtn`) | `button.fai-SendButton:not(.fai-BebopLiteChatInput__send)` | `button[aria-label="Parar de gerar"]`, `button[aria-label="Stop generating"]`, `button[aria-label*="Parar"]` | `button.fai-SendButton:has(svg rect)` | Media | Visivel durante a geracao da resposta. Desaparecimento sinaliza conclusao. |
| Bloco de Resposta (`response`) | `[data-testid="copilot-message-div"] [data-testid="markdown-reply"]`, `[data-testid="copilot-message-div"]` | `div[role="region"][aria-label*="Copilot"]` | `.fai-CopilotMessage__content [data-testid="markdown-reply"]`, `.fai-CopilotMessage__content` | Alta | Conteudo Markdown renderizado no turno do Copilot. Em sessoes continuadas, seleciona o ultimo turno. |
| Filtro de Sugestoes / Cabecalhos (`filter`) | `.fai-Suggestion`, `.fai-CopilotMessage__accessibleHeading` | `[aria-label*="suggestion"]`, `[aria-label*="sugestao"]` | `.fai-CopilotMessage__content > .fai-Suggestion`, `h6.fai-CopilotMessage__accessibleHeading` | Alta | Sugestoes de prompts e cabecalhos acessiveis ("Copilot said:") descartados da extracao limpa. |
| Citacoes / Fontes (`citations`) | `[data-testid="markdown-reply"] a.fui-Link`, `[data-testid="copilot-message-div"] a.fui-Link` | `[data-testid="markdown-reply"] a[target="_blank"][href^="http"]` | `.fai-CopilotMessage__content a[href^="http"]` | Alta | Links de citacao e fontes externas estilizados com componentes Fluent UI (`fui-Link`). |
| Nova Conversa (`newChatBtn`) | `a.fui-NavItem.spa-link[href*="/chat?es=Click"]`, `a.fui-NavItem[href*="/chat"]` | `a[aria-label="Novo chat"]`, `a[aria-label="New chat"]`, `button[aria-label*="Novo chat"]` | `nav a[href*="chat"]`, `.spa-link` | Alta | Limpa o contexto da conversa e inicia uma nova thread. |
| Anexo de Arquivo (`fileInput`) | `input#upload-file-button[type="file"]` | `input[type="file"][multiple]` | `input[type="file"]` | Alta | Elemento input de upload de arquivos manipulado via CDP `page.setInputFiles`. |

### Regras Criticas do Microsoft Copilot
- **Editor Lexical em elemento span:** O editor utiliza a tag `span` (`#m365-chat-editor-target-element`) com `data-lexical-editor="true"`. O envio requer `.focus()` e `Input.insertText` ou `page.keyboard.type()`, evitando atribuicao direta a `.innerText`.
- **Limpeza de Turnos e Sugestoes:** As mensagens do Copilot residem em `[data-testid="copilot-message-div"]`. Deve-se selecionar sempre o ultimo container da lista em conversas multi-turn e filtrar rigorosamente `.fai-Suggestion` e `.fai-CopilotMessage__accessibleHeading`.

---

## 7. Meta AI (https://www.meta.ai/)

Provedor homologado para a interface web do Meta AI baseada em Lexical e Tailwind/Prose.

| Acao / Elemento | Nivel 1 (Semantico) | Nivel 2 (Aria / I18n) | Nivel 3 (Estrutural / Classes) | Grau de Confianca | Observacoes |
|---|---|---|---|---|---|
| Campo de entrada (`input`) | `div[data-testid="composer-input"][data-lexical-editor="true"]`, `[data-testid="composer-input"]` | `div[role="textbox"][contenteditable="true"]`, `div[aria-label*="Ask Meta AI"]`, `div[aria-label*="Pergunte"]` | `form div[contenteditable="true"]`, `.composer [contenteditable="true"]` | Alta | Editor Lexical com `contenteditable="true"`. Exige foco no elemento e digitacao sintetica via CDP. |
| Botao Enviar (`sendBtn`) | `button[data-testid="composer-send-button"]` | `button[aria-label="Enviar"]`, `button[aria-label="Send"]`, `button[aria-label*="Enviar"]` | `button:has(svg)` junto ao composer | Alta | Habilitado quando ha texto preenchido no compositor. |
| Botao Parar (`stopBtn`) | `button[data-testid="composer-stop-button"]` | `button[aria-label="Parar"]`, `button[aria-label="Stop"]`, `button[aria-label*="Parar"]` | `button:has(svg rect)` junto ao composer | Media | Visivel durante a geracao da resposta. Desaparecimento sinaliza conclusao. |
| Bloco de Resposta (`response`) | `div[data-testid="assistant-message"] .prose.ur-markdown`, `div[data-testid="assistant-message"]` | `div[role="region"][aria-label*="Assistant"]`, `div[role="region"][aria-label*="Meta AI"]` | `.ur-markdown.markdown-content`, `div.prose.ur-markdown` | Alta | Conteudo Markdown renderizado dentro de `assistant-message`. Em conversas continuadas, seleciona o ultimo bloco. |
| Filtro de Raciocinio (`thoughtFilter`) | `div[data-testid="thinking-status"]`, `[data-testid="thinking-status"]` | `div[aria-label*="thinking"]`, `div[aria-label*="raciocinio"]` | `.thinking-status`, `div:has-text("Mostrar raciocinio")` | Media | Indicador de raciocinio intermediario do modelo; deve ser descartado na extracao final. |
| Citacoes / Fontes (`citations`) | `a[data-testid="citation-pill"]`, `a[data-citation-urls]` | `div[data-testid="assistant-message"] a[target="_blank"][href^="http"]` | `.prose.ur-markdown a[href^="http"]` | Alta | Pilulas de citacao contendo URLs de fontes no atributo `data-citation-urls` ou no atributo `href`. |
| Nova Conversa (`newChatBtn`) | `a[data-testid="new-chat-button"]`, `a[href="/?new=1"]` | `a[aria-label="Nova conversa"]`, `a[aria-label="New chat"]`, `button[aria-label*="Nova conversa"]` | `nav a[href="/"]`, `header a[href*="new"]` | Alta | Inicia um novo topico redirecionando com parametro `?new=1`. |
| Verificacao de Autenticacao (`isLoggedIn`) | `button[data-testid="user-menu-button"]` | `button[aria-label*="Perfil"]`, `button[aria-label*="Profile"]`, `button[aria-label*="Menu"]` | `header button:has(img)` | Alta | Identifica usuario autenticado pela presenca do menu do usuario no header. |

### Regras Criticas do Meta AI
- **Extracao de Citacoes em data-citation-urls:** As referencias externas em `a[data-testid="citation-pill"]` podem armazenar a URL destino prioritariamente no atributo `data-citation-urls`. A extracao deve inspecionar tanto `data-citation-urls` quanto `href`.
- **Filtro de Botoes em Blocos de Codigo:** Elementos `<pre class="ur-sm-code">` contem botoes inline (`<button>Copiar</button>`). O extrator de texto deve ignorar textos de elementos interativos para manter o bloco de codigo integro.

---

## 8. Groq Chat (https://chat.groq.com/?model=qwen/qwen3.8-27b)

Provedor homologado para a interface web de inferencia em hardware LPU do Groq Chat.

| Acao / Elemento | Nivel 1 (Semantico) | Nivel 2 (Aria / I18n) | Nivel 3 (Estrutural / Classes) | Grau de Confianca | Observacoes |
|---|---|---|---|---|---|
| Campo de entrada (`input`) | `textarea#chat`, `textarea[placeholder="Try it"]` | `textarea[role="textbox"]`, `textarea[placeholder*="Try it"]`, `textarea[placeholder*="pergunte"]` | `form textarea`, `textarea` | Alta | Elemento textarea nativo padrao. Suporta foco e insercao via CDP `Input.insertText` ou digitacao. |
| Botao Enviar (`sendBtn`) | `button[type="submit"]:has(svg path[d*="M120-160v-240l320-80"])`, `button[type="submit"]` | `button[aria-label="Submit message"]`, `button[aria-label*="Submit"]`, `button[aria-label*="Enviar"]` | `form button:has(svg)` | Alta | Botao de submit dentro do formulario do compositor. |
| Botao Limpar / Nova Conversa (`newChatBtn`) | `button:has-text("Clear chat")`, `button:has-text("Clear")` | `button[aria-label*="Clear chat"]`, `button[aria-label*="Limpar"]` | `header button` | Alta | Limpa a conversa atual no Groq Chat mantendo o modelo selecionado. |
| Seletor de Modelo (`modelBadge` / `modelSelector`) | `button:has(svg.lucide-chevrons-up-down)`, `[role="option"][data-value]` | `button[aria-label*="Select model"]`, `button[aria-label*="model"]` | `header button:has(svg)` | Alta | Menu suspenso para alternancia de modelo via parametro de URL `?model=` ou clique na opcao desejada. |
| Bloco de Resposta (`response`) | `div.font-inter.pl-10px`, `div[class*="font-inter"][class*="pl-10px"]` | `div[role="region"][aria-label*="Response"]`, `div.assistant-turn div.font-inter` | `.chat-thread .assistant-turn`, `div.font-inter` | Alta | Container da resposta renderizada do Groq. Contem paragrafos, tabelas (`<table>`), blocos de codigo (`pre code`) e links externos. |
| Citacoes / Fontes (`citations`) | `div.font-inter.pl-10px a[target="_blank"][href^="http"]` | `div.font-inter a[target="_blank"]` | `a[href^="http"]` | Alta | Links externos referenciados na resposta. |
| Verificacao de Autenticacao (`isLoggedIn`) | `footer button:has-text("@")`, `footer button` | `button[aria-label*="User profile"]`, `footer button` | `footer` | Alta | Presenca do botao de perfil do usuario com email no rodape indica sessao autenticada. |

### Regras Criticas do Groq Chat
- **Bloqueio do modelo arabe padrao:** O Groq Chat pode carregar por padrao o modelo `canopylabs/orpheus-arabic-saudi` em certas instancias ou quando a URL nao contem parametros. Este modelo deve ser estritamente bloqueado. A navegacao deve sempre forcar o parametro explicito de modelo recomendado: `https://chat.groq.com/?model=qwen/qwen3.8-27b`.
- **Cadeia de Fallback em Erro 429 (Rate Limit):** Em caso de esgotamento de quota ou erro 429 retornado pela infraestrutura da Groq, o driver deve aplicar a seguinte sequencia deterministica de fallback:
  `qwen/qwen3.8-27b` -> `openai/gpt-oss-120b` -> `qwen/qwen3.6-27b` -> `openai/gpt-oss-20b`.

---

## 9. Grok / xAI (https://grok.com/)

Provedor homologado para a interface web de conversacao do Grok (xAI).

| Acao / Elemento | Nivel 1 (Semantico) | Nivel 2 (Aria / I18n) | Nivel 3 (Estrutural / Classes) | Grau de Confianca | Observacoes |
|---|---|---|---|---|---|
| Campo de entrada (`input`) | `div.tiptap.ProseMirror[contenteditable="true"]`, `div.tiptap[role="textbox"]` | `div[role="textbox"][contenteditable="true"]`, `div[aria-label*="Grok"]`, `div[aria-label*="Ask"]` | `.tiptap`, `div[contenteditable="true"]` | Alta | Editor baseado em TipTap / ProseMirror com `contenteditable="true"`. Requer foco e digitacao sintetica via CDP. |
| Botao Enviar (`sendBtn`) | `button[data-testid="chat-submit"][data-composer-action="send"]`, `button[data-testid="chat-submit"]` | `button[aria-label="Send"]`, `button[aria-label="Enviar"]`, `button[type="submit"]` | `footer button:has(svg)` | Alta | Habilitado quando ha texto preenchido no editor TipTap. |
| Botao Parar (`stopBtn`) | `button[data-composer-action="stop"]`, `button[data-testid="chat-stop"]` | `button[aria-label="Stop"]`, `button[aria-label="Parar"]` | `button:has(svg rect)` | Media | Visivel durante a geracao da resposta. Desaparecimento sinaliza conclusao. |
| Seletor de Modelo / Modo (`modelBadge` / `modelSelector`) | `button#model-select-trigger`, `button[id="model-select-trigger"]` | `button[aria-label*="Modelo: Fast"]`, `button[aria-label*="Modelo"]`, `button[aria-label*="Model"]` | `header button` | Alta | Gatilho de selecao de modo de inferencia gratuito (`Fast` ou `Build`). |
| Nova Conversa (`newChatBtn`) | `button[aria-label="Novo bate-papo"]`, `button[aria-label="New chat"]` | `button[aria-label*="bate-papo"]`, `button[aria-label*="chat"]` | `header button:first-child`, `a[href="/"]` | Alta | Inicia nova sessao limpa de conversa no Grok. |
| Anexo de Arquivo (`fileInput`) | `input[type="file"][name="files"]` | `input[type="file"][multiple]` | `input[type="file"]` | Alta | Input de arquivo nativo manipulado via CDP `page.setInputFiles`. |
| Bloco de Resposta (`response`) | `div[data-testid="assistant-message"] .response-content-markdown`, `.response-content-markdown` | `div[role="article"] .response-content-markdown`, `div[data-testid="assistant-message"]` | `.message-bubble .response-content-markdown`, `.message-bubble` | Alta | Conteudo Markdown renderizado da resposta do Grok. |
| Filtro de Raciocinio (`thoughtFilter`) | `div[data-testid="conversation-thought"]`, `[data-testid="conversation-thought"]` | `div[aria-label*="thought"]`, `div[aria-label*="pensou"]` | `.thought-container`, `div:has-text("Pensou por")` | Alta | Bloco de raciocinio intermediario isolado ("Pensou por X s"). Fica separado de `.response-content-markdown` e deve ser rigorosamente descartado da extracao final. |
| Citacoes / Fontes (`citations`) | `.response-content-markdown a[href^="http"]` | `div[data-testid="assistant-message"] a[target="_blank"]` | `a[href^="http"]:not([href*="grok.com"])` | Alta | Links externos referenciados no Markdown da resposta. |

### Regras Criticas do Grok / xAI
- **Modos Gratuitos e Bloqueio de Modos Pagos:** Apenas os modos gratuitos `Fast` e `Build` sao homologados e permitidos. Os modos pagos (`Auto`, `Expert`, `Heavy`) sao estritamente bloqueados para prevenir cobrancas indevidas ou bloqueios de assinatura.
- **Isolamento de Raciocinio vs Conteudo:** O elemento `div[data-testid="conversation-thought"]` reside fora de `div.response-content-markdown`. A extracao deve mirar diretamente em `div.response-content-markdown` para obter exclusivamente a resposta limpa sem o indicador de pensamento previo.

---

## 10. Deteccao de Anomalias e Desafios de Seguranca

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

## 11. Ciclo de Vida de Espera de Conclusao (waitDone)

O metodo `waitDone` combina tres sinais complementares para determinar o encerramento da resposta sem depender de polling estatico longo:

1. **Aparecimento e desaparecimento do botao Stop:** Durante o streaming, o botao Stop fica visivel. O sumico do botao e o primeiro indicador de termino.
2. **Estabilizacao do MutationObserver:** Quando nenhuma nova mutacao de texto ocorre por um periodo de amortecimento (debounce de 400ms a 600ms).
3. **Timeout maximo de guarda:** Timeout configuravel (padrao 120s) com cancelamento cooperativo via `AbortSignal`.

---

## 12. Conexao CDP e Politica de Isolamento de Rede

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
| Microsoft Copilot | `button.fai-SendButton[aria-label*="Parar"]` | `[data-testid="copilot-message-div"] [data-testid="markdown-reply"]` | `[data-testid="markdown-reply"] a.fui-Link` (nivel 1, Alta) |
| Meta AI | `button[data-testid="composer-stop-button"]` | `div[data-testid="assistant-message"] .prose.ur-markdown` | `a[data-testid="citation-pill"]` (via `data-citation-urls` / `href`, nivel 1, Alta) |
| Groq | `button:has-text("Clear chat")` | `div.font-inter.pl-10px` | `div.font-inter.pl-10px a[target="_blank"]` (nivel 1, Alta) |
| Grok | `button[data-composer-action="stop"]` / `button[data-testid="chat-stop"]` | `div[data-testid="assistant-message"] .response-content-markdown` | `.response-content-markdown a[href^="http"]` (nivel 1, Alta) |

Armadilhas encontradas: (1) seletor de resposta que tambem casa com a bolha da pergunta do usuario (Perplexity); (2) seletor de resposta que casa com blocos internos e o "ultimo elemento" fica pequeno (DeepSeek); (3) link de aviso legal contado como fonte (Claude); (4) links de busca do Google contados como fonte (Gemini); (5) paginas que mutam o DOM sem parar (Perplexity), por isso a conclusao usa o texto estavel; (6) seletor de baixa confianca (nivel 3) que casa com qualquer botao de icone e clica no lugar errado (Gemini): por isso envio, nova conversa e botao parar usam so os niveis 1 e 2, e sem eles o envio usa a tecla Enter; (7) em conversa continuada o texto da resposta anterior ja esta na tela: o `waitDone` registra um baseline antes de enviar e so conclui com uma resposta nova; (8) Copilot: o editor e um elemento `span` (`#m365-chat-editor-target-element`), exigindo foco explicito e descartando cabecalho `.fai-CopilotMessage__accessibleHeading` e sugestoes `.fai-Suggestion`; (9) Meta AI: links de fontes podem vir encapsulados no atributo `data-citation-urls` da pilula de citacao alem de `href`, e blocos de codigo contem botoes de copia inline que precisam ser filtrados; (10) Groq: o modelo padrao pode vir como canopylabs/orpheus-arabic-saudi se a URL nao especificar o modelo, exigindo forcar ?model=qwen/qwen3.8-27b e cadeia de fallback em erro 429; (11) Grok: modos pagos (Auto/Expert/Heavy) devem ser bloqueados restringindo-se aos modos gratuitos Fast e Build, e o bloco conversation-thought deve ser isolado de response-content-markdown.

`cancel_chat` validado em geracao real (Gemini e Perplexity): a chamada pendente retorna `CANCELLED`, o botao parar e acionado e o lease da aba e liberado.
