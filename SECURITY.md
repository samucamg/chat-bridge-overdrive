# Security Policy / Política de Segurança

## English

chat-overdrive-bridge drives a browser you are signed in to, so security reports matter.

**Report privately.** Do not open a public issue for a vulnerability. Use GitHub's "Report a vulnerability" button (Security tab of the repository, private advisories). Include the version, steps to reproduce and the impact.

**In scope:** the sanitizer being bypassed (secrets, credentials, PII or denied files reaching a chat), CDP being reachable beyond `127.0.0.1`, `Runtime.evaluate` being exposed as a tool, prompts or answers appearing in logs, lease or queue bypass.

**Out of scope:** changes in a provider's website that break selectors (open a normal issue), and provider terms-of-service questions.

**Design guarantees to keep:** CDP only on `127.0.0.1` with a dedicated Chrome profile; no HTTP server, tunnel or browser extension; logs hold metadata only; every prompt is sanitized before it touches the browser.

## Português (Brasil)

O chat-overdrive-bridge controla um navegador no qual você está logado, então relatos de segurança importam.

**Relate em privado.** Não abra issue pública para vulnerabilidade. Use o botão "Report a vulnerability" do GitHub (aba Security do repositório, advisories privados). Informe a versão, os passos para reproduzir e o impacto.

**No escopo:** burlar o sanitizador (segredos, credenciais, PII ou arquivos proibidos chegando a um chat), CDP acessível além de `127.0.0.1`, `Runtime.evaluate` exposto como tool, prompts ou respostas aparecendo em logs, falha de lease ou de fila.

**Fora do escopo:** mudança no site de um provedor que quebre seletores (abra uma issue comum) e dúvidas sobre termos de uso dos provedores.

**Garantias de desenho a manter:** CDP somente em `127.0.0.1` com perfil dedicado do Chrome; sem servidor HTTP, túnel nem extensão de navegador; logs só com metadados; todo prompt é sanitizado antes de tocar no navegador.
