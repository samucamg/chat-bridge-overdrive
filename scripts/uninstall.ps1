#Requires -Version 5.1
<#
.SYNOPSIS
  chat-overdrive-bridge - desinstalador / uninstaller.

.DESCRIPTION
  PT: remove o atalho da area de trabalho e a entrada do servidor no Claude Desktop (com backup)
      e no Claude Code. Nao apaga a pasta do projeto. O perfil isolado do Chrome (com seus
      logins nos chats) so e apagado com -RemoveProfile e confirmacao.
  EN: removes the desktop shortcut and the server entry from Claude Desktop (with backup) and
      Claude Code. Does not delete the project folder. The isolated Chrome profile (with your
      chat sign-ins) is only deleted with -RemoveProfile and confirmation.
#>
[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$DryRun,
  [switch]$RemoveProfile,
  [string[]]$Target = @('All'),
  [string]$ClaudeDesktopConfigPath = (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'),
  [string[]]$AntigravityConfigPaths = @(
    (Join-Path $env:USERPROFILE '.gemini\config\mcp_config.json'),
    (Join-Path $env:USERPROFILE '.gemini\antigravity\mcp_config.json')
  )
)

$ErrorActionPreference = 'Stop'
$ServerName = 'chat-overdrive-bridge'
$IsPt = ((Get-UICulture).Name -like 'pt*')

function T([string]$pt, [string]$en) { if ($IsPt) { return $pt } else { return $en } }
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Ok([string]$m) { Say "  [OK] $m" 'Green' }
function Warn([string]$m) { Say "  [!] $m" 'Yellow' }
function Plan([string]$m) { Say "  (dry-run) $m" 'DarkGray' }
function Ask([string]$q) {
  if ($Yes) { return $true }
  $a = Read-Host "  $q [s/N, y/N]"
  return ($a -match '^(s|y|sim|yes)$')
}

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
      Write-Host "  [ERRO/ERROR] -Target '$v' invalido/invalid. Use: $($Valid -join ', ')" -ForegroundColor Red
      exit 1
    }
    $result += $canon[$v.ToLower()]
  }
  return $result
}

function Write-Utf8NoBom([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

$Target = Normalize-Targets $Target @('All', 'Both', 'None', 'Desktop', 'Code', 'Antigravity')
$AntigravityConfigPaths = Split-List $AntigravityConfigPaths ';'

Say ''
Say ' chat-overdrive-bridge - Desinstalador / Uninstaller' 'Cyan'
if ($DryRun) { Warn (T 'Modo dry-run: nada sera alterado.' 'Dry-run mode: nothing will be changed.') }

# Atalho
$lnkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Chrome Debug - Overdrive Bridge.lnk'
if (Test-Path $lnkPath) {
  if ($DryRun) { Plan (T "removeria $lnkPath" "would remove $lnkPath") }
  else { Remove-Item $lnkPath -Force; Ok (T 'Atalho removido.' 'Shortcut removed.') }
} else { Say (T '  Atalho nao encontrado (ok).' '  Shortcut not found (ok).') }

# Remove a entrada do servidor de um arquivo de configuracao MCP (com backup), sem imprimir o conteudo
function Remove-JsonEntry([string]$Path, [string]$Label) {
  if (-not (Test-Path $Path)) { Say (T "  ${Label}: configuracao nao encontrada ($Path) (ok)." "  ${Label}: config not found ($Path) (ok).") ; return }
  $raw = Get-Content -Raw -Encoding UTF8 $Path
  $cfg = $null
  try { if ($raw.Trim().Length -gt 0) { $cfg = $raw | ConvertFrom-Json } } catch {
    Warn (T "O arquivo de $Label nao e JSON puro. Nao alterei; remova a entrada a mao." "The $Label file is not plain JSON. Left untouched; remove the entry by hand.")
    return
  }
  if ($cfg -and $cfg.PSObject.Properties.Name -contains 'mcpServers' -and $cfg.mcpServers.PSObject.Properties.Name -contains $ServerName) {
    if ($DryRun) { Plan (T "removeria '$ServerName' de $Path (com backup)" "would remove '$ServerName' from $Path (with backup)"); return }
    $bak = "$Path.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $Path $bak
    $cfg.mcpServers.PSObject.Properties.Remove($ServerName)
    Write-Utf8NoBom $Path ($cfg | ConvertTo-Json -Depth 20)
    Ok (T "${Label}: entrada removida (backup: $bak). Reinicie o app." "${Label}: entry removed (backup: $bak). Restart the app.")
  } else { Say (T "  ${Label}: sem entrada para remover (ok)." "  ${Label}: no entry to remove (ok).") }
}

$wanted = @()
foreach ($t in $Target) {
  switch ($t) {
    'All' { $wanted += @('Desktop', 'Code', 'Antigravity') }
    'Both' { $wanted += @('Desktop', 'Code') }
    'None' { }
    default { $wanted += $t }
  }
}
$wanted = @($wanted | Select-Object -Unique)

# Claude Desktop
if ($wanted -contains 'Desktop') { Remove-JsonEntry $ClaudeDesktopConfigPath 'Claude Desktop' }

# Antigravity
if ($wanted -contains 'Antigravity') {
  foreach ($p in $AntigravityConfigPaths) { Remove-JsonEntry $p 'Antigravity' }
}

# Claude Code
if ($wanted -contains 'Code') {
  $cli = Get-Command claude -ErrorAction SilentlyContinue
  if ($cli) {
    if ($DryRun) { Plan "claude mcp remove --scope user $ServerName" }
    else {
      & claude mcp remove --scope user $ServerName 2>$null
      if ($LASTEXITCODE -eq 0) { Ok (T 'Claude Code: servidor removido.' 'Claude Code: server removed.') }
      else { Say (T '  Claude Code: nada para remover (ok).' '  Claude Code: nothing to remove (ok).') }
    }
  } else { Say (T '  Claude Code nao encontrado (ok).' '  Claude Code not found (ok).') }
}

# Perfil do Chrome
if ($RemoveProfile) {
  $profile = Join-Path $env:LOCALAPPDATA 'Google\Chrome-Overdrive-Bridge-Profile'
  if (Test-Path $profile) {
    Warn (T 'Apagar o perfil desconecta todos os chats que voce logou nele.' 'Deleting the profile signs you out of every chat you logged into it.')
    if ($DryRun) { Plan (T "apagaria $profile" "would delete $profile") }
    elseif (Ask (T "Apagar $profile ?" "Delete $profile ?")) {
      Remove-Item $profile -Recurse -Force
      Ok (T 'Perfil do Chrome removido.' 'Chrome profile removed.')
    } else { Say (T '  Perfil mantido.' '  Profile kept.') }
  } else { Say (T '  Perfil do Chrome nao encontrado (ok).' '  Chrome profile not found (ok).') }
}

Say ''
Say (T ' Concluido. A pasta do projeto nao foi apagada: remova-a manualmente se quiser.' ' Done. The project folder was not deleted: remove it by hand if you want.')
