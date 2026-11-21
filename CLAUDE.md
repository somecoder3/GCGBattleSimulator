# GCGBattleSimulator

Privates Projekt des Nutzers: Kampfsimulator für das **Gundam Card Game** auf Basis von **GCGDB**
(Repo `somecoder3/GCGDB`, hier als Submodul `gcgdb/`, siehe dessen `CLAUDE.md`). Vorbild für Aufbau und
Abläufe ist **GCGScanner** (neben diesem Repo: `D:\programming\GCGScanner` zu Hause, `E:\programming\GCGScanner`
auf dem Arbeitsrechner). Kommunikation auf Deutsch. Der Nutzer kommt aus der
Webentwicklung. Plan und Begründungen: `docs/PLAN.md`.

## Ziele (aus der ursprünglichen Anfrage)

1. Mensch gegen Computer-KI; das Spiel soll gut aussehen und sich sehr gut anfühlen, auf Desktop und Handy (PWA).
2. Rollback, um eigene Spielfehler zum Üben rückgängig zu machen.
3. Zwei KIs spielen selbstständig tausende Matches, um die Chancen von Decks zu ermitteln.
4. Aktuelle Meta-Decks automatisch online ermitteln, mit sinnvollen Einstellungen gegeneinander antreten lassen,
   alle Statistiken erfassen.
5. Offizielle Kartenbilder verwenden (Erlaubnis des Nutzers). Erst privat und am Desktop testen, später
   öffentlich auf GitHub Pages.

## Stand (16. Nov. 2026)

- Repo `https://github.com/somecoder3/GCGBattleSimulator` (**privat**) über Chrome angelegt, Branch `main`,
  lokal per `git init` + `origin` eingerichtet (ein `git clone` ohne Anmeldung scheitert beim privaten Repo;
  das Repo war leer). Erster Commit `a73a236` (Plan, CLAUDE.md, .gitignore) vom Nutzer gepusht;
  Push mit seiner Anmeldung funktioniert.
- `docs/PLAN.md` vom Nutzer freigegeben. Entscheidungen (Abschnitt 13): TypeScript + Vite + Svelte;
  Rollback mit gleichem Zufall; **KI kennt das gegnerische Deck nicht**, darf es aber wie ein Mensch aus
  gesehenen Karten erraten; erstes Kartenziel Top-8-Archetypen der letzten 8 Wochen.
- **M0 (Gerüst) fertig**, Commit `57220b2` (vom Nutzer gepusht): Vite 8 + TypeScript 6 + Svelte 5 (Runes),
  Vitest, ESLint, Prettier, svelte-check; GCGDB als Submodul `gcgdb/` (Branch `main`); `npm run verify` = alles
  wie in der CI (`.github/workflows/ci.yml`, Node 26 seit 21. Nov., vorher 24; auch `meta.yml`). Kartenliste mit Filtern (Suche, Set, alle acht Typen wie
  auf gundam-gcg.com, Farbe) und Detaildialog. Befehle und Einrichtung: `README.md`. CI-Lauf #1 auf GitHub grün (1 min).
- **M1 (Engine-Kern) fertig**, Commit `59fe24b` (vom Nutzer gepusht). Beschreibung, Umfang und Grenzen: **`docs/ENGINE.md`**.
  Regeln ohne Kartentexte: Vorbereitung, Phasen, Ressourcen/Level/Kosten, Units, Pilots/Links, Bases,
  Kampf, Schilde, Keywords (Blocker, First Strike, High-Maneuver, Suppression, Breach, Repair, Support),
  Rules Management. Zufalls-KI, `playMatch`/`replay`, `npm run sim` und `npm run fuzz`.
  - Tests: 34 Regeltests mit Testkarten (Set `X`, `tests/engine/helpers.ts`, Baukasten `scenario()`),
    1000 Fuzz-Spiele mit Invarianten, Replay-/Determinismus-/JSON-Tests; insgesamt 49 Tests.
  - **`npm run fuzz` (100 000 Spiele, Invarianten nach jedem Schritt): 0 Fehler**, 62 s. Ohne Prüfung
    0,23 ms pro Spiel auf einem Kern (Zufalls-KI, Zufallsdecks: Ø 19 Züge, 68 Entscheidungen, Spieler 1
    gewinnt 56,6 %; Werte sind ohne Effekte und mit Zufallsspiel nicht aussagekräftig für echte Decks).
- **M2 (Effektsystem) fertig.** Beschreibung: **`docs/EFFECTS.md`** (DSL, Übersetzer,
  Compiler, Ablauf, Abdeckung, wie man Karten ergänzt, Auslegungen), Engine-Teil in `docs/ENGINE.md`.
  - Kartentexte → DSL per Übersetzer `src/effects/parse.ts` (feste Satzmuster, Unbekanntes wird nicht
    geraten) oder Handskript `src/effects/manual.ts` (Vorrang; zurzeit ST01-015, ST02-016, ST03-011, ST04-012).
    Compiler macht flache Programme; laufende Effekte sind `frames` im Zustand, wartende Trigger `queue`.
  - Engine aufgeteilt: `engine.ts` (Ablauf, Optionen, Aktionen), `core.ts` (Werte mit Dauereffekten, Filter,
    Bedingungen, Kartenbewegung, Trigger, Rules Management), `interpret.ts` (Effekte ausführen).
  - **Abdeckung (`npm run coverage`): 51,6 % der 1123 Karten vollständig, ST01–ST04 zu 100 %.**
    Starter-Decklisten in `src/data/decks.ts`.
  - Tests: 109 (Regeln 34, Kartentests ST01–ST04 49 inkl. 400 Starter-Spielen mit Invarianten,
    Übersetzer/Compiler 11, Fuzz/Replay 4, Daten 11). **`npm run fuzz` mit Effekten (100 000 Spiele): 0 Fehler**, 106 s;
    ~1,3 ms pro Spiel mit Effekten.
- **M3 (erste spielbare Oberfläche) fertig.** KI-Beschreibung: **`docs/AI.md`**.
  - Heuristik-KI v0 `src/ai/heuristic.ts`: Regeln + Kartenwert, ohne Vorausschau, nur auf ihrer Sicht; liest
    bei Zielwahl im übersetzten Effektprogramm, ob das Ziel geschädigt oder gestärkt wird. Starter-Decks:
    **93,8 % gegen Zufall** (1000 Spiele), gegen sich selbst 51/49, Startspieler 63 %.
  - `GameSession` (`src/sim/session.ts`): Mensch gegen KI, Rollback = Replay eines Präfixes (`undo`,
    `rollbackTo`, `turnStart`), speichert Schritte mit Zustand danach fürs Log, `save`/`restore` als JSON.
  - Oberfläche `src/app/components/game/` (`PlayScreen` Einstellungen/Fortsetzen, `Board` Spielfeld,
    `BoardCard`, `CardInfo`), Reiter „Spielen“ (`#play`, Standard) und „Karten“ (`#cards`) in `App.svelte`.
    Bedienung per Klick (Karte → Menü/Ziel), Leertaste, Strg+Z, Log mit ↶-Rücksprung, KI-Tempo, Partie in
    `localStorage` (`gcg-battle-simulator.game`). Log-Texte `src/app/lib/gamelog.ts` (nur sichtbare Karten
    benannt), Optionen/Beschriftungen `src/app/lib/actions.ts`. Im Browser durchgespielt (1440×900, 1280×720).
  - `npm run sim -- --ai heuristic,random --decks starters` (KI je Seite, Starter-Decks).
  - Tests: 121 (neu: KI 4, Sitzung/Rollback/Log 5, Aktionen 3).
  - Nachbesserungen nach erstem Spieltest des Nutzers: Pilot liegt 28 % nach unten versetzt unter der Unit
    (Name und AP+/HP+ sichtbar, gemessen am Kartenbild), eigenes Hovern zeigt den Piloten im Detail;
    Detail zeigt Link-Bedingungen (gelb mit ✓, wenn gelinkt); zerstörte Schilde werden 2,8 s in der Mitte
    aufgedeckt (Kartennummer aus dem vollen Zustand, da öffentlich aufgedeckt); „Choose 1 of your Resources.
    Set it as active.“ fragt nicht mehr, sondern macht eine geruhte Ressource aktiv.
