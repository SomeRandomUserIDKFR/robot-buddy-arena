. "$PSScriptRoot\tools\activate-node.ps1"
Set-Location $PSScriptRoot
& (Join-Path $env:PORTABLE_NODE_DIR "npm.cmd") run dev
