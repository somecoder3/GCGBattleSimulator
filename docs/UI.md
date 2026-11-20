# Spieloberfläche (Partie gegen die KI)

Aufbau, Abläufe und Fallen des Spielfelds. Stand: Umbau nach ExBurst-Vorbild (20. Nov. 2026). Vorbild war eine
Partie auf `play.exburst.dev/gundam/play/ai`: beschriftete Zonen, Phasenleiste, Zielhinweise, Log nach Zügen mit
Filtern, Endbildschirm mit Match-Statistik. Grundsätze aus M3 gelten weiter: Die Oberfläche rendert nur
`viewFor(state, mensch)`, AP/HP kommen aus dem vollen Zustand (öffentlich), Rollback-Punkte sind nur Entscheidungen
des Menschen.

## Dateien

| Datei                                        | Inhalt                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/app/components/game/PlayScreen.svelte`  | Startbildschirm „Du VS KI“, Fortsetzen, Partie laden, Würfeln um den Start      |
| `src/app/components/game/Board.svelte`       | Spielfeld, Mittelleiste, Hand, Pfeile, Seitenleiste (Detail + Log), Animationen |
| `src/app/components/game/BoardCard.svelte`   | Eine Karte auf dem Feld/in der Hand                                             |
| `src/app/components/game/CardInfo.svelte`    | Kartendetail (Zeitpunkt-Schlüsselwörter farbig, Link-Bedingungen)               |
| `src/app/components/game/GameEnd.svelte`     | Endbildschirm mit Statistik                                                     |
| `src/app/components/game/LogIcon.svelte`     | SVG-Symbol je Log-Ereignis                                                      |
| `src/app/components/game/KeywordIcon.svelte` | Keyword-/Link-Symbol, `KeywordBadge`, `KEYWORD_LABEL`                           |
| `src/app/assets/keywords/<key>.svg`          | Die Symbole als Dateien (Farbe im `color`-Attribut), auch für die Doku          |
| `docs/keyword-icons.html`                    | Übersicht der Symbol-Dateien, per Doppelklick                                   |
| `src/app/lib/gamelog.ts`                     | Log-Zeilen aus Engine-Events, `segments`, `LOG_FILTERS`                         |
| `src/app/lib/gamesummary.ts`                 | `summarize()` für den Endbildschirm                                             |
| `src/app/lib/actions.ts`                     | Optionen/Beschriftungen der Entscheidungen                                      |
| `src/app/components/sim/ReplayScreen.svelte` | Replay nutzt dasselbe Board (`replay`-Modus, `--chrome: 112px`)                 |

Tests: `tests/app/gamelog.test.ts` (Mulligan-Zeilen, `segments`), `tests/app/gamesummary.test.ts`
(KI-Partien mit Seeds 1–3: Sieger, Züge, Vorzeichen, Schilde, letzter Treffer).

## Spielfeld (`Board.svelte`)

- **Matten** (`{#snippet mat(p)}`): Grid je Seite. KI oben gespiegelt (`"sh res piles" / "sh bat piles"`),
  eigene Seite unten (`"sh bat piles" / "sh res piles"`). Die Seite am Zug bekommt `.active` (blau du, rot KI).
  - Schildzone (`data-shields`): Stapel, Zähler (`.low` bei ≤ 2), Base; bei Schildbruch Einschlag-Ring `.boom`
    (`booms`-Map aus `animate()`, Zahl im `{#key}` startet die Animation neu) und Wackeln (`shaking`).
  - Battle Area „x/6“, `data-drop="field"`, Units mit `data-card` (für Pfeile und Ziehen & Ablegen).
  - Ressourcen als echte Karten (`.res-card`, geruht grau, EX gold), „Lv N“ und „a/n aktiv“.
  - Stapel: Deckrücken und oberste Trash-Karte mit Zahl; Klick auf Trash öffnet ihn als Dialog über dem
    Spielfeld (`showTrash`, `.trash-layer`; Esc, ✕ oder Klick daneben schließt; Überfahren zeigt die Karte im Detail,
    Klick hält sie fest). Vorher stand der Trash im Detail und verschwand beim Überfahren einer seiner Karten (Nutzer).
- **Namensschild der KI**: Schwierigkeit aus `DIFFICULTIES`, Handkarten als kleine Rücken.
- **Mittelleiste** (drei Spalten): Zug + Phasenleiste `PHASES` (Start/Draw/Resource/Main/End, `phaseIndex`) +
  Unterschritt; Aufforderung/Kampfinfo/Optionen ohne Karte; Knöpfe. `@container (max-width: 860px)`: zweizeilig.
- **Hand** als Fächer (`--k`/`--ak`), Überfahren hebt die Karte.
- **Aktionsmenü** schwebt an der gewählten Karte (`menuAt`, berechnet in `placeArrows`): Hand darüber, Feld
  daneben (damit Ziele sichtbar bleiben). Die gewählte Handkarte bleibt angehoben (`.hand-card.raised`), sonst sank sie
  beim Wechsel der Maus ins Menü und das Menü rutschte mit (Nutzer, 20. Nov.).
- **Pfeile** (SVG-Overlay, `arrowPath` = quadratische Kurve): orange für den laufenden Kampf (`view.battle`),
  gelb beim Zielen (gewählte Karte → überfahrene Karte, `drag.over` oder Schilde über `aimPlayer`). Neu berechnet
  bei Änderung von View/Auswahl, nach 360 ms (Animationen) und per ResizeObserver.
- **Starthand** (`decision.kind === "mulligan"`): groß in der Mitte mit Austeil-Animation und Knöpfen.
- **Größen**: `--fit: calc((100dvh - var(--chrome, 62px) - 330px) / 5.45)` begrenzt die Kartenbreite aus der Höhe,
  `--chrome` = Höhe von Kopfzeile (+ Replay-Leiste). ≤ 1000 px eine Spalte, ≤ 700 px Handy-Layout (Matte
  `"res res piles" / "sh bat bat"`, Seitenleiste als Schublade „☰ Log & Details“).

## Bedienung, Keywords, Links (Nutzerwunsch 20. Nov.)

- **Klick auf eine Karte spielt nie von selbst** (`immediate()` in `Board.svelte`): Einsetzen, Paaren, Commands
  und Activate öffnen immer das Aktionsmenü. Sofort wirken nur Antworten auf eine Frage (`target`, `discard`,
  `block`). Vorher spielte ein Klick eine Unit mit nur einer Option direkt aus, obwohl der Nutzer die Karte nur
  ansehen wollte.
- **Festhalten**: Klick auf eine Karte ohne Optionen hält sie im Detail (`pinned`, Leiste „📌 Festgehalten“ mit
  „Lösen“, erneuter Klick oder Esc löst). `detailId = hovered ?? selected ?? pinned`. Wie ExBursts Pin im Inspector.
- **Keyword-Symbole** (`keywordBadges()`): nur Units in der Battle Area, aus `engine.keywords()` (gedruckt, Pilot/
  Link, Dauereffekte, vorübergehende Modifier). Spalte am linken Kartenrand, außerhalb der Drehung (bleibt bei
  geruhten Units aufrecht). Weiß umrandet = nicht gedruckt (`granted`), gold leuchtend = von einem Modifier
  mit Ende (`temporary`, „during this turn/battle“). Tooltip mit Name und Menge. Symbole: Blocker Schild,
  First Strike Blitz, High-Maneuver Doppelpfeil, Suppression Fächer mit zwei Strahlen (lila), Breach Pfeil durch eine Wand, Repair Plus, Support Pfeil hoch (AP-Orange).
- **Link**: Ketten-Symbol oben rechts an gelinkten Units (ersetzt das frühere „LINK“). `linkHints` (wie ExBurst):
  Überfahren/Wählen eines eigenen Piloten (auch Command mit 【Pilot】, `pairable`) markiert Units auf der Hand und
  Units ohne Piloten im Feld, mit denen er linken würde; eine Unit markiert passende Piloten auf der Hand
  (`satisfiesLink`). Markierung: goldener Rahmen + Kette.

## Seitenleiste

- **Detail** zeigt mit Vorrang `peek` (Name im Log überfahren), sonst die überfahrene/gewählte/festgehaltene
  Karte oder eine kurze Hilfe. **Feste Höhe** (`clamp(180px, 42vh, 440px)`, Handy `34dvh`): Bei `auto`-Höhe wuchs das
  Detail beim Überfahren eines Log-Namens, schob das Log nach unten, der Zeiger verließ den Namen, das Detail
  schrumpfte – das Log sprang/flackerte (vom Nutzer gefunden, 20. Nov.). Nie wieder inhaltsabhängig machen.
- **Log**: Reiter `LOG_FILTERS` (Alle/Kämpfe/Effekte), Symbole `LogIcon`, klebende Zugüberschriften (blau du, rot
  KI), Kartennamen als `.ref`-Knöpfe aus `segments(line)`, ↶ springt zurück (`rollbackIndex`).

## Log (`gamelog.ts`)

- `LogLine` trägt `event` (Event-Art, fürs Symbol und den Filter) und `cards` (sichtbare Karten der Zeile;
  `name()` sammelt sie, `add()` hängt die im Text vorkommenden an). Verdeckte Karten heißen „eine Karte“ und sind
  kein Verweis. Ein Verweis bleibt überfahrbar, auch wenn die Karte inzwischen verdeckt ist.
- Mulligan: Die Engine legt die Ziehungen der neuen Hand **vor** das `mulligan`-Event. Darum werden in einem Schritt
  mit `mulligan` alle Ziehungen bis zum ersten `turnStart` ausgelassen (eine Zeile „… zieht eine neue Starthand“);
  das Ziehen im ersten Zug bleibt.

## Endbildschirm (`GameEnd.svelte`, `gamesummary.ts`)

- `summarize(engine, steps, human)` liefert Sieger, Züge, `points` je Zug (Vorteil = v1-Bewertung `Evaluator` /
  3,3 ≈ Schild-Werte, auf ±12 begrenzt, Spielende ±12; Schilde, Base), `sides` (Schilde zerstört, Schaden an
  Spieler/Units, Units zerstört, Karten gespielt), MVP (meiste Wirkung), letzter Treffer, Schlüsselmomente
  (Schildbrüche je Zug mit Angreifern, Base zerstört). Zuordnung über `attack`/`block`, zurückgesetzt bei
  `battleEnd`/`endAction`.
- Anzeige: Sieg/Niederlage, Kacheln „du:KI“, Vorteils-Balken (blau oben/rot unten), Schildlinien, letzte sechs
  Momente. „Spielfeld ansehen“ blendet aus (`endHidden`), Knopf „Statistik der Partie“ holt ihn zurück. Im Replay nur
  „Replay schließen“.

## Startbildschirm (`PlayScreen.svelte`)

Deck-Panels mit Aushängeschild (höchste Unit, `faceCard()`), Farben, Meta-Anteil; Schwierigkeit als Kacheln
(`LEVEL_TEXT`), Startwahl als Umschalter, Seed unter „Erweitert“, Fortsetzen zeigt Decks und Entscheidungszahl.

## Geprüft

1440×900, 1024×640 (Feld passt, „Main Phase beenden“ klickbar), 375×812 (kein waagerechtes Scrollen), Replay.
WebGPU o. Ä. war nicht nötig (CSS/SVG reichen). Prüfen im Browser per `javascript_tool` (Positionen messen) ist
zuverlässiger als verkleinerte Screenshots.