- **M4 (Heuristik-KI v1, Massensimulation) fertig.** Beschreibung und Messungen: **`docs/AI.md`**.
  - Heuristik v1 (`src/ai/lookahead.ts`, Bewertung `src/ai/evaluate.ts`): probiert jede Option auf einer
    Kopie der Sicht (verdeckte Karten → `R-001`-Platzhalter, `determinize`), v0 spielt für beide bis zur Main
    Phase des nächsten Zuges weiter, Stellung bewerten. KI-Namen/Erzeugung `src/ai/registry.ts`.
  - Match-Runner `src/sim/runner.ts` (Spiel = Job + Index, Blöcke à 8 gleichen Startspieler, KI- und
    Deck-Sitz aus), Pool `src/sim/pool.ts`, Statistik `src/sim/stats.ts` (Wilson-Intervalle, Matrix),
    Node-CLI `npm run sim` mit Worker-Threads (`tools/sim-worker.ts`, `--import tsx`), Browser-Reiter
    „Simulator“ (`#sim`, `src/app/components/sim/SimScreen.svelte`, Web Worker `src/sim/worker.ts`).
  - `cloneState` (`src/engine/clone.ts`) statt `structuredClone`: v1 3× schneller.
  - Gegner-KI im Spiel wählbar (Standard v1), `SessionSetup.ai`.
  - Abnahme (Starter-Decks, Seed 1): **10 000 Spiele v1 gegen v1 in 128 s auf 8 Workern**; v1 gegen Zufall
    **97,5 %**, gegen v0 75,5 %, v0 gegen Zufall 92,9 % (je 4000). Startspieler gewinnt bei v1 64 %.
    Starter bei v1: ST04 58 %, ST01 58 %, ST03 49 %, ST02 35 %.
  - Tests: 130 (neu: v1 2, Runner/Pool/Statistik 6, cloneState 1).
  - `npm run fuzz` läuft jetzt über den Runner auf allen Kernen: 100 000 Spiele mit Invarianten in 30 s, 0 Fehler.
- **M5 (Meta) fertig.** Beschreibung: **`docs/META.md`**, Effekt-Erweiterungen in `docs/EFFECTS.md`.
  - `src/meta/`: Limitless-Client (`limitless.ts`, **keine Spielernamen speichern**), Archetypen mit
    Gewichtung/Konsensliste/Legalität (`archetypes.ts`), Bannliste (`banlist.ts`, Stand 25. Sep. 2026, von
    Hand), Decks `M01…` (`decks.ts`). `npm run meta` schreibt `data/meta/<datum>.json` (committet, im App-
    Bundle per `import.meta.glob`); GitHub Action `.github/workflows/meta.yml` montags 05:00 UTC.
  - Erster Snapshot 16. Nov.: 72 Listen aus 6 Turnieren mit Listen (16 Turniere ≥ 8 Spieler in 8 Wochen),
    15 Archetypen; Top 8: Shining Gundam 21,8 %, White Red Zaft 10,9 %, Freedom Blockers, Strike Freedom
    (Base/Aile/Victory), Sazabi, Nu Gundam. **Alle 113 Karten der Top 8 voll unterstützt**; gesamt 59,5 %
    (vorher 51,6 %). Konsenslisten sind legal (2 Hauptfarben, Bann-Paare aufgelöst).
  - Meta-Decks in Spiel und Simulator wählbar (`src/app/lib/decks.ts`), CLI `--decks meta`/`meta12`/`M03`.
  - KI-Mulligan gelockert (Unit bis Lv. 3 oder zwei Karten bis Lv. 4): Mulligans bei Meta-Decks 44 % → 2 %.
  - Gefundene Engine-Fehler: Pilot blieb zurück, wenn seine Unit unter das Deck ging oder ins Exil (jetzt
    geht er mit). `Engine.card()` berücksichtigt Piloten, die als Unit eingesetzt wurden.
  - Tests: 158 (neu: 21 Meta-Kartentests in `tests/cards/meta.test.ts`, 6 Meta-Pipeline-Tests).
    `npm run sim -- --decks meta --ai v1 --check`: 2000 Spiele ohne Fehler.
- **M6 (schöne Oberfläche) fertig**, Handy nur in der Browser-Emulation (375×812) geprüft.
  - Stopps: Einstellung „Anhalten“ (Immer/Bei Angriffen der KI/Nie, `localStorage`-Schlüssel `…stops-v2`);
    automatische Pässe sind in der Sitzung als `auto` markiert (kein Rollback-Punkt, `SavedSession.auto`).
    **Nutzerwunsch (16. Nov.):** Kann der Spieler eine Karte spielen, muss er die Chance zum Reagieren
    bekommen. Die frühere Standardstufe „Klug“ übersprang Angriffe der KI auf den Spieler (mit > 1 Schild)
    und wurde deshalb ersetzt; Standard ist jetzt „Immer“.
  - Animationen: Schadens-/Heilzahlen, Angreifer/Verteidiger, wackelnde Schildzone, Zugbanner, Zerstörung.
  - Ziehen & Ablegen mit Pointer Events (`data-drop` = Karten-Id, `player`, `field`); Klicken bleibt.
  - Handy (≤ 700 px): Kartenbreite aus Bildschirmbreite, Seitenleiste als Schublade („☰ Log & Details“).
  - PWA: `public/manifest.webmanifest`, `public/sw.js` (Version aus `__BUILD_ID__`, Kartenbilder in eigenem
    Cache), Icons aus `public/icon.svg` (`npm run icons`), Hinweis bei neuer Version. Preview-Server in
    `.claude/launch.json` (`preview`, Port 4173).
  - `npm run game -- M01 M02 3`: KI-Partie als Log (Analyse von KI und Karten).
- **Nach M6 (selbstständig):** alle 15 Meta-Archetypen voll unterstützt (M09–M15 nachgezogen, ~30 Karten,
  neue Mechaniken in `docs/EFFECTS.md` „Erweiterungen nach M5“); Abdeckung gesamt **65,1 %**.
  `npm run coverage -- --meta` zeigt Archetypen und fehlende Zeilen. 169 Tests.
  - Gewichts-Abstimmung `npm run tune` (Koordinatensuche, Bestätigungslauf; Runner kann Gewichte pro KI:
    `SimJob.weights`, `GameSpec.slots`; Node-Worker in `tools/node-pool.ts`). Erste Runde: **keine
    Verbesserung** (einziger Treffer war Zufall) → Gewichte unverändert, v1 ist durch die Suche begrenzt.
- **M7 (Such-KI) fertig, Ziel nur teilweise erreicht:** `src/ai/search.ts` (Monte Carlo über
  Determinisierungen, kein voller ISMCTS-Baum) mit Gegnermodell `src/ai/opponent.ts` (Feld möglicher Decks,
  Posterior aus gesehenen Karten). Suche – v1 **54,3 %** (800 Spiele Meta), stark – v1 53,5 %; kürzerer
  Horizont schlechter. Schwierigkeitsgrade Leicht/Normal/Schwer/Sehr schwer = v0/v1/search/search-strong
  (`DIFFICULTIES`), Standard im Spiel „Schwer“. Im Spiel kennt die KI das Feld (Meta mit Anteilen), nie das
  echte Deck.
- **M8 fertig:** Simulator-Dashboard (Gauntlet, meta-gewichtete Siegquote, Kartenleistung à la 17lands aus
  `SimJob.cardStats`/`GameSummary.cards`, Spieleliste, Export JSON/CSV, Läufe in IndexedDB), **Replays**
  (`recordGame` spielt Spiel Nr. i nach, `ReplayScreen` mit Board im `replay`-Modus), Reiter **Meta**
  (`MetaScreen`, Neu-Laden von Limitless im Browser, Cache in IndexedDB, aktiver Snapshot über
  `setSnapshot`) und **Decks** (`DecksScreen`, GCGDB `parseList`/`formatList`, Deckbau, Prüfung, IndexedDB).
  IndexedDB-Schicht `src/app/lib/db.ts` (Stores `runs`, `decks`, `meta`). Vorauswahl zwischen Reitern über
  `preset` in `src/app/lib/decks.ts`. Im Browser durchgeklickt (Desktop).
