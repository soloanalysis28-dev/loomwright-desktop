# Build loomwright.exe and both installers (.exe and .msi)
param(
    [string]$Version = "1.0.6.2",
    [switch]$SkipCargo
)

$ErrorActionPreference = 'Stop'
$versionParts = $Version.Split('.')
if ($versionParts.Count -ne 4 -or $versionParts.Where({ $_ -notmatch '^\d+$' }).Count -gt 0) {
    throw "Version must contain four numeric parts, for example 1.0.6.2."
}

$major = [int]$versionParts[0]
$minor = [int]$versionParts[1]
$patch = [int]$versionParts[2]
$revision = [int]$versionParts[3]
$msiBuild = ($patch * 1000) + $revision
if ($major -gt 255 -or $minor -gt 255 -or $patch -gt 65535 -or $revision -gt 65535 -or $msiBuild -gt 65535) {
    throw "Version $Version cannot be represented by a Windows Installer version."
}
$MsiVersion = "$major.$minor.$msiBuild"

$repoRoot = (Get-Item $PSScriptRoot).Parent.FullName
$windowDir = Join-Path $repoRoot "loomwright-window"
$installerDir = Join-Path $repoRoot "installer"
$exePath = Join-Path $windowDir "target\release\loomwright.exe"

Write-Host "=== Loomwright Build Script (Version $Version; MSI version $MsiVersion) ===" -ForegroundColor Cyan

# 1. Build release binary if requested
if (-not $SkipCargo) {
    Write-Host "`n[1/3] Building release binary with Cargo..." -ForegroundColor Yellow
    Push-Location $windowDir
    try {
        $cargo = Get-Command cargo.exe -ErrorAction SilentlyContinue
        if (-not $cargo -and (Test-Path "$HOME\.cargo\bin\cargo.exe")) {
            $cargo = Get-Item "$HOME\.cargo\bin\cargo.exe"
        }
        if (-not $cargo) { throw "cargo.exe not found. Install Rust and ensure Cargo is available." }
        $cargoPath = if ($cargo.Source) { $cargo.Source } else { $cargo.FullName }
        & $cargoPath build --release
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

if (-not $makensis) {
    throw "makensis.exe not found. Install NSIS 3 to build the .exe installer."
}
$makensisPath = if ($makensis.Source) { $makensis.Source } else { $makensis.FullName }

Push-Location $installerDir
try {
    & $makensisPath "/DVERSION=$Version" "loomwright.nsi"
    if ($LASTEXITCODE -ne 0) { throw "makensis failed." }
    Write-Host "NSIS installer created: Loomwright-Setup-$Version.exe" -ForegroundColor Green
} finally {
    Pop-Location
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

if (-not $candle -or -not $light) {
    throw "WiX Toolset v3.11 (candle.exe and light.exe) not found. Install it to build the .msi installer."
}
$candlePath = if ($candle.Source) { $candle.Source } else { $candle.FullName }
$lightPath = if ($light.Source) { $light.Source } else { $light.FullName }

Push-Location $installerDir
try {
    & $candlePath "-dVersion=$MsiVersion" "-dDisplayVersion=$Version" "loomwright.wxs" "-out" "loomwright.wixobj"
    if ($LASTEXITCODE -ne 0) { throw "candle failed." }
    & $lightPath "-sval" "loomwright.wixobj" "-out" "Loomwright-Setup-$Version.msi"
    if ($LASTEXITCODE -ne 0) { throw "light failed." }
    Remove-Item "loomwright.wixobj", "Loomwright-Setup-$Version.wixpdb" -ErrorAction SilentlyContinue
} finally {
    Pop-Location
}

$installerPaths = @(
    (Join-Path $installerDir "Loomwright-Setup-$Version.exe"),
    (Join-Path $installerDir "Loomwright-Setup-$Version.msi")
)
foreach ($path in $installerPaths) {
    if (-not (Test-Path $path) -or (Get-Item $path).Length -eq 0) {
        throw "Expected installer was not created: $path"
    }
}

Get-FileHash -Algorithm SHA256 $installerPaths |
    ForEach-Object { "$($_.Hash) *$([System.IO.Path]::GetFileName($_.Path))" } |
    Set-Content -Path (Join-Path $installerDir "checksums.txt") -Encoding ascii

Write-Host "`nBoth installers created in $installerDir." -ForegroundColor Green
