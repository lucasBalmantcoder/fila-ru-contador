@echo off
title Fila RU - Servidor
cd /d "%~dp0"
node server/server.js %*
pause