- **Alle Starter-Decks (16. Nov., Nutzerwunsch):** ST05–ST14 in `src/data/decks.ts`, ST09 als `ST09W`
  (Lila-Weiß) und `ST09R` (Rot-Lila) nach den offiziellen Rezepten deck-026/027; Quellen und Auslegungen in
  `docs/EFFECTS.md`. Alle ST-Sets zu 100 % unterstützt (~25 neue Satzmuster, neue Schritte/Trigger/Flags,
  3 Handskripte), dadurch **Abdeckung gesamt 73,2 %** (vorher 65,1 %). **Starter-Decks bleiben in
  unverändertem Aufbau trotz Bannliste legal** (Nutzer, 17. Nov.; `isUnchangedStarter` in
  `src/meta/banlist.ts`), z. B. ST02 (3× ST02-016) und ST05 (zwei Vanilla-2/2-Sorten); geändert gilt die Liste.
  Tests, die Stärken messen, nutzen weiter nur ST01–ST04 (`STARTER_DECKS.slice(0, 4)`).
  - **Zusammengeführt am 17. Nov.** mit den Korrekturen vom Arbeitsrechner (unten): Konflikte nur in
    `parse.ts` (beide Seiten hatten Nomen „Pilot card“ und die Trash-Bedingung erweitert; die allgemeinere
    `nounPhrase`-Fassung behalten) und `docs/META.md`. Geprüft: jedes Kartenskript gleicht danach exakt dem
    einer Seite; Abdeckung **73,3 %** (823 von 1123), 214 Tests. Neue Meta-Archetypen ab M11 haben wieder
    einzelne unvollständige Karten (`npm run coverage -- --meta`).
  - Vorsicht beim Aufräumen: `git worktree remove --force` folgt unter Windows Verzeichnis-Junctions und
    löscht deren Ziel (so gingen `node_modules` und `gcgdb/` verloren; wiederhergestellt mit
    `git submodule update --init --force gcgdb` und `npm ci`). Junctions vorher mit `rmdir` lösen.
  - Oberfläche: Zufalls-Seed (⟳) im Simulator, Matchup-Matrix mit eigenem Tooltip (Deck-Namen, Zeile/Spalte
    hervorgehoben), Deckliste mit Bildchen (Bildausschnitt) und großer Kartenvorschau beim Überfahren
    (nur Maus), gemeinsame Komponente `src/app/components/HoverTip.svelte`. Decks-Reiter am Handy lief über
    den Rand (Grid `1fr` → `minmax(0, 1fr)`).
- **M9 (17. Nov.), erster Teil fertig: alle Karten unterstützt** (`npm run coverage`: 100 %, 1123 Karten,
  925 automatisch, 34 Handskripte; Test in `tests/cards/m9.test.ts` hält das fest). Neu: Ereignis-Trigger über
  `raiseForPlayer`/`EventInfo`, verzögerte und verliehene Effekte (`dormant` + `grantEffect`, auch für
  Spieler), Ersatz- und Pair-Kosten (`altCost`, `pairCost`, Aktionen mit `sacrifice`/`alt`), Piloten als
  Ziel, viele Filter/Bedingungen; Details und Auslegungen in `docs/EFFECTS.md` („Erweiterungen in M9“).
  Vorgehen: Rundenweise, nach jeder Runde Vergleich aller Kartenskripte mit dem Stand davor (keine zuvor
  verstandene Karte darf sich unbeabsichtigt ändern), neue Skripte gegen den Text gelesen.
  - Fallen: Der Compiler nutzt das Feld `to` für Sprungziele (ein Schritt mit Feld `to` wird überschrieben,
    darum `copyKeywords.into`); Bedingungen über Effektvariablen auch in `not`/`or` (`frameCond`).
  - Leistung: `activeStatics` überspringt Karten ohne Dauereffekte (`hasStatic`): v1 mit Meta-Decks 290 statt
    368 ms Rechenzeit pro Spiel, Spiele identisch (verglichen). Fuzz 100 000 Spiele ohne Fehler.
  - Tests: 226.
- Aufbau: `src/data/` (Kartenmodell, Decklisten), `src/effects/` (DSL, Übersetzer, Compiler, Handskripte),
  `src/engine/`, `src/ai/`, `src/sim/`, `src/app/` (Svelte), `tools/` (`images.ts`, `sim.ts`, `coverage.ts`),
  `tests/`. Geplanter Rest siehe `docs/PLAN.md` Abschnitt 3.
- **M9 Q&A (17. Nov.):** Rules Q&A (112) und Karten-FAQ aller Sets (437 Einträge, per `curl` von
  `…/rules/faqs/list.php?series=<Set>` geladen, Texte nicht im Repo) gegen die Engine gelesen; 19 Abweichungen
  behoben, Liste in **`docs/QA.md`**, Tests `tests/cards/qa.test.ts`. Wichtigste: aktuelle HP bei „with N or
  less HP“ (Q96, vorher bewusst anders ausgelegt), Reihenfolge eigener Trigger wählbar (Q107, neue Entscheidung
  `prompt: "order"`, in Szenario-Tests `orderChoice: false`), Spielbarkeit nur mit allen Zielen/Optionen
  (`canStart`), „Then“ bleibt in der Bedingung (Q175/Q233). 239 Tests; Fuzz ohne Fehler; v1 Meta 310 ms/Spiel.
  - Falle: `git worktree remove --force` nach Junctions löschte `node_modules`/`gcgdb` (siehe oben); PDFs
    ohne Bibliothek: Streams mit `zlib` entpacken (Skript im Scratchpad, Text als `( … )Tj`).
- **KI-Mulligan neu (17. Nov., Nutzerwunsch):** `src/ai/mulligan.ts`, Regel `units` = behalten nur mit
  ≥ 2 Units bis Lv.4 (vorher `basic`: Unit bis Lv.3 oder zwei Karten bis Lv.4). Aus einer Studie mit
  18 432 behaltenen Händen abgeleitet, im direkten Vergleich v1 gegen v1 **51,4 %** (50,9–51,9 %, 36 864
  Spiele); Mulligans 2 % → 43 %. Regel pro KI-Platz wählbar (`SimJob.mulligans`, `makePolicy(…, mulligan)`),
  Werkzeug `npm run mulligan`. Details `docs/AI.md` „Mulligan“.
- **Command-Regeln der KI (18. Nov., Nutzerwunsch):** v0 spielt Commands nach Wirkung und Dauer
  (`mainCommandScore`, `commandMatters` in `src/ai/heuristic.ts`): „during this battle“ nur im Kampf,
  „during this turn“ nur, wenn es diesen Zug hilft, Ziehen am Ende der Main Phase mit Ressourcen-Reserve für
  Action-Commands. Gemessen mit `npm run ab` (neues Werkzeug für Varianten, alte Regeln als
  `eager-commands`/`eager-main-commands`/`old-commands`): v1 neu gegen alt **51,0 %** (50,3–51,7 %), v0 Main-
  Phase-Regel 50,6 %; die Action-Regel allein ändert nur 0,19 Entscheidungen pro Spiel. Optionen:
  `RuleOptions` (`SimJob.rules`, `makePolicy(…, rules)`), Details `docs/AI.md`.
  - Nachtrag (Nutzerwunsch): Ziehen zuerst bei ≤ 3 weiteren Handkarten oder ohne Unit im Spiel und ohne
    einsetzbare Unit/Base; AP−/AP+-Ziele nach geänderten Kämpfen ab aktuellem AP (gehäufte AP−2 gehen auf
    dieselbe Unit, solange es etwas ändert; `apChangeValue`). Engine summiert AP-Änderungen korrekt (Q95).
    Gemessen: kein messbarer Unterschied (v1 50,5 % / 50,2 %, je 9216 Spiele), behalten. Varianten
    `late-draw`, `plain-ap-targets`.
- **Startspieler (18. Nov., Nutzerwunsch):** Im Spiel wird vor der Partie gewürfelt (`rollForStart` in
  `src/sim/start.ts`, W6 je Seite, Gleichstand neu, nur vom Seed abhängig), der Gewinner wählt (Rules Q&A Q8);
  Dialog in `PlayScreen`, Wurf in `SessionSetup.start` und im Log. Die KI wählt immer zu beginnen
  (`src/ai/turnorder.ts`): gemessen mit `npm run first` gewinnt **jedes** von 30 Decks als Startspieler öfter
  (+9 bis +30 Punkte, gesamt 62 %), auch ohne Lv.-1-Karten (Vermutung des Nutzers widerlegt). Simulator bleibt
  ausgeglichen. Nachgemessen mit neuer EX-Regel: auch alle 15 besten Turnierlisten beginnen lieber (+7 bis +19
  Punkte, `npm run first -- --list best --starters false`); Startspieler-Vorteil gesamt 62 % → 56 % (EX-Regel).
- **EX Resource (18. Nov., Nutzerwunsch):** Regeln als `RuleOptions.ex` (`free`/`never`/`hand`/`deck`/`level`,
  Ausnahmen `exLink`, `exEmergency`), `Engine.spendsEx`/`resourceCost`, Filter `HeuristicPolicy.allowed`
  (auch in v1/Suche). Standard jetzt `deck` + Link-Ausnahme (`DEFAULT_EX`): EX Resource erst, wenn die höchste
  Unit des Decks ohne sie erreichbar bleibt, außer für einen linkenden Piloten. Gegen die alte Regel (`ex-free`)
  v0 **55,8 %**, v1 **54,1 %** (9216 Spiele); hand+link und link-only gleich stark. Tabelle `docs/AI.md`.
  Ausnahme für Commands ab Level N (`exCommandLevel`, `ex-cmd3…9`): bei Lv. 3–4 schlechter (Standard gewinnt
  v1 51,5/51,2 %), ab Lv. 5 gleich → nicht übernommen.
