# DnD Overlay – Release ZIP erstellen und auf GitHub veroeffentlichen
# Einfach doppelklicken oder in PowerShell ausfuehren.

$ErrorActionPreference = 'Stop'
$root    = $PSScriptRoot
$extDir  = Join-Path $root 'extension'
$accFile = Join-Path $extDir 'accounts.json'

# -------------------------------------------------------------------------
# 1. Version und Passwort abfragen
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "=== DnD Overlay Release ===" -ForegroundColor Cyan
Write-Host ""

$version = Read-Host "Versionsnummer (z.B. 1.2.0)"
if (-not $version) { $version = "1.0.0" }
$version = $version.TrimStart('v')

$zipPw = Read-Host "ZIP-Passwort fuer Spieler (leer = kein Passwort)"

$outZip = Join-Path $root "dnd-overlay-v$version.zip"

# -------------------------------------------------------------------------
# 2. Accounts.json pruefen
# -------------------------------------------------------------------------
if (-not (Test-Path $accFile)) {
    Write-Host ""
    Write-Host "ACHTUNG: extension\accounts.json nicht gefunden!" -ForegroundColor Yellow
    Write-Host "Ohne diese Datei koennen Spieler sich nicht einloggen."
    $ans = Read-Host "Trotzdem fortfahren? (j/N)"
    if ($ans -notmatch '^[jJyY]') { exit 1 }
}

# -------------------------------------------------------------------------
# 3. Temporaeres Verzeichnis vorbereiten
# -------------------------------------------------------------------------
if (Test-Path $outZip) { Remove-Item $outZip -Force }

$tmp = Join-Path $env:TEMP 'dnd-overlay-release'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $tmp 'extension') | Out-Null

# Extension-Dateien kopieren
Copy-Item "$extDir\*" -Destination (Join-Path $tmp 'extension') -Recurse

# accounts.example.json raus, echte accounts.json rein
Remove-Item (Join-Path $tmp 'extension\accounts.example.json') -ErrorAction SilentlyContinue
if (Test-Path $accFile) {
    Copy-Item $accFile -Destination (Join-Path $tmp 'extension\accounts.json') -Force
    Write-Host "accounts.json eingebunden." -ForegroundColor Green
}

# -------------------------------------------------------------------------
# 4. ZIP erstellen (mit oder ohne Passwort via 7za)
# -------------------------------------------------------------------------
$7za = 'C:\Windows\7za.exe'

if ($zipPw) {
    & $7za a -tzip -p"$zipPw" -mem=AES256 $outZip (Join-Path $tmp 'extension\*') | Out-Null
    Write-Host "Passwortgeschuetzte ZIP erstellt." -ForegroundColor Green
} else {
    & $7za a -tzip $outZip (Join-Path $tmp 'extension\*') | Out-Null
    Write-Host "ZIP ohne Passwort erstellt." -ForegroundColor Green
}

Remove-Item $tmp -Recurse -Force

$size = [math]::Round((Get-Item $outZip).Length / 1KB, 1)
Write-Host "Datei: $outZip ($size KB)" -ForegroundColor Cyan

# -------------------------------------------------------------------------
# 5. GitHub Release erstellen
# -------------------------------------------------------------------------
Write-Host ""
$doRelease = Read-Host "GitHub Release v$version erstellen und ZIP hochladen? (J/n)"
if ($doRelease -notmatch '^[nN]') {

    Write-Host "Erstelle Release..." -ForegroundColor Cyan

    # Release Notes
    $notes = "## DnD Overlay v$version`n`n"
    $notes += "### Installation`n"
    $notes += "1. ZIP herunterladen und entpacken`n"
    if ($zipPw) {
        $notes += "2. **Passwort beim Entpacken eingeben** (erhaeltst du vom DM)`n"
    }
    $notes += "$(if ($zipPw) {'3'} else {'2'}). Chrome oeffnen → ``chrome://extensions`` → **Entwicklermodus** aktivieren`n"
    $notes += "$(if ($zipPw) {'4'} else {'3'}). **'Entpackte Erweiterung laden'** → ``extension``-Ordner auswaehlen`n"
    $notes += "$(if ($zipPw) {'5'} else {'4'}). Auf ``dndbeyond.com/games/...`` gehen → **DnD**-Button klicken → einloggen`n"
    if ($zipPw) {
        $notes += "`n> Das ZIP-Passwort erhaeltst du vom DM."
    }

    gh release create "v$version" $outZip `
        --title "DnD Overlay v$version" `
        --notes $notes

    Write-Host ""
    Write-Host "Release veroeffentlicht!" -ForegroundColor Green
    Write-Host "URL: https://github.com/soeler1337/dnd-overlay/releases/tag/v$version"
}

Write-Host ""
Write-Host "Fertig!" -ForegroundColor Cyan
if ($zipPw) {
    Write-Host "Passwort an Spieler weitergeben: $zipPw" -ForegroundColor Yellow
}
Write-Host ""
