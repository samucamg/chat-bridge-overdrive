# DOM Selector Mapping and Driver Contract

Portuguese version: [SELETORES.md](SELETORES.md)

Technical documentation of selectors in 3 resilience levels for the providers supported by `chat-overdrive-bridge`, and of the anomaly and challenge detection mechanisms.

---

## 3-Level Selection Strategy

To maximize stability against layout updates of the web interfaces, the drivers must locate elements by applying the following cascade:

1. **Level 1 (Semantic and Data):** Stable data attributes (`data-testid`, `data-workflow-*`, `data-lexical-editor`), W3C roles and semantic IDs.
2. **Level 2 (Multi-language ARIA):** Accessibility attributes (`aria-label`, `title`) covering language variants (pt-BR, en-US, es).
3. **Level 3 (Structural and Fallback):** Hierarchy of container tags, known SVG icons and secondary CSS classes.

---

## 1. Perplexity (perplexity.ai)

Provider verified by live inspection via Chrome DevTools.

| Action / Element | Level 1 (Semantic) | Level 2 (ARIA / I18n) | Level 3 (Structural / SVG) | Confidence Level | Notes |
|---|---|---|---|---|---|
| Input field (Prompt) | `div[role="textbox"][data-lexical-editor="true"]` | `div[contenteditable="true"][aria-label*="Ask"]`, `div[contenteditable="true"][aria-label*="Pergunte"]` | `textarea[placeholder*="Ask"]`, `div[contenteditable="true"]` | High | Based on the Lexical editor. Requires focus and `Input.insertText` via CDP. |
| Submit button | `button[type="submit"]` | `button[aria-label="Enviar"]`, `button[aria-label="Submit"]` | `button:has(svg path[d*="M"])` at the footer of the text box | High | Enabled only when there is text filled in. |
| Stop button | `button[data-testid="stop-button"]` | `button[aria-label*="Interromper"]` (validated live), `button[aria-label="Parar"]`, `button[aria-label="Stop"]` | `button svg use[href*="player-stop"]`, `#pplx-icon-player-stop` | Medium (Inferred) | Present during response streaming. Its disappearance signals completion. |
| Response block | `div[data-workflow-final-text] div[data-renderer="lm"]` | `div[data-testid="answer-content"]` | `div.prose[data-renderer="lm"]`, `div[data-workflow-entry]` | High | Contains the rendered Markdown of the final response. |
| Citations / Sources | `span[data-pplx-citation]`, `a[data-pplx-citation-url]` | `a[target="_blank"][rel*="noreferrer"]` inside the response | `div[data-testid="sources-list"] a` | High | Extract the anchor text and the `href` attribute. |
| New Chat (New Thread) | `a[href="/"]` with edit icon | `a[aria-label="Novo"]`, `a[aria-label="New Thread"]` | `button:has(svg[aria-label*="New"])`, `nav a[href="/"]` | High | Clears the context and starts a new chat. |
| Thinking indicator | `div[data-workflow-thought]`, `div[data-testid="thinking"]` | `details[aria-label*="Thinking"]` | `div:has(svg.animate-spin)` | Medium | Must be filtered so it does not pollute the final text. |

### Perplexity Critical Rules
- **Text insertion:** Do not assign `.value` or `.innerText` directly to the Lexical element, because React/Lexical ignores synthetic DOM changes and the submit button stays disabled. The correct procedure is:
  1. Call `.focus()` on the input field selector.
  2. Dispatch the CDP command `Input.insertText` or `page.keyboard.type(prompt)`.

---

## 2. Gemini (gemini.google.com)

Provider adapted from Argon and antigravity-bridge (reuse of proven selectors).

| Action / Element | Level 1 (Semantic) | Level 2 (ARIA / I18n) | Level 3 (Structural / Classes) | Confidence Level | Notes |
|---|---|---|---|---|---|
| Input field (Composer) | `rich-textarea [contenteditable="true"]` | `[contenteditable="true"][role="textbox"]` | `div.input-area [contenteditable="true"]` | Medium | Google renders it inside the custom element `rich-textarea`. |
| Submit button | `button[data-test-id="send-button"]` | `button[aria-label="Send message"]`, `button[aria-label="Enviar mensagem"]` | `button.send-button` | Medium | Enabled when a draft is filled in. |
| Stop button | `button[data-test-id="stop-button"]` | `button[aria-label*="Stop"]`, `button[aria-label*="Parar"]` | `button.stop-button` | Medium | Visible during response generation. |
| Response block | `model-response` | `div[role="region"][aria-label*="Response"]` | `div.model-response-text`, `message-content` | Medium | Filter out nested thinking blocks. |
| Reasoning filter | `model-thoughts`, `thinking-panel` | `[data-test-id="thinking-content"]` | `details.thinking-details` | Medium | Must be explicitly excluded from the final text extraction. |
| Model selector | `[data-test-id="bard-mode-menu-button"]` | `button[aria-label*="model"]`, `button[aria-label*="modelo"]` | `.model-switcher` | Medium | Used for auditing and confirming the active model. |
| New Chat | `a[data-test-id="new-chat-button"]` | `button[aria-label*="New chat"]`, `button[aria-label*="Novo chat"]` | `nav a[href="/app"]` | Medium | Resets the conversation context. |

