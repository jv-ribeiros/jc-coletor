@echo off
cd /d "%~dp0"
title Operacoes Lieto
sc query JCColetor >nul 2>&1
if errorlevel 1 goto abrir
echo O sistema roda como servico (JC Coletor). Abrindo no navegador...
start "" http://localhost:3090
timeout /t 4 >nul
exit /b
:abrir
node.exe node_modules\next\dist\bin\next start -H 0.0.0.0 -p 3090
pause
