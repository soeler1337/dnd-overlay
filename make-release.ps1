# DnD Overlay – Release ZIP erstellen
# Einfach doppelklicken oder in PowerShell ausfuehren.

$ErrorActionPreference = 'Stop'
$root    = $PSScriptRoot
$outZip  = Join-Path $root 'dnd-overlay-extension.zip'
$extDir  = Join-Path $root 'extension'
$accFile = Join-Path $extDir 'accounts.json'
$accEx   = Join-Path $extDir 'accounts.example.json'

# Accounts.json pruefen
if (-not (Test-Path $accFile)) {
    Write-Host ""
    Write-Host "ACHTUNG: extension\accounts.json nicht gefunden!" -ForegroundColor Yellow
    Write-Host "Ohne diese Datei koennen Spieler sich nicht einloggen."
    Write-Host "Bitte erstelle sie zuerst (Vorlage: extension\accounts.example.json)."
    Write-Host ""
    $ans = Read-Host "Trotzdem fortfahren und ZIP ohne accounts.json erstellen? (j/N)"
    if ($ans -notmatch '^[jJyY]') { exit 1 }
}

# Alte ZIP loeschen
if (Test-Path $outZip) { Remove-Item $outZip -Force }

# Temporaeres Verzeichnis
$tmp = Join-Path $env:TEMP 'dnd-overlay-release'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null

# Extension-Dateien kopieren
Copy-Item $extDir -Destination (Join-Path $tmp 'extension') -Recurse

# accounts.example.json aus der Kopie entfernen (gehoert nicht in die Spieler-ZIP)
$exInTmp = Join-Path $tmp 'extension\accounts.example.json'
if (Test-Path $exInTmp) { Remove-Item $exInTmp -Force }

# accounts.json einfuegen falls vorhanden (liegt lokal, nie im Git)
if (Test-Path $accFile) {
    Copy-Item $accFile -Destination (Join-Path $tmp 'extension\accounts.json') -Force
    Write-Host "accounts.json eingebunden." -ForegroundColor Green
} else {
    Write-Host "accounts.json fehlt – ZIP wird ohne erstellt." -ForegroundColor Yellow
}

# ZIP packen
Compress-Archive -Path (Join-Path $tmp 'extension') -DestinationPath $outZip

# Aufraeumen
Remove-Item $tmp -Recurse -Force

$size = [math]::Round((Get-Item $outZip).Length / 1KB, 1)
Write-Host ""
Write-Host "Fertig: dnd-overlay-extension.zip ($size KB)" -ForegroundColor Cyan
Write-Host "Spieler: ZIP entpacken -> in Chrome 'Entpackte Erweiterung laden' -> extension-Ordner auswaehlen."
Write-Host ""
