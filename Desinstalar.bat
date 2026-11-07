@echo off
chcp 65001 > nul
title chat-overdrive-bridge - Desinstalador / Uninstaller
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall.ps1" %*
echo.
pause
