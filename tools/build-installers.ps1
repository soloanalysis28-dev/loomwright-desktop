# Build loomwright.exe and both installers (.exe and .msi)
param(
    [string]$Version = "1.6.0",
    [switch]$SkipCargo
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Get-Item $PSScriptRoot).Parent.FullName
$windowDir = Join-Path $repoRoot "loomwright-window"
$installerDir = Join-Path $repoRoot "installer"
$exePath = Join-Path $windowDir "target\release\loomwright.exe"

Write-Host "=== Loomwright Build Script (Version $Version) ===" -ForegroundColor Cyan

# 1. Build release binary if requested
if (-not $SkipCargo) {
    Write-Host "`n[1/3] Building release binary with Cargo..." -ForegroundColor Yellow
    Push-Location $windowDir
    try {
        cargo build --release
        if ($LASTEXITCODE -ne 0) { throw "Cargo build failed." }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $exePath)) {
    throw "Release binary not found at $exePath"
}
Write-Host "Binary ready: $exePath" -ForegroundColor Green

# 2. Build NSIS Installer (.exe)
Write-Host "`n[2/3] Building NSIS Installer (.exe)..." -ForegroundColor Yellow
$makensis = Get-Command makensis.exe -ErrorAction SilentlyContinue
if (-not $makensis) {
    $candidate = "C:\Program Files (x86)\NSIS\makensis.exe"
    if (Test-Path $candidate) { $makensis = Get-Item $candidate }
}

if ($makensis) {
    Push-Location $installerDir
    try {
        & $makensis "/DVERSION=$Version" "loomwright.nsi"
        if ($LASTEXITCODE -ne 0) { throw "makensis failed." }
        Write-Host "NSIS installer created: Loomwright-Setup-$Version.exe" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Warning "makensis.exe not found on PATH. Install NSIS 3 to build the .exe installer."
}

# 3. Build WiX Installer (.msi)
Write-Host "`n[3/3] Building WiX MSI Installer (.msi)..." -ForegroundColor Yellow
$candle = Get-Command candle.exe -ErrorAction SilentlyContinue
$light = Get-Command light.exe -ErrorAction SilentlyContinue

if (-not $candle -or -not $light) {
    $wixBin = if ($env:WIX) { Join-Path $env:WIX "bin" } else { "C:\Program Files (x86)\WiX Toolset v3.11\bin" }
    if (Test-Path (Join-Path $wixBin "candle.exe")) { $candle = Get-Item (Join-Path $wixBin "candle.exe") }
    if (Test-Path (Join-Path $wixBin "light.exe")) { $light = Get-Item (Join-Path $wixBin "light.exe") }
}

if ($candle -and $light) {
    Push-Location $installerDir
    try {
        & $candle "-dVersion=$Version" "loomwright.wxs" -out "loomwright.wixobj"
        if ($LASTEXITCODE -ne 0) { throw "candle failed." }
        & $light -sval "loomwright.wixobj" -out "Loomwright-Setup-$Version.msi"
        if ($LASTEXITCODE -ne 0) { throw "light failed." }
        Remove-Item "loomwright.wixobj", "Loomwright-Setup-$Version.wixpdb" -ErrorAction SilentlyContinue
        Write-Host "WiX MSI installer created: Loomwright-Setup-$Version.msi" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Warning "WiX toolset (candle/light) not found. Install WiX v3.11 to build the .msi installer."
}

Write-Host "`nBuild step complete." -ForegroundColor Cyan