### Gemini Critical Rules
- **Reasoning and variable headers:** Some Gemini responses contain `model-thoughts` or `thinking-panel` blocks that change state continuously during generation. Final text extraction must scan `.model-response-text` while ignoring any ancestor or descendant node that belongs to `model-thoughts` or `[data-test-id="thinking-content"]`.

---

## 3. ChatGPT (https://chatgpt.com/)

Provider adapted from Argon and chat-bridge (selectors extracted from the base projects, pending live verification).

| Action / Element | Level 1 (Semantic) | Level 2 (ARIA / I18n) | Level 3 (Structural / Classes) | Confidence Level | Notes |
|---|---|---|---|---|---|
| Input field (`input`) | `#prompt-textarea.ProseMirror`, `#prompt-textarea[contenteditable="true"]` | `div[id="prompt-textarea"][role="textbox"]`, `[contenteditable="true"][aria-label*="mensagem"]`, `[contenteditable="true"][aria-label*="message"]` | `div.ProseMirror[contenteditable="true"]`, `#prompt-textarea` | Medium | ProseMirror-based editor. Requires focus on the element before sending. |
| Submit button (`sendBtn`) | `button[data-testid="send-button"]` | `button[aria-label="Enviar prompt"]`, `button[aria-label="Send prompt"]`, `button[aria-label*="Enviar"]`, `button[aria-label*="Send"]` | `button:has(svg path[d*="M"])` | Medium | Enabled when there is content in the ProseMirror editor. |
| Stop button (`stopBtn`) | `button[data-testid="stop-button"]` | `button[aria-label="Parar geracao"]`, `button[aria-label="Stop generating"]`, `button[aria-label*="Parar"]`, `button[aria-label*="Stop"]` | `button:has(rect)`, `button[aria-label*="stop"]` | Medium | Visible during response generation. Its disappearance signals completion. |
| Response block (`response`) | `[data-markdown-text-style="assistant-message"]`, `[data-message-author-role="assistant"] .markdown.prose`, `[data-message-author-role="assistant"] .markdown` | `article [data-message-author-role="assistant"] div.markdown` | `div[data-message-author-role="assistant"]` | Medium | Main content of the assistant's response, rendered as Markdown. |
| Reasoning filter (`thoughtFilter`) | `details[data-testid="reasoning-panel"]`, `.result-thinking` | `details[aria-label*="Thinking"]`, `details[aria-label*="Raciocinio"]` | `details.thinking-details`, `.reasoning-content` | Medium | Internal reasoning of the o1/o3 models; must be explicitly discarded during extraction. |
| Citations / Sources (`citations`) | `a[data-testid="webpage-citation"]`, `a.citation-pill` | `[data-message-author-role="assistant"] a[target="_blank"][href^="http"]` | `article a[target="_blank"]` | Medium | External web search links integrated into the response. |
| New Chat (`newChatBtn`) | `a[data-testid="create-new-chat-button"]`, `button[data-testid="create-new-chat-button"]` | `a[aria-label="Novo chat"]`, `a[aria-label="New chat"]`, `button[aria-label*="Novo chat"]` | `a[href="/"]` | Medium | Redirects to a clean session at the application root. |
| File attachment (`fileInput`) | `input#file-upload[type="file"]` | `input[type="file"][multiple]` | `input[type="file"]` | Medium | Hidden input used for file attachment via CDP `page.setInputFiles`. |
| Model selector (`modelBadge`) | `button[data-testid="model-switcher-dropdown-button"]` | `button[aria-label*="model"]`, `button[aria-label*="modelo"]` | `header button:has-text("ChatGPT")` | Medium | Identifier and selector of the active model (e.g., ChatGPT 4o). |

### ChatGPT Critical Rules
- **Reasoning filtering (o1/o3):** The reasoning panel (`details[data-testid="reasoning-panel"]` or `.result-thinking`) must be filtered and removed from the final text during extraction so that only the assistant's useful content is returned.
- **ProseMirror editor:** The `#prompt-textarea` element uses ProseMirror with `contenteditable="true"`. Safe interaction requires focusing the element and typing via CDP/Playwright to trigger the framework's synthetic events.
- **Confidence Level:** All ChatGPT selectors were initially classified as `Medium`, pending live verification with a real browser via the `doctor` routine.

---

## 4. Claude Web (https://claude.ai/)

Provider adapted from antigravity-bridge (selectors extracted from the base projects, pending live verification).

