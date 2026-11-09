# Guia de instalação (Português do Brasil)

English version: [INSTALL.en.md](INSTALL.en.md) | Voltar ao [README](../README.md)

## 1. Requisitos

- Node.js 20 ou superior (`node -v`)
- Google Chrome instalado
- Um cliente MCP que consiga iniciar um servidor stdio (por exemplo Antigravity IDE, Claude Code, OpenAI Codex, DeepSeek Harness/DSH, Claude Desktop, Cursor, Windsurf)
- Contas já logadas nos chats que você quer usar

## 2. Instalar

```
git clone https://github.com/samucamg/chat-overdrive-bridge.git
cd chat-overdrive-bridge
npm install
npm test
```

O `npm test` deve terminar com 0 falhas. Ele usa apenas fixtures HTML locais e nunca contata um chat real.

O `npm install` baixa o `playwright-core` como biblioteca. Ele não baixa navegador: o bridge controla o seu próprio Chrome.

## 2a. Instalador automático para Windows (opcional)

Dê dois cliques em `Instalar.bat` na pasta do projeto. Ele roda `scripts\install.ps1` com `-ExecutionPolicy Bypass` apenas nesse processo; não altera nenhuma política do sistema e não precisa de administrador. O SmartScreen do Windows pode avisar sobre script sem assinatura quando o repositório foi baixado em ZIP: escolha "Mais informações" e "Executar assim mesmo" só se confiar na origem, ou leia antes o `scripts\install.ps1` (é texto puro).

O que ele faz, em ordem: verifica o Node.js 20+ (oferece `winget install OpenJS.NodeJS.LTS` se faltar), verifica o Chrome, roda `npm ci`, `npm run check` e `npm test` (fixtures locais, nenhum chat real), cria o atalho "Chrome Debug - Overdrive Bridge" na área de trabalho e pergunta se deve registrar o servidor no Antigravity, no Claude Desktop e/ou no Claude Code. Cada arquivo de configuração recebe backup (`.bak-<data>`) e é mesclado sem tocar nos seus outros servidores. No Antigravity, só são alterados os `mcp_config.json` que já existem em `.gemini\config` e `.gemini\antigravity` na sua pasta de usuário; nenhum arquivo é criado.

Opções úteis (passe para o `Instalar.bat`): `-DryRun` (mostra o plano, não altera nada), `-Yes` (sem perguntas; não registra nada a menos que `-Target` seja informado), `-Target` (lista separada por vírgula de `Antigravity`, `Desktop`, `Code`, ou `All` / `None`), `-SkipTests`, `-NoShortcut`.

Para remover: `Desinstalar.bat` apaga o atalho e a entrada do servidor (Claude Desktop com backup, Claude Code). Nunca apaga a pasta do projeto. `-RemoveProfile` também apaga o perfil isolado do Chrome, o que desloga você dos chats.

Ao terminar, continue na seção 3 (login nos chats no Chrome de debug) e na seção 5 (primeiro uso). As seções 2 a 4 abaixo são o equivalente manual.

## 3. Iniciar o Chrome em modo debug (perfil isolado)

Use um perfil dedicado, nunca o do dia a dia. O CDP deve escutar somente em `127.0.0.1`.

**Windows:** dê dois cliques em `_ferramentas\start-chrome-debug.bat`. Ele abre o Chrome em `127.0.0.1:9222` com o perfil `%LOCALAPPDATA%\Google\Chrome-Overdrive-Bridge-Profile`.

**macOS e Linux (documentados, ainda não testados pelo autor):**

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

Nessa janela do Chrome, abra cada chat e faça login uma vez nos provedores desejados:
- Perplexity (`https://www.perplexity.ai`)
- Gemini (`https://gemini.google.com`)
- ChatGPT (`https://chatgpt.com`)
- Claude (`https://claude.ai`)
- DeepSeek (`https://chat.deepseek.com`)
- Copilot (`https://copilot.cloud.microsoft`)
- Meta AI (`https://www.meta.ai`)
- Groq (`https://chat.groq.com/?model=qwen/qwen3.8-27b` — utilize esta URL com o modelo `qwen/qwen3.8-27b` para evitar o modelo padrão em árabe e garantir a rotação automática)
- Grok (`https://grok.com/` — operando nos modos gratuitos `Fast` e `Build`)

A sessão fica guardada no perfil isolado.

Confirme que o CDP está no ar: abra `http://127.0.0.1:9222/json/version` no navegador. Deve aparecer um JSON.

## 4. Registrar o servidor no cliente MCP

Se você usou o instalador automático (seção 2a), ele já fez isso nos clientes que você escolheu. Use o caminho absoluto do arquivo `src/server.mjs` que você clonou.

### Antigravity IDE (e Claude Code rodando dentro da Antigravity IDE)

