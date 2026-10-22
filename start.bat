@echo off
title Meta Farming Payment Proof Bot
cd /d "%~dp0"

:loop
echo ======================================================
echo    Meta Farming Payment Proof Bot (Auto-Restart Enabled)
echo ======================================================
echo.
echo Starting Telegram Bot...
node index.js
echo.
echo [WARNING] Bot exited. Restarting in 5 seconds...
echo Press Ctrl+C if you want to stop.
timeout /t 5 /nobreak
goto loop
