@echo off
set "NODE_DIR=%~dp0tools\node-v24.18.0-win-x64"

if exist "%NODE_DIR%\node.exe" (
  set "PATH=%NODE_DIR%;%PATH%"
  cd /d "%~dp0"
  call "%NODE_DIR%\npm.cmd" %*
) else (
  where npm >nul 2>nul
  if %errorlevel% neq 0 (
    echo Portable Node not found at %NODE_DIR%
    exit /b 1
  )
  npm %*
)
