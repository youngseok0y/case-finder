[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$StageRoot,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [string]$NsisPath = "makensis.exe"
)

$ErrorActionPreference = "Stop"
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$stage = [IO.Path]::GetFullPath($StageRoot)
$output = [IO.Path]::GetFullPath($OutputPath)
$node = Get-Command node.exe -ErrorAction Stop
$npm = Get-Command npm.cmd -ErrorAction Stop
$makensis = Get-Command $NsisPath -ErrorAction Stop

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

Invoke-Checked $node.Source @(
  (Join-Path $sourceRoot "packaging\build-staging.mjs"),
  "--source", $sourceRoot,
  "--stage", $stage
)

Push-Location (Join-Path $stage "app")
try {
  Invoke-Checked $npm.Source @("ci", "--omit=dev")
} finally {
  Pop-Location
}

Invoke-Checked $node.Source @(
  (Join-Path $sourceRoot "packaging\prune-staging.mjs"),
  "--stage", $stage
)

Invoke-Checked $node.Source @(
  (Join-Path $sourceRoot "packaging\verify-staging.mjs"),
  "--stage", $stage
)

Invoke-Checked $node.Source @(
  (Join-Path $sourceRoot "src\verifyManagedRuntime.js"),
  "--install-root", $stage,
  "--skip-query"
)

$outputParent = Split-Path -Parent $output
New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
$script = Join-Path $sourceRoot "packaging\CaseFinder.nsi"
Push-Location $sourceRoot
try {
  Invoke-Checked $makensis.Source @(
    "/V4",
    "/DSTAGING_ROOT=$stage",
    "/DOUTFILE_PATH=$output",
    $script
  )
} finally {
  Pop-Location
}

$hash = Get-FileHash -LiteralPath $output -Algorithm SHA256
Write-Output ([ordered]@{
  status = "INSTALLER_BUILD_PASS"
  sourceRoot = $sourceRoot
  stageRoot = $stage
  outputPath = $output
  nsisPath = $makensis.Source
  installerBytes = (Get-Item -LiteralPath $output).Length
  installerSha256 = $hash.Hash
} | ConvertTo-Json -Compress)