| Action / Element | Level 1 (Semantic) | Level 2 (ARIA / I18n) | Level 3 (Structural / Classes) | Confidence Level | Notes |
|---|---|---|---|---|---|
| Input field (`input`) | `fieldset div.ProseMirror[contenteditable="true"]`, `div.ProseMirror[contenteditable="true"]` | `div[contenteditable="true"][role="textbox"]`, `[aria-label*="Claude"]`, `[aria-label*="mensagem"]` | `div.ProseMirror`, `fieldset [contenteditable="true"]` | Medium | ProseMirror editor contained in a `fieldset`. Requires focus and typing via CDP. |
| Submit button (`sendBtn`) | `button[data-testid="send-button"]` | `button[aria-label="Enviar mensagem"], button[aria-label="Send Message"]`, `button[aria-label*="Enviar"]`, `button[aria-label*="Send"]` | `fieldset button:has(svg)` | Medium | Enabled when there is text filled in the editor. |
| Stop button (`stopBtn`) | `button[data-testid="stop-button"]` | `button[aria-label="Parar resposta"], button[aria-label="Stop Response"]`, `button[aria-label*="Parar"]`, `button[aria-label*="Stop"]` | `button:has(svg rect)`, `button.stop-btn` | Medium | Visible during Claude's response streaming. Its disappearance signals completion. |
| Response block (`response`) | `.font-claude-message`, `[data-testid="chat-message-text"]`, `div.font-claude-message` | `div[data-is-streaming] .font-claude-message`, `article .font-claude-message` | `div.font-user-message ~ div.font-claude-message`, `.grid .font-claude-message` | Medium | Main block of the response generated by Claude. |
| Reasoning filter (`thoughtFilter`) | `div.thinking-block`, `[data-testid="thinking-block"]`, `div[data-testid="thinking-block"]` | `div[aria-label*="thinking"]`, `div[class*="thinking"]` | `details.thinking-details`, `.thinking-block` | Medium | Extended thinking block; must be explicitly discarded during extraction. |
| Citations / Sources (`citations`) | `.font-claude-message a[target="_blank"][href^="http"]` | `article a[target="_blank"][href^="http"]` | `a[href^="http"]:not([href*="claude.ai"])` | Medium | External links and sources cited in the body of the response. |
| New Chat (`newChatBtn`) | `a[href="/new"]`, `a[data-testid="new-chat-button"]` | `a[aria-label="Nova conversa"]`, `a[aria-label="New chat"]`, `button[aria-label*="Nova conversa"]` | `nav a[href="/new"]`, `header a[href="/new"]` | Medium | Clears the current conversation and opens a new chat window. |
| File attachment (`fileInput`) | `input[type="file"][data-testid="file-upload"]` | `input[type="file"][multiple]`, `input[type="file"]` | `input[type="file"]` | Medium | Hidden input manipulated directly via CDP `page.setInputFiles`. |
| Model selector (`modelBadge`) | `button[data-testid="model-selector-dropdown"]` | `button[aria-label*="model"]`, `button[aria-label*="modelo"]` | `button:has-text("Claude")` | Medium | Identifier and dropdown menu for selecting the active model (e.g., Claude 3.7 Sonnet). |

### Claude Web Critical Rules
- **Extended reasoning filtering:** The `div.thinking-block` or `[data-testid="thinking-block"]` container holds the model's intermediate reasoning. It must be filtered and removed from the final text before the response is returned to the MCP client.
- **Fieldset structure:** Claude's ProseMirror editor usually resides inside a `<fieldset>` element. DOM navigation must respect this hierarchy without assuming standard forms.

---

## 5. DeepSeek (https://chat.deepseek.com/)

Provider adapted from antigravity-bridge (selectors extracted from the base projects, pending live verification).

