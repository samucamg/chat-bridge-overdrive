# ARQUITETURA — chat-overdrive-bridge

English version: [ARCHITECTURE.en.md](ARCHITECTURE.en.md)

Documento de referência arquitetural do projeto **chat-overdrive-bridge**.
Origem: plano de projeto interno (fase de concepção).

## 1. Visão Geral

O **chat-overdrive-bridge** é um servidor MCP (Model Context Protocol) com transporte `stdio`, desenvolvido em Node.js, projetado para permitir que o Antigravity consulte modelos de ponta em interfaces web já autenticadas (Perplexity, Gemini, ChatGPT) através do Chrome DevTools Protocol (CDP) conectado a uma instância de navegador de depuração local (`127.0.0.1:9222`).

A arquitetura elimina servidores HTTP locais desnecessários, WebSockets auxiliares em portas 8989/4545, túneis de rede e extensões de navegador MV3, garantindo superfície de ataque mínima e total controle sobre os dados trafegados.

```mermaid
flowchart LR
  A["Antigravity (MCP Client)"] -->|MCP stdio| B["chat-overdrive-bridge"]
  B --> C["Fila + Lease por targetId"]
  C --> D["Drivers: perplexity / gemini / chatgpt"]
  D -->|CDP 127.0.0.1:9222| E["Chrome Debug (Logado)"]
  B --> F["Sanitizador de Segredos e PII"]
```

## 2. Componentes Principais

### 2.1 Servidor MCP (stdio)
- Implementado utilizando a biblioteca oficial `@modelcontextprotocol/sdk`.
- Comunicação estritamente via entrada e saída padrão (`stdio`), sem abertura de portas de rede de entrada.
- Expõe ferramentas estruturadas para o cliente Antigravity e traduz respostas para JSON padronizado.

### 2.2 Camada CDP (Chrome DevTools Protocol)
- Conexão estabelecida via `playwright-core` utilizando o método `chromium.connectOverCDP('http://127.0.0.1:9222')`.
- Restrição estrita de rede: loopback local `127.0.0.1` exclusivo.
- Gerenciamento de abas baseado em leases associados ao `targetId` do CDP, impedindo concorrência desordenada sobre a mesma aba.
- Acesso à API interna `Runtime.evaluate` mantido estritamente encapsulado nos drivers internos; nunca é exposto como ferramenta MCP.

### 2.3 Concorrência e Escalonamento
- **Entre provedores distintos:** execução concorrente/paralela permitida (ex.: uma requisição para Perplexity e outra para Gemini podem rodar simultaneamente).
- **Dentro do mesmo provedor:** execução estritamente serial com fila em memória, garantindo intervalo com jitter (10 a 15 s) para evitar gatilhos anti-bot e bloqueios de taxa.

### 2.4 Sanitizador de Segredos e PII
- Interceptador obrigatório executado antes de qualquer envio de texto ao navegador.
- Conjunto de padrões regex (`_SECRET_PATTERNS`) para interceptar:
  - Chaves de API (OpenAI, Google, AWS, tokens JWT, GitHub, etc.).
  - Certificados e chaves privadas (`.pem`, `.key`, `.pkcs12`).
  - Credenciais de banco de dados, strings de conexão e dumps `.sql`.
  - Arquivos e trechos de configuração sensíveis (`.env*`, `*_privado*`, `*.jsonl`).
  - Dados pessoais identificáveis (PII) e informações de alunos.
- Em caso de detecção de segredos ou PII: a requisição é bloqueada imediatamente com erro `BLOCKED_BY_POLICY` ou sanitizada conforme política de segurança.

## 3. Contrato de Driver

Cada provedor web implementa uma interface padronizada de driver:

