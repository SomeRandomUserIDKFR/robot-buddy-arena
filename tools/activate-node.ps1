$NodeDir = Join-Path $PSScriptRoot "node-v24.18.0-win-x64"
if (-not (Test-Path (Join-Path $NodeDir "node.exe"))) {
  throw "Portable Node not found at $NodeDir"
}
$env:PORTABLE_NODE_DIR = $NodeDir
$env:Path = "$NodeDir;$env:Path"
