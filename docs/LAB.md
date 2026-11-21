# Labor (lokaler Server, seit 21. Nov. 2026)

Die App gibt es in zwei Ausprägungen aus demselben Code (Nutzerentscheidung 21. Nov. 2026):

| Ausprägung | Start                                   | Reiter                                     | Daten                                          |
| ---------- | --------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| **PWA**    | `npm run dev` / `dev.bat`, später Pages | Spielen, Meta (nur ansehen), Decks, Karten | Browser (`localStorage`, IndexedDB)            |
| **Labor**  | `npm run lab` / `lab.bat`, Port 5180    | dazu Simulator, Replays, Meta neu laden    | SQLite unter `data-lab/lab.db` (nicht im Repo) |

Die Konstante `__LAB__` (`src/app/env.d.ts`) unterscheidet beide: `vite.config.ts` setzt sie auf `false`,
`tools/lab.ts` auf `true`. Die Labor-Bildschirme lädt `App.svelte` per dynamischem Import
(`src/app/labscreens.ts`); im PWA-Build fehlen sie ganz (geprüft: keine Simulator-Texte in `dist/`).

## Aufbau

```
Browser ──HTTP──▶ tools/lab.ts (127.0.0.1:5180)
                   ├─ /api/…  → src/lab/api.ts ─┬─ src/lab/store.ts  (SQLite, node:sqlite)
                   │                             └─ src/lab/jobs.ts   (Simulationen auf Worker-Threads)
                   └─ sonst   → Vite (Middleware-Modus, HMR) → die App mit __LAB__ = true
```

- **Speicher** (`LabStore`): Tabellen `runs` (Lauf mit Job, Decknamen, Code-Version; Spiele als gzip-JSON),
  `game_hashes` (Hash → Lauf und Spielnummer, für die Suche), `decks`, `kv` (z. B. `meta` = neu geladener
  Snapshot). `node:sqlite` ist in Node eingebaut (keine Abhängigkeit). Andere Datei: `--data <pfad>` oder
  `GCG_LAB_DATA`.
- **Jobs** (`JobManager`): eine Simulation zur Zeit, verteilt mit `runPool` auf Worker-Threads
  (`tools/node-pool.ts`, dieselben wie `npm run sim`). Fortschritt per Server-Sent Events
  (`/api/jobs/events`, zuerst der aktuelle Stand). Die Seite kann während eines Laufs geschlossen und wieder
  geöffnet werden; „Abbrechen“ speichert die bisherigen Spiele als Lauf.
- **Code-Version** (`src/lab/version.ts`): Prüfsumme über Engine, Effekte, KI, Simulation, Kartendaten,
  zu jedem Lauf gespeichert. Worker-Threads laden den Code beim Start eines Jobs, Änderungen gelten also ab
  dem nächsten Lauf.

## API

| Methode und Pfad                               | Zweck                                                     |
| ---------------------------------------------- | --------------------------------------------------------- |
| `GET /api/lab`                                 | Name, Code-Version, Kerne, Standard-Worker                |
| `GET /api/runs`                                | Läufe ohne Spiele (neueste zuerst)                        |
| `GET/DELETE /api/runs/<id>`                    | ein Lauf mit Spielen / löschen                            |
| `POST /api/runs/import`                        | Liste alter Läufe (aus dem Browser) übernehmen            |
| `GET /api/games/find?hash=…`                   | Spiel per Hash finden → `{ runId, index }`                |
| `POST /api/jobs`                               | `{ job, names, workers }` starten (409, wenn einer läuft) |
| `GET /api/jobs/current`                        | laufender oder letzter Job mit Spielen                    |
| `POST /api/jobs/stop`                          | abbrechen (bisherige Spiele werden gespeichert)           |
| `GET /api/jobs/events`                         | Server-Sent Events: `state`, `progress`, `done`           |
| `GET /api/decks`, `PUT/DELETE /api/decks/<id>` | Decks des Labors                                          |
| `GET/PUT/DELETE /api/meta`                     | neu geladener Meta-Snapshot                               |

## Sicherheit

- Der Server lauscht nur auf `127.0.0.1` (nicht im Netzwerk).
- `Host` muss `localhost`/`127.0.0.1` sein (Schutz vor DNS-Rebinding).
- CORS nur für bekannte Herkünfte (`allowedOrigin`): lokale Server (`http://localhost:<port>`) und
  `https://somecoder3.github.io`. Andere Seiten bekommen 403, damit keine fremde Webseite Läufe löscht
  oder Simulationen startet. Vorabanfragen beantworten auch Chromes Private Network Access
  (`Access-Control-Allow-Private-Network`). Chrome fragt bei einer öffentlichen Seite (Pages) einmal nach
  Zugriff aufs lokale Netzwerk.

## PWA und Labor

- **Labor-Decks:** Die PWA fragt beim Start `http://localhost:5180/api/decks` (1,5 s Zeitlimit). Antwortet ein
  Labor, erscheinen dessen Decks als eigene Kategorie „Labor-Decks“ (Ids `lab:<id>`) im Spiel-Reiter und zum
  Kopieren in eigene Decks im Decks-Reiter. Eigene Decks der PWA bleiben im Browser. Standard: an auf lokalen
  Servern, sonst aus (`localStorage` `gcg-battle-simulator.lab-connect`, `src/app/lib/lab.ts`).
- **Alte Läufe:** Läufe früherer Versionen liegen in der IndexedDB des Browsers (Store `runs`). Läuft ein
  Labor, bietet die PWA an, sie zu übertragen (`/api/runs/import`, Doppelte nach Name + Zeit übersprungen),
  und löscht sie danach im Browser.
- **Meta:** Ansehen in beiden; „Neu von Limitless laden“ nur im Labor (schreibt Daten, Speicher `kv.meta`).

## Später: Synchronisierung in der Cloud

Wunsch des Nutzers (21. Nov. 2026): eigene Decks überall dabei (Handy und Desktop), Decks mit dem Sohn
tauschen und teilen, irgendwann Mehrspieler. Favorit: **Cloudflare Workers + D1** (kostenloser Plan). Erst
nach dem Labor; Konto anlegen nur mit Zustimmung, Anmeldedaten gibt der Nutzer selbst ein. Rechnen bleibt
lokal im Labor (kostenlose Server sind dafür zu schwach).
