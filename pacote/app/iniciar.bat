@echo off
cd /d "%~dp0"
title Operacoes Lieto
node.exe node_modules\next\dist\bin\next start -H 0.0.0.0 -p 3090
pause
