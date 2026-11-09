# Technical reference

Portuguese version: [REFERENCIA.pt-BR.md](REFERENCIA.pt-BR.md) | Back to the [README](../README.md)

This document is for people who program or want to understand the project from the inside. To install and use it, the [README](../README.md) and the [installation guide](INSTALL.en.md) are enough.

## What it is, technically

A local MCP (Model Context Protocol) server that talks over stdio, written in Node.js. It connects to your Google Chrome through the Chrome DevTools Protocol (CDP) on `127.0.0.1:9222`, using a dedicated browser profile, and drives the tabs of the web chats (Perplexity, Gemini, ChatGPT, Claude, DeepSeek, Copilot, Meta AI, Groq, Grok) where you are already signed in. There is no HTTP server, no tunnel and no browser extension.

## Tools

| Tool | What it is for |
|---|---|
| `ask_perplexity`, `ask_gemini`, `ask_chatgpt`, `ask_claude`, `ask_deepseek`, `ask_copilot`, `ask_meta`, `ask_groq`, `ask_grok` | Ask one specific chat. Names and descriptions follow natural speech ("ask Gemini", "use ChatGPT web", "ask Copilot", "use Meta AI", "ask Groq", "ask Grok") so the client picks the right tool by itself. |
| `compare_web_chats` | Ask several chats in parallel and get every answer side by side. A chat that is not signed in returns its own error without stopping the others. Default: all nine supported providers (Perplexity, Gemini, ChatGPT, Claude, DeepSeek, Copilot, Meta AI, Groq, Grok). |
| `ask_web_chat` | Generic form: pass `provider` yourself. Accepts aliases such as "ChatGPT Web", "Google Gemini", "gemini.google.com", "GPT", "OpenAI", "Copilot", "Meta AI", "Groq", "Groq Chat", "chat.groq.com", "Grok", "xAI", "grok.com". |
| `list_chat_sessions` | Lists active sessions, busy tabs and leases. Shows whether a session has a conversation, never its URL. |
| `cancel_chat` | Stops a running generation. |
| `chat_bridge_status` | State of CDP and queues and, with `doctor: true`, a check of each provider's selectors (no prompt is sent). |
| `preview_payload` | Dry run: shows what the sanitizer would block (secrets, personal data, forbidden files). |

`Runtime.evaluate` is internal to the drivers and is never exposed as a tool.

## Options of `ask_*` and `ask_web_chat`

| Option | Description |
|---|---|
| `prompt` | Required. The text sent to the chat. |
| `provider` | Only on `ask_web_chat`. `perplexity`, `gemini`, `chatgpt`, `claude`, `deepseek`, `copilot`, `meta`, `groq` or `grok` (aliases accepted). |
| `session` | Key to continue a conversation. Each session returns to its own conversation, even if another session used the tab in between. |
| `new_chat` | Start a new conversation. Default: true without `session`; false with `session`. |
| `timeout_s` | Maximum wait for the answer, in seconds. Default: 120. |
| `context_files` | Context files. Sent in full once; if unchanged, only a SHA-256 hash marker. |
| `attachments` | Files sent through the website's attach button. If the real upload fails, nothing is sent (`ATTACHMENT_FAILED`). |
| `mode`, `model` | Mode or model request. Groq accepts model selection (starting at `qwen/qwen3.8-27b` with 429 rotation). Grok operates in free modes `Fast` and `Build`. |

## What the answer contains