| Action / Element | Level 1 (Semantic) | Level 2 (ARIA / I18n) | Level 3 (Structural / Classes) | Confidence Level | Notes |
|---|---|---|---|---|---|
| Input field (`input`) | `textarea#chat-input`, `textarea[placeholder*="DeepSeek"]` | `textarea[role="textbox"]`, `textarea[placeholder*="mensagem"]`, `textarea[placeholder*="message"]` | `textarea`, `div.chat-input textarea` | Medium | Standard textarea element. Supports focus and insertion via CDP. |
| Submit button (`sendBtn`) | `div[data-testid="send-button"][role="button"]`, `button[data-testid="send-button"]` | `div[role="button"][aria-label="Enviar"]`, `div[role="button"][aria-label="Send"]`, `div.ds-icon-button[aria-label*="Enviar"]` | `div.ds-icon-button:has(svg)`, `button:has(svg)` | Medium | Custom div with `role="button"` and `aria-disabled="false"` when active. |
| Stop button (`stopBtn`) | `button[data-testid="stop-button"]`, `div[data-testid="stop-button"]` | `button[aria-label="Parar"]`, `button[aria-label="Stop"]`, `div[role="button"][aria-label*="Parar"]` | `button:has(rect)`, `.ds-stop-button` | Medium | Visible during reasoning execution or response generation. |
| Response block (`response`) | `.ds-markdown`, `div.ds-markdown` | `div.ds-message .ds-markdown`, `.ds-answer-content` | `div[class*="markdown"]`, `div.ds-message` | Medium | Markdown block containing DeepSeek's structured response. |
| Reasoning filter (`thoughtFilter`) | `div.ds-think-content`, `.ds-think-content` | `div[class*="think-content"]`, `div.ds-think` | `details.think`, `div:has(.ds-think)` | Medium | DeepSeek R1 chain of thought; must be explicitly discarded from the final response. |
| Citations / Sources (`citations`) | `a.ds-citation`, `a[data-testid="ds-citation"]` | `.ds-markdown a[target="_blank"][href^="http"]` | `a[target="_blank"][href^="http"]` | Medium | External links and sources referenced in the response. |
| New Chat (`newChatBtn`) | `div[data-testid="new-chat-button"]`, `button[data-testid="new-chat-button"]` | `div[role="button"][aria-label="New chat"]`, `div[role="button"][aria-label="Novo chat"]`, `div[aria-label*="Novo chat"]` | `div.ds-new-chat`, `a[href="/"]` | Medium | Creates a new conversation session in the web interface. |
| Model selector (`modelBadge`) | `div[data-testid="model-selector"]`, `div.ds-model-switch` | `div[aria-label*="model"]`, `div[aria-label*="modelo"]` | `div:has-text("DeepSeek")` | Medium | Indicator and badge of the active model (e.g., DeepSeek R1). |

### DeepSeek Critical Rules
- **R1 chain of thought:** The `div.ds-think-content` container holds DeepSeek R1's internal reasoning chain. This section must be excluded entirely during final text extraction (`extractAnswer`).
- **Custom buttons with role="button":** DeepSeek often uses `div` elements styled with `role="button"` and `aria-disabled` attributes instead of native `<button>` tags. Selector resolution must accommodate this flexibility.

---

## 6. Microsoft Copilot (https://copilot.cloud.microsoft/ or https://copilot.microsoft.com/)

Homologated provider for Microsoft Copilot enterprise and web interface based on Fluent UI components and Lexical editor.

| Action / Element | Level 1 (Semantic) | Level 2 (Aria / I18n) | Level 3 (Structural / Classes) | Confidence Level | Remarks |
|---|---|---|---|---|---|
| Input Field (`input`) | `#m365-chat-editor-target-element`, `span[data-lexical-editor="true"][role="textbox"]` | `[role="textbox"][aria-label*="mensagem"]`, `[role="textbox"][aria-label*="message"]`, `[role="textbox"][aria-label*="Pergunte"]` | `.fai-BebopLiteChatInput [contenteditable="true"]`, `.fai-BebopLiteChatInput span` | High | Editor Lexical montado em elemento span dentro de `.fai-BebopLiteChatInput`. Requer foco e digitacao sintetica via CDP. |
| Send Button (`sendBtn`) | `button.fai-BebopLiteChatInput__send`, `button[type="submit"].fai-SendButton` | `button[aria-label="Enviar"]`, `button[aria-label="Send"]`, `button[aria-label*="Enviar"]` | `.fai-BebopLiteChatInput button:has(svg.fai-SendButton__sendIcon)` | High | Enabled when there is text content entered in the Lexical editor. |
| Stop Button (`stopBtn`) | `button.fai-SendButton:not(.fai-BebopLiteChatInput__send)` | `button[aria-label="Parar de gerar"]`, `button[aria-label="Stop generating"]`, `button[aria-label*="Parar"]` | `button.fai-SendButton:has(svg rect)` | Medium | Visible during response generation. Disappearance signals completion. |
| Response Block (`response`) | `[data-testid="copilot-message-div"] [data-testid="markdown-reply"]`, `[data-testid="copilot-message-div"]` | `div[role="region"][aria-label*="Copilot"]` | `.fai-CopilotMessage__content [data-testid="markdown-reply"]`, `.fai-CopilotMessage__content` | High | Rendered Markdown content in Copilot turn. In multi-turn sessions, selects the last turn. |
| Suggestions / Headings Filter (`filter`) | `.fai-Suggestion`, `.fai-CopilotMessage__accessibleHeading` | `[aria-label*="suggestion"]`, `[aria-label*="sugestao"]` | `.fai-CopilotMessage__content > .fai-Suggestion`, `h6.fai-CopilotMessage__accessibleHeading` | High | Prompt suggestions and accessible headings ("Copilot said:") discarded from clean extraction. |
| Citations / Sources (`citations`) | `[data-testid="markdown-reply"] a.fui-Link`, `[data-testid="copilot-message-div"] a.fui-Link` | `[data-testid="markdown-reply"] a[target="_blank"][href^="http"]` | `.fai-CopilotMessage__content a[href^="http"]` | High | Links de citacao e fontes externas estilizados com componentes Fluent UI (`fui-Link`). |
| New Chat (`newChatBtn`) | `a.fui-NavItem.spa-link[href*="/chat?es=Click"]`, `a.fui-NavItem[href*="/chat"]` | `a[aria-label="Novo chat"]`, `a[aria-label="New chat"]`, `button[aria-label*="Novo chat"]` | `nav a[href*="chat"]`, `.spa-link` | High | Clears conversation context and starts a new thread. |
| File Attachment (`fileInput`) | `input#upload-file-button[type="file"]` | `input[type="file"][multiple]` | `input[type="file"]` | High | Elemento input de upload de arquivos manipulado via CDP `page.setInputFiles`. |

