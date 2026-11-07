@echo off
chcp 65001 > nul
title chat-overdrive-bridge - Instalador / Installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1" %*
echo.
pause