- **Resten (18. Nov., Nutzerwunsch):** `restValue` in `src/ai/heuristic.ts` (lohnender Angriff auf die
  geruhte Unit, Breach-Bonus, Blocker aus dem Weg, im gegnerischen Zug verhinderte Angriffe) steuert
  Rest-Commands (Main Phase und jetzt auch Action Step), Activate-Effekte und die Zielwahl; alt `plain-rest`.
  v0 51,1 %, v1 50,4 % (n. s.); nur 5 von 15 Archetypen haben Rest-Karten. `npm run ab -- --by-deck`.
- Simulator: keine Decks vorausgewählt (Nutzerwunsch 18. Nov.; vorher Meta Top 8).
  Deckauswahl in Gruppen zum Auf-/Zuklappen (`<details>`, Zustand in `opened`), Reihenfolge Eigene Decks
  (offen), Meta, Starter, Testdecks (zu); Kopf zeigt „N von M gewählt“ (Nutzerwunsch 19. Nov.). Eigene Decks
  (Id `u-…`) erscheinen überall im Simulator nur mit Namen (`shortId`/`fullName`), auch in Matrix und Spieleliste. Klappzustand in `localStorage` (`…sim-groups`); Seed bei jedem Öffnen zufällig (Nutzerwunsch, vorher 1).
- **Angesehene Karten (18. Nov., Nutzerwunsch):** „Look at the top N“-Effekte (Gundam Maxter …) melden
  ein Event `look` (nur der Schauende erfährt die Karten), Karten unter dem Deck tragen `toDeck.seenBy`.
  Log: „Du siehst dir die obersten 4 Karten deines Decks an: …“ und „Unter dein Deck: …“ (KI-Seite ohne
  Namen); Spielfeld zeigt die Karten unter dem Deck in der Mitte, bis der Mensch „Schließen“ drückt (Nutzerwunsch:
  immer manuell schließen, auch ohne Auswahl); die KI wartet so lange.
- **Fehler „während dieses Kampfs“ (18. Nov., vom Nutzer im Replay gefunden):** ST12-006 Banshee bekam
  <Suppression> per 【Activate･Action】 im Action Step der End Phase (kein Kampf) und behielt es bis zu
  seinem Angriff im nächsten Zug (zwei Schilde). Jetzt endet `until: "battle"` außerhalb eines Kampfs sofort
  (`finish` in `interpret.ts`), und die KI löst solche Fähigkeiten nicht aus, wenn sie keinen Kampf ändern
  (`battleUseless`, auch in `allowed()`). Test `tests/cards/battleonly.test.ts`. Alte Replays laufen mit
  der neuen Engine anders weiter (Replays werden neu berechnet).
- **Keine Spiegelspiele mehr im Simulator (19. Nov., Nutzerwunsch):** „Jeder gegen jeden“ spielt nur Paare
  verschiedener Decks (Häkchen „Spiegelspiele“, `npm run sim -- --mirrors`; `SimJob.mirrors`, Standard im
  Runner weiter `true`, damit `npm run ab`/`tune` Regeln auch im Spiegel vergleichen). Siegquoten ließen
  Spiegel schon immer weg, kosteten aber z. B. bei 8 Decks 8 von 36 Paarungen; die Kartenleistung
  (`cardStats`) lässt sie jetzt auch weg. Jede Paarung bekommt gleich viele Achterblöcke (`fullRounds`).
- **Selbst gegen die KI gespielt (18. Nov., Nutzerwunsch):** `npm run play` (Partie in einer JSON-Datei, jede
  Entscheidung ein Aufruf, `undo`, `cards`). ST02 gegen „Sehr schwer“ mit ST01: **0:3**. v1 gegen v1: ST02
  34 % gegen ST01 (2016 Spiele). Zweiter Versuch mit Rücksprüngen (`play -- history`/`back`, gleiche Karten):
  fünf Abzweigungen, alle verloren; ST01 zieht über Bursts (Amuro, Suletta) und White-Base-Token nach.
  Gefundener KI-Fehler: die Suche spielte ein wirkungsloses AP−3 am Ende des gegnerischen Zuges → `allowed()`
  filtert solche Commands jetzt auch für v1/Suche (`searchIdleCommands` = alt), Messung in `docs/AI.md`.
  Bewährt beim Spielen: zuerst mit einer Unit angreifen, die einen Konter-Command herauslockt.
- **Exporte (18. Nov., Nutzerwunsch):** Spiel: „Verlauf kopieren“ (Log als Text mit Kopf: Decks, KI, Seed,
  Ergebnis) und „Partie speichern (.json)“ (= `SavedSession`) am Spielende und in der Seitenleiste; „Partie
  laden …“ im Spiel-Reiter setzt eine gespeicherte Partie fort (`src/app/lib/gameexport.ts`). Dieselbe JSON-Datei
  läuft mit `npm run play -- show <datei>` (Analyse von Partien des Nutzers). Decks: Format wählen und „Liste
  kopieren“ wie in der Scanner-App (GCGDB `formatList`: Einfach, Limitless, Nur Namen, MSA, TTS; ExBurst-CSV
  weggelassen, weil „Owned“ zum Registrieren gedacht ist), statt Datei-Download; Wahl in `localStorage`.
- **Zusammengeführt am 19. Nov.** (Konflikte in `CLAUDE.md`, `docs/AI.md`, `src/ai/heuristic.ts`): v0 bewertet
  Activate-Effekte jetzt mit beidem, erst `restUseless`/`battleUseless` (hier), dann die Kampf-Regeln
  vom Arbeitsrechner (`suppressionHelps`, `firstStrikeSavesBattle`). Deren Messungen liefen noch ohne die
  Korrektur „während dieses Kampfs“.
- **Zusammengeführt am 18. Nov.** (Pull-Konflikte nur in `CLAUDE.md` und `tools/ab.ts`, beide Seiten behalten):
  `allowed()` filtert jetzt EX-Regel und wirkungslose Action-Commands; `commandMatters` kennt dabei auch das
  neue Resten (`restValue`), Rest-Commands im gegnerischen Zug bleiben also für v1/Suche erlaubt.
- **Kombos, erster Schritt (18. Nov., Nutzerwunsch):** Bei v1 sind die besten Turnierlisten schwächer als
  die Konsenslisten (49,1 % gegen 50,9 %). `src/ai/synergy.ts` erkennt Kombos aus den Effekten (Filter auf
  eigene Karten mit Trait/Name im Trash oder Spiel, Links), `npm run combos -- M01B` zeigt sie. Feste
  Zusatzwerte (Trash-Karten des Plans, gelinkte Units) machen v1 nicht stärker (49,2–49,5 %) → nur als
  Versuch `comboFuel`/`linkValue`. Übernommen: Pilot wartet auf eine Link-Unit auf der Hand (v0 50,8 %,
  v1 49,9 %; alt `pairAnyPilot`). `npm run ab -- --list best` misst mit Turnierlisten; `npm run game` kennt
  `M01B`. Details `docs/AI.md` „Kombos“.
- **Längere Vorausschau (18. Nov., Nutzerwunsch):** `RuleOptions.horizon` (`turn`/`round`/`through`).
  v1 rechnet jetzt standardmäßig bis zur eigenen nächsten Main Phase (`round`): beste Listen **52,2 %**
  gegen `turn`, Konsenslisten 49,8 %, 1,7–1,9× Rechenzeit (0,10 → 0,19 s pro Spiel, 1,5 ms pro Entscheidung). `through` (eigenen nächsten Zug mitspielen) 43,3 %,
  weil der Gegner mit Platzhalter-Handkarten nichts spielt. Suche gegen neues v1 nur noch 51,7 %; Suche mit
  `round`-Vorauswahl gemessen: 49,4 %/49,5 % (kein Gewinn, +10 % Zeit) → nicht übernommen, Nutzer entscheidet. Details `docs/AI.md` „Vorausschau“.
- **Kämpfe durch Effekte (19. Nov., Nutzerwunsch):** v0 bewertet The Final Victor (ST12-013) und andere
  „fight“-Effekte (Nu Gundam, Qubeley) mit First Strike, Schadensminderung und bester Antwort des Gegners
  (`fightCommandValue`, `fightChoice`), antwortet selbst sinnvoll und aktiviert First Strike/Suppression nur mit
  Nutzen (Banshee ST12-006 → dann The Final Victor). Vorher spielte v0 die Karte nie und zahlte Nu Gundams
  Kosten nie. v0 **50,7 %** (36 960 Spiele, ST12-Decks), v1/Suche/Meta gleich; alt `plain-fights`; `npm run
ab -- --decks ST12,ST12X,ST01,ST02,ST03,ST04` (Testliste ST12X = ST12 mit 4× The Final Victor und 2× Destiny, `TEST_DECKS` in `src/data/decks.ts`, in Spiel
  und Simulator unter „Testdecks“, auch in `npm run sim`/`play`/`game`/`combos`). Details `docs/AI.md`.
