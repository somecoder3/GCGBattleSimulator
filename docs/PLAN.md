# GCGBattleSimulator – Umsetzungsplan

Stand: 16. Nov. 2026 · Status: **freigegeben**, Entscheidungen in Abschnitt 13 · **M0–M3 fertig** (Engine: `docs/ENGINE.md`, Effekte: `docs/EFFECTS.md`, KI: `docs/AI.md`)

Ein Kampfsimulator für das **Gundam Card Game** auf Basis von [GCGDB](https://github.com/somecoder3/GCGDB):

1. **Mensch gegen KI** – gut aussehend, flüssig, auf Desktop und Handy angenehm, mit Rollback.
2. **KI gegen KI in großer Zahl** – tausende Matches zwischen aktuellen Meta-Decks, mit allen Statistiken.
3. **Meta automatisch ermitteln** – aktuelle Turnierdecks online laden, zu Archetypen bündeln, als Decks bereitstellen.

Ausgeliefert als **PWA**, zuerst lokal auf dem Desktop getestet, später auf GitHub Pages.

---

## 1. Ausgangslage (geprüft am 16. Nov. 2026)

### GCGDB (Basis)

- `data/cards.json` (Schema 2): **1290 Karten, 2205 Drucke, 26 Produkte**. Pro Karte Name, Typ, Farbe,
  Level, Kosten, AP, HP, Zone, Trait, Link, Effekttext (Englisch), Set.
- Typen: 679 UNIT, 178 COMMAND, 148 PILOT, 108 RESOURCE, 82 BASE, 36 UNIT TOKEN, 30 EX BASE, 29 EX RESOURCE.
- JS-Module ohne Build (`carddb.js`, `ids.js`, `lists.js` mit `parseList()` für ExBurst/Limitless/TTS/…).
- Wird wie in GCGScanner als **Git-Submodul `gcgdb/`** eingebunden.
- Effekte liegen nur als Text vor. Die Formulierungen sind sehr regelmäßig: 【Deploy】 213×, 【Burst】 288×,
  【Main】 159×, 【Action】 114×, <Blocker> 113×, 【Attack】 104×, 【Once per Turn】 99×, 【During Link】 79×, …

### GCGScanner (Vorbild für Aufbau und Abläufe)

- PWA mit Service Worker, Pages-Workflow mit gepinnten Actions, Dev-Server, CLAUDE.md als lebende Doku.
- Kartenbilder: In `GCGScanner/build/carddb-cache/images/` liegen **alle 2205 offiziellen Bilder** lokal.
  gundam-gcg.com sendet `Cross-Origin-Resource-Policy: same-site` (kein Hotlinking), daher kommen die Bilder
  aus einem lokalen Cache. Für eine öffentliche Seite nutzt GCGScanner verschlüsselte Bildpakete.

### Regeln

- Offizielle **Comprehensive Rules Ver. 1.10.0 (16. Okt. 2026)**, 35 Seiten, vollständig gelesen.
  Dazu gibt es das Rules-Q&A-PDF und die Banned/Restricted-Liste (aktuell `news/01_279.html`).
- Kernpunkte für die Engine: 50 Karten Deck + 10 Ressourcen, max. 4 Kopien, 1–2 Farben; 5 Startkarten,
  1× Mulligan; 6 Schilde, EX Base (0 AP / 3 HP), Spieler 2 bekommt eine EX Resource; Phasen Start (Active/Start
  Step) → Draw → Resource → Main → End (Action/End/Hand/Cleanup Step); Level = Anzahl Ressourcen, Kosten durch
  Ruhen; max. 6 Units, 1 Base, 15 Ressourcen (5 EX), 10 Handkarten; Kampf in 5 Schritten (Attack, Block,
  Action, Damage, Battle End); Action Steps mit abwechselndem Passen; Trigger-Reihenfolge (aktiver Spieler
  zuerst, Burst hat Vorrang, neue Trigger zuerst); Rules Management (Niederlage, Zerstörung, Überzahl);
  Keywords Repair, Breach, Support, Blocker, First Strike, High-Maneuver, Suppression, Development;
  Timings Deploy, Attack, Destroyed, When Paired, During Pair, When Linked, During Link, Once per Turn,
  Activate·Main/Action, Burst.

### Meta-Daten

- **Limitless** (`play.limitlesstcg.com/api`) führt das Spiel als `GUNDAM`. Öffentliche API, **CORS `*`**
  (direkt aus der PWA nutzbar). `/tournaments?game=GUNDAM` liefert Turniere, `/tournaments/<id>/standings`
  Platzierung, Bilanz, **Archetyp** (`deck.name`) und **Deckliste** (Set + Nummer, ohne Ressourcen-Deck).
- Probe: 30 Turniere ≥ 12 Spieler (Mai–Nov. 2026), Top 8 = 176 Decks, **343 verschiedene Karten**.
  **Die häufigsten 100 Karten decken 80 % aller Kartenplätze ab, 200 Karten 94 %, 300 Karten 98,5 %.**
  Häufigste Archetypen: Blue White Victory Unicorn, Shining Gundam (Master Gundam), Strike Freedom,
  Blue White Control, Blue Purple Barbatos Rush, Nu Gundam, White Green Operation Meteor …
- Weitere Quelle: offizielle Turnier-Decklisten von Bandai (Regionals, Championship) auf gundam-gcg.com.

**Folgerung:** Der größte Aufwand sind die Karteneffekte. Wir setzen sie nach Meta-Relevanz um: mit ~200
Karten sind fast alle aktuellen Turnierdecks spielbar.

---

## 2. Grundsatzentscheidungen

| Thema       | Vorschlag                                                                    | Begründung                                                                      |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Sprache     | **TypeScript** (strict)                                                      | Regel-Engine und Effektsystem mit vielen Datentypen; Fehler früh finden         |
| Build       | **Vite** (gepinnt)                                                           | Schneller Dev-Server, Web Worker, PWA-Build; Pages-Workflow baut                |
| UI          | **Svelte 5**                                                                 | Klein, schnell, eingebaute Übergänge/FLIP-Animationen, wenig Boilerplate        |
| Darstellung | **DOM + CSS-Transforms + Web Animations API**, Canvas-Ebene nur für Partikel | Scharfer Text, responsiv, barrierearm; bei ≤ 40 sichtbaren Karten schnell genug |
| Engine      | **Reines TS ohne DOM**, läuft in Browser, Worker und Node                    | Gleicher Code für Spiel, Massensimulation und Tests                             |
| Tests       | **Vitest** + eigene Fuzz-/Determinismus-Tests                                | Schnell, TS-nativ                                                               |
| Daten       | GCGDB als Submodul, `cards.json`                                             | Eine Quelle für Karten                                                          |
| Speicher    | IndexedDB (Decks, Spiele, Simulationsläufe)                                  | Große Datenmengen, offline                                                      |

Abweichung von GCGDB/GCGScanner: Dort gibt es bewusst keinen Build-Schritt. Hier lohnt er sich wegen der
Größe (Engine, KI, Worker, UI). GCGDBs JS-Module werden unverändert importiert. Konventionen bleiben:
Abhängigkeiten exakt pinnen, keine Version jünger als 2 Wochen, Actions per Commit-SHA, CLAUDE.md immer aktuell.

---

## 3. Architektur

```
┌──────────────────────────── PWA (Svelte) ─────────────────────────────┐
│  Start · Spielen · Decks · Meta · Simulator · Statistiken · Einstellungen │
│        │ Events → Animationen          │ Jobs                           │
└────────┼───────────────────────────────┼────────────────────────────────┘
         ▼                               ▼
   ┌─────────────┐   Decisions    ┌──────────────┐   Worker-Pool (N Kerne)
   │   Engine    │◀──────────────▶│      KI      │◀── auch Node-CLI
   │ (rein, TS)  │   Views        └──────────────┘
   └──────┬──────┘
          │ Karten + Effekt-Skripte
   ┌──────┴──────┐      ┌───────────────┐
   │ cards/ DSL  │◀─────│ gcgdb (Submod)│      Meta: Limitless-API → Archetypen → Decks
   └─────────────┘      └───────────────┘
```

### Ordner

```
gcgdb/              Git-Submodul (Kartendaten, ids/lists/carddb)
src/engine/         Spielzustand, Regeln, Effekt-Interpreter (kein DOM)
src/cards/          Effekt-Skripte pro Set (GD01.ts …), Registry, Abdeckung
src/ai/             Heuristik-KI, Such-KI (ISMCTS), Bewertung, Profile
src/sim/            Match-Runner, Worker-Pool, Statistik-Sammler
src/meta/           Limitless-Client, Archetypen, Deck-Aggregation, Banliste
src/app/            Svelte-Oberfläche, Animationen, Eingabe, PWA
tools/              Node-CLIs: sim, coverage, meta-snapshot, images, effect-draft
tests/              Regeltests, Kartentests, Fuzz, Determinismus, Leistung
data/meta/          Meta-Snapshots (committet, Fallback/offline)
docs/               PLAN.md, ENGINE.md, EFFECTS.md, AI.md
```

---

## 4. Regel-Engine

### 4.1 Prinzipien

- **Deterministisch:** Zustand enthält einen eigenen RNG (xoshiro128**, Seed). Gleicher Seed + gleiche
  Entscheidungen ⇒ exakt gleicher Zustand (geprüft über einen Zustands-Hash).
- **Entscheidungsgetrieben:** Die Engine läuft selbstständig, bis ein Spieler etwas entscheiden muss, und
  liefert dann eine `PendingDecision` (wer, Art, legale Optionen). `apply(state, choice)` setzt fort.
  Mensch, KI und Simulator benutzen genau diese eine Schnittstelle.
- **Serialisierbar:** Zustand ist ein schlichtes Objekt (auch Effekt-Warteschlange mit Fortschritt), daher
  klonbar für Suche, speicherbar, als Replay abspielbar. Keine Closures/Generatoren im Zustand.
- **Ereignisstrom:** Jede Änderung erzeugt Events (`CardMoved`, `Rested`, `Damage`, `ShieldBroken`,
  `BurstRevealed`, `AttackDeclared`, `Blocked`, `Destroyed`, `PhaseChanged`, …). UI animiert daraus,
  Statistik zählt daraus, Log zeigt sie an.
- **Verdeckte Information:** `viewFor(state, player)` liefert nur, was der Spieler sehen darf. Die KI
  arbeitet ausschließlich auf ihrer Sicht (kein Schummeln).

### 4.2 Bestandteile

- Zustand: Spieler mit Zonen (Deck, Ressourcen-Deck, Ressourcen, Battle Area, Schilde, Base, Hand, Trash,
  Removal), Karteninstanzen mit eigener Id, Zustand aktiv/geruht, Schaden, Pilot, Herkunfts-Turn.
- Ablauf: Vorbereitung (Mischen, Startspieler, Mulligan, Schilde, EX-Token), Phasen und Schritte, Kampf,
  Action Steps mit Pass-Logik, Handlimit, Cleanup.
- Rules Management als eigener Schritt nach jedem Ereignis: Niederlage (Schaden ohne Schilde, leeres Deck),
  Zerstörung bei HP 0, Überzahl Battle Area/Base (nicht „zerstört“).
- Trigger-System: Sammeln, Reihenfolge (aktiver vor Standby-Spieler, eigener Spieler wählt Reihenfolge,
  Burst zuerst, neue Trigger haben Vorrang), Once per Turn pro Karte.
- Dauereffekte als **Schichten**: AP/HP/Keywords werden aus Grundwerten + Pilot + aktiven Modifikatoren
  (mit Dauer: „during this turn“, „during this battle“, „while …“) bei Bedarf berechnet, nicht gespeichert.
- Ersatzeffekte („instead“), Verbote („can't“) mit Vorrang laut 10-1-5-6.
- Kostenzahlung: Ressourcen automatisch ruhen (Standard: normale vor EX-Ressource), optional manuell.

### 4.3 Qualitätssicherung Engine

- Regeltests nach Regelnummer (`8-5-2-4 Base nimmt Schaden vor Schilden`, …), Fälle aus dem Q&A-PDF.
- **Fuzz:** 100 000 Spiele mit Zufalls-KI und zufälligen legalen Decks, Invarianten nach jedem Schritt
  (Kartenanzahl bleibt erhalten, Grenzen 6/1/15/10 eingehalten, keine Pilot ohne Unit, Spiel endet).
- **Determinismus:** Replay aus Seed + Entscheidungen ergibt denselben Hash; Zustand nach JSON-Runde gleich.
- Leistung: Ziel < 5 ms pro Spiel mit Zufalls-KI in Node, Benchmark in CI.

---

## 5. Karteneffekte (größter Brocken)

### 5.1 Effekt-DSL

Effekte werden **als Daten** beschrieben und von der Engine interpretiert. Beispiel:

```ts
// GD01-0xx: 【Deploy】Choose 1 enemy Unit with 3 or less HP. Rest it.
{ on: "deploy",
  do: [ { choose: { count: 1, from: "battle", side: "enemy", filter: { hpMax: 3 } }, as: "t" },
        { rest: "$t" } ] }
```

- Bausteine: Trigger/Timing, Bedingungen (`if`, Zähler, „while“), Auswahl mit Filtern (Seite, Typ, Farbe,
  Trait, Level, AP/HP, Zustand, Name enthält), Aktionen (draw, discard, rest/activate, damage, destroy,
  return to hand/deck, deploy token, add to hand, look at top N, AP/HP-Modifikatoren, Keyword geben,
  Kosten ändern, Schilde nehmen/legen, exile from trash, Battle beginnen …), Kosten vor dem Doppelpunkt,
  „you may“, „If you do“ vs. „Then“ (5-20), Wiederholung.
- Keywords (<Blocker>, <Repair 2> …) als eigene Bausteine mit Addition laut Regeln.
- Was die DSL nicht abbildet, bekommt ein **Skript in TS** mit derselben Schnittstelle (Ausweg für Sonderfälle).

### 5.2 Vorgehen

1. **Entwurfsgenerator** (`tools/effect-draft`): übersetzt die regelmäßigen englischen Texte per Mustern in
   DSL-Entwürfe und meldet nicht erkannte Teile. Erwartung: ein großer Teil der Standardformulierungen.
2. Jede Karte bekommt einen Status: `vanilla` (kein Text) · `draft` · `implemented` · `verified` (mit Test) ·
   `unsupported`. Ein **Abdeckungsbericht** zeigt das pro Set, pro Meta-Deck und gesamt.
3. Reihenfolge nach Meta-Relevanz: zuerst die Karten der Top-Archetypen (≈ 200 Karten → 94 %), dann
   Starter-Decks, dann der Rest.
4. **Kartentests:** pro Karte mindestens ein Szenario-Test (Ausgangslage → Aktion → erwarteter Zustand).
5. Decks mit nicht unterstützten Karten werden im Simulator markiert und standardmäßig ausgeschlossen.

---

## 6. KI

| Stufe       | Verfahren                                                                                                                                                  | Einsatz                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 0 Zufall    | zufällige legale Aktion                                                                                                                                    | Tests, Fuzz                                |
| 1 Heuristik | Regeln + **Bewertungsfunktion** (Schilde, Board-AP/HP, Tempo, Hand, Ressourcen, Bedrohung), pro Entscheidung kurze Vorausschau innerhalb des eigenen Zuges | **Massensimulation** (schnell)             |
| 2 Suche     | **ISMCTS mit Determinisierung**: verdeckte Karten werden passend zum Wissen ausgewürfelt, Heuristik als Rollout-Politik, Zeitbudget pro Entscheidung       | Gegner für Menschen, „starke“ Simulationen |
| Tuning      | Gewichte der Bewertung per Selbstspiel optimieren (SPSA/CMA-ES-artig, Node)                                                                                | regelmäßig                                 |

- Entscheidungen als **Makro-Aktionen** (Karte X spielen + Ziel Y) gegen zu große Verzweigung.
- Eigene Teilpolitiken für Mulligan, Blocken, Burst ja/nein, Action-Step-Reaktionen, Angriffsziel.
- Schwierigkeitsgrade für Menschen: Leicht (Heuristik mit Rauschen), Normal (Heuristik), Schwer (ISMCTS ~1 s),
  Sehr schwer (ISMCTS mehr Budget).
- **Gegnermodell (Entscheidung des Nutzers):** Die KI kennt das gegnerische Deck nicht. Sie sieht nur, was
  ein Mensch sieht (gespielte Karten, Trash, aufgedeckte Bursts, Handgröße), und schätzt daraus laufend, welcher
  Meta-Archetyp gespielt wird (Wahrscheinlichkeit pro Archetyp aus den Meta-Daten, aktualisiert mit jeder
  gesehenen Karte; Farben grenzen früh ein). Beim Auswürfeln verdeckter Karten (ISMCTS) zieht sie aus dieser
  Schätzung. Ohne Treffer im Meta fällt sie auf „typische Karten der gesehenen Farben“ zurück. Gilt für Spiele
  gegen Menschen und standardmäßig auch für KI-gegen-KI.
- Hinweis in den Statistiken: Ergebnisse spiegeln das Spiel der KI wider. Deshalb Vergleich mehrerer
  KI-Stufen möglich, und die Heuristik wird mit Selbstspiel verbessert.

---

## 7. Meta-Ermittlung

1. **Laden:** Limitless-API direkt aus der PWA (CORS erlaubt), Zeitraum einstellbar (z. B. letzte 8 Wochen),
   Mindestgröße der Turniere, Top-N-Platzierungen. Ergebnisse in IndexedDB zwischengespeichert, höflich
   gedrosselt.
2. **Snapshot:** wöchentlicher GitHub-Action-Lauf (`tools/meta-snapshot`) schreibt `data/meta/<datum>.json`
   ins Repo – damit funktioniert es offline und reproduzierbar. Später optional offizielle Bandai-Decklisten.
3. **Abgleich mit GCGDB:** Set + Nummer → Kartennummer; unbekannte Karten melden.
4. **Archetypen:** Limitless-Name übernehmen; „Other“ und Varianten per Kartenähnlichkeit (Jaccard über
   Kartenanzahlen) zuordnen oder neu bündeln.
5. **Gewichtung:** Meta-Anteil nach Häufigkeit, gewichtet nach Aktualität (Halbwertszeit), Turniergröße und
   Platzierung.
6. **Repräsentatives Deck pro Archetyp:** „Konsensliste“ (häufigste Anzahl pro Karte, auf 50 aufgefüllt)
   und alternativ die bestplatzierte echte Liste. Ressourcen-Deck fehlt bei Limitless → Standard 10
   Ressourcen.
7. **Legalität:** Deckbau-Regeln, aktuelle Banned/Restricted-Liste (von gundam-gcg.com, gepflegt als Datei),
   Effekt-Abdeckung.

---

## 8. Simulator und Statistiken

### Einstellungen

- Paarungen: **Jeder gegen jeden**, **Gauntlet** (ein Deck gegen das Feld), frei gewählt.
- Spiele pro Paarung mit Anzeige der Genauigkeit (200 Spiele ≈ ±7 %, 1000 ≈ ±3 % bei 95 %);
  optional **adaptiv**: so lange, bis das Konfidenzintervall schmal genug ist.
- Startspieler abwechselnd (Standard) oder zufällig/fest; KI-Stufe und Zeitbudget pro Seite;
  Mulligan-Politik; Seed (reproduzierbar); Zugbegrenzung gegen Endlosspiele; Anzahl Worker (Standard:
  Kerne − 1).
- Läuft im Browser (Web-Worker-Pool, pausier- und fortsetzbar) und als **Node-CLI** für große Läufe:
  `npm run sim -- --decks meta-top8 --games 1000 --ai heuristic`.

### Erfasste Werte

- Pro Spiel: Gewinner, Startspieler, Mulligans, Anzahl Züge, Siegart (Schaden/Deck leer/Zuglimit),
  Schildverlauf, Ressourcen-Kurve, gespielte/gezogene Karten mit Zug, Bursts, Angriffe, Blocks.
- Auswertung: **Matchup-Matrix** (Heatmap mit Intervallen), Gesamt-Siegquote, **meta-gewichtete Siegquote**
  (gegen das Feld nach Meta-Anteil), Vorteil Startspieler, Spieldauer, Siegarten, Mulligan-Quote,
  **Kartenleistung** (Siegquote wenn gezogen / gespielt / im Starthand, wie 17lands), Elo-Rangliste.
- Läufe gespeichert, vergleichbar, Export als JSON/CSV. Einzelne Spiele als **Replay** ansehbar
  (wichtig, um KI-Fehler zu finden).

---

## 9. Spiel gegen die KI – Aussehen und Gefühl

### Spielfeld

- Gegner oben, eigener Bereich unten; Battle Area (6 Plätze), Schilde als Stapel mit Zähler + Base,
  Ressourcen als Karten/Leiste mit aktiv/geruht, Deck/Trash/Removal als Stapel, Hand als Fächer.
- Kartenbilder offiziell; aktuelle AP/HP mit Änderungen als Abzeichen, Schaden als Marker, Pilot unter der Unit
  sichtbar versetzt, Link deutlich markiert.
- **Desktop:** Querformat, Kartendetail beim Überfahren in einer Seitenleiste (voller Text, Modifikatoren),
  Log-Leiste, Tastenkürzel (Leertaste = weiter/Pass, Strg+Z = Rückgängig, Esc = Abbrechen).
- **Handy hochkant:** kompakte Zonen, Hand unten aufschiebbar, Tippen = Karte groß anzeigen,
  Wischen/Ziehen zum Spielen, große Tippflächen (≥ 44 px), Safe Areas, Vibration bei wichtigen Ereignissen
  (Android). Querformat am Handy ebenfalls unterstützt.

### Bedienung

- **Ziehen & Ablegen** (Pointer Events, Maus und Touch) _und_ Antippen → Ziel antippen. Legale Ziele leuchten,
  ungültige sind abgedunkelt; man kann keine regelwidrige Aktion auslösen.
- Angriff: Unit auf Gegner/Unit ziehen, Pfeil zeigt das Ziel. Kosten werden automatisch bezahlt.
- **Intelligente Stopps:** Kein Warten in Action Steps ohne mögliche Aktion; einstellbar wie bei
  digitalen Kartenspielen („immer anhalten“ / „nur bei Optionen“). Bestätigung nur, wo eine Wahl besteht.
- KI-Züge mit lesbarem Tempo, „KI denkt…“-Anzeige, Pfeile und Hervorhebung, was die KI tut.

### Animationen und Effekte

- FLIP-Animationen für jede Kartenbewegung (Hand → Feld, Feld → Trash, Ziehen), Drehen beim Ruhen,
  Schadenszahlen, Schild zerbricht, **Burst-Aufdecken** mit Umdrehen, Angriffs-Ausfallschritt mit Treffer,
  Zerstörung, Zugbanner, dezentes Wackeln bei großen Treffern, Siegesbildschirm.
- Geschwindigkeit einstellbar (0,5–3×, „sofort“), `prefers-reduced-motion` beachten, 60 fps (nur
  `transform`/`opacity` animieren). Eigene, freie Soundeffekte optional (an/aus).
- Eigenes Sci-Fi-Design (dunkel, klar), keine Nachahmung von Bandai-Logos/Oberflächen.

### Rollback

- Spiel = Seed + Liste der Entscheidungen; Rückgängig baut den Zustand bis zur gewählten Stelle neu auf
  (schnell dank Engine; Zwischenstände alle paar Entscheidungen als Snapshot).
- **Strg+Z / Button:** letzte eigene Entscheidung zurück (inklusive der KI-Reaktion darauf).
- **Zeitleiste:** alle Züge und Aktionen, Klick springt zurück („zurück zum Zugbeginn“).
- Da der Seed gleich bleibt, kommen dieselben Karten wieder (zum Üben gewollt); optional Modus „neu mischen
  nach Rollback“. Partien speichern/fortsetzen, Rollback auch nach Neuladen.

### PWA

- Installierbar, offline spielbar (Engine, KI, Karten, gecachte Bilder), Service Worker mit Versionierung,
  Updates mit Hinweis.

---

## 10. Kartenbilder

- Lokal: `tools/images` übernimmt die 2205 Bilder aus `GCGScanner/build/carddb-cache/images/` oder lädt fehlende
  von gundam-gcg.com (gedrosselt), erzeugt zwei Größen (Voll 600 px, Vorschau ~240 px, WebP) nach
  `build/images/` (**nicht im Repo**). Der Dev-Server liefert sie unter `cards/…` aus.
- Platzhalter mit Name/Werten, solange ein Bild fehlt.
- Später für die öffentliche Seite: Bilder nicht frei auf Pages legen (Pages ist öffentlich, auch bei
  privatem Repo). Lösung wie in GCGScanner (verschlüsselte Pakete mit Passwort) oder eine andere, dann
  gemeinsam entscheiden.

---

## 11. Meilensteine

Jeder Meilenstein endet mit etwas Ausprobierbarem, Tests in CI und aktualisierter CLAUDE.md.

| #      | Inhalt                                                                                                                                                   | Ergebnis / Abnahme                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **M0** | Gerüst: Vite + TS + Svelte, Submodul `gcgdb`, Vitest, ESLint/Prettier, CI, Bild-Pipeline, CLAUDE.md                                                      | `npm run dev` zeigt Kartenliste mit Bildern; CI grün              |
| **M1** | Engine-Kern ohne Kartentexte: Aufbau, Phasen, Ressourcen, Units, Pilots (Werte, Link), Kampf, Schilde, Base, Keywords, Rules Management, Zufalls-KI, CLI | Fuzz 100 k Spiele ohne Fehler, Determinismus-Test, Regeltests     |
| **M2** | Effektsystem: DSL, Interpreter, Trigger, Dauereffekte, Ersatzeffekte, Kosten; Entwurfsgenerator; Abdeckungsbericht; **2–3 Starter-Decks vollständig**    | Starter-Decks spielbar, alle ihre Karten getestet                 |
| **M3** | Erste spielbare Oberfläche (schlicht) gegen Heuristik-KI v0, Rollback, Log                                                                               | Ein komplettes Spiel am Desktop spielbar und zurücksetzbar        |
| **M4** | Heuristik-KI v1, Match-Runner, Worker-Pool, Node-CLI, Grundstatistik                                                                                     | 10 000 Matches < 5 min (8 Kerne); Heuristik schlägt Zufall > 95 % |
| **M5** | Meta-Pipeline (Limitless, Archetypen, Konsenslisten, Banliste, Snapshot-Action); **Meta-Karten umsetzen (~200)**                                         | Top-8-Archetypen voll unterstützt                                 |
| **M6** | Schöne Spieloberfläche: Animationen, Ziehen & Ablegen, Handy-Layouts, Zeitleiste, PWA/offline                                                            | Test am Desktop (und Handy), flüssig mit 60 fps                   |
| **M7** | Such-KI (ISMCTS), Schwierigkeitsgrade, Gewichts-Tuning per Selbstspiel                                                                                   | ISMCTS schlägt Heuristik deutlich                                 |
| **M8** | Simulator-Oberfläche und Statistik-Dashboard, Replays, Export                                                                                            | Meta-Turnier mit Matrix, Intervallen, Kartenleistung              |
| **M9** | Restliche Karten, Q&A-Regelfälle, Feinschliff, Vorbereitung Pages (Bilderlösung)                                                                         | Abdeckungsziel erreicht; Veröffentlichung entscheidbar            |

M1–M3 sind der „vertikale Schnitt“: früh ein echtes Spiel, damit Engine und Bedienung zusammen wachsen.
Danach laufen Kartenumsetzung (M5/M9) und Oberfläche (M6) gut parallel.

---

## 12. Risiken

| Risiko                                            | Gegenmaßnahme                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Effekttexte mehrdeutig                            | Comprehensive Rules + Q&A-PDF als Tests; Zweifelsfälle in `docs/EFFECTS.md` festhalten      |
| Viele Karten (1290)                               | Meta-Priorität, Entwurfsgenerator, Abdeckungsbericht, nicht unterstützte Decks ausschließen |
| KI-Stärke verzerrt Statistiken                    | mehrere KI-Stufen, Selbstspiel-Tuning, Replays zum Prüfen, Hinweis in der Auswertung        |
| Meta-Daten lückenhaft („Other“, keine Ressourcen) | Ähnlichkeits-Bündelung, Standard-Ressourcen, Snapshots                                      |
| Neue Sets/Regeländerungen                         | GCGDB-Update-Ablauf, Regelnummern in Tests, Abdeckungsbericht zeigt neue Karten             |
| Bildrechte bei Veröffentlichung                   | Bilder nie im Repo; Lösung vor Pages-Veröffentlichung                                       |
| Leistung am Handy                                 | Engine in Worker, nur `transform`/`opacity` animieren, Bilder in zwei Größen                |

---

## 13. Entscheidungen des Nutzers (16. Nov. 2026)

1. **Technik:** TypeScript + Vite + Svelte mit Build-Schritt.
2. **Rollback:** unbegrenzt, gleicher Zufall (dieselben Karten kommen wieder). Kein „fairer“ Modus nötig.
3. **Deckwissen der KI:** Die KI kennt das gegnerische Deck **nicht**. Sie darf es wie ein Mensch aus den
   gesehenen Karten erraten (siehe 6. KI, „Gegnermodell“).
4. **Umfang M5:** Top-8-Archetypen der letzten 8 Wochen als erstes Ziel.
