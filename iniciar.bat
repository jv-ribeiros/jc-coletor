@echo off
cd /d "%~dp0"
title Operacoes Lieto
if not exist node_modules call npm install
echo Compilando a versao atual...
call npm run build
npm start
pause