- **Kartenfilter wie bei ExBurst (19. Nov., Nutzerwunsch):** gemeinsame Komponente
  `src/app/components/CardFilters.svelte` für Karten-Reiter und Deckbau, Logik in `src/app/lib/cardfilter.ts`.
  Abschnitte Farbe, Typ, Set, Seltenheit (alle Drucke), Level, Kosten, Trait, Link, Pilot (auch 【Pilot】[Name]
  von Commands), HP, AP, Keywords (【…】 und <…>, Zusätze wie „･(Zeon) Pilot“ abgeschnitten), Link-Art, Zonen,
  Serie; innerhalb eines Abschnitts „eines davon“, Abschnitte zusammen „alle“. Schnellfilter-Leiste (★, Standard
  wie ExBurst: Typ, Seltenheit, Level, Trait, Set), 🔒 hält einen Abschnitt beim Zurücksetzen und Neuladen fest
  (`localStorage` `…card-filters`), Sortierung pro Liste (`…card-sort.<id>`). Suche mit Feldern wie ExBurst
  (`trait:zeon`, `name="…"`, `kw<>blocker`, `OR`, Klammern) plus `-wort` und Vergleichen (`ap>=4`), deutsche
  Kurzformen (`farbe`, `kosten`, …). Abschnitte mit vielen Werten (Trait, Link, Pilot, Keywords, Set, Serie) öffnen beim Hineinklicken eine scrollbare
  Liste mit Checkboxen (Mehrfachauswahl, Eintippen filtert, Pfeiltasten + Enter; Gewählte stehen beim Öffnen oben
  und springen beim Anhaken nicht). Deckbau zeigt jetzt immer Treffer (je 120, „Weitere anzeigen“), Häkchen
  „Nur Farben des Decks“. Nicht übernommen: Preise, Sammlung, Alt-Art-Einzelansicht, „Block“, Vorlagen (Presets).
- **Deck-Statistik wie bei ExBurst (19. Nov., Nutzerwunsch):** Deckbau hat Reiter „Liste | Statistik“
  (`src/app/components/decks/DeckStats.svelte`, Logik `src/app/lib/deckstats.ts`): Kosten-/Level-Kurve, Units
  (HP, AP, Kosten, Level), Farbe, Kartentypen, Traits/Link-Bedingungen/Keywords, Link-Paare (Unit ← passende
  Piloten inkl. Commands mit 【Pilot】, per `satisfiesLink`; fehlende gelb), Starthand-Chancen und Probehand
  (`SampleHand.svelte`: Mulligan, Schilde, Ziehen, Abwerfen). Klick auf Balken/Tag filtert die Kartensuche,
  nochmal hebt es auf. Unterschiede zu ExBurst (Werte für ST01 sonst gleich, Test): HP/AP nur über Units
  (ExBurst zählt dort mehr Karten mit); Starthand-Chancen **exakt nach unseren Regeln** (Lv. _und_ Kosten ≤ Zug,
  als Zweiter +1 durch EX Resource, Ziehen auch im ersten Zug, Mulligan = Hand unter das Deck, 5 ziehen, mischen),
  Zug 1–4, Unit und beliebige Karte. ExBursts „≤1-cost unit“ ignoriert das Level. Nicht übernommen: Preise,
  Sammlung, Kommentare, Match-Log (W/L%), „Considering“, Versionen.
  - Auch im **Meta-Reiter** (Nutzerwunsch): Umschalter „Karten | Statistik“ für Konsens- und Turnierlisten;
    dort ohne Kartensuche, darum ohne Klick-Filter (`onpick` optional), Diagramme breiter (`--chart-min`).
- **Spielfeld nach ExBurst-Vorbild überarbeitet (20. Nov., Nutzerwunsch):** Vorher eine Partie gegen die KI auf
  `play.exburst.dev/gundam/play/ai` gespielt (Zonen mit Beschriftung, Phasenleiste, Kartendialog, Zielhinweise,
  Log nach Zügen mit Filtern, Endbildschirm mit Match-Statistik). Umgesetzt in `src/app/components/game/`:
  - `Board.svelte`: je Seite eine „Matte“ (Schilde/Base, Battle Area x/6, Ressourcen als echte Karten mit Lv und
    „aktiv“, Deck- und Trash-Stapel mit oberster Karte), KI-Seite gespiegelt, aktive Seite leuchtet (blau du,
    rot KI); Namensschild der KI mit Schwierigkeit und Handkarten; Mittelleiste in drei Spalten (Zug +
    Phasen Start/Draw/Resource/Main/End + Substep, Aufforderung, Knöpfe), auf schmalen Spielfeldern per
    Container Query zweizeilig; Hand als Fächer; Aktionsmenü einer gewählten Karte schwebt an der Karte
    (Hand: darüber, Feld: daneben); **Pfeile** (SVG-Overlay, `placeArrows`): orange für den laufenden Kampf,
    gelb beim Zielen (Überfahren/Ziehen); Starthand groß in der Mitte zur Mulligan-Wahl; Einschlag-Ring bei
    Schildbruch; Höhe über `--chrome` (Replay hat eine Leiste mehr).
  - Log (`gamelog.ts`): Zeilen tragen `event` und `cards` (sichtbare Karten); `segments()` macht Kartennamen
    zu Verweisen (Überfahren zeigt die Karte im Detail, auch wenn sie jetzt verdeckt ist), Symbole
    `LogIcon.svelte`, Filter Alle/Kämpfe/Effekte (`LOG_FILTERS`), Zugüberschriften klebend. Mulligan: die neue
    Hand ist eine Zeile (vorher fünf „zieht eine Karte“).
  - Endbildschirm `GameEnd.svelte` mit `src/app/lib/gamesummary.ts`: Vorteil je Zug aus der v1-Bewertung
    (`Evaluator`, in Schild-Werten ≈ 3,3), Schilde je Zug, Schilde zerstört, Schaden an Units, Units zerstört,
    Karten gespielt, MVP (meiste Wirkung) und letzter Treffer, Schlüsselmomente; „Spielfeld ansehen“ blendet
    ihn aus. Kartendetail: Zeitpunkt-Schlüsselwörter farbig (Burst, Deploy, Activate, Attack, Destroyed, Pair/Link).
  - Startbildschirm `PlayScreen.svelte`: „Du VS KI“ mit Aushängeschild je Deck (höchste Unit), Schwierigkeit
    als erklärte Kacheln, Startwahl als Umschalter, Seed unter „Erweitert“.
  - Ausführliche Beschreibung (Aufbau, Dateien, Fallen): **`docs/UI.md`**.
  - Nachtrag (Nutzerwunsch): Klick auf eine Handkarte öffnet immer das Menü (nur Antworten auf Fragen wirken
    sofort), Klick auf Karten ohne Optionen hält sie im Detail fest; Keyword-Symbole an Units im Feld (nur
    solange aktiv, vorübergehende gold leuchtend), Ketten-Symbol für Links und Link-Hinweis auf der Hand beim
    Überfahren (`KeywordIcon.svelte`, `keywordBadges`, `linkHints`).
  - Symbole nach Nutzer-Vorschlägen: Suppression lila, Fächer mit zwei Strahlen (zwei Schilde; Pfeilspitzen
    ausprobiert und verworfen), Breach Pfeil durch eine Wand, Support in AP-Orange. Symbole sind eigene Dateien
    `src/app/assets/keywords/<key>.svg` (Farbe als `color="#…"` im Wurzelelement, gezeichnet mit `currentColor`);
    `KeywordIcon.svelte` lädt sie per `import.meta.glob(…, ?raw)` und nimmt die Rahmenfarbe aus der Datei;
    `docs/keyword-icons.html` zeigt dieselben Dateien per `<img>` (Doppelklick genügt, Beispiele wie Zustände und Karten; neues Symbol: Eintrag mit Rahmenfarbe in
    `KEYS`, `tests/app/keywordicons.test.ts` prüft Dateien, App und `KEYS` gegeneinander).
  - Nach Testspiel des Nutzers: gewählte Handkarte bleibt bei offenem Menü angehoben (Menü rutschte vorher mit);
    Trash als Dialog über dem Spielfeld statt im Detail (dort verschwand er beim Überfahren seiner Karten).
  - Log flackerte beim Überfahren von Kartennamen (Nutzer): das Detail darüber wuchs mit dem Text und schob das
    Log weg. Detail hat jetzt eine feste Höhe (`clamp(180px, 42vh, 440px)`, Handy `34dvh`).
  - WebGPU o. Ä. war nicht nötig (CSS/SVG reichen). Geprüft bei 1440×900, 1024×640, 375×812 und im Replay.
    Tests `tests/app/gamesummary.test.ts`, `tests/app/gamelog.test.ts`; 289 Tests.
