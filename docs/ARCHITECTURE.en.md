# ARCHITECTURE — chat-overdrive-bridge

Portuguese version: [ARQUITETURA.md](ARQUITETURA.md)

Architecture reference document for the **chat-overdrive-bridge** project.
Origin: internal project plan (design phase).

## 1. Overview

**chat-overdrive-bridge** is an MCP (Model Context Protocol) server with `stdio` transport, developed in Node.js, designed to let Antigravity query frontier models in already authenticated web interfaces (Perplexity, Gemini, ChatGPT) through the Chrome DevTools Protocol (CDP) connected to a local debugging browser instance (`127.0.0.1:9222`).

The architecture avoids unnecessary local HTTP servers, auxiliary WebSockets on ports 8989/4545, network tunnels and MV3 browser extensions, ensuring a minimal attack surface and full control over the data in transit.

```mermaid
flowchart LR
  A["Antigravity (MCP Client)"] -->|MCP stdio| B["chat-overdrive-bridge"]
  B --> C["Queue + Lease per targetId"]
  C --> D["Drivers: perplexity / gemini / chatgpt"]
  D -->|CDP 127.0.0.1:9222| E["Chrome Debug (Logged In)"]
  B --> F["Secrets and PII Sanitizer"]
```

## 2. Main Components

### 2.1 MCP Server (stdio)
- Implemented using the official `@modelcontextprotocol/sdk` library.
- Communication strictly via standard input and output (`stdio`), with no opening of inbound network ports.
- Exposes structured tools to the Antigravity client and translates responses into standardized JSON.

### 2.2 CDP Layer (Chrome DevTools Protocol)
- Connection established via `playwright-core` using the method `chromium.connectOverCDP('http://127.0.0.1:9222')`.
- Strict network restriction: exclusively local loopback `127.0.0.1`.
- Tab management based on leases associated with the CDP `targetId`, preventing disorderly concurrency over the same tab.
- Access to the internal `Runtime.evaluate` API kept strictly encapsulated within the internal drivers; it is never exposed as an MCP tool.

### 2.3 Concurrency and Scheduling
- **Between distinct providers:** concurrent/parallel execution allowed (e.g., a request to Perplexity and another to Gemini may run simultaneously).
- **Within the same provider:** strictly serial execution with an in-memory queue, guaranteeing an interval with jitter (10 to 15 s) to avoid anti-bot triggers and rate blocks.

### 2.4 Secrets and PII Sanitizer
- Mandatory interceptor executed before any text is sent to the browser.
- Set of regex patterns (`_SECRET_PATTERNS`) to intercept:
  - API keys (OpenAI, Google, AWS, JWT tokens, GitHub, etc.).
  - Certificates and private keys (`.pem`, `.key`, `.pkcs12`).
  - Database credentials, connection strings and `.sql` dumps.
  - Sensitive configuration files and snippets (`.env*`, `*_privado*`, `*.jsonl`).
  - Personally identifiable information (PII) and student information.
- On detection of secrets or PII: the request is immediately blocked with the error `BLOCKED_BY_POLICY`, or sanitized according to the security policy.

## 3. Driver Contract

Each web provider implements a standardized driver interface:

- `ensureTab(context, targetUrl)`: locates or creates the tab corresponding to the provider.
- `isLoggedIn(page)`: evaluates whether the user's session is active and usable.
- `newChat(page)`: starts a new clean topic/conversation.
- `setMode(page, mode)`: adjusts search mode, focus or model according to the provider's support.
- `send(page, text)`: focuses the input box and injects the text (e.g., via `Input.insertText` for Lexical editors).
- `waitDone(page, timeoutMs)`: waits for the response to complete by monitoring the disappearance of the "Stop" buttons and DOM stabilization via MutationObserver (debounce of 400 to 600 ms).
- `extractAnswer(page)`: extracts the generated text, citations and structured references/sources.
- `stop(page)`: immediately interrupts the ongoing generation in the interface.
- `diagnose(page)`: runs the self-diagnostic routine for the provider's selectors.

### Selector Strategy (3 Levels)
To ensure resilience against visual updates of web interfaces:
1. **Level 1 (Semantic / Data):** application-specific attributes (e.g., `data-lexical-editor`, `data-workflow-final-text`, `data-renderer`).
2. **Level 2 (Multi-language Aria):** accessibility roles and labels in multiple languages (e.g., `button[aria-label="Enviar"]`, `button[aria-label="Submit"]`).
3. **Level 3 (Structural / SVG):** SVG paths and node structure as the last-resort fallback.

## 4. MCP Tools

| Tool | Arguments | Return | Description |
|---|---|---|---|
| `ask_web_chat` | `provider` (string), `prompt` (string), `session` (optional, string), `new_chat` (optional, bool), `timeout_s` (optional, int) | `{ text, sources[], provider, model, duration_ms, session }` | Runs a query against an authenticated web provider and returns the consolidated text with a list of sources. |
| `list_chat_sessions` | none | `{ sessions: [{ id, provider, targetId, createdAt }] }` | Lists the sessions and tabs active and managed by the bridge. |
| `cancel_chat` | `session_id` (string) | `{ success, session_id }` | Interrupts the ongoing generation for the specified session. |
| `chat_bridge_status` | none | `{ cdpConnected, cdpPort, providers: { [name]: { available, loggedIn } } }` | Returns the CDP health status and provider availability. |
| `preview_payload` | `provider` (string), `prompt` (string) | `{ allowed, sanitizedPrompt, violations[] }` | Dry-run mode for prior validation of compliance against the sanitizer. |

## 5. Structured Error Codes

In case of failure, the bridge returns standardized structured errors:

- `CDP_UNAVAILABLE`: Debug Chrome not found at `127.0.0.1:9222`.
- `AUTH_REQUIRED`: Expired session or login screen requested in the web interface.
- `TAB_BUSY`: Provider or tab busy serving another serial request.
- `PROMPT_TIMEOUT`: Time limit exceeded while waiting for a response from the web interface.
- `CANCELLED`: Operation explicitly cancelled by the user or tool.
- `BLOCKED_BY_POLICY`: Prompt contained secrets, PII or violated the sanitizer's security policy.

## 6. Logging and Telemetry

- Execution logs strictly record operational metadata: provider queried, inferred model, elapsed time in milliseconds, approximate number of characters/tokens and status/error codes.
- It is strictly prohibited to record the text of sent prompts or generated responses in log files or history (`history.jsonl`).
- Periodic rotation of log files, guaranteeing a ceiling of 30 KB / 300 lines / 20 entries per agent log file.

## 7. Testing Strategy

- **Unit Tests and Fixtures:** Fast, independent tests using the native Node.js runner (`node:test`) and syntax checking (`node --check`).
- **HTML Fixtures:** Mocks of pages and real DOM structures recorded locally to validate selector extraction, citations and sanitization without depending on a network connection or on a real open Chrome.
- **Opt-in Integration Tests:** Live tests executed strictly serially, on explicit demand, using test credentials and fictitious data.
