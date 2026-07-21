@echo off
set "NODE_DIR=%~dp0tools\node-v24.18.0-win-x64"
if not exist "%NODE_DIR%\node.exe" (
  echo Portable Node not found at %NODE_DIR%
  exit /b 1
)
set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0"
call "%NODE_DIR%\npm.cmd" %*
