# Installation guide (English)

Portuguese version: [INSTALL.pt-BR.md](INSTALL.pt-BR.md) | Back to the [README](../README.md)

## 1. Requirements

- Node.js 20 or newer (`node -v`)
- Google Chrome installed
- An MCP client that can launch a stdio server (for example Claude Desktop, Claude Code, or any client that accepts a `command` plus `args`)
- Accounts already signed in on the chats you want to use

## 2. Install

```
git clone https://github.com/samucamg/chat-overdrive-bridge.git
cd chat-overdrive-bridge
npm install
npm test
```

`npm test` must finish with 0 failures. It uses local HTML fixtures only and never contacts a real chat.

`npm install` downloads `playwright-core` as a library. It does not download a browser: the bridge drives your own Chrome.

## 2a. Windows automatic installer (optional)

Double-click `Instalar.bat` in the project folder. It runs `scripts\install.ps1` with `-ExecutionPolicy Bypass` for that single process only; it changes no system policy and needs no administrator rights. Windows SmartScreen may warn about an unsigned script when the repository was downloaded as a ZIP: choose "More info" then "Run anyway" only if you trust the source, or read `scripts\install.ps1` first (it is plain text).

What it does, in order: checks Node.js 20+ (offers `winget install OpenJS.NodeJS.LTS` if missing), checks Chrome, runs `npm ci`, `npm run check` and `npm test` (local fixtures, no real chat), creates the desktop shortcut "Chrome Debug - Overdrive Bridge", and asks whether to register the server in Antigravity, Claude Desktop and/or Claude Code. Each configuration file is backed up (`.bak-<date>`) and merged without touching your other servers. For Antigravity, only the existing `mcp_config.json` files under `.gemini\config` and `.gemini\antigravity` in your user folder are changed; no file is created.

Useful switches (pass them to `Instalar.bat`): `-DryRun` (show the plan, change nothing), `-Yes` (no questions; registers nothing unless `-Target` is given), `-Target` (comma-separated list of `Antigravity`, `Desktop`, `Code`, or `All` / `None`), `-SkipTests`, `-NoShortcut`.

To remove: `Desinstalar.bat` deletes the shortcut and the server entry (Claude Desktop with backup, Claude Code). It never deletes the project folder. `-RemoveProfile` also deletes the isolated Chrome profile, which signs you out of the chats.

After it finishes, continue at section 3 (sign in to the chats in the debug Chrome) and section 5 (first use). Sections 2 to 4 below are the manual equivalent.

## 3. Start Chrome in debug mode (isolated profile)

Use a dedicated profile, never your everyday one. CDP must listen on `127.0.0.1` only.

**Windows:** double-click `_ferramentas\start-chrome-debug.bat`. It opens Chrome on `127.0.0.1:9222` with the profile `%LOCALAPPDATA%\Google\Chrome-Overdrive-Bridge-Profile`.

**macOS and Linux (documented, not yet tested by the author):**

**macOS:**
```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$HOME/.chrome-overdrive-bridge-profile"
```

**Linux:**
```
google-chrome --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$HOME/.chrome-overdrive-bridge-profile"
```

In that Chrome window, open each chat and sign in once (perplexity.ai, gemini.google.com, chatgpt.com, claude.ai, chat.deepseek.com). The session stays in the isolated profile.

Check that CDP is up: open `http://127.0.0.1:9222/json/version` in a browser. You should see JSON.

## 4. Register the server in your MCP client

If you used the automatic installer (section 2a), it already did this for the clients you chose. Antigravity: by hand, add the snippet below to its `mcp_config.json` (normally `C:\Users\<you>\.gemini\config\mcp_config.json`).

Use the absolute path of the `src/server.mjs` file you cloned.

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

On Claude Code you can instead run:

```
claude mcp add chat-overdrive-bridge -- node /path/to/chat-overdrive-bridge/src/server.mjs
```

Restart the client. It should list 11 tools: `ask_perplexity`, `ask_gemini`, `ask_chatgpt`, `ask_claude`, `ask_deepseek`, `compare_web_chats`, `ask_web_chat`, `list_chat_sessions`, `cancel_chat`, `chat_bridge_status`, `preview_payload`.

## 5. First use

1. Call `chat_bridge_status` with `{"doctor": true}`. It reports whether CDP is connected and whether each provider's selectors are found. It sends no prompt.
2. Call `preview_payload` with a sample prompt to see what the sanitizer would block.
3. Just ask in plain language, naming the chat: "Ask Perplexity: reply with OK." The client calls `ask_perplexity` for you. Other examples: "Use Gemini web to explain this error", "Compare ChatGPT and Claude on this question" (`compare_web_chats`). If you prefer the explicit form, call `ask_web_chat`:

```json
{ "provider": "perplexity", "prompt": "Reply with OK." }
```

Useful optional fields: `session` (keep a conversation), `new_chat`, `timeout_s` (default 120), `mode`, `model`, `context_files` (sent once, then only a hash marker if unchanged), `attachments`.

## 6. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `CDP_UNAVAILABLE` | Chrome is not running in debug mode. Start it (section 3) and check `http://127.0.0.1:9222/json/version`. |
| `AUTH_REQUIRED` | Login expired, CAPTCHA or Cloudflare challenge. Solve it by hand in the debug Chrome, then retry. The bridge does not retry by itself. |
| `BLOCKED_BY_POLICY` | The sanitizer found a secret, PII or a blocked file path. Remove it. This is intentional. |
| `TAB_BUSY` | The tab is busy: another session holds it, or the chat is generating an answer (maybe you, by hand). Wait for it to finish, or call `cancel_chat` for a bridge session. |
| `ATTACHMENT_FAILED` | The file could not be uploaded through the website, so nothing was sent. Try without the attachment or paste the content. |
| `warnings` in an answer | A `model` or `mode` you asked for cannot be selected through the website yet; the chat answered with its current one. |
| `playwright-core` unavailable | Run `npm install` in the project folder. |
| Provider returns empty text | The site layout may have changed. Run `chat_bridge_status` with `{"doctor": true}` and see [SELECTORS.en.md](SELECTORS.en.md). |

## 7. Security rules to keep

- Never expose port 9222 beyond `127.0.0.1` (no tunnels, no `0.0.0.0`).
- Never use your daily Chrome profile for the debug instance.
- Do not put secrets, credentials or personal data in prompts. Free web chats do not offer zero data retention.
