# Referência técnica

English version: [REFERENCE.en.md](REFERENCE.en.md) | Voltar ao [README](../README.md)

Este documento é para quem programa ou quer entender o projeto por dentro. Para instalar e usar, o [README](../README.md) e o [guia de instalação](INSTALL.pt-BR.md) bastam.

## O que é, tecnicamente

Um servidor MCP (Model Context Protocol) local, que se comunica por stdio, escrito em Node.js. Ele conecta ao seu Google Chrome pelo Chrome DevTools Protocol (CDP) em `127.0.0.1:9222`, usando um perfil de navegador dedicado, e controla as abas dos chats web (Perplexity, Gemini, ChatGPT, Claude, DeepSeek, Copilot, Meta AI, Groq, Grok) nas quais você já está logado. Não há servidor HTTP, túnel nem extensão de navegador.

## Ferramentas

| Ferramenta | Para que serve |
|---|---|
| `ask_perplexity`, `ask_gemini`, `ask_chatgpt`, `ask_claude`, `ask_deepseek`, `ask_copilot`, `ask_meta`, `ask_groq`, `ask_grok` | Pergunta a um chat específico. Os nomes e as descrições seguem a fala natural ("pergunte ao Gemini", "use o ChatGPT web", "pergunte ao Copilot", "use o Meta AI", "pergunte ao Groq", "pergunte ao Grok"), para o cliente escolher a ferramenta certa sozinho. |
| `compare_web_chats` | Pergunta a vários chats em paralelo e devolve as respostas lado a lado. Um chat deslogado devolve o próprio erro sem derrubar os outros. Padrão: todos os provedores ativos (Perplexity, Gemini, ChatGPT, Claude, DeepSeek, Copilot, Meta AI, Groq, Grok). |
| `ask_web_chat` | Forma genérica: informe `provider` você mesmo. Aceita apelidos como "ChatGPT Web", "Google Gemini", "gemini.google.com", "GPT", "OpenAI", "Copilot", "Meta AI", "Groq", "Groq Chat", "chat.groq.com", "Grok", "xAI", "grok.com". |
| `list_chat_sessions` | Lista sessões ativas, abas ocupadas e leases. Mostra se a sessão tem conversa, nunca a URL dela. |
| `cancel_chat` | Interrompe uma geração em andamento. |
| `chat_bridge_status` | Estado do CDP, das filas e, com `doctor: true`, a checagem dos seletores de cada provedor (sem enviar prompt). |
| `preview_payload` | Simulação: mostra o que o sanitizador bloquearia (segredos, dados pessoais, arquivos proibidos). |

`Runtime.evaluate` é de uso interno dos drivers e nunca é exposto como ferramenta.

## Opções de `ask_*` e `ask_web_chat`

| Opção | Descrição |
|---|---|
| `prompt` | Obrigatória. O texto enviado ao chat. |
| `provider` | Só em `ask_web_chat`. `perplexity`, `gemini`, `chatgpt`, `claude`, `deepseek`, `copilot`, `meta`, `groq` ou `grok` (apelidos aceitos). |
| `session` | Chave para continuar uma conversa. Cada sessão volta à própria conversa, mesmo se outra sessão usou a aba no meio. |
| `new_chat` | Começa uma conversa nova. Padrão: verdadeiro sem `session`; falso com `session`. |
| `timeout_s` | Espera máxima pela resposta, em segundos. Padrão: 120. |
| `context_files` | Arquivos de contexto. Enviados por inteiro uma vez; se não mudarem, só um marcador de hash SHA-256. |
| `attachments` | Arquivos enviados pelo botão de anexo do site. Se o envio real falhar, nada é enviado (`ATTACHMENT_FAILED`). |
| `mode`, `model` | Pedido de modo ou modelo. No Groq, aceita seleção de modelo (iniciando em `qwen/qwen3.8-27b` com rotação em 429). No Grok, aceita os modos gratuitos `Fast` e `Build`. |

## O que a resposta traz

`text`, `sources`, `provider`, `model` (o modelo observado), `duration_ms`, `session`. Opcionais: `model_requested`, `conversation_restored` (a conversa da sessão foi reaberta), `images`, `warnings`, `delta_stats`.

### Extração automática de imagens geradas

Quando um chat web gera imagens no turno de resposta (por exemplo em pedidos como "gere uma imagem de..."), os drivers compatíveis extraem automaticamente as imagens diretamente da página:

- `images`: array de metadados das imagens geradas `{ index, alt, mimeType, bytes, delivered }`.
- No protocolo MCP, a imagem é transferida como conteúdo nativo multimodal (`type: "image"` com base64 e mimeType correspondente), sem inflar o payload JSON textual.
- Ícones de interface, avatares e imagens decorativas com menos de 256 px são ignorados automaticamente.
- Quando o chat devolve imagem WebP, o bridge faz a conversão para PNG via canvas quando necessário para compatibilidade universal com clientes MCP.

Variáveis de ambiente para controle de imagens:
- `CHAT_BRIDGE_MAX_IMAGE_BYTES`: limite máximo por imagem em bytes (padrão: `8388608`, ou seja, 8 MB).
- `CHAT_BRIDGE_MAX_IMAGES`: número máximo de imagens extraídas por turno (padrão: `4`).
- `CHAT_BRIDGE_IMAGE_APPEAR_MS`: tempo de espera para a tag da imagem surgir (padrão: `3000` ms).
- `CHAT_BRIDGE_IMAGE_LOAD_MS`: tempo limite para o carregamento completo dos bytes da imagem (padrão: `20000` ms).

### Recursos especiais: Groq e Grok (xAI)

