@echo off
chcp 65001 >nul
echo Starting Cris Mailer Bot and Auto Answer System...

REM Запуск бота в новой консоли
start "Cris Mailer Bot" powershell -NoExit -Command "cd '%~dp0'; bun run index.ts"

REM Задержка 3 секунды
timeout /t 3 /nobreak >nul

REM Запуск auto_answer системы (webhook + опционально парсер)
start "Auto Answer System" powershell -NoExit -Command "cd '%~dp0auto_answer'; .\venv\Scripts\python.exe main.py"

echo All services started!
