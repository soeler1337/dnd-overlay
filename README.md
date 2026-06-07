# DnD Overlay – v2

Chrome Extension (MV3) als Echtzeit-Overlay fuer DnD Beyond Spielsitzungen (`dndbeyond.com/games/[game-id]`).
Der DM steuert Szenen, Musik und Initiative – alle Spieler sehen und hoeren die Aenderung sofort ueber Supabase Realtime.

---

## Features

| Feature | DM | Spieler |
|---|---|---|
| Hintergrundbild je Szene | schalten + AN/AUS | sehen |
| Szenen-Sync aus DDB | automatisch per Namens-Abgleich | – |
| Umgebungsmusik / Kampfmusik | steuern | hoeren |
| Wetter-GIF + Wettergeraeusche | schalten | sehen / hoeren |
| Initiative starten / beenden | ✓ | – |
| Handouts anzeigen (Zoom, Pan) | oeffnen & streamen | oeffnen |
| Soundboard (Einzel-SFX) | abspielen | hoeren |
| Kampagnen-Notizen (Markdown) | schreiben | lesen |
| Lautstaerke | je selbst | je selbst |
| Einklappbare Panel-Sektionen | ✓ | ✓ |
| Stream-Overlay (OBS) | Hintergrund + Handout + Wetter + Wuerfellog | – |

### Szenen-Sync (automatisch)
Wenn der DM in DDB eine Szene auswechselt, prueft die Extension ob eine Overlay-Szene mit demselben Namen existiert und wechselt automatisch. Gibt es keine passende Szene, wird eine Szene namens **„Default"** aktiviert – oder der Hintergrund ausgeblendet.

---

## Voraussetzungen

- Chrome-Browser (kein Firefox, kein Edge)
- Ein Supabase-Projekt (Free Tier reicht)
- Jeder Spieler benoetigt einen eigenen Supabase-Account (Username + Passwort)
- Der DM legt Szenen, Handouts und Musik per Watcher-Script hoch

---

## Installation

### 1. Extension in Chrome laden

1. `chrome://extensions` oeffnen
2. **Entwicklermodus** einschalten (oben rechts)
3. **Entpackte Erweiterung laden** → Ordner `extension/` auswaehlen
4. Keine Fehlermeldung = Erfolg
5. `https://www.dndbeyond.com/games/[deine-game-id]` oeffnen
6. Unten rechts erscheint ein roter **DnD**-Button

### 2. Accounts anlegen

Erstelle `extension/accounts.json` (Vorlage: `accounts.example.json`):

```json
[
  { "label": "DM",       "username": "dm_name",      "password": "passwort" },
  { "label": "Spieler1", "username": "spieler1",     "password": "passwort" }
]
```

`username` muss exakt dem Supabase-Profil entsprechen (Spalte `username` in `profiles`).
Nach dem Erstellen der Datei Extension einmal neu laden (`chrome://extensions` → Reload).

### 3. Nach Code-Aenderungen

1. `chrome://extensions` → Reload-Symbol der Extension klicken
2. DDB-Tab neu laden (`F5`)

---

## DM-Bedienung

Das Panel oeffnet sich per Klick auf den **DnD**-Button unten rechts.

| Element | Funktion |
|---|---|
| **Szene** (Zeile oben) | Zeigt die aktuell aktive Szene; **AN/AUS** blendet den Hintergrund ein/aus |
| **Initiative starten** | Schaltet Kampfmodus: Hintergrund + Wetter ausgeblendet, Kampfmusik aktiv |
| **Wetter-Dropdown** | Wettereffekt (GIF + Sound) fuer die aktive Szene |
| **Szenen** (Liste) | Manuell wechseln; wird automatisch aktualisiert wenn DDB-Szene wechselt |
| **Handouts** | Bilder/Dokumente oeffnen und auf Stream-Overlay spiegeln |
| **Soundboard** | Einzel-SFX abspielen (alle Spieler hoeren es gleichzeitig) |
| **Notizen** | Markdown-Notizen schreiben und mit Spielern teilen |
| **Musik** | Play/Stop + Lautstaerke; Standard-Musik aus `default/`-Ordner |

Alle Sektionen koennen per Klick auf den Abschnittstitel **eingeklappt** werden (Zustand bleibt nach Reload erhalten).

---

## Stream Overlay (OBS)

Als Browser-Quelle in OBS hinzufuegen:

```
URL:    https://[dein-github-user].github.io/dnd-overlay/stream-overlay.html?game=[game-id]
Breite: 1920
Hoehe:  1080
Hintergrund: transparent (Haken setzen)
```

Das Overlay zeigt automatisch:
- Hintergrundbild der aktiven Szene
- Wetter-GIF
- Gespiegelte Handouts (wenn DM eins oeffnet)
- Wuerfellog (letzte 5 Wuerfe, 18 Sek. sichtbar, Nat-20-Hervorhebung)

---

## Watcher (Medien-Upload)

Der Watcher beobachtet den `content/`-Ordner und laedt neue Dateien automatisch in Supabase Storage hoch.

```
content/
  [game-id]/
    scenes/
      Szene A/
        ambient/ambient.mp3      # Umgebungsmusik
        combat/combat.mp3        # Kampfmusik
        background/bild.jpg      # Hintergrundbild (optional – sonst greift Default)
    default/
      background/bild.jpg        # Standard-Hintergrundbild (Fallback fuer alle Szenen ohne eigenes BG)
      ambient/ambient.mp3        # Standard-Ambient (Fallback)
      combat/combat.mp3          # Standard-Kampfmusik (Fallback)
    sounds/
      Feuerball.mp3              # Soundboard-SFX
    handouts/
      Karte.png
    weather/
      regen/
        regen.gif
        regen.mp3
```

**Szenenname im Ordner muss exakt dem DDB-Szenennamen entsprechen** (Gross-/Kleinschreibung egal) damit der automatische Sync funktioniert.

Watcher starten:

```bash
cd watcher
cp .env.example .env    # Supabase URL + Service Key eintragen
npm install
node watcher.js
```

---

## Datenbankstruktur (Supabase)

Tabellen: `profiles`, `campaigns`, `sessions`, `scenes`, `handouts`, `sounds`, `weather_presets`, `campaign_notes`, `dice_rolls`

Migrationen liegen in `supabase/migrations/`. Im Supabase SQL-Editor ausfuehren (zuerst `001_`, dann `002_`).

---

## Layout

Das Overlay deckt den Spielbereich vollstaendig ab:

| Rand | Wert | Grund |
|---|---|---|
| Oben | 64 px | DDB-Kopfzeile bleibt frei (Szenen-Auswahl, Wuerfel) |
| Links / Unten / Rechts | 0 | Overlay geht bis zum Rand |

Alle DDB-UI-Elemente (Seitenleiste, Toolbars, Szenen-Dropdown) liegen per CSS (`z-index: 200 !important`) ueber dem Overlay und sind immer klickbar.
