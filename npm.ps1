$NodeDir = Join-Path $PSScriptRoot "tools\node-v24.18.0-win-x64"
if (-not (Test-Path (Join-Path $NodeDir "npm.cmd"))) {
  throw "Portable Node not found at $NodeDir"
}
& (Join-Path $NodeDir "npm.cmd") @args
