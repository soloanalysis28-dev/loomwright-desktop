# Portable PowerShell installer for Loomwright
# Used if installing directly from the repository / extracted ZIP without NSIS.
param(
    [switch]$DesktopShortcut
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Get-Item $PSScriptRoot).Parent.FullName
$windowExe = Join-Path $repoRoot "loomwright-window\target\release\loomwright.exe"
$installedDir = "$env:LOCALAPPDATA\Programs\Loomwright"
$icoPath = Join-Path $PSScriptRoot "app.ico"
$readmePath = Join-Path $PSScriptRoot "README.txt"

Write-Host "Installing Loomwright to $installedDir..." -ForegroundColor Cyan

if (-not (Test-Path $windowExe)) {
    # Check if loomwright.exe is present in current folder or parent
    $localExe = Join-Path $PSScriptRoot "loomwright.exe"
    if (Test-Path $localExe) {
        $sourceExe = $localExe
    } else {
        throw "loomwright.exe not found. Build it with 'cargo build --release' or download the installer from GitHub Releases."
    }
} else {
    $sourceExe = $windowExe
}

New-Item -ItemType Directory -Force -Path $installedDir | Out-Null
Copy-Item $sourceExe (Join-Path $installedDir "loomwright.exe") -Force
if (Test-Path $icoPath) { Copy-Item $icoPath (Join-Path $installedDir "app.ico") -Force }
if (Test-Path $readmePath) { Copy-Item $readmePath (Join-Path $installedDir "README.txt") -Force }

# Shortcuts
$wsh = New-Object -ComObject WScript.Shell
$smDir = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('StartMenu'), 'Programs', 'Loomwright')
New-Item -ItemType Directory -Force -Path $smDir | Out-Null

$smShortcut = $wsh.CreateShortcut((Join-Path $smDir "Loomwright.lnk"))
$smShortcut.TargetPath = (Join-Path $installedDir "loomwright.exe")
$smShortcut.IconLocation = "$installedDir\app.ico, 0"
$smShortcut.WorkingDirectory = $installedDir
$smShortcut.Save()

if ($DesktopShortcut) {
    $desktopPath = [System.Environment]::GetFolderPath('Desktop')
    $dShortcut = $wsh.CreateShortcut((Join-Path $desktopPath "Loomwright.lnk"))
    $dShortcut.TargetPath = (Join-Path $installedDir "loomwright.exe")
    $dShortcut.IconLocation = "$installedDir\app.ico, 0"
    $dShortcut.WorkingDirectory = $installedDir
    $dShortcut.Save()
}

# Clean legacy demo shared.json
$sharedJson = "$env:APPDATA\Loomwright\shared.json"
if (Test-Path $sharedJson) { Remove-Item $sharedJson -Force -ErrorAction SilentlyContinue }
$sharedBak = "$env:APPDATA\Loomwright\shared.json.bak"
if (Test-Path $sharedBak) { Remove-Item $sharedBak -Force -ErrorAction SilentlyContinue }

Write-Host "Loomwright installed successfully!" -ForegroundColor Green
Write-Host "Launch it from the Start menu or: $installedDir\loomwright.exe" -ForegroundColor Green
