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
| `npm run sim`      | Spiele ohne Oberfläche, z. B. `-- --games 10000`            |
|                    | `-- --ai heuristic,random --decks starters`: KI je Seite    |
| `npm run fuzz`     | 100 000 Zufallsspiele mit Invarianten-Prüfung               |
| `npm run coverage` | Wie viele Kartentexte die Engine versteht (`-- --set ST01`) |

Aufbau der Regel-Engine: [docs/ENGINE.md](docs/ENGINE.md), Karteneffekte: [docs/EFFECTS.md](docs/EFFECTS.md),
KI: [docs/AI.md](docs/AI.md).

## Spielen

Im Reiter „Spielen“ Deck, KI-Deck, Startspieler und Seed wählen. Leuchtende Karten sind nutzbar: anklicken,
dann im Menü oder direkt auf dem Feld das Ziel wählen (rot pulsierend; die Schildzone steht für den
Spielerangriff). Leertaste = hervorgehobene Schaltfläche (Passen, Nicht blocken, Main Phase beenden),
Strg+Z = letzte eigene Entscheidung zurück, Esc = Auswahl aufheben. Im Log springt ↶ vor eine Entscheidung
oder an den Beginn eines eigenen Zuges. Die Partie wird im Browser gespeichert und lässt sich fortsetzen.

## GCGDB aktualisieren

```bash
git submodule update --remote gcgdb
npm run verify
git add gcgdb && git commit -m "Update GCGDB"
```
