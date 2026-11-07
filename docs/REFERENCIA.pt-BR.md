# Referência técnica

English version: [REFERENCE.en.md](REFERENCE.en.md) | Voltar ao [README](../README.md)

Este documento é para quem programa ou quer entender o projeto por dentro. Para instalar e usar, o [README](../README.md) e o [guia de instalação](INSTALL.pt-BR.md) bastam.

## O que é, tecnicamente

Um servidor MCP (Model Context Protocol) local, que se comunica por stdio, escrito em Node.js. Ele conecta ao seu Google Chrome pelo Chrome DevTools Protocol (CDP) em `127.0.0.1:9222`, usando um perfil de navegador dedicado, e controla as abas dos chats web (Perplexity, Gemini, ChatGPT, Claude, DeepSeek) nas quais você já está logado. Não há servidor HTTP, túnel nem extensão de navegador.

## Ferramentas

| Ferramenta | Para que serve |
|---|---|
| `ask_perplexity`, `ask_gemini`, `ask_chatgpt`, `ask_claude`, `ask_deepseek` | Pergunta a um chat específico. Os nomes e as descrições seguem a fala natural ("pergunte ao Gemini", "use o ChatGPT web"), para o cliente escolher a ferramenta certa sozinho. |
| `compare_web_chats` | Pergunta a vários chats em paralelo e devolve as respostas lado a lado. Um chat deslogado devolve o próprio erro sem derrubar os outros. Padrão: os cinco. |
| `ask_web_chat` | Forma genérica: informe `provider` você mesmo. Aceita apelidos como "ChatGPT Web", "Google Gemini", "gemini.google.com", "GPT", "OpenAI". |
| `list_chat_sessions` | Lista sessões ativas, abas ocupadas e leases. Mostra se a sessão tem conversa, nunca a URL dela. |
| `cancel_chat` | Interrompe uma geração em andamento. |
| `chat_bridge_status` | Estado do CDP, das filas e, com `doctor: true`, a checagem dos seletores de cada provedor (sem enviar prompt). |
| `preview_payload` | Simulação: mostra o que o sanitizador bloquearia (segredos, dados pessoais, arquivos proibidos). |

`Runtime.evaluate` é de uso interno dos drivers e nunca é exposto como ferramenta.

## Opções de `ask_*` e `ask_web_chat`

| Opção | Descrição |
|---|---|
| `prompt` | Obrigatória. O texto enviado ao chat. |
| `provider` | Só em `ask_web_chat`. `perplexity`, `gemini`, `chatgpt`, `claude` ou `deepseek` (apelidos aceitos). |
| `session` | Chave para continuar uma conversa. Cada sessão volta à própria conversa, mesmo se outra sessão usou a aba no meio. |
| `new_chat` | Começa uma conversa nova. Padrão: verdadeiro sem `session`; falso com `session`. |
| `timeout_s` | Espera máxima pela resposta, em segundos. Padrão: 120. |
| `context_files` | Arquivos de contexto. Enviados por inteiro uma vez; se não mudarem, só um marcador de hash SHA-256. |
| `attachments` | Arquivos enviados pelo botão de anexo do site. Se o envio real falhar, nada é enviado (`ATTACHMENT_FAILED`). |
| `mode`, `model` | Pedido de modo ou modelo. Nenhum provedor tem seleção real implementada ainda: veja "Avisos". |

## O que a resposta traz

`text`, `sources`, `provider`, `model` (o modelo observado), `duration_ms`, `session`. Opcionais: `model_requested`, `conversation_restored` (a conversa da sessão foi reaberta), `warnings`, `delta_stats`.

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

## Registro manual em qualquer cliente MCP

```json
{
  "mcpServers": {
    "chat-overdrive-bridge": { "command": "node", "args": ["C:/caminho/para/chat-overdrive-bridge/src/server.mjs"] }
  }
}
```

Claude Code: `claude mcp add --scope user chat-overdrive-bridge -- node C:/caminho/para/chat-overdrive-bridge/src/server.mjs`.

## Desenvolvimento

`npm ci`, `npm run check` (sintaxe) e `npm test` (testes com `node:test` sobre fixtures locais; nenhum chat real é contatado). O executor `tests/run-all.mjs` lista os arquivos de teste ele mesmo, para funcionar no Windows com Node 20.

## Mais documentos

- [Arquitetura](ARQUITETURA.md)
- [Mapa de seletores e validação ao vivo](SELETORES.md)
- [Política de segurança](../SECURITY.md)
