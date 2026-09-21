# scripts/package.ps1
# Windows PowerShell packaging script for Chrome extension release.
# Uses system built-in tar or Compress-Archive.
# Excludes design/, scripts/, tests/, *.md, git, and release archives.

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $rootDir "manifest.json"
$releaseDir = Join-Path $rootDir "release"

if (-not (Test-Path $manifestPath)) {
    Write-Error "manifest.json not found in $rootDir"
    exit 1
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$rawName = if ($manifest.name) { $manifest.name } else { "fb-diet" }
$version = if ($manifest.version) { $manifest.version } else { "1.0.0" }

$slug = ($rawName.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
$zipFileName = "$slug-v$version.zip"
$zipFilePath = Join-Path $releaseDir $zipFileName

if (-not (Test-Path $releaseDir)) {
    New-Item -ItemType Directory -Path $releaseDir | Out-Null
}

if (Test-Path $zipFilePath) {
    Remove-Item $zipFilePath -Force
}

$includeItems = @("manifest.json", "icons", "src")

Write-Host "Packaging $rawName v$version..."

$tarCmd = Get-Command tar.exe -ErrorAction SilentlyContinue
if ($tarCmd) {
    Push-Location $rootDir
    try {
        & tar.exe -a -cf $zipFilePath manifest.json icons src
    } finally {
        Pop-Location
    }
} else {
    $fullPaths = $includeItems | ForEach-Object { Join-Path $rootDir $_ }
    Compress-Archive -Path $fullPaths -DestinationPath $zipFilePath -Force
}

if (Test-Path $zipFilePath) {
    $sizeKb = [math]::Round((Get-Item $zipFilePath).Length / 1KB, 1)
    Write-Host "✓ Package created successfully!" -ForegroundColor Green
    Write-Host "  File: release/$zipFileName ($sizeKb KB)"
    Write-Host "  Included: $($includeItems -join ', ')"
    Write-Host "  Excluded: design/, scripts/, tests/, *.md, etc."
} else {
    Write-Error "Failed to create package."
    exit 1
}