- `ensureTab(context, targetUrl)`: localiza ou cria a aba correspondente ao provedor.
- `isLoggedIn(page)`: avalia se a sessão do usuário está ativa e utilizável.
- `newChat(page)`: inicia um novo tópico/conversa limpo.
- `setMode(page, mode)`: ajusta modo de busca, foco ou modelo conforme suporte do provedor.
- `send(page, text)`: realiza o foco na caixa de entrada e injeta o texto (ex.: via `Input.insertText` para editores Lexical).
- `waitDone(page, timeoutMs)`: aguarda a conclusão da resposta monitorando sumiço de botões de parada ("Stop") e estabilização de DOM via MutationObserver (debounce de 400 a 600 ms).
- `extractAnswer(page)`: extrai o texto gerado, citações e referências/fontes estruturadas.
- `stop(page)`: interrompe imediatamente a geração em andamento na interface.
- `diagnose(page)`: executa rotina de auto-diagnóstico dos seletores do provedor.

### Estratégia de Seletores (3 Níveis)
Para garantir resiliência contra atualizações visuais das interfaces web:
1. **Nível 1 (Semântico / Dados):** atributos específicos de aplicação (ex.: `data-lexical-editor`, `data-workflow-final-text`, `data-renderer`).
2. **Nível 2 (Aria Multi-idioma):** papéis de acessibilidade e labels em múltiplos idiomas (ex.: `button[aria-label="Enviar"]`, `button[aria-label="Submit"]`).
3. **Nível 3 (Estrutural / SVG):** caminhos SVG e estrutura de nós como fallback de última linha.

## 4. Ferramentas (Tools) do MCP

| Ferramenta | Argumentos | Retorno | Descrição |
|---|---|---|---|
| `ask_web_chat` | `provider` (string), `prompt` (string), `session` (opcional, string), `new_chat` (opcional, bool), `timeout_s` (opcional, int) | `{ text, sources[], provider, model, duration_ms, session }` | Executa consulta a um provedor web autenticado e retorna o texto consolidado com lista de fontes. |
| `list_chat_sessions` | nenhum | `{ sessions: [{ id, provider, targetId, createdAt }] }` | Lista as sessões e abas ativas gerenciadas pelo bridge. |
| `cancel_chat` | `session_id` (string) | `{ success, session_id }` | Interrompe a geração em andamento para a sessão especificada. |
| `chat_bridge_status` | nenhum | `{ cdpConnected, cdpPort, providers: { [name]: { available, loggedIn } } }` | Retorna o status de integridade do CDP e disponibilidade dos provedores. |
| `preview_payload` | `provider` (string), `prompt` (string) | `{ allowed, sanitizedPrompt, violations[] }` | Modo dry-run para validação prévia de conformidade contra o sanitizador. |

## 5. Códigos de Erro Estruturados

Em caso de falha, o bridge retorna erros estruturados padronizados:

- `CDP_UNAVAILABLE`: Chrome debug não encontrado na porta `127.0.0.1:9222`.
- `AUTH_REQUIRED`: Sessão expirada ou tela de login solicitada na interface web.
- `TAB_BUSY`: Provedor ou aba ocupada atendendo a outra requisição serial.
- `PROMPT_TIMEOUT`: Tempo limite excedido aguardando resposta da interface web.
- `CANCELLED`: Operação cancelada explicitamente pelo usuário ou ferramenta.
- `BLOCKED_BY_POLICY`: Prompt continha segredos, PII ou violou a política de segurança do sanitizador.

## 6. Registro de Logs e Telemetria

- Os logs de execução gravam estritamente metadados operacionais: provedor consultado, modelo inferido, tempo decorrido em milissegundos, quantidade aproximada de caracteres/tokens e códigos de status/erro.
- É terminantemente proibido registrar textos de prompts enviados ou respostas geradas em arquivos de log ou histórico (`history.jsonl`).
- Rotação periódica de arquivos de log garantindo teto de 30 KB / 300 linhas / 20 entradas por arquivo de log dos agentes.

## 7. Estratégia de Testes

- **Testes de Unidade e Fixtures:** Testes rápidos e independentes utilizando o runner nativo do Node.js (`node:test`) e checagem de sintaxe (`node --check`).
- **Fixtures HTML:** Mocks de páginas e estruturas de DOM reais gravadas localmente para validar a extração de seletores, citações e sanitização sem dependência de conexão de rede ou do Chrome real aberto.
- **Testes de Integração Opt-in:** Testes ao vivo executados de forma estritamente serial, sob demanda explícita, utilizando credenciais de teste e dados fictícios.
