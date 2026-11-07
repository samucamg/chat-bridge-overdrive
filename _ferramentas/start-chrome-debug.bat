@echo off
chcp 65001 > nul
title chat-overdrive-bridge - Chrome CDP Debug (Porta 9222)
color 0B

echo ==============================================================================
echo       INICIALIZADOR GOOGLE CHROME DEVTOOLS DEBUGGER (PORTA 9222)
echo ==============================================================================
echo.
echo Este script inicia o Google Chrome com depuracao remota aberta exclusivamente
echo em 127.0.0.1:9222 com perfil dedicado e isolado.
echo.

set "CHROME_PATH="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

if "%CHROME_PATH%"=="" (
    color 0C
    echo [ERRO] O executavel chrome.exe nao foi encontrado nos caminhos padrao.
    pause
    exit /b 1
)

echo [OK] Chrome encontrado em: "%CHROME_PATH%"
echo [OK] Perfil isolado: "%LOCALAPPDATA%\Google\Chrome-Overdrive-Bridge-Profile"
echo [OK] Inicializando Chrome em 127.0.0.1:9222...
echo.

start "" "%CHROME_PATH%" --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir="%LOCALAPPDATA%\Google\Chrome-Overdrive-Bridge-Profile" http://127.0.0.1:9222/json/version

echo Navegador iniciado em segundo plano com CDP ativo na porta 9222.
echo Conecte-se com chat-overdrive-bridge via stdio MCP.
echo.
pause
