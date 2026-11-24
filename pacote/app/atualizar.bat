@echo off
set "LIETO_PS=%~dp0atualizar-online.ps1"
rem tudo numa linha so: este arquivo tambem e trocado na atualizacao
net session >nul 2>&1 && (powershell -NoProfile -ExecutionPolicy Bypass -File "%LIETO_PS%" & exit /b) || (powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File ' + [char]34 + $env:LIETO_PS + [char]34)" & exit /b)
