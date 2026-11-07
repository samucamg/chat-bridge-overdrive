#Requires -Version 5.1
<#
.SYNOPSIS
  chat-overdrive-bridge - instalador para Windows / Windows installer.

.DESCRIPTION
  PT: verifica o Node.js 20+ (instala via winget se faltar, com sua confirmacao), roda npm ci,
      npm run check e npm test, cria o atalho do Chrome em modo debug na area de trabalho e,
      se voce autorizar, registra o servidor MCP no Claude Desktop e/ou Claude Code.
  EN: checks Node.js 20+ (installs via winget if missing, with your confirmation), runs npm ci,
      npm run check and npm test, creates a Chrome debug shortcut on the desktop and, if you
      agree, registers the MCP server in Claude Desktop and/or Claude Code.

  Nada e enviado para a internet alem do download de pacotes npm (e do Node, se voce aceitar).
  Nenhum prompt e disparado. / Nothing is sent anywhere besides npm packages (and Node if you agree).
  Nenhum chat e acessado. / No chat is contacted.

.PARAMETER Yes
  Nao pergunta nada; assume "sim" para instalar o Node e criar o atalho. Nao registra em nenhum
  cliente MCP, a menos que -Target seja informado. / No prompts; registers nothing unless -Target is given.
.PARAMETER DryRun
  Mostra o que seria feito sem alterar nada. / Shows what would happen without changing anything.
.PARAMETER SkipTests
  Pula npm test. / Skips npm test.
.PARAMETER NoShortcut
  Nao cria o atalho na area de trabalho. / Does not create the desktop shortcut.
.PARAMETER Target
  Ask (padrao/default), None, All, ou uma ou mais de: Desktop, Code, Antigravity (Both = Desktop + Code).
  Onde registrar o servidor MCP. / Where to register the MCP server.
.PARAMETER ClaudeDesktopConfigPath
  Caminho do claude_desktop_config.json (padrao: %APPDATA%\Claude). / Path of the Claude Desktop config.
.PARAMETER AntigravityConfigPaths
  Arquivos mcp_config.json do Antigravity (padrao: .gemini\config e .gemini\antigravity, no perfil do usuario).
  Somente arquivos que ja existem sao alterados. / Only files that already exist are changed.
