$NodeDir = Join-Path $PSScriptRoot "node-v24.18.0-win-x64"
if (-not (Test-Path (Join-Path $NodeDir "node.exe"))) {
  throw "Portable Node not found at $NodeDir"
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$entries = @()
if ($userPath) {
  $entries = $userPath -split ";" | Where-Object { $_ -and $_ -ne $NodeDir }
}

$newPath = @($NodeDir) + $entries
[Environment]::SetEnvironmentVariable("Path", ($newPath -join ";"), "User")
$env:Path = "$NodeDir;$env:Path"

Write-Host "Added portable Node to your user PATH (no admin needed):"
Write-Host $NodeDir
Write-Host ""
Write-Host "Open a new terminal, then run: npm run dev"