### Critical Rules for Microsoft Copilot
- **Lexical Editor on span element:** O editor utiliza a tag `span` (`#m365-chat-editor-target-element`) com `data-lexical-editor="true"`. O envio requer `.focus()` e `Input.insertText` ou `page.keyboard.type()`, evitando atribuicao direta a `.innerText`.
- **Turn and Suggestions Cleanup:** As mensagens do Copilot residem em `[data-testid="copilot-message-div"]`. Deve-se selecionar sempre o ultimo container da lista em conversas multi-turn e filtrar rigorosamente `.fai-Suggestion` e `.fai-CopilotMessage__accessibleHeading`.

---

## 7. Meta AI (https://www.meta.ai/)

Homologated provider for Meta AI web interface based on Lexical and Tailwind/Prose.

| Action / Element | Level 1 (Semantic) | Level 2 (Aria / I18n) | Level 3 (Structural / Classes) | Confidence Level | Remarks |
|---|---|---|---|---|---|
| Input Field (`input`) | `div[data-testid="composer-input"][data-lexical-editor="true"]`, `[data-testid="composer-input"]` | `div[role="textbox"][contenteditable="true"]`, `div[aria-label*="Ask Meta AI"]`, `div[aria-label*="Pergunte"]` | `form div[contenteditable="true"]`, `.composer [contenteditable="true"]` | High | Editor Lexical com `contenteditable="true"`. Requires element focus and synthetic typing via CDP. |
| Send Button (`sendBtn`) | `button[data-testid="composer-send-button"]` | `button[aria-label="Enviar"]`, `button[aria-label="Send"]`, `button[aria-label*="Enviar"]` | `button:has(svg)` junto ao composer | High | Enabled when there is text populated in composer. |
| Stop Button (`stopBtn`) | `button[data-testid="composer-stop-button"]` | `button[aria-label="Parar"]`, `button[aria-label="Stop"]`, `button[aria-label*="Parar"]` | `button:has(svg rect)` junto ao composer | Medium | Visible during response generation. Disappearance signals completion. |
| Response Block (`response`) | `div[data-testid="assistant-message"] .prose.ur-markdown`, `div[data-testid="assistant-message"]` | `div[role="region"][aria-label*="Assistant"]`, `div[role="region"][aria-label*="Meta AI"]` | `.ur-markdown.markdown-content`, `div.prose.ur-markdown` | High | Conteudo Markdown renderizado dentro de `assistant-message`. Em conversas continuadas, seleciona o ultimo bloco. |
| Reasoning Filter (`thoughtFilter`) | `div[data-testid="thinking-status"]`, `[data-testid="thinking-status"]` | `div[aria-label*="thinking"]`, `div[aria-label*="raciocinio"]` | `.thinking-status`, `div:has-text("Mostrar raciocinio")` | Medium | Model intermediate reasoning indicator; must be discarded in final extraction. |
| Citations / Sources (`citations`) | `a[data-testid="citation-pill"]`, `a[data-citation-urls]` | `div[data-testid="assistant-message"] a[target="_blank"][href^="http"]` | `.prose.ur-markdown a[href^="http"]` | High | Pilulas de citacao contendo URLs de fontes no atributo `data-citation-urls` ou no atributo `href`. |
| New Chat (`newChatBtn`) | `a[data-testid="new-chat-button"]`, `a[href="/?new=1"]` | `a[aria-label="Nova conversa"]`, `a[aria-label="New chat"]`, `button[aria-label*="Nova conversa"]` | `nav a[href="/"]`, `header a[href*="new"]` | High | Inicia um novo topico redirecionando com parametro `?new=1`. |
| Authentication Check (`isLoggedIn`) | `button[data-testid="user-menu-button"]` | `button[aria-label*="Perfil"]`, `button[aria-label*="Profile"]`, `button[aria-label*="Menu"]` | `header button:has(img)` | High | Identifies authenticated user by the presence of the user menu in header. |

### Critical Rules for Meta AI
- **Citation Extraction in data-citation-urls:** As referencias externas em `a[data-testid="citation-pill"]` podem armazenar a URL destino prioritariamente no atributo `data-citation-urls`. A extracao deve inspecionar tanto `data-citation-urls` quanto `href`.
- **Button Filtering in Code Blocks:** Elementos `<pre class="ur-sm-code">` contem botoes inline (`<button>Copiar</button>`). O extrator de texto deve ignorar textos de elementos interativos para manter o bloco de codigo integro.

