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

## 6. Anomaly Detection and Security Challenges

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

## 7. Completion Wait Lifecycle (waitDone)

The `waitDone` method combines three complementary signals to determine the end of the response without relying on long static polling:

1. **Appearance and disappearance of the Stop button:** During streaming, the Stop button is visible. Its disappearance is the first indicator of completion.
2. **MutationObserver stabilization:** When no new text mutation occurs for a damping period (debounce of 400ms to 600ms).
3. **Maximum guard timeout:** Configurable timeout (default 120s) with cooperative cancellation via `AbortSignal`.

---

## 8. CDP Connection and Network Isolation Policy

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

Pitfalls found: (1) a response selector that also matches the user's own question bubble (Perplexity); (2) a response selector that matches inner blocks so the "last element" is tiny (DeepSeek); (3) a legal disclaimer link counted as a source (Claude); (4) Google search links counted as sources (Gemini); (5) pages that mutate the DOM constantly (Perplexity), which is why completion relies on stable text; (6) a low-confidence (level 3) selector that matches every icon button and clicks the wrong one (Gemini): so send, new chat and the stop button use levels 1 and 2 only, and without them sending falls back to the Enter key; (7) in a continued conversation the previous answer is already on screen: `waitDone` records a baseline before sending and only completes on a new answer.

`cancel_chat` validated on a real generation (Gemini and Perplexity): the pending call returns `CANCELLED`, the stop button is triggered and the tab lease is released.