- **Groq (`ask_groq`):**
  - Inicialização na URL `https://chat.groq.com/?model=qwen/qwen3.8-27b`, fixando o modelo inicial em `qwen/qwen3.8-27b` para evitar o modelo padrão em árabe.
  - Rotação automática contra sobrecarga (erro 429): se o modelo atingir limite de taxa, o driver rotaciona automaticamente em cascata para `openai/gpt-oss-120b` -> `qwen/qwen3.6-27b` -> `openai/gpt-oss-20b`, garantindo resposta ininterrupta.
- **Grok (`ask_grok`):**
  - Salvaguarda de gratuidade: opera estritamente nos modos gratuitos `Fast` e `Build`.
  - Evita ativamente a seleção de modos pagos (`Auto`, `Expert` e `Heavy`) para preservar cotas do usuário.

## Avisos e erros

| Código | Significado |
|---|---|
| `BLOCKED_BY_POLICY` | O sanitizador encontrou segredo, dado pessoal ou arquivo proibido; ou o provedor é desconhecido. Nada foi enviado. |
| `AUTH_REQUIRED` | Login expirado, CAPTCHA ou desafio. O bridge para e não tenta de novo sozinho. |
| `CDP_UNAVAILABLE` | O Chrome não está aberto em modo debug em `127.0.0.1:9222`, ou o `playwright-core` não está instalado. |
| `TAB_BUSY` | A aba está ocupada: outra sessão a usa, ou o chat está gerando uma resposta (inclusive uso manual). O bridge nunca toma uma aba que está gerando. |
| `PROMPT_TIMEOUT` | A resposta não terminou dentro de `timeout_s`. |
| `CANCELLED` | A chamada foi cancelada. |
| `ATTACHMENT_FAILED` | O anexo não pôde ser enviado pelo site; nenhum prompt foi enviado. |
| aviso `MODEL_NOT_APPLIED`, `MODE_NOT_APPLIED` | Em `warnings`, não é erro: o modelo ou modo pedido não pode ser selecionado pelo site ainda; o chat respondeu com o atual. |

## Texto parcial (progresso)

Se o cliente enviar um `progressToken`, o servidor manda o texto recebido até o momento como `notifications/progress`, no máximo a cada 0,8 s. Se o texto aparece ao vivo depende do cliente. Variável `CHAT_BRIDGE_PROGRESS`: `text` (padrão, últimos 2000 caracteres), `chars` (só a contagem de caracteres) ou `off`. O texto parcial nunca vai para o log. Para diagnosticar, `chat_bridge_status` devolve `progress` com contadores (só números): `tool_calls_with_progress_token`, `tool_calls_without_progress_token`, `progress_notifications_sent` e `progress_send_errors`. Se o primeiro for zero, o cliente não pede progresso.

## Segurança por desenho

- Todo prompt, o conteúdo dos arquivos de contexto e os anexos passam pelo sanitizador (segredos, credenciais, dados pessoais, lista de arquivos proibidos) antes de qualquer toque no navegador.
- O CDP só é aceito em `127.0.0.1`, com perfil dedicado do Chrome. Sem túnel, sem `0.0.0.0`.
- Os logs guardam só metadados operacionais (provedor, sessão, duração, tamanhos). Nunca prompts nem respostas.
- Provedores diferentes rodam em paralelo; dentro do mesmo provedor é serial, com lease por aba.
- Seletores de baixa confiança (nível 3) nunca são usados para clicar nem para detectar geração.
- Instalador: não precisa de administrador, faz backup antes de alterar a configuração do cliente e preserva os outros servidores.

## Instalador do Windows

`Instalar.bat` chama `scripts\install.ps1`. Opções (passe ao `Instalar.bat`): `-DryRun` (mostra o plano sem alterar nada), `-Yes` (sem perguntas; não registra em nenhum cliente sem `-Target`), `-Target` (lista separada por vírgula de `Antigravity`, `Desktop`, `Code`, `All`, `None`), `-SkipTests`, `-NoShortcut`. `Desinstalar.bat` remove o atalho e a entrada do servidor; `-RemoveProfile` apaga também o perfil isolado do Chrome (desloga os chats).

## Clientes MCP homologados e registro

O chat-overdrive-bridge opera via transporte stdio padrão do protocolo MCP, sendo compatível com qualquer cliente MCP stdio. As configurações para os principais clientes e IDEs são:

### Antigravity IDE (e Claude Code rodando dentro da Antigravity IDE)

Adicione a entrada ao arquivo `mcp_config.json` (normalmente em `C:\Users\<você>\.gemini\config\mcp_config.json` ou `%USERPROFILE%\.gemini\antigravity\mcp_config.json`):

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

Registre no escopo do usuário via linha de comando:

```bash
claude mcp add --scope user chat-overdrive-bridge -- node C:/caminho/para/chat-overdrive-bridge/src/server.mjs
```

### OpenAI Codex (`~/.codex/config.toml`)

Adicione a seção do servidor no `~/.codex/config.toml`:

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

Adicione o bloco JSON padrão `mcpServers` no arquivo de configuração do seu cliente (ex.: `claude_desktop_config.json`):

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

## Desenvolvimento

`npm ci`, `npm run check` (sintaxe) e `npm test` (testes com `node:test` sobre fixtures locais; nenhum chat real é contatado). O executor `tests/run-all.mjs` lista os arquivos de teste ele mesmo, para funcionar no Windows com Node 20.

## Mais documentos

- [Arquitetura](ARQUITETURA.md)
- [Mapa de seletores e validação ao vivo](SELETORES.md)
- [Política de segurança](../SECURITY.md)