---

## 8. Groq Chat (https://chat.groq.com/?model=qwen/qwen3.8-27b)

Provider homologated for the Groq Chat web interface powered by LPU hardware inference.

| Action / Element | Level 1 (Semantic) | Level 2 (Aria / I18n) | Level 3 (Structural / Classes) | Confidence Level | Remarks |
|---|---|---|---|---|---|
| Input Field (`input`) | `textarea#chat`, `textarea[placeholder="Try it"]` | `textarea[role="textbox"]`, `textarea[placeholder*="Try it"]`, `textarea[placeholder*="pergunte"]` | `form textarea`, `textarea` | High | Standard native textarea element. Supports focus and insertion via CDP `Input.insertText` or typing. |
| Send Button (`sendBtn`) | `button[type="submit"]:has(svg path[d*="M120-160v-240l320-80"])`, `button[type="submit"]` | `button[aria-label="Submit message"]`, `button[aria-label*="Submit"]`, `button[aria-label*="Enviar"]` | `form button:has(svg)` | High | Submit button within the composer form. |
| Clear Chat / New Chat (`newChatBtn`) | `button:has-text("Clear chat")`, `button:has-text("Clear")` | `button[aria-label*="Clear chat"]`, `button[aria-label*="Limpar"]` | `header button` | High | Clears current chat conversation on Groq while preserving the selected model. |
| Model Selector (`modelBadge` / `modelSelector`) | `button:has(svg.lucide-chevrons-up-down)`, `[role="option"][data-value]` | `button[aria-label*="Select model"]`, `button[aria-label*="model"]` | `header button:has(svg)` | High | Dropdown menu for model switching via `?model=` URL parameter or clicking the desired option. |
| Response Block (`response`) | `div.font-inter.pl-10px`, `div[class*="font-inter"][class*="pl-10px"]` | `div[role="region"][aria-label*="Response"]`, `div.assistant-turn div.font-inter` | `.chat-thread .assistant-turn`, `div.font-inter` | High | Container of rendered Groq response. Contains paragraphs, tables (`<table>`), code blocks (`pre code`), and external links. |
| Citations / Sources (`citations`) | `div.font-inter.pl-10px a[target="_blank"][href^="http"]` | `div.font-inter a[target="_blank"]` | `a[href^="http"]` | High | External links referenced in the response. |
| Authentication Check (`isLoggedIn`) | `footer button:has-text("@")`, `footer button` | `button[aria-label*="User profile"]`, `footer button` | `footer` | High | Presence of user profile button with email in the footer indicates an authenticated session. |

### Critical Rules for Groq Chat
- **Blocking default Arabic model:** Groq Chat may default to `canopylabs/orpheus-arabic-saudi` on some instances or when no URL parameters are provided. This model must be strictly blocked. Navigation must always explicitly force the recommended model parameter: `https://chat.groq.com/?model=qwen/qwen3.8-27b`.
- **Fallback Chain on Error 429 (Rate Limit):** In case of quota exhaustion or HTTP 429 error from Groq infrastructure, the driver must execute the following deterministic fallback sequence:
  `qwen/qwen3.8-27b` -> `openai/gpt-oss-120b` -> `qwen/qwen3.6-27b` -> `openai/gpt-oss-20b`.

---

## 9. Grok / xAI (https://grok.com/)

Provider homologated for the Grok (xAI) conversational web interface.