`text`, `sources`, `provider`, `model` (the observed model), `duration_ms`, `session`. Optional: `model_requested`, `conversation_restored` (the session's conversation was reopened), `images`, `warnings`, `delta_stats`.

### Automatic extraction of generated images

When a web chat generates images in its answer turn (for example after a prompt like "generate an image of..."), compatible drivers automatically extract the images directly from the page DOM:

- `images`: array of metadata for each image generated in the turn: `{ index, alt, mimeType, bytes, delivered }`.
- Under the MCP protocol, the image is delivered as native multimodal content (`type: "image"` with base64 data and mimeType), keeping the JSON text payload clean.
- Smart filtering: interface icons, user avatars, and decorative images under 256 px are automatically skipped.
- When the chat returns a WebP image, the bridge performs canvas-based conversion to PNG when needed for universal MCP client compatibility.

Environment variables for image control:
- `CHAT_BRIDGE_MAX_IMAGE_BYTES`: maximum byte size per image (default: `8388608`, i.e. 8 MB).
- `CHAT_BRIDGE_MAX_IMAGES`: maximum number of images extracted per turn (default: `4`).
- `CHAT_BRIDGE_IMAGE_APPEAR_MS`: timeout waiting for the `<img>` tag to appear (default: `3000` ms).
- `CHAT_BRIDGE_IMAGE_LOAD_MS`: timeout waiting for the image bytes to load completely (default: `20000` ms).

### Dedicated provider features: Groq and Grok (xAI)

- **Groq (`ask_groq`):**
  - Starts directly at `https://chat.groq.com/?model=qwen/qwen3.8-27b`, setting the initial model to `qwen/qwen3.8-27b` to avoid the default Arabic model.
  - Automatic 429 rate limit fallback: when a model hits a rate limit or capacity constraint, the driver automatically rotates in sequence:
    `qwen/qwen3.8-27b` -> `openai/gpt-oss-120b` -> `qwen/qwen3.6-27b` -> `openai/gpt-oss-20b`.
- **Grok (`ask_grok`):**
  - Free-tier safety guarantee: strictly operates within free modes `Fast` and `Build`.
  - Proactively blocks paid modes (`Auto`, `Expert`, and `Heavy`) to avoid consuming user quotas.

## Warnings and errors

| Code | Meaning |
|---|---|
| `BLOCKED_BY_POLICY` | The sanitizer found a secret, personal data or a forbidden file; or the provider is unknown. Nothing was sent. |
| `AUTH_REQUIRED` | Login expired, CAPTCHA or challenge. The bridge stops and does not retry by itself. |
| `CDP_UNAVAILABLE` | Chrome is not open in debug mode on `127.0.0.1:9222`, or `playwright-core` is not installed. |
| `TAB_BUSY` | The tab is busy: another session holds it, or the chat is generating an answer (including manual use). The bridge never takes a tab that is generating. |
| `PROMPT_TIMEOUT` | The answer did not finish within `timeout_s`. |
| `CANCELLED` | The call was cancelled. |
| `ATTACHMENT_FAILED` | The attachment could not be uploaded through the website; no prompt was sent. |
| warning `MODEL_NOT_APPLIED`, `MODE_NOT_APPLIED` | In `warnings`, not an error: the requested model or mode cannot be selected through the website yet; the chat answered with its current one. |

## Partial text (progress)

If the client sends a `progressToken`, the server sends the text received so far as `notifications/progress`, at most every 0.8 s. Whether the text shows up live depends on the client. Environment variable `CHAT_BRIDGE_PROGRESS`: `text` (default, last 2000 characters), `chars` (character count only) or `off`. Partial text never reaches the log. To diagnose, `chat_bridge_status` returns `progress` with counters (numbers only): `tool_calls_with_progress_token`, `tool_calls_without_progress_token`, `progress_notifications_sent` and `progress_send_errors`. If the first one is zero, the client does not ask for progress.

## Safety by design

- Every prompt, the content of context files and attachments go through the sanitizer (secrets, credentials, personal data, forbidden-file list) before anything touches the browser.
- CDP is accepted only on `127.0.0.1`, with a dedicated Chrome profile. No tunnel, no `0.0.0.0`.
- Logs hold operational metadata only (provider, session, duration, sizes). Never prompts or answers.
- Different providers run in parallel; within one provider it is serial, with a lease per tab.
- Low-confidence (level 3) selectors are never used to click or to detect generation.
- Installer: no administrator rights, backs up the client configuration before changing it, and preserves the other servers.

## Windows installer

`Instalar.bat` runs `scripts\install.ps1`. Options (pass them to `Instalar.bat`): `-DryRun` (shows the plan without changing anything), `-Yes` (no questions; registers with no client unless `-Target` is given), `-Target` (comma-separated list of `Antigravity`, `Desktop`, `Code`, `All`, `None`), `-SkipTests`, `-NoShortcut`. `Desinstalar.bat` removes the shortcut and the server entry; `-RemoveProfile` also deletes the isolated Chrome profile (signs you out of the chats).

## Supported MCP clients and registration

chat-overdrive-bridge operates via standard MCP stdio transport and works with any MCP stdio client. Recommended configuration for major clients and IDEs:

### Antigravity IDE (and Claude Code running inside Antigravity IDE)

Add the entry to your `mcp_config.json` (typically at `C:\Users\<you>\.gemini\config\mcp_config.json` or `%USERPROFILE%\.gemini\antigravity\mcp_config.json`):

```json
{
  "mcpServers": {
    "chat-overdrive-bridge": {
      "command": "node",
      "args": ["C:/path/to/chat-overdrive-bridge/src/server.mjs"]
    }
  }
}
```

### Claude Code (CLI / IDE)

Register globally in the user scope via command line:

```bash
claude mcp add --scope user chat-overdrive-bridge -- node C:/path/to/chat-overdrive-bridge/src/server.mjs
```

### OpenAI Codex (`~/.codex/config.toml`)

Add the server section to `~/.codex/config.toml`:

```toml
[mcp_servers.chat-overdrive-bridge]
command = "node"
args = ["C:/path/to/chat-overdrive-bridge/src/server.mjs"]
```

### DeepSeek Harness — DSH (`~/.dsh/profiles/web/cordis.patch.yml`)

Configure the `@deepseek-ai/dsh-mcp-client` plugin in your profile config:

```yaml
plugins:
  - name: "@deepseek-ai/dsh-mcp-client"
    config:
      serverName: bridge
      transport: stdio
      command: node
      args:
        - "C:/path/to/chat-overdrive-bridge/src/server.mjs"
```

### Claude Desktop / Cursor / Windsurf / other MCP stdio clients

Add the standard `mcpServers` JSON block in your client configuration file (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "chat-overdrive-bridge": {
      "command": "node",
      "args": ["C:/path/to/chat-overdrive-bridge/src/server.mjs"]
    }
  }
}
```

## Development

`npm ci`, `npm run check` (syntax) and `npm test` (`node:test` tests on local fixtures; no real chat is contacted). The runner `tests/run-all.mjs` lists the test files itself so it works on Windows with Node 20.

## More documents

- [Architecture](ARCHITECTURE.en.md)
- [Selector map and live validation](SELECTORS.en.md)
- [Security policy](../SECURITY.md)
