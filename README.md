# DnD Overlay

Chrome Extension (MV3) als Overlay ueber DnD Beyond Spielsitzungen.
Realtime-Sync ueber Supabase: DM schaltet Szenen, Musik und Initiative -
alle Spieler sehen die Aenderung sofort.

---

## Voraussetzungen

- Google Chrome (aktuell)
- [Supabase](https://supabase.com) Account (kostenloser Free Tier reicht)
- Node.js ist **nicht** benoetigt - keine Build-Pipeline, reines Vanilla JS

---

## 1. Supabase-Projekt anlegen

1. Unter [supabase.com](https://supabase.com) einloggen und **New Project** klicken.
2. Name z. B. `dnd-overlay`, Region nach Wahl (Frankfurt empfohlen fuer DE).
3. Warte bis das Projekt bereit ist (ca. 1-2 Min).
4. Gehe zu **Project Settings > API** und notiere:
   - `Project URL` (sieht aus wie `https://xxxx.supabase.co`)
   - `anon public` Key (langer JWT-String)

---

## 2. Datenbank-Schema einrichten

1. Im Supabase-Dashboard: **SQL Editor** oeffnen.
2. Inhalt von [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql) komplett hineinkopieren.
3. **Run** klicken - alle Tabellen, Trigger und Realtime-Einstellungen werden angelegt.

> RLS (Row Level Security) wird in Milestone 2 als separate Migration ergaenzt.

---

## 3. Extension-Konfiguration

Kopiere die Datei `extension/lib/config.example.js` zu `extension/lib/config.js`
und trage deine Supabase-Daten ein:

```js
// extension/lib/config.js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'dein-anon-key';
```

> `config.js` ist in `.gitignore` - sie wird nie ins Repo committed.

---

## 4. Extension lokal laden (Entwicklermodus)

1. Chrome oeffnen, in Adresszeile `chrome://extensions` eingeben.
2. Oben rechts **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** klicken.
4. Den Ordner `extension/` (nicht das Repo-Root) auswaehlen.
5. Die Extension erscheint in der Liste - keine Fehlermeldung = Erfolg.
6. Oeffne `https://www.dndbeyond.com/games/[deine-game-id]`.
7. Unten rechts erscheint ein roter **DnD**-Button - Klick oeffnet das Panel.

Nach Code-Aenderungen in der Extension: auf der `chrome://extensions`-Seite
auf den Reload-Pfeil der Extension klicken, dann DDB-Tab neu laden.

---

## 5. Storage Buckets anlegen (Milestone 4+)

Im Supabase-Dashboard unter **Storage** drei Buckets erstellen:

| Bucket-Name    | Public |
|----------------|--------|
| `backgrounds`  | ja     |
| `music`        | nein   |
| `handouts`     | nein   |

---

## Milestone-Uebersicht

| # | Inhalt                                        | Status   |
|---|-----------------------------------------------|----------|
| 1 | Extension-Geruest, Overlay-Shell auf DDB       | fertig   |
| 2 | Supabase Auth, Login-Panel, Rollenunterscheidung | offen  |
| 3 | Szenen-Schalter mit Realtime-Sync              | offen    |
| 4 | Musik via Offscreen Document                  | offen    |
| 5 | Initiative-Tracker                            | offen    |
| 6 | Handouts mit Freigabe pro Spieler / alle      | offen    |

---

## Spaetere Veroeffentlichung (Unlisted)

Die Extension wird im Chrome Web Store als **Unlisted** veroeffentlicht -
nur Personen mit dem direkten Link koennen sie installieren.
Anleitung folgt nach Milestone 6.
