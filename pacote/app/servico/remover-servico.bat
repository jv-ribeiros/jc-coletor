@echo off
set "LIETO_PS=%~dp0instalar-servico.ps1"
net session >nul 2>&1
if not errorlevel 1 goto ok
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File ' + [char]34 + $env:LIETO_PS + [char]34 + ' -Remover')"
exit /b
:ok
powershell -NoProfile -ExecutionPolicy Bypass -File "%LIETO_PS%" -Remover