- **Replays (20. Nov., Nutzerwunsch):** Tempo 0,5×–8× und Umschalter „Hand des Gegners“ im Replay;
  „Match exportieren (.json)“ im Endbildschirm (Decks mit Kartennamen, KIs, Ergebnis, Verlauf, Job; lädt als
  Partie); jedes Simulationsspiel hat einen **Spiel-Hash** (`src/sim/gamehash.ts`, aus Job + Index berechnet,
  im Labor indiziert), sichtbar im Endbildschirm, in der Replay-Leiste und der Spieleliste, Suche „Replay suchen“
  im Simulator. Warnung, wenn ein Replay heute anders endet als im Lauf. Details `docs/UI.md`. Tests
  `tests/sim/gamehash.test.ts`.
- **Such-Karten in der Simulation (20. Nov., vom Nutzer im Replay gefunden):** v1 griff mit White Gundam
  nicht an, weil v0 in der Simulation danach Turning Point of History spielte (zählt als verlorene Handkarte).
  Jetzt rechnen v1/Suche den Zug zusätzlich ohne solche reinen Zieh-/Such-Commands und nehmen das bessere
  Ergebnis (`optionalPlay`/`chooseWithoutOptional` in `src/ai/heuristic.ts`, alt `forcedFiller`). Gleich stark
  (v1 50,2/50,6 %, Suche 49,7 %), +5 % Zeit; Nutzer-Entscheidung: übernehmen. Ein erster Versuch, solche
  Karten in Simulationen nie zu spielen, wurde verworfen. Details `docs/AI.md` „Vorausschau“.
- **Spielfeld-Feinschliff (21. Nov., Nutzerwünsche vom Handy):** alle Kopien einer Handkarte wählbar
  (`withCopies` im Board, `Engine.isCopyOfOption`), großes Link-Symbol in der Karte (`.link-big`), Aktionsmenü bei
  jeder gewählten Karte (auch nur „ⓘ Details“), immer ganz im Bild (gemessen und begrenzt), einklappbar („▾“),
  KI-Angriffe 1,1 s mit Pfeil angekündigt (`session.aiChoice`, `announced`). Im Handy-Layout mit der Partie des
  Nutzers geprüft. Details `docs/UI.md`.
  Nachtrag: Kartenwahl durch Effekte wird gesammelt und erst mit „Bestätigen (n/m)“ ausgeführt (Tipp wählt/abwählt,
  `staged`/`confirmStaged`, `Frame.choosing.exact` neu), „ⓘ Karte ansehen“ zeigt die getippte Karte am Handy.
- **Autopilot (21. Nov., Nutzerwunsch):** „🤖 Autopilot“ in der Zugleiste lässt eine wählbare KI deine Seite
  spielen, an/aus jederzeit; KI-Stufe und Tempo in der Seitenleiste, gespeichert. `session.choiceFor`, Details
  `docs/UI.md`. Im Browser geprüft (Zug 1–9 in 8 s bei „Schnell“, danach wieder selbst am Zug). Solange
  zerstörte Schilde gezeigt werden, ziehen weder KI noch Autopilot (Nutzerwunsch). Starthand: Antippen zeigt
  die Karte im Detail (am Handy Schublade).
  - Falle beim Prüfen im Browser-Fenster: Ist die Seite `hidden`, laufen Svelte-Ausblendungen nicht zu Ende;
    alte Overlays bleiben im DOM (mit `inert`). Nur `:not([inert])` zählen.
- **Wahl von Karten verständlicher (21. Nov., vom Nutzer am Handy gefunden):** Master Gundams 【Attack】 (2
  Special Moves aus dem Trash verbannen → 5 Schaden auf die Base) wirkte nicht, weil „Fertig“ (hervorgehoben,
  Leertaste) bei „Ziel wählen“ gedrückt wurde und damit nichts gewählt war; die Engine war richtig (nachgespielt
  mit der exportierten Partie: mit Wahl 5 Schaden auf Mad Angler, danach fällt ein Schild). Jetzt nennt die Frage
  Anzahl und Ort, ohne Wahl heißt der Knopf „Nicht nutzen“ und liegt nicht auf der Leertaste (`choiceInfo`,
  `doneLabel` in `src/app/lib/actions.ts`). Test `tests/app/choiceprompt.test.ts`.
- **Kartenbilder in der App (21. Nov., Nutzerentscheidung):** Originalbilder (600 px, eine Variante; der
  Browser skaliert, Nutzerwunsch statt 240 + 480 px) verschlüsselt im Repo: `public/cards/<name>.bin` (2205
  Dateien, ~129 MB) = IV + AES-GCM-256, **fester Schlüssel im Code** (`src/data/imagecrypt.ts`), IV aus dem
  Bildinhalt (Neubau byte-gleich). `npm run images:pack` (aus `build/images/full`, entfernt Veraltetes).
  Im Build lädt `src/app/lib/cardimages.ts` die `.bin`, entschlüsselt und zeigt Blob-URLs (`CardImage` erst
  nahe dem Sichtbereich per IntersectionObserver, `use:cardSrc` für `<img>`); Dev-Server und Labor nutzen
  weiter die rohen Bilder aus `build/images`. Service Worker cacht die `.bin`. **Hinweis an den Nutzer
  gegeben:** fester Schlüssel = nur Verschleierung, jeder kann die Bilder aus der Seite holen; Passwort wie in
  GCGScanner angeboten, abgelehnt. Im Preview geprüft (Kartenliste lädt nur Sichtbares, keine rohen WebP).
- **Veröffentlichung (21. Nov., Nutzerentscheidung):** Repo öffentlich gemacht (Pages geht bei privaten Repos nur
  mit bezahltem Plan; Alternativen Cloudflare Pages, Pro, zweites Repo angeboten). `.github/workflows/pages.yml`
  baut die PWA (`vite build`, ohne Labor, mit verschlüsselten Bildern) bei jedem Push auf `main` und
  veröffentlicht sie unter `https://somecoder3.github.io/GCGBattleSimulator/` (Pages-Quelle „GitHub Actions“).
  Vorher geprüft: Commits nur mit der noreply-Adresse, keine Geheimnisse im Repo.
- **Labor (21. Nov., Nutzerentscheidung):** Simulator und Replays sind nicht mehr in der PWA, sondern im
  **Labor**: `npm run lab` / `lab.bat` startet `tools/lab.ts` (127.0.0.1:5180), Vite im Middleware-Modus mit
  `__LAB__ = true` plus API `src/lab/api.ts`; Simulationen auf Worker-Threads (`src/lab/jobs.ts`, Fortschritt
  per Server-Sent Events, Seite darf zu), Speicher SQLite über eingebautes `node:sqlite` (`src/lab/store.ts`,
  `data-lab/lab.db`, nicht im Repo): Läufe mit Code-Version (`src/lab/version.ts`) und Hash-Index, Decks,
  Meta-Snapshot. Im Labor liegen Decks und Meta auf dem Server (`db.ts` schaltet um, Client
  `src/app/lib/lab.ts`). PWA: ohne Simulator-Reiter (dynamischer Import `src/app/labscreens.ts`, im Build
  geprüft), fragt ein laufendes Labor nach Decks („Labor-Decks“, Ids `lab:…`, CORS nur für lokale Server und
  `somecoder3.github.io`, 403 sonst), bietet an, alte Browser-Läufe ins Labor zu übertragen; „Meta neu laden“
  nur im Labor. Browser-Web-Worker (`src/sim/worker.ts`, `simworkers.ts`) entfernt. Tests `tests/lab/`.
  Beschreibung **`docs/LAB.md`**. **Später:** Cloud-Synchronisierung (Decks überall, mit dem Sohn tauschen,
  irgendwann Mehrspieler), Favorit Cloudflare Workers + D1; erst nach dem Labor.
