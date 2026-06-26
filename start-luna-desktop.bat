@echo off
title Luna Desktop
cd /d "%~dp0"

echo Starting Luna backend + Live2D desktop avatar...
echo.
echo   Backend:  http://127.0.0.1:8787
echo   Monitor:  http://127.0.0.1:8787/monitor
echo.
echo   First time: npm run setup:live2d
echo   Put your Live2D model in apps\desktop\public\assets\live2d\
echo   Set VITE_LIVE2D_MODEL_URL in apps\desktop\.env if needed
echo.

start "Luna Backend" cmd /c "%~dp0start-luna.bat"
timeout /t 4 /nobreak >nul
npm run tauri:dev --workspace @giada/desktop

if errorlevel 1 (
  echo.
  echo Desktop app exited with an error.
  pause
)