Adicione o bloco abaixo ao arquivo `mcp_config.json` (normalmente em `C:\Users\<você>\.gemini\config\mcp_config.json` ou `%USERPROFILE%\.gemini\antigravity\mcp_config.json`):

```json
{
  "mcpServers": {
    "chat-overdrive-bridge": {
      "command": "node",
      "args": ["C:/caminho/para/chat-overdrive-bridge/src/server.mjs"]
    }
  }
}
```

### Claude Code (CLI / IDE)

Execute no terminal:

```bash
claude mcp add --scope user chat-overdrive-bridge -- node C:/caminho/para/chat-overdrive-bridge/src/server.mjs
```

### OpenAI Codex (`~/.codex/config.toml`)

Adicione o bloco `[mcp_servers.chat-overdrive-bridge]` no arquivo `~/.codex/config.toml`:

```toml
[mcp_servers.chat-overdrive-bridge]
command = "node"
args = ["C:/caminho/para/chat-overdrive-bridge/src/server.mjs"]
```

### DeepSeek Harness — DSH (`~/.dsh/profiles/web/cordis.patch.yml`)

Configure o plugin `@deepseek-ai/dsh-mcp-client` no arquivo de perfil:

```yaml
plugins:
  - name: "@deepseek-ai/dsh-mcp-client"
    config:
      serverName: bridge
      transport: stdio
      command: node
      args:
        - "C:/caminho/para/chat-overdrive-bridge/src/server.mjs"
```

### Claude Desktop / Cursor / Windsurf / outros clientes MCP stdio

Adicione o bloco padrão `mcpServers` no arquivo de configuração do seu cliente (por exemplo `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "chat-overdrive-bridge": {
      "command": "node",
      "args": ["C:/caminho/para/chat-overdrive-bridge/src/server.mjs"]
    }
  }
}
```

Reinicie o cliente. Ele deve listar 15 ferramentas: `ask_perplexity`, `ask_gemini`, `ask_chatgpt`, `ask_claude`, `ask_deepseek`, `ask_copilot`, `ask_meta`, `ask_groq`, `ask_grok`, `compare_web_chats`, `ask_web_chat`, `list_chat_sessions`, `cancel_chat`, `chat_bridge_status`, `preview_payload`.

## 5. Primeiro uso

1. Chame `chat_bridge_status` com `{"doctor": true}`. Ele informa se o CDP está conectado e se os seletores de cada provedor foram encontrados. Não envia prompt.
2. Chame `preview_payload` com um prompt de exemplo para ver o que o sanitizador bloquearia.
3. Basta pedir em linguagem natural, citando o chat: "Pergunte ao Perplexity: responda apenas OK." O cliente chama `ask_perplexity` por você. Outros exemplos: "Use o Gemini web para explicar este erro", "Compare o ChatGPT e o Claude nesta pergunta" (`compare_web_chats`). Se preferir a forma explícita, chame `ask_web_chat`:

```json
{ "provider": "perplexity", "prompt": "Responda apenas OK." }
```

Campos opcionais úteis: `session` (manter uma conversa), `new_chat`, `timeout_s` (padrão 120), `mode`, `model`, `context_files` (enviados uma vez; depois só um marcador de hash se não mudarem), `attachments`.

## 6. Solução de problemas

| Sintoma | Causa e solução |
|---|---|
| `CDP_UNAVAILABLE` | O Chrome não está em modo debug. Inicie-o (seção 3) e confira `http://127.0.0.1:9222/json/version`. |
| `AUTH_REQUIRED` | Login expirado, CAPTCHA ou desafio Cloudflare. Resolva à mão no Chrome de debug e tente de novo. O bridge não tenta de novo sozinho. |
| `BLOCKED_BY_POLICY` | O sanitizador achou segredo, PII ou caminho de arquivo proibido. Remova. É intencional. |
| `TAB_BUSY` | A aba está ocupada: outra sessão a usa, ou o chat está gerando uma resposta (talvez você, à mão). Aguarde terminar, ou chame `cancel_chat` para uma sessão do bridge. |
| `ATTACHMENT_FAILED` | O arquivo não pôde ser enviado pelo site, então nada foi enviado. Tente sem o anexo ou cole o conteúdo. |
| `warnings` em uma resposta | Um `model` ou `mode` pedido ainda não pode ser selecionado pelo site; o chat respondeu com o atual. |
| `playwright-core` indisponível | Rode `npm install` na pasta do projeto. |
| Provedor devolve texto vazio | O layout do site pode ter mudado. Rode `chat_bridge_status` com `{"doctor": true}` e veja [SELETORES.md](SELETORES.md). |

## 7. Regras de segurança a manter

- Nunca exponha a porta 9222 além de `127.0.0.1` (sem túnel, sem `0.0.0.0`).
- Nunca use o perfil do seu Chrome do dia a dia na instância de debug.
- Não coloque segredos, credenciais nem dados pessoais em prompts. Chats web gratuitos não oferecem retenção zero de dados.