- **Neue Decks finden:** Überlegungen in **`docs/DECKSEARCH.md`**. Antworten des Nutzers (21. Nov.): keine
  Nachtläufe (Lüfter), erst v1, eigentlich Suche; nur Bannliste; Bo1; KI-Schwächen zuerst. **Stufe 0 und 1
  gebaut:** `npm run decklab` (`calibrate`, `measure`, `swaps`; `src/lab/decklab/`), Achterblöcke mit gemeinsamen
  Seeds (gepaart), Cache im Labor-Speicher, halbe Kerne als Standard. Snapshot hat jetzt `pairings` (Limitless,
  nach Platzierung, ohne Namen); Snapshot `data/meta/2026-11-21.json` (148 Paarungen, GD06 erschienen). Erste
  Kalibrierung: echte Daten dünn (0–20 Spiele je Archetyp), M01 Shining echt 65 %, KI 35,5 % → KI-Schwäche.
  Egman taugt dafür nicht (große Events nur Top 8/16 ohne Bilanzen, keine Paarungen). Tauschsuche jetzt mit
  Doppel-Tauschen, erster Runde 2 Blöcke, sequenzieller Bestätigung bis 32 Blöcke; erster Lauf M01: kein Tausch
  signifikant (bester +0,7 %). **Stufe 2 und 3 gebaut (22. Nov.):** `pearls`, `values` (Ridge-Regression),
  `swaps --pearls`, `seeds`, `evolve` (MAP-Elites, `src/lab/decklab/evolve.ts`). v0 überschätzt neue Decks stark
  (45–49 % mit v0, 15–20 % mit v1) → `--evo-ai v1`; v1-Lauf mit `--seed 2` nach Generation 5 pausiert
  (fortsetzbar mit demselben Befehl). Details `docs/DECKSEARCH.md` Abschnitt 10.
- **`dev.bat` (20. Nov., Nutzerwunsch):** Doppelklick startet `npm run dev -- --open`, vorher `npm ci` bzw.
  Submodul, falls sie fehlen. `.gitattributes`: `*.bat` mit CRLF (sonst LF für alles).
- Nächster Schritt: Rest von **M9**: Feinschliff, Vorbereitung GitHub Pages (Bilderlösung). Offen aus M7: Such-KI deutlich stärker machen (bessere Fortsetzung,
  Makro-Aktionen), Gewichte für die Suche abstimmen.
- Commits: M3 `e3bdd8e`, M4 `4f03529`, M5 `2a76b7f`, M6 bis `9da824e`, alle 15 Archetypen `d4eedaf` (alles
  vom Nutzer gepusht, 16. Nov.; der Push aus der Sitzung war vom Sicherheitsfilter abgelehnt worden).
- **Korrekturen 17. Nov. (Arbeitsrechner):**
  - Spielfeld bei niedrigen Fenstern: Bei 1024×640 ragte die eigene Seite (unten ausgerichtet) 37 px in die
    mittlere Leiste, „Main Phase beenden“ war per Maus nicht klickbar. Kartenbreite jetzt auch aus der Höhe
    (`--fit` in `Board.svelte`: `(100dvh − 360px) / 5,8`, Handkarten × 1,06), mittlere Leiste mit `z-index`,
    eigene Seite `safe flex-end`. Gemessen: 1024×640 48 px Karten, nichts überlappt; 1280×720 (62 px) und
    1440×900 (89 px) wie vorher; Handy unverändert.
  - Simulator: Spiel i spielt Paarung ⌊i/8⌋ mod Paarungen; bei 64 Spielen und 8 Decks liefen nur die
    Paarungen mit M01. Spielzahl wird jetzt auf volle Runden (8 × Paarungen) aufgerundet (`fullRounds`/
    `roundSize` in `src/sim/runner.ts`, im Formular angezeigt, ebenso `npm run sim` und `npm run tune`).
  - KI v0 legt eine Base nur, wenn es sich lohnt (HP-Gewinn gegen Schildverlust, wie die v1-Bewertung,
    `baseSwapGain` in `src/ai/heuristic.ts`); vorher ersetzte sie jede Base, auch gesunde, und als
    Fortsetzung von v1/Suche nahm sie das für beide Spieler an. Spielstärke gleich (v1 neu gegen alt 50,4 %,
    6912 Spiele). Dabei gefunden: Handlimit-Abwurf von v0 gab nie eine Wahl zurück (Punkte negativ), selten
    (≈ 1/7000 Spiele), behoben. Messungen und Regel in `docs/AI.md`.
  - Such-KI „letzte Chance“ (`src/ai/search.ts`): verliert in der Main Phase selbst die beste Option im
    Schnitt, dann alle Optionen, bis 64 Stichproben, Simulation über zwei Runden (Abbruch nach 24 ohne
    Ausweg). Prüfstellung „Base für den letzten Schild, vielleicht der Pilot zum Sieg“: Schwer 16/30 → 30/30,
    Sehr schwer 25/30 → 29/30; Test in `tests/ai/search.test.ts`. Kosten +33 % Rechenzeit bei Suche-Läufen,
    Stärke gleich. Leicht/Normal finden solche Auswege nicht. Details `docs/AI.md`.
  - Such-KI mit **Successive Halving** (`SearchOptions.halving`, Standard an): Optionen bekommen erst wenige
    Stichproben, die schlechtere Hälfte fällt je Runde heraus; gleiche Stichproben für alle Optionen. Gleich
    stark (neu gegen alt 50,9 % Schwer, 49,8 % Sehr schwer), 1,3× bzw. 1,5× schneller pro Entscheidung.
    GPU-Frage des Nutzers: Engine auf GPU lohnt nicht (verzweigter Code); ein gelerntes Bewertungsnetz
    (Inferenz per WebGPU/ONNX) wäre ein eigenes Forschungsprojekt; „kleine Hebel“ (kürzere Simulationen,
    gemeinsame Ergebnisse) vom Nutzer zurückgestellt.
  - CI-Lauf #10/#11 rot: Fuzz-Test (1000 Spiele) brauchte auf dem GitHub-Runner 5,8 s (lokal 2,4 s) und
    lief ins Vitest-Standardlimit von 5 s. Jetzt `testTimeout: 30_000` in `vite.config.ts`. Simulationslastige
    Tests sind auf dem Runner 2–3× langsamer als am Desktop; neue Tests nicht knapp an Grenzen bauen.
  - **Zweite Meta-Quelle Egman Deck Builder** (`src/meta/egman.ts`, Nutzerwunsch nach Vergleich mit Bandai,
    Victory Road, MetaSheep): eine JSON-Datei mit großen offiziellen Regionals und kompletten Decklisten,
    nur im wöchentlichen Snapshot abgerufen, ohne Spielernamen, Quelle im Meta-Reiter genannt, Doppelte
    zu Limitless per Link oder Datum+Name aussortiert, Archetyp pro Egman-Gruppe (gleicher Name, sonst
    ähnlichster, sonst eigener). Snapshot `data/meta/2026-11-17.json`: 152 Listen aus 13 Turnieren (vorher 72
    aus 6). MetaSheep: Nutzungsbedingungen verbieten Abgreifen → nicht genutzt; Bandai selbst veröffentlicht
    keine Turnierlisten (nur TCG+-Deckcodes über interne Schnittstelle → nicht genutzt). Öffentliche Nutzung ok
    (Nutzer, 21. Nov.: Egman verbietet es nicht). Details `docs/META.md`.
  - **Bannliste korrigiert:** Guntank (GD01-008) ist nur mit M1 Astray Shrike (GD05-015) gepaart; die
    Vanilla-2/2-Units sind untereinander gepaart (nur eine Sorte). Vorher war Guntank mit allen Vanilla-Units
    gepaart (Fehler aus M5, verfälschte Konsenslisten). Belege in `docs/META.md`.
  - Neu unterstützt: GD01-023 (Kosten „Discard 1 … card“, `pairTo`), GD01-076 („While …, this Unit gets“,
    Trash-Zählung nach Kartentyp). Abdeckung 65,8 %. 189 Tests.
  - **Meta-Listen wählbar** (Nutzerwunsch): Konsens (`M01`, Standard), beste Liste (`M01B`) oder beide;
    Simulator-Formular „Meta-Listen“, CLI `--list`, `metaDecks(…, list)`. Spiel nutzt weiter Konsens.
  - **Alle Turnierlisten eines Archetyps** (`Archetype.entries`, Nutzerwunsch): Meta-Reiter „Turnierlisten“,
    Decks-Reiter kopiert Archetyp → Konsens oder eine echte Liste. Sortiert nach Ergebnis
    `resultScore` = log₂(Spieler)/√Platz; die erste ist die beste Liste (`M01B`, vorher bestplatzierte).
    Spielen/Simulieren aus dem Meta-Reiter nimmt die angezeigte Liste (Turnierliste als `M03T5`, nur im Speicher).
