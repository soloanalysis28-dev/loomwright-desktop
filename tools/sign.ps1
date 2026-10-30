# Sign the executable and the installer.
#
# SmartScreen reputation comes from a real code-signing certificate; a
# self-signed certificate does not help. Use an EV certificate for immediate
# reputation, or an OV certificate (reputation builds over downloads).
#
# Usage:
#   $env:LOOMWRIGHT_CERT_THUMBPRINT = 'AB12...'
#   .\sign.ps1
#
# The certificate must be in CurrentUser\My (or LocalMachine\My with -Machine).
param(
    [string]$Thumbprint = $env:LOOMWRIGHT_CERT_THUMBPRINT,
    [string]$Timestamp = 'http://timestamp.digicert.com',
    [string]$Exe = '..\loomwright-window\target\release\loomwright.exe',
    [string]$Installer = '..\installer\Loomwright-Setup-1.6.0.exe',
    [switch]$Machine
)

$ErrorActionPreference = 'Stop'

if (-not $Thumbprint) {
    throw 'Set LOOMWRIGHT_CERT_THUMBPRINT (or pass -Thumbprint) to the certificate thumbprint.'
}

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
    $kits = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    foreach ($kit in $kits) {
        $candidate = Join-Path $kit.FullName 'x64\signtool.exe'
        if (Test-Path $candidate) { $signtool = Get-Item $candidate; break }
    }
}
if (-not $signtool) {
    throw 'signtool.exe not found. Install the Windows SDK (Signing Tools).'
}

$store = if ($Machine) { 'LocalMachine' } else { 'CurrentUser' }
$cert = Get-ChildItem "Cert:\$store\My\$Thumbprint" -ErrorAction SilentlyContinue
if (-not $cert) {
    throw "Certificate $Thumbprint was not found in Cert:\$store\My."
}

foreach ($file in @($Exe, $Installer)) {
    if (-not (Test-Path $file)) { throw "Missing $file - build before signing." }
    Write-Host "Signing $file"
    & $signtool.FullName sign /fd SHA256 /td SHA256 /tr $Timestamp /sha1 $Thumbprint $file
    if ($LASTEXITCODE -ne 0) { throw "signtool failed for $file" }
    & $signtool.FullName verify /pa /v $file | Out-Host
}

Write-Host 'Signed. Rebuild the installer after signing the executable if you changed the exe.'
