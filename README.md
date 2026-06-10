# DnD Overlay – v2.4.0 (stable)

> **Aktuellste stabile Version: [v2.4.0](https://github.com/soeler1337/dnd-overlay/releases/tag/v2.4.0)**
> Alle aelteren Releases (v2.3.x) sind veraltet und sollten nicht mehr verwendet werden.

Chrome Extension (MV3) als Echtzeit-Overlay fuer DnD Beyond Spielsitzungen (`dndbeyond.com/games/[game-id]`).
Der DM steuert Szenen, Musik und Initiative – alle Spieler sehen und hoeren die Aenderung sofort.

---

## Features

| Feature | DM | Spieler |
|---|---|---|
| Hintergrundbild je Szene | schalten + AN/AUS | sehen |
| Szenen-Sync aus DDB | automatisch per Namens-Abgleich | – |
| Umgebungsmusik / Kampfmusik | steuern | hoeren |
| Wetter-Video + Wettergeraeusche | schalten | sehen / hoeren |
| Initiative starten / beenden | ✓ | Sehen (Hintergrund + Wetter ausgeblendet) |
| Handouts anzeigen (Zoom, Pan) | oeffnen & streamen | oeffnen |
| Soundboard (Einzel-SFX) | abspielen | hoeren |
| Kampagnen-Notizen (Markdown) | schreiben | lesen |
| Lautstaerke | je selbst | je selbst |
| Einklappbare Panel-Sektionen | ✓ | ✓ |
| Stream-Overlay (OBS) | Hintergrund + Handout + Wetter + Wuerfellog | – |

### Szenen-Sync
Alle Aenderungen (Szene, Wetter, Initiative, Soundboard, Hintergrund AN/AUS, Notizen) werden per **Supabase Realtime** sofort an alle Spieler auf anderen Geraeten gesendet. Die `campaign_id` wird beim Login in `chrome.storage.local` gespeichert, damit der Service Worker nach einem Neustart die Realtime-Subscription automatisch wieder aufbaut.

Auch die **Default-Szene** (wenn DDB-Szene keiner Overlay-Szene entspricht) ist vollstaendig synchronisiert: Hintergrund AN/AUS, Wetter und Initiative funktionieren auch ohne aktive Overlay-Szene fuer alle Spieler.

Wenn der DM in DDB eine Szene auswechselt, prueft die Extension ob eine Overlay-Szene mit demselben Namen existiert und wechselt automatisch. Gibt es keine passende Szene, wird eine Szene namens **„Default"** aktiviert – oder der Standard-Hintergrund angezeigt und an alle Spieler gesendet.

### Lautstaerke
Die Lautstaerke-Regler steuern die Benutzer-Lautstaerke (0–100%). Intern wird ein **Master-Gain** angewendet damit Musik auch bei 100% als Hintergrundmusik klingt:

| Kanal | Master-Gain | Slider 100% = |
|---|---|---|
| Musik | 0.4 | 40% |
| Wetter | 0.6 | 60% |
| Soundboard | 0.5 | 50% |

Werte koennen in `extension/offscreen/offscreen.js` angepasst werden.

### Testen mit zwei Browsern
Zum Testen (DM + Spieler am gleichen PC) einen **zweiten Browser** (z.B. Edge) oeffnen und dort als Spieler einloggen. Das verhaelt sich wie echter Remote-Betrieb – Updates kommen ausschliesslich ueber Supabase Realtime.

---

## Voraussetzungen

- Chrome oder Edge (kein Firefox)
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
| **Wetter-Dropdown** | Wettereffekt (Video + Sound) fuer die aktive Szene |
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
- Wetter-Video (transparentes WebM, mix-blend-mode: screen)
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
        regen.webm           # transparentes Video (mix-blend-mode: screen)
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

Migrationen liegen in `supabase/migrations/` und werden **in der Reihenfolge** `001_` → `006_` im Supabase SQL-Editor ausgefuehrt. Ab v2.3.3 wurden Migrationen `004_`–`006_` direkt per MCP angewendet und muessen nicht manuell ausgefuehrt werden.

---

## Layout

Das Overlay deckt den Spielbereich vollstaendig ab:

| Rand | Wert | Grund |
|---|---|---|
| Oben | 64 px | DDB-Kopfzeile bleibt frei (Szenen-Auswahl, Wuerfel) |
| Links / Unten / Rechts | 0 | Overlay geht bis zum Rand |

Alle DDB-UI-Elemente (Seitenleiste, Toolbars, Szenen-Dropdown) liegen per CSS (`z-index: 200 !important`) ueber dem Overlay und sind immer klickbar.