#>
[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$DryRun,
  [switch]$SkipTests,
  [switch]$NoShortcut,
  [string[]]$Target = @('Ask'),
  [string]$ClaudeDesktopConfigPath = (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'),
  [string[]]$AntigravityConfigPaths = @(
    (Join-Path $env:USERPROFILE '.gemini\config\mcp_config.json'),
    (Join-Path $env:USERPROFILE '.gemini\antigravity\mcp_config.json')
  )
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ServerPath = Join-Path $Root 'src\server.mjs'
$ServerName = 'chat-overdrive-bridge'
$IsPt = ((Get-UICulture).Name -like 'pt*')

function T([string]$pt, [string]$en) { if ($IsPt) { return $pt } else { return $en } }
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Step([string]$n, [string]$m) { Say ''; Say "[$n] $m" 'Cyan' }
function Ok([string]$m) { Say "  [OK] $m" 'Green' }
function Warn([string]$m) { Say "  [!] $m" 'Yellow' }
function Fail([string]$m) { Say "  [ERRO/ERROR] $m" 'Red'; exit 1 }
function Ask([string]$q) {
  if ($Yes) { return $true }
  $a = Read-Host "  $q [s/N, y/N]"
  return ($a -match '^(s|y|sim|yes)$')
}
function Plan([string]$m) { Say "  (dry-run) $m" 'DarkGray' }

# Com "powershell -File" (como o Instalar.bat), listas chegam como um unico texto ("Desktop,Code").
# Aceita virgula ou ponto e virgula e valida os nomes aqui.
function Split-List([string[]]$Values, [string]$Pattern) {
  $out = @()
  foreach ($v in $Values) {
    if ($v) { foreach ($piece in ($v -split $Pattern)) { $x = $piece.Trim(); if ($x) { $out += $x } } }
  }
  return $out
}
function Normalize-Targets([string[]]$Values, [string[]]$Valid) {
  $canon = @{}
  foreach ($n in $Valid) { $canon[$n.ToLower()] = $n }
  $result = @()
  foreach ($v in (Split-List $Values '[,;]')) {
    if (-not $canon.ContainsKey($v.ToLower())) {
      Say "  [ERRO/ERROR] -Target '$v' invalido/invalid. Use: $($Valid -join ', ')" 'Red'
      exit 1
    }
    $result += $canon[$v.ToLower()]
  }
  return $result
}

function Get-NodeMajor {
  try {
    $v = (& node -v) 2>$null
    if ($v -match '^v(\d+)') { return [int]$Matches[1] }
  } catch { }
  return 0
}
function Update-SessionPath {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$m;$u"
}
function Find-Chrome {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}
function Write-Utf8NoBom([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

# Mescla a entrada do servidor em um arquivo de configuracao MCP no formato { "mcpServers": { ... } },
# preservando todos os outros servidores e chaves, com backup. Nunca imprime o conteudo do arquivo.
function Register-JsonConfig([string]$Path, [string]$Label, [bool]$RequireExistingFile) {
  $dir = Split-Path -Parent $Path
  $existed = Test-Path $Path
  if ($RequireExistingFile -and -not $existed) {
    Say (T "  $Label : arquivo nao encontrado ($Path). Pulei." "  $Label : file not found ($Path). Skipped.")
    return $false
  }
  if (-not (Test-Path $dir)) {
    Warn (T "$Label nao encontrado (pasta de configuracao ausente). Pulei o registro." "$Label not found (config folder missing). Skipped registration.")
    return $false
  }
  if ($DryRun) { Plan (T "mesclaria a entrada '$ServerName' em $Path (com backup)" "would merge entry '$ServerName' into $Path (with backup)"); return $true }

  $cfg = $null
  if ($existed) {
    $raw = Get-Content -Raw -Encoding UTF8 $Path
    if ($raw.Trim().Length -gt 0) {
      try { $cfg = $raw | ConvertFrom-Json }
      catch {
        Warn (T "O arquivo de $Label existente nao e JSON puro (comentarios?). Nao alterei nada; use o trecho abaixo manualmente." "The existing $Label file is not plain JSON (comments?). Nothing was changed; use the snippet below by hand.")
        return $false
      }
    }
    $bak = "$Path.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $Path $bak
    Ok (T "backup: $bak" "backup: $bak")
  }
  if ($null -eq $cfg) { $cfg = [pscustomobject]@{} }
  if (-not ($cfg.PSObject.Properties.Name -contains 'mcpServers')) {
    $cfg | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([pscustomobject]@{})
  }
  $entry = [pscustomobject]@{ command = 'node'; args = @($ServerPath) }
  if ($cfg.mcpServers.PSObject.Properties.Name -contains $ServerName) {
    $cfg.mcpServers.$ServerName = $entry
  } else {
    $cfg.mcpServers | Add-Member -NotePropertyName $ServerName -NotePropertyValue $entry
  }
  Write-Utf8NoBom $Path ($cfg | ConvertTo-Json -Depth 20)
  Ok (T "${Label}: entrada '$ServerName' gravada. Reinicie o aplicativo." "${Label}: entry '$ServerName' written. Restart the app.")
  return $true
}

function Register-ClaudeDesktop {
  [void](Register-JsonConfig $ClaudeDesktopConfigPath 'Claude Desktop' $false)
}

function Register-Antigravity {
  $done = 0
  foreach ($p in $AntigravityConfigPaths) {
    if (Register-JsonConfig $p 'Antigravity' $true) { $done += 1 }
  }
  if ($done -eq 0) {
    Warn (T 'Antigravity nao encontrado (nenhum mcp_config.json existente). Use o trecho abaixo no Antigravity.' 'Antigravity not found (no existing mcp_config.json). Use the snippet below in Antigravity.')
  }
}

function Register-ClaudeCode {
  $cli = Get-Command claude -ErrorAction SilentlyContinue
  if (-not $cli) {
    Warn (T 'Claude Code (comando "claude") nao encontrado. Pulei o registro.' 'Claude Code ("claude" command) not found. Skipped registration.')
    return
  }
  if ($DryRun) { Plan "claude mcp add --scope user $ServerName -- node `"$ServerPath`""; return }
  & claude mcp add --scope user $ServerName -- node $ServerPath
  if ($LASTEXITCODE -eq 0) { Ok (T 'Claude Code: servidor registrado (escopo de usuario).' 'Claude Code: server registered (user scope).') }
  else { Warn (T 'O Claude Code recusou o registro (talvez ja exista). Veja: claude mcp list' 'Claude Code refused the registration (maybe it already exists). See: claude mcp list') }
}

$Target = Normalize-Targets $Target @('Ask', 'None', 'All', 'Desktop', 'Code', 'Antigravity', 'Both')
$AntigravityConfigPaths = Split-List $AntigravityConfigPaths ';'

Say ''
Say '==============================================================================' 'Cyan'
Say ' chat-overdrive-bridge - Instalador Windows / Windows Installer' 'Cyan'
Say '==============================================================================' 'Cyan'
Say (T " Pasta do projeto: $Root" " Project folder: $Root")
if ($DryRun) { Warn (T 'Modo dry-run: nada sera alterado.' 'Dry-run mode: nothing will be changed.') }
if (-not (Test-Path $ServerPath)) { Fail (T "src\server.mjs nao encontrado em $Root. Rode o instalador de dentro da pasta clonada." "src\server.mjs not found in $Root. Run the installer from the cloned folder.") }

# 1. Node.js
Step '1/6' (T 'Verificando Node.js 20 ou superior' 'Checking Node.js 20 or newer')
$major = Get-NodeMajor
if ($major -ge 20) {
  Ok "Node.js v$((& node -v).TrimStart('v'))"
} else {
  if ($major -gt 0) { Warn (T "Node.js $major encontrado, mas e preciso 20 ou superior." "Node.js $major found, but 20 or newer is required.") }
  else { Warn (T 'Node.js nao encontrado.' 'Node.js not found.') }
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget -and (Ask (T 'Instalar o Node.js LTS agora com o winget?' 'Install Node.js LTS now with winget?'))) {
    if ($DryRun) { Plan 'winget install -e --id OpenJS.NodeJS.LTS' }
    else {
      & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
      Update-SessionPath
      $major = Get-NodeMajor
      if ($major -lt 20) { Fail (T 'Node.js ainda nao esta disponivel. Feche e abra o terminal, ou instale de https://nodejs.org e rode de novo.' 'Node.js is still unavailable. Reopen the terminal, or install from https://nodejs.org and run again.') }
      Ok "Node.js v$((& node -v).TrimStart('v'))"
    }
  } elseif (-not $DryRun) {
    Fail (T 'Instale o Node.js 20+ em https://nodejs.org e rode o instalador de novo.' 'Install Node.js 20+ from https://nodejs.org and run the installer again.')
  }
}

# 2. Chrome
Step '2/6' (T 'Verificando o Google Chrome' 'Checking Google Chrome')
$chrome = Find-Chrome
if ($chrome) { Ok $chrome } else { Warn (T 'Chrome nao encontrado nos caminhos padrao. Instale-o antes de usar (https://www.google.com/chrome).' 'Chrome not found in default paths. Install it before use (https://www.google.com/chrome).') }

# 3. Dependencias
Step '3/6' (T 'Instalando dependencias (npm)' 'Installing dependencies (npm)')
if ($DryRun) { Plan 'npm ci' }
else {
  Push-Location $Root
  try {
    if (Test-Path (Join-Path $Root 'package-lock.json')) { & npm ci } else { & npm install }
    if ($LASTEXITCODE -ne 0) { Fail (T 'Falha no npm. Veja a mensagem acima.' 'npm failed. See the message above.') }
    Ok (T 'Dependencias instaladas.' 'Dependencies installed.')
  } finally { Pop-Location }
}

# 4. Verificacao
Step '4/6' (T 'Verificando a instalacao' 'Verifying the installation')
if ($DryRun) { Plan 'npm run check'; if (-not $SkipTests) { Plan 'npm test' } }
else {
  Push-Location $Root
  try {
    & npm run check *> $null
    if ($LASTEXITCODE -ne 0) { Fail (T 'npm run check falhou.' 'npm run check failed.') }
    Ok 'npm run check'
    if ($SkipTests) { Warn (T 'npm test pulado (-SkipTests).' 'npm test skipped (-SkipTests).') }
    else {
      & npm test *> $null
      if ($LASTEXITCODE -ne 0) { Fail (T 'npm test falhou. Rode "npm test" para ver os detalhes.' 'npm test failed. Run "npm test" for details.') }
      Ok (T 'npm test (fixtures locais; nenhum chat real foi contatado)' 'npm test (local fixtures; no real chat was contacted)')
    }
  } finally { Pop-Location }
}

# 5. Atalho
Step '5/6' (T 'Atalho do Chrome em modo debug' 'Chrome debug shortcut')
if ($NoShortcut) { Warn (T 'Atalho pulado (-NoShortcut).' 'Shortcut skipped (-NoShortcut).') }
elseif ($DryRun) { Plan (T 'criaria "Chrome Debug - Overdrive Bridge.lnk" na area de trabalho' 'would create "Chrome Debug - Overdrive Bridge.lnk" on the desktop') }
else {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path $desktop 'Chrome Debug - Overdrive Bridge.lnk'))
  $lnk.TargetPath = Join-Path $Root '_ferramentas\start-chrome-debug.bat'
  $lnk.WorkingDirectory = $Root
  $lnk.Description = 'Chrome com CDP em 127.0.0.1:9222 e perfil isolado'
  $lnk.Save()
  Ok (T 'Atalho criado na area de trabalho.' 'Shortcut created on the desktop.')
}

# 6. Registro no cliente MCP
Step '6/6' (T 'Registro no cliente MCP' 'MCP client registration')
# Normaliza -Target (pode ser uma lista) em um conjunto de destinos
$wanted = @()
foreach ($t in $Target) {
  switch ($t) {
    'All' { $wanted += @('Desktop', 'Code', 'Antigravity') }
    'Both' { $wanted += @('Desktop', 'Code') }
    'None' { }
    'Ask' { }
    default { $wanted += $t }
  }
}
$askMode = ($Target -contains 'Ask')
if ($askMode -and -not $Yes) {
  Say (T '  Posso registrar o servidor no seu cliente MCP (faco backup da configuracao antes).' '  I can register the server in your MCP client (the config is backed up first).')
  if (Ask (T 'Registrar no Antigravity?' 'Register in Antigravity?')) { $wanted += 'Antigravity' }
  if (Ask (T 'Registrar no Claude Desktop?' 'Register in Claude Desktop?')) { $wanted += 'Desktop' }
  if (Ask (T 'Registrar no Claude Code?' 'Register in Claude Code?')) { $wanted += 'Code' }
}
$wanted = @($wanted | Select-Object -Unique)
if ($wanted -contains 'Antigravity') { Register-Antigravity }
if ($wanted -contains 'Desktop') { Register-ClaudeDesktop }
if ($wanted -contains 'Code') { Register-ClaudeCode }
if ($wanted.Count -eq 0) { Warn (T 'Nenhum registro feito. Use o trecho abaixo no seu cliente MCP.' 'No registration done. Use the snippet below in your MCP client.') }

$jsonPath = $ServerPath.Replace('\', '/')
Say ''
Say '==============================================================================' 'Green'
Say (T ' Pronto. Proximos passos:' ' Done. Next steps:') 'Green'
Say '==============================================================================' 'Green'
Say (T ' 1. Abra o atalho "Chrome Debug - Overdrive Bridge" (ou _ferramentas\start-chrome-debug.bat).' ' 1. Open the "Chrome Debug - Overdrive Bridge" shortcut (or _ferramentas\start-chrome-debug.bat).')
Say (T ' 2. Nessa janela, faca login nos chats (perplexity.ai, gemini.google.com, chatgpt.com, claude.ai, chat.deepseek.com).' ' 2. In that window, sign in to the chats (perplexity.ai, gemini.google.com, chatgpt.com, claude.ai, chat.deepseek.com).')
Say (T ' 3. Reinicie o cliente MCP e peca: chat_bridge_status com {"doctor": true}.' ' 3. Restart your MCP client and call: chat_bridge_status with {"doctor": true}.')
Say ''
Say (T ' Trecho de configuracao MCP (se preferir registrar a mao):' ' MCP config snippet (if you prefer to register by hand):')
Say '{'
Say '  "mcpServers": {'
Say "    `"$ServerName`": { `"command`": `"node`", `"args`": [`"$jsonPath`"] }"
Say '  }'
Say '}'
Say ''
Say (T ' Para remover: Desinstalar.bat' ' To remove: Desinstalar.bat')
