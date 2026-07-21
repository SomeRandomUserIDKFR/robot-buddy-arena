$PSScriptRoot = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$NodeDir = Join-Path $PSScriptRoot "tools\node-v24.18.0-win-x64"
$NodeExe = Join-Path $NodeDir "node.exe"

if (Test-Path $NodeExe) {
    $env:PATH = "$NodeDir;$env:PATH"
    Set-Location $PSScriptRoot
    & (Join-Path $NodeDir "npm.cmd") $args
} else {
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        & npm $args
    } else {
        throw "Portable Node not found at $NodeDir"
    }
}