- Beobachtung: Shining Gundam (M01, meistgespielt) gewann bei v1 nur ~40 %. **22. Nov. verbessert** (Kalibrierung
  des Deck-Labors): eigene Trash-Karten als Effekt-Kosten (`plainTrashCost` = alt) und Link-Partner beim Abwerfen
  behalten (`plainLinkKeep`); M01 gegen das Feld 39,3 → 44,5 % (v1), v0 gesamt 51,6 %. `npm run game` gibt den KIs
  jetzt Deck und Feld mit und kann mit `--explain <Zug>` die v1-Werte zeigen. Details `docs/AI.md` „Shining Gundam“.

## Svelte-Fallen

- **Keine Variable `set` nennen, wenn sie mit `bind:` gebunden wird** (Svelte 5.57.3): Der Compiler
  erzeugt für `bind:value` eine Setter-Funktion namens `set`, die die Variable verdeckt; der Wert ändert sich
  dann nie. Darum hieß der Set-Filter der Kartenliste nicht mehr `set`, sondern `setCode` (gefunden am 16. Nov.).

## Entscheidungen

- **Meta (M5):** Konsensliste statt nur bestplatzierter Liste (stabiler bei wenigen Listen); unbenannte
  Decks zum ähnlichsten Archetyp ab Jaccard 0,5. Nutzer-Auftrag: nach M5 selbstständig weiterarbeiten und
  verbessern (16. Nov.), dabei committen und pushen.

- **KI v1 (M4):** Vorausschau bis Ende des Zuges statt bis zur nächsten Entscheidung (37–58 % → ~75 % gegen
  v0). Hohe Strafe für geruhte Units macht passiv und schadet (`exposed` 0,15). Gewichte von Hand, Tuning in M7.
  Gemessen, nicht geraten: allokationsfreie `activeStatics`-Variante war langsamer (66 statt 51 ms) und
  wurde verworfen.

- **Oberfläche (M3):** Die Oberfläche rendert nur `viewFor(state, mensch)` (kein Schummeln möglich); AP/HP
  kommen aus dem vollen Zustand (öffentlich). Optionen mit Zielkarte (Pilot, Angriff, Support, Ersetzen)
  brauchen zwei Klicks, alle anderen wirken sofort. Rollback-Punkte sind nur Entscheidungen des Menschen
  (die KI ist deterministisch und würde dasselbe wiederholen). Eigene Aktionen ohne eigenes Event (Passen,
  Main Phase beenden, Ja/Nein) bekommen eine Log-Zeile, damit jede Entscheidung einen ↶ hat.

- **Effekte (M2):** Daten-DSL statt Code pro Karte, damit laufende Effekte serialisierbar bleiben. Der
  Übersetzer erkennt nur sichere Muster; nicht verstandene Zeilen wirken nicht und machen die Karte
  `partial` (für die Meta-Auswahl später sichtbar). Pilot-Zeilen außer 【Burst】 gehen an die Unit.
  Triggerreihenfolge: Burst, dann aktiver Spieler, dann Standby; gleichzeitige eigene Trigger in gewählter
  Reihenfolge (10-1-6-5, seit M9). Weitere Auslegungen in `docs/EFFECTS.md`, Regelfälle in `docs/QA.md`.

- **Engine (M1):** Zustand ist reines JSON und wird von `apply` direkt geändert (schnell); Entscheidungen
  enthalten alle legalen Optionen, `apply` prüft dagegen. Rollback = Replay von Seed + Decks + Aktionen.
  Die KI bekommt nur `viewFor()` (verdeckte Karten als `"?"`, Zufallsgenerator geleert). Kopien einer Karte
  auf der Hand sind eine Option. Kosten: normale Ressourcen zuerst, EX Resource zuletzt (sie zählt bis zum
  Verbrauch fürs Level mit). Spieler 1 zieht im ersten Zug (Regeln nehmen ihn nicht aus). Handlimit gilt nur
  für den aktiven Spieler (7-6-5, 4-8-4 „your end phase“). Der zuletzt gelegte Schild ist der oberste (6-2-2).

- **TypeScript 6.0.3 statt 7:** TS 7 (seit Juli 2026) wird von svelte-check (`^5 || ^6`) und
  typescript-eslint (`<6.1`) noch nicht unterstützt.
- Installiert mit `npm install --before=2026-11-02T23:59:59Z`, damit auch indirekte Abhängigkeiten
  mindestens 2 Wochen alt sind (Lockfile hält sie fest). Bei neuen Paketen genauso vorgehen.
- `npm audit` meldet beim Stand 16. Nov. nur Entwicklungswerkzeuge (deepmerge in vite-plugin-svelte ohne Fix,
  minimatch in ESLint/typescript-eslint); die App selbst ist nicht betroffen.
- `cards.json` wird per `?url` als gehashte Datei gebaut und zur Laufzeit geladen (787 KB, gzip 85 KB).
- Kartenbilder: `npm run images` kopiert aus GCGScanners Cache nach `build/images/full/` (600 px, 128 MB)
  und erzeugt `build/images/small/` (240 px, WebP q82, 49 MB) mit sharp. Ein Vite-Plugin in
  `vite.config.ts` liefert sie im Dev- und Preview-Server unter `cards/<size>/<file>`; der Build enthält
  nur die verschlüsselten `public/cards/*.bin` (siehe „Kartenbilder in der App“). Die App lädt Bilder relativ (`base: "./"`).
- **Units mit AP „-“** (GCGDB `null`, z. B. GD01-048, EB01-013, 11 Karten) haben AP 0 (auf der Karte gedruckt,
  von Shops bestätigt); `CardPool` setzt fehlende AP/HP bei UNIT/UNIT TOKEN auf 0.
- **Token** = Set `T` (dort gibt es auch ein Base-Token mit Typ BASE ohne Lv./Kosten, T-037), EX Base,
  EX Resource, Resource. `EXB-001`, `EXR-001`, `R-001` haben keinen Druck ALT0; Bild ist dann der erste Druck.
- Link-Bedingungen: Alternativen mit `/`, je `[Pilotname]` (Teil des Namens, 3-2-6-4; Namen können Klammern
  enthalten) oder `(Trait) Trait` (bei einer Karte fehlt „Trait“).

## Fakten (geprüft am 16. Nov. 2026)

- Regeln: Comprehensive Rules **Ver. 1.10.0 (16. Okt. 2026)**,
  `https://www.gundam-gcg.com/en/pdf/comprehensiverules_en.pdf`. Rules Q&A: `…/en/pdf/rule-qa_en.pdf`,
  FAQ `…/en/rules/faqs/`, Banned/Restricted aktuell `…/en/news/01_279.html`.
- Limitless: `https://play.limitlesstcg.com/api/tournaments?game=GUNDAM&limit=N`,
  `…/tournaments/<id>/standings` mit `decklist` (`unit`/`pilot`/`command`/`base`, je `count,name,set,number`,
  **ohne Ressourcen-Deck**), `deck.name` = Archetyp, `placing`, `record`. Sendet `Access-Control-Allow-Origin: *`.
- Probe (30 Turniere ≥ 12 Spieler, Mai–Nov. 2026, Top 8 = 176 Decks): 343 verschiedene Karten; Top 100 Karten
  decken 80 %, Top 200 94 %, Top 300 98,5 % der Kartenplätze.
- Kartenbilder: alle 2205 liegen in GCGScanners `build\carddb-cache\images\` (`npm run images` findet sie
  über `../GCGScanner`). gundam-gcg.com
  sendet `Cross-Origin-Resource-Policy: same-site` (kein Einbinden von fremden Seiten). Bilder nicht ins Repo
  und nicht frei auf Pages (Pages ist öffentlich); seit 21. Nov. nur verschlüsselt im Repo (siehe „Kartenbilder in
  der App“).
- `gh` ist nicht installiert; GitHub-Oberfläche über Claude in Chrome (Nutzer angemeldet als `somecoder3`).
  Zwei Rechner: zu Hause Projekte unter `D:\programming` (Node v26.13.1 seit 21. Nov., per winget `OpenJS.NodeJS.LTS`; Ausnahme von der 2-Wochen-Regel, weil Sicherheitsupdate; npm 11.20 überspringt das Install-Skript von esbuild, alles läuft trotzdem), Arbeitsrechner unter `E:\programming`
  (Node v26.13); auf beiden Python 3.11. Nach dem Wechsel: `git pull`, `npm ci`, ggf. `npm run images`.

## Konventionen

- **Diese CLAUDE.md immer aktuell halten** (wie in GCGDB/GCGScanner): Änderungen, Erkenntnisse und
  Entscheidungen im selben Commit nachtragen, Veraltetes korrigieren.
- Abhängigkeiten exakt pinnen und gegen die Registry prüfen; keine Version unter 2 Wochen Alter
  (auch GitHub Actions, per Commit-SHA).
- Unter Windows mit Python-Pfaden `D:/...` bzw. `E:/...` statt `/d/...` (je nach Rechner).
