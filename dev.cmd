@echo off
set "NODE_DIR=%~dp0tools\node-v24.18.0-win-x64"
cd /d "%~dp0"

if exist "%NODE_DIR%\node.exe" (
  echo [dev] Using portable Node tools...
  set "PATH=%NODE_DIR%;%PATH%"
  call "%NODE_DIR%\npm.cmd" run dev
) else (
  echo [dev] Portable Node not found. Falling back to system Node/npm...
  where npm >nul 2>nul
  if %errorlevel% neq 0 (
    echo [error] npm is not installed on your system and portable tools are missing.
    echo Please install Node.js globally or download the portable tools.
    exit /b 1
  )
  call npm run dev
)
