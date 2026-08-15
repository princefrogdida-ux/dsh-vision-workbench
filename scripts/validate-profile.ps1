param(
  [Parameter(Mandatory = $true)]
  [string]$HarnessRoot
)

$ErrorActionPreference = 'Stop'

$pluginRoot = Split-Path -Parent $PSScriptRoot
$overlayTemplate = Join-Path $PSScriptRoot 'phase5-overlay.yml'
$officialRoot = (Resolve-Path -LiteralPath $HarnessRoot).Path
$cli = Join-Path $officialRoot 'apps\cli\lib\bin.js'
$packageVersion = (Get-Content -Raw -LiteralPath (Join-Path $pluginRoot 'package.json') | ConvertFrom-Json).version
$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$tempRoot = Join-Path $tempBase ('dshvw-phase5-' + [System.Guid]::NewGuid().ToString('N'))
$resolvedTemp = [System.IO.Path]::GetFullPath($tempRoot)
if (-not $resolvedTemp.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing temporary path outside OS temp: $resolvedTemp"
}
$isolatedHome = Join-Path $resolvedTemp 'home'
$artifact = Join-Path $resolvedTemp ("dsh-vision-workbench-$packageVersion.tgz")
$overlay = Join-Path $resolvedTemp 'phase5-overlay.yml'
$languagePath = Join-Path $pluginRoot 'node_modules\@tesseract.js-data\eng\4.0.0_best_int'
$previousDshHome = $env:DSH_HOME

try {
  New-Item -ItemType Directory -Path $isolatedHome -Force | Out-Null

  & pnpm run build
  if ($LASTEXITCODE -ne 0) { throw "plugin build failed with exit code $LASTEXITCODE" }

  & pnpm pack --pack-destination $resolvedTemp
  if ($LASTEXITCODE -ne 0) { throw "plugin pack failed with exit code $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $artifact)) { throw "packed artifact not found: $artifact" }

  $escapedLanguagePath = $languagePath.Replace('\', '\\')
  (Get-Content -Raw -LiteralPath $overlayTemplate).Replace('__LOCAL_OCR_LANGUAGE_PATH__', $escapedLanguagePath) |
    Set-Content -LiteralPath $overlay -Encoding utf8NoBOM
  $env:DSH_HOME = $isolatedHome

  & node $cli plugin --profile headless add $artifact --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw "plugin install failed with exit code $LASTEXITCODE" }

  $dump = & node $cli --profile headless --patch $overlay --dump-config | Out-String
  if ($LASTEXITCODE -ne 0) { throw "config dump failed with exit code $LASTEXITCODE" }
  if ($dump -notmatch 'fallbackProviders|providerRouting|localOcr') {
    throw 'composed configuration did not expose the stage 5 local OCR settings'
  }

  & node $cli --profile headless --patch $overlay --help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "profile boot/dispose failed with exit code $LASTEXITCODE" }

  $installedPlugin = Join-Path $isolatedHome 'profiles\headless\node_modules\dsh-vision-workbench'
  $installedLocalOcr = Join-Path $installedPlugin 'lib\local-ocr.js'
  $localLocalOcr = Join-Path $pluginRoot 'lib\local-ocr.js'
  $installedHash = (Get-FileHash -LiteralPath $installedLocalOcr -Algorithm SHA256).Hash
  $localHash = (Get-FileHash -LiteralPath $localLocalOcr -Algorithm SHA256).Hash
  if ($installedHash -ne $localHash) { throw 'installed local-ocr.js hash does not match the packed build' }

  & pnpm exec tsx (Join-Path $PSScriptRoot 'smoke-installed-local-ocr.mts') $installedPlugin $languagePath
  if ($LASTEXITCODE -ne 0) { throw "installed local OCR smoke failed with exit code $LASTEXITCODE" }

  [pscustomobject]@{
    Profile = 'headless'
    PackageVersion = $packageVersion
    LocalOcr = 'enabled-and-smoked'
    ProviderFallback = 'enabled'
    BootDispose = 'passed'
    LocalOcrHash = $installedHash
  } | ConvertTo-Json -Compress
} finally {
  $env:DSH_HOME = $previousDshHome
  if (Test-Path -LiteralPath $resolvedTemp) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
