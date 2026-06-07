# DnD Overlay

Chrome Extension (MV3) als Overlay fuer DnD Beyond Spielsitzungen (`dndbeyond.com/games/[game-id]`).
Realtime-Sync ueber Supabase: DM schaltet Szenen, Musik und Initiative – alle Spieler sehen die Aenderung sofort.

---

## Features

| Feature | DM | Spieler |
|---|---|---|
| Hintergrundbild je Szene | schalten | sehen |
| Umgebungsmusik / Kampfmusik | steuern | hoeren |
| Wetter-GIF + Wettergeraeusche | schalten | sehen / hoeren |
| Initiative starten / beenden | ✓ | – |
| Handouts anzeigen (Zoom, Pan) | oeffnen & streamen | oeffnen |
| Soundboard (Einzel-SFX) | abspielen | hoeren |
| Kampagnen-Notizen (Markdown) | schreiben | lesen |
| Lautstaerke & Layout-Offset | je selbst | je selbst |
| Stream-Overlay (OBS) | Hintergrund + Handout + Wetter + Wuerfellog | – |

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

Erstelle `extension/accounts.json` (wird nicht ins Git committed):

```json
[
  { "label": "DM",       "username": "dm_name",      "password": "passwort" },
  { "label": "Spieler1", "username": "spieler_name", "password": "passwort" }
]
```

`username` muss exakt dem Supabase-Profil entsprechen.

### 3. Nach Code-Aenderungen

1. `chrome://extensions` → Reload-Symbol der Extension klicken
2. DDB-Tab neu laden (`F5`)

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
  scenes/
    Szene A/
      ambient.mp3       # Umgebungsmusik
      combat.mp3        # Kampfmusik
      background.jpg    # Hintergrundbild
  default/
    ambient.mp3         # Standard-Ambient (Fallback)
    combat.mp3          # Standard-Kampfmusik (Fallback)
  sounds/
    Feuerball.mp3       # Soundboard-SFX
  handouts/
    Karte.png
  weather/
    regen.gif
    regen.mp3
```

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

Migrationen liegen in `supabase/migrations/`. Im Supabase SQL-Editor ausfuehren.

---

## Layout

Das Hintergrund-Overlay deckt nur den Spielbereich ab:

| Rand | Wert | Grund |
|---|---|---|
| Oben | 64 px | DDB-Kopfzeile (Szenen-Auswahl, Wuerfel-Optionen) |
| Links | 270 px (Slider) | DDB-Seitenleiste / Charakter-Sheet |
| Unten / Rechts | 0 | DDB-Toolbar schwimmt per z-index ueber dem Overlay |

Die DDB-Toolbar-Leisten (oben, unten) werden automatisch per z-index ueber das Overlay gehoben und sind immer erreichbar.
