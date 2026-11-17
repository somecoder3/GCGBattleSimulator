# GCG Battle Simulator

Kampfsimulator für das **Gundam Card Game**: gegen eine KI spielen und Meta-Decks in tausenden KI-Matches
gegeneinander antreten lassen. PWA für Desktop und Handy. Kartendaten aus
[GCGDB](https://github.com/somecoder3/GCGDB) (Git-Submodul `gcgdb/`). Plan: [docs/PLAN.md](docs/PLAN.md).

## Einrichten

Voraussetzungen: Node ≥ 22.12 (getestet mit 24 und 26), Git.

```bash
git clone --recurse-submodules https://github.com/somecoder3/GCGBattleSimulator.git
cd GCGBattleSimulator
npm ci
npm run images   # Kartenbilder nach build/images/ (siehe unten)
npm run dev      # http://localhost:5173/ (Reiter „Spielen“: gegen die KI, „Karten“: Kartenliste)
```

Bei einem bestehenden Klon ohne Submodul einmal `git submodule update --init`.

### Kartenbilder

Die offiziellen Bilder liegen **nicht** im Repo. `npm run images` übernimmt sie aus dem Cache von
GCGScanner (`../GCGScanner/build/carddb-cache/images`) und erzeugt `build/images/full/` (600 px) und
`build/images/small/` (240 px). Der Dev- und Preview-Server liefert sie unter `cards/<größe>/<datei>.webp`.

```bash
npm run images -- --source <ordner>   # andere Quelle
npm run images -- --download          # fehlende Bilder langsam von gundam-gcg.com laden
```

## Befehle

| Befehl             | Zweck                                                       |
| ------------------ | ----------------------------------------------------------- |
| `npm run dev`      | Dev-Server                                                  |
| `npm test`         | Tests (Vitest)                                              |
| `npm run check`    | Typprüfung (svelte-check)                                   |
| `npm run lint`     | ESLint                                                      |
| `npm run format`   | Prettier                                                    |
| `npm run verify`   | alles wie in der CI (Format, Lint, Typen, Tests, Build)     |
| `npm run build`    | Produktionsbuild nach `dist/`                               |
| `npm run sim`      | KI-Spiele auf allen Kernen mit Statistik (siehe unten)      |
| `npm run fuzz`     | 100 000 Zufallsspiele mit Invarianten-Prüfung               |
| `npm run coverage` | Wie viele Kartentexte die Engine versteht (`-- --set ST01`) |
| `npm run meta`     | Aktuelle Turnierdecks von Limitless laden (`-- --report`)   |
| `npm run game`     | Eine KI-Partie als Log, z. B. `-- M01 M02 3`                |
| `npm run tune`     | Gewichte der KI v1 per Selbstspiel abstimmen (`docs/AI.md`) |

Aufbau der Regel-Engine: [docs/ENGINE.md](docs/ENGINE.md), Karteneffekte: [docs/EFFECTS.md](docs/EFFECTS.md),
KI und Stärkemessungen: [docs/AI.md](docs/AI.md), Meta-Decks: [docs/META.md](docs/META.md), offizielle
Regelfälle: [docs/QA.md](docs/QA.md).

## Simulieren

Im Reiter „Simulator“ (Web Worker): Decks wählen (Meta, Starter, eigene), „Jeder gegen jeden“ oder
„Gauntlet“ (ein Deck gegen das Feld), KIs, Spiele, Seed (⟳ = zufällig). Ergebnisse mit Siegquoten und 95-%-Intervallen
pro KI und Deck, meta-gewichteter Siegquote, Matchup-Matrix (Deck-Namen beim Überfahren), **Kartenleistung** (Siegquote, wenn eine Karte
auf der Hand, gespielt oder in der Starthand war) und Spieleliste mit **Replay**. Läufe werden im Browser
gespeichert und lassen sich als JSON oder CSV exportieren.

Auf der Kommandozeile (Worker-Threads, Standard: Kerne − 1):

```bash
npm run sim -- --ai v1,random --decks starters --games 4000   # KI-Vergleich
npm run sim -- --ai v1 --decks starters --games 10000         # Deck-Matrix
npm run sim -- --decks ST01,ST03 --ai v1 --json out.json      # nur diese Decks, Ergebnisse als JSON
```

KIs: `random`, `v0`, `v1` (= `heuristic`), `search`, `strong` (= `search-strong`). Decks: `random` (Zufallsdecks), `starters`, `meta` (Top 8
der Meta, `meta12` für 12 …) oder eine Liste (`ST01,M03`).
Weitere Schalter: `--seed`, `--workers` (0 = ohne Threads), `--max-turns`, `--check` (Invarianten), `--verbose`.
Jedes Spiel folgt aus Job und Nummer und ist damit wiederholbar.

## Meta und Decks

- **Meta:** Archetypen des aktuellen Snapshots mit Anteil, Listen und Unterstützung, Konsens- und
  bestplatzierte Liste mit Kartenbildern, Bannliste; „Neu von Limitless laden“ (Zeitraum, Mindestgröße,
  Top-N) speichert den neuen Stand im Browser. Von dort direkt spielen oder gegen das Feld simulieren.
- **Decks:** eigene Decks anlegen, aus Meta/Starter kopieren, Listen importieren (alle Formate von GCGDBs
  `parseList`), mit Kartensuche bearbeiten (Liste mit Kartenbildchen, großes Bild beim Überfahren), prüfen (Deckbau-Regeln, Bannliste, Kartenunterstützung),
  speichern (IndexedDB), exportieren, spielen und simulieren.

## Spielen

Im Reiter „Spielen“ Deck (Meta, Starter ST01–ST14 mit beiden ST09-Varianten, eigene), KI-Deck, Gegner-KI, Startspieler und Seed wählen. Leuchtende
Karten sind nutzbar: anklicken und im Menü oder direkt auf dem Feld das Ziel wählen (rot pulsierend; die
Schildzone steht für den Spielerangriff), oder die Karte auf das Ziel bzw. das eigene Feld **ziehen** (Maus
und Touch). „Anhalten“ legt fest, wann das Spiel im Action Step für dich stoppt. Es fragt nur, wenn du
etwas spielen kannst; Standard „Immer“, „Bei Angriffen der KI“ überspringt nur deine eigenen Angriffe auf
den Spieler und das Zugende, „Nie“ passt immer. Leertaste = hervorgehobene Schaltfläche (Passen, Nicht blocken, Main Phase beenden),
Strg+Z = letzte eigene Entscheidung zurück, Esc = Auswahl aufheben. Im Log springt ↶ vor eine Entscheidung
oder an den Beginn eines eigenen Zuges. Die Partie wird im Browser gespeichert und lässt sich fortsetzen.
Am Handy (hochkant) liegen Log, Details und Einstellungen in einer Leiste hinter „☰ Log & Details“.

Die gebaute App (`npm run build`, `npm run preview`) ist eine installierbare PWA und läuft nach dem ersten
Besuch offline; Kartenbilder werden beim Ansehen zwischengespeichert. Icons: `npm run icons` aus
`public/icon.svg`.

## GCGDB aktualisieren

```bash
git submodule update --remote gcgdb
npm run verify
git add gcgdb && git commit -m "Update GCGDB"
```
