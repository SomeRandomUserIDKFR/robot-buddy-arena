$portablePath = Join-Path $PSScriptRoot "tools\node-v24.18.0-win-x64\node.exe"
Set-Location $PSScriptRoot

if (Test-Path $portablePath) {
    Write-Host "[dev] Using portable Node tools..." -ForegroundColor Cyan
    . "$PSScriptRoot\tools\activate-node.ps1"
    & (Join-Path $env:PORTABLE_NODE_DIR "npm.cmd") run dev
} else {
    Write-Host "[dev] Portable Node not found. Falling back to system Node/npm..." -ForegroundColor Yellow
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        & npm run dev
    } else {
        Write-Error "[error] npm is not installed on your system and portable tools are missing."
        Write-Error "Please install Node.js globally or download the portable tools."
        exit 1
    }
}
