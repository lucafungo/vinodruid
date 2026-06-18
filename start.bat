@echo off
cd /d "%~dp0"
start "vinoDruid - Python Backend" cmd /k "python server.py"
timeout /t 3 /nobreak >nul
start "vinoDruid - Vite Frontend" cmd /k "npm.cmd exec vite"
echo.
echo vinoDruid is starting...
echo Backend:  http://localhost:3000
echo Frontend: http://localhost:5173
echo.
timeout /t 5 /nobreak >nul
start http://localhost:5173