| Action / Element | Level 1 (Semantic) | Level 2 (Aria / I18n) | Level 3 (Structural / Classes) | Confidence Level | Remarks |
|---|---|---|---|---|---|
| Input Field (`input`) | `div.tiptap.ProseMirror[contenteditable="true"]`, `div.tiptap[role="textbox"]` | `div[role="textbox"][contenteditable="true"]`, `div[aria-label*="Grok"]`, `div[aria-label*="Ask"]` | `.tiptap`, `div[contenteditable="true"]` | High | Editor based on TipTap / ProseMirror with `contenteditable="true"`. Requires element focus and synthetic typing via CDP. |
| Send Button (`sendBtn`) | `button[data-testid="chat-submit"][data-composer-action="send"]`, `button[data-testid="chat-submit"]` | `button[aria-label="Send"]`, `button[aria-label="Enviar"]`, `button[type="submit"]` | `footer button:has(svg)` | High | Enabled when text is entered into the TipTap editor. |
| Stop Button (`stopBtn`) | `button[data-composer-action="stop"]`, `button[data-testid="chat-stop"]` | `button[aria-label="Stop"]`, `button[aria-label="Parar"]` | `button:has(svg rect)` | Medium | Visible during response generation. Disappearance signals completion. |
| Mode / Model Selector (`modelBadge` / `modelSelector`) | `button#model-select-trigger`, `button[id="model-select-trigger"]` | `button[aria-label*="Modelo: Fast"]`, `button[aria-label*="Modelo"]`, `button[aria-label*="Model"]` | `header button` | High | Trigger button for selecting free inference mode (`Fast` or `Build`). |
| New Chat (`newChatBtn`) | `button[aria-label="Novo bate-papo"]`, `button[aria-label="New chat"]` | `button[aria-label*="bate-papo"]`, `button[aria-label*="chat"]` | `header button:first-child`, `a[href="/"]` | High | Initiates a clean conversation session in Grok. |
| File Attachment (`fileInput`) | `input[type="file"][name="files"]` | `input[type="file"][multiple]` | `input[type="file"]` | High | Native file input handled directly via CDP `page.setInputFiles`. |
| Response Block (`response`) | `div[data-testid="assistant-message"] .response-content-markdown`, `.response-content-markdown` | `div[role="article"] .response-content-markdown`, `div[data-testid="assistant-message"]` | `.message-bubble .response-content-markdown`, `.message-bubble` | High | Rendered Markdown response content from Grok. |
| Reasoning Filter (`thoughtFilter`) | `div[data-testid="conversation-thought"]`, `[data-testid="conversation-thought"]` | `div[aria-label*="thought"]`, `div[aria-label*="pensou"]` | `.thought-container`, `div:has-text("Pensou por")` | High | Isolated intermediate reasoning block ("Pensou por X s"). Stored separately from `.response-content-markdown` and must be strictly discarded from final extraction. |
| Citations / Sources (`citations`) | `.response-content-markdown a[href^="http"]` | `div[data-testid="assistant-message"] a[target="_blank"]` | `a[href^="http"]:not([href*="grok.com"])` | High | External links referenced in the response Markdown. |

### Critical Rules for Grok / xAI
- **Free Modes and Blocking Paid Modes:** Only free modes `Fast` and `Build` are homologated and permitted. Paid modes (`Auto`, `Expert`, `Heavy`) are strictly blocked to prevent unwanted charges or subscription blocks.
- **Reasoning vs Content Isolation:** The `div[data-testid="conversation-thought"]` element resides outside `div.response-content-markdown`. Extraction must target `div.response-content-markdown` directly to retrieve only clean output without preceding thought text.

---

## 10. Anomaly Detection and Security Challenges

When any of these elements is detected, the driver must immediately stop execution and return a structured error, without entering blind retry loops.

| Challenge Type | Primary Selectors | MCP Error Code | Recommended Action |
|---|---|---|---|
| Cloudflare Turnstile | `iframe[src*="challenges.cloudflare.com"]`, `div.cf-turnstile`, `#turnstile-wrapper`, `[data-sitekey]` | `AUTH_REQUIRED` | Abort immediately. Require intervention in the visible browser. |
| Google reCAPTCHA | `iframe[src*="google.com/recaptcha"]`, `iframe[src*="recaptcha"]`, `div.g-recaptcha` | `AUTH_REQUIRED` | Abort execution. |
| Arkose FunCAPTCHA | `iframe[src*="arkoselabs.com"]`, `iframe#fc-iframe-wrap` | `AUTH_REQUIRED` | Abort execution. |
| hCaptcha | `iframe[src*="hcaptcha"]`, `div.h-captcha` | `AUTH_REQUIRED` | Abort execution. |
| Session Logged Out / Expired | `form[action*="/login"]`, `form[action*="/auth"]`, `button[data-testid="login-button"]`, `a[href*="/login"]`, `a[href*="/auth"]`, `a[href*="accounts.google.com/signin"]`, `input[type="password"]` | `AUTH_REQUIRED` | Abort immediately and instruct authentication in the local debug Chrome. |
| Temporary Block / Rate Limit | `div:has-text("Too many requests")`, `div:has-text("Muitas requisicoes")` | `TAB_BUSY` | Apply exponential backoff or wait for the cooldown window. |

### Expired Session Detection (`AUTH_REQUIRED`)
Loss of session or redirection to a login screen is identified by two complementary factors:
1. **Presence of authentication components:** Presence of forms with a login action (`form[action*="/login"]`), specific login buttons (`button[data-testid="login-button"]`) or isolated password fields (`input[type="password"]`).
2. **Absence of the chat input field:** The `isLoggedIn(page)` method checks for a match of the `selectors.input` selector. If the count is zero and/or login selectors are visible, the driver determines that there is no active session and immediately raises the `AUTH_REQUIRED` error, avoiding unnecessary timeouts and guiding the user to log in on the dedicated Chrome instance.

---

## 11. Completion Wait Lifecycle (waitDone)

The `waitDone` method combines three complementary signals to determine the end of the response without relying on long static polling:

1. **Appearance and disappearance of the Stop button:** During streaming, the Stop button is visible. Its disappearance is the first indicator of completion.
2. **MutationObserver stabilization:** When no new text mutation occurs for a damping period (debounce of 400ms to 600ms).
3. **Maximum guard timeout:** Configurable timeout (default 120s) with cooperative cancellation via `AbortSignal`.

---

## 12. CDP Connection and Network Isolation Policy

### Connection Technical Note
The CDP connection endpoint strictly requires the IPv4 loopback notation `http://127.0.0.1:9222` (rejecting `0.0.0.0`, `[::1]` or external tunnels, per security policy).

- **Security Reason:** The Chrome DevTools Protocol grants unrestricted control over inspection, execution and reading of session cookies. Exposing the port on `0.0.0.0`, binding to uncontrolled IPv6 interfaces or using external tunnels (e.g., Cloudflare Tunnels, ngrok, supergateway) violates the local isolation policy and the zero port exposure rule.
- **Runtime Validation:** The `validateCdpEndpoint` routine explicitly validates that the URL hostname is strictly `127.0.0.1` or `localhost`, aborting with the standardized `CDP_UNAVAILABLE` error if any other host address is provided.

## Live validation (homologation of 2026-11-07)

Selectors confirmed on real accounts with a fictitious prompt (short answer and long answer with sources). Provider UIs change without notice: after visible changes, rerun `chat_bridge_status` with `doctor: true` and a short round.

| Provider | Stop button (`stopBtn`) | Response (`response`) | Citations (`citations`) |
|---|---|---|---|
| Perplexity | `button[aria-label*="Interromper"]` (label "Interromper resposta (Esc)") | `div[data-workflow-final-text] div[data-renderer="lm"]`, `div[data-renderer="lm"].prose` | `span[data-pplx-citation] a` (level 1, High) |
| ChatGPT | level 2 (Medium) | `[data-markdown-text-style="assistant-message"]` | not validated (answer had no web search) |
| Gemini | level 2 (`button[aria-label*="Parar"]`, label "Parar resposta") | `model-response` | `model-response a[href^="http"]` excluding `google.com/search` |
| Claude | `button[data-testid="chat-input-stop"]` | `main .prose` / `div[data-is-streaming] .prose` | `.standard-markdown a[href^="http"]` excluding support links |
| DeepSeek | `div[role="button"].ds-button--primary:has(svg rect)` | `.ds-markdown` (container, not `ds-markdown-paragraph` nor `ds-markdown-cite`) | `.ds-markdown a` (level 1, Medium) |
| Microsoft Copilot | `button.fai-SendButton[aria-label*="Parar"]` | `[data-testid="copilot-message-div"] [data-testid="markdown-reply"]` | `[data-testid="markdown-reply"] a.fui-Link` (level 1, High) |
| Meta AI | `button[data-testid="composer-stop-button"]` | `div[data-testid="assistant-message"] .prose.ur-markdown` | `a[data-testid="citation-pill"]` (via `data-citation-urls` / `href`, level 1, High) |
| Groq | `button:has-text("Clear chat")` | `div.font-inter.pl-10px` | `div.font-inter.pl-10px a[target="_blank"]` (level 1, High) |
| Grok | `button[data-composer-action="stop"]` / `button[data-testid="chat-stop"]` | `div[data-testid="assistant-message"] .response-content-markdown` | `.response-content-markdown a[href^="http"]` (level 1, High) |

Pitfalls found: (1) a response selector that also matches the user's own question bubble (Perplexity); (2) a response selector that matches inner blocks so the "last element" is tiny (DeepSeek); (3) a legal disclaimer link counted as a source (Claude); (4) Google search links counted as sources (Gemini); (5) pages that mutate the DOM constantly (Perplexity), which is why completion relies on stable text; (6) a low-confidence (level 3) selector that matches every icon button and clicks the wrong one (Gemini): so send, new chat and the stop button use levels 1 and 2 only, and without them sending falls back to the Enter key; (7) in a continued conversation the previous answer is already on screen: `waitDone` records a baseline before sending and only completes on a new answer; (8) Copilot: the editor is a `span` element (`#m365-chat-editor-target-element`), requiring explicit focus and discarding header `.fai-CopilotMessage__accessibleHeading` and suggestions `.fai-Suggestion`; (9) Meta AI: source links may be encapsulated in `data-citation-urls` attribute of citation pill in addition to `href`, and code blocks contain inline copy buttons that must be filtered out; (10) Groq: default model may resolve to canopylabs/orpheus-arabic-saudi if URL does not specify model, requiring forcing ?model=qwen/qwen3.8-27b and fallback chain on HTTP 429; (11) Grok: paid modes (Auto/Expert/Heavy) must be blocked restricting strictly to free modes Fast and Build, and the conversation-thought block must be isolated from response-content-markdown.

`cancel_chat` validated on a real generation (Gemini and Perplexity): the pending call returns `CANCELLED`, the stop button is triggered and the tab lease is released.
