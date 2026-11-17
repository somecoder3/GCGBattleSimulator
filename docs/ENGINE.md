# Regel-Engine

Stand: M5 (16. Nov. 2026). Regelgrundlage: Comprehensive Rules **Ver. 1.10.0**; Regelnummern stehen im
Code und in den Tests.

## Schnittstelle

```ts
const engine = new Engine(CardLib.fromPool(pool));
const { state, events } = engine.newGame([deckA, deckB], { seed: 42, firstPlayer: 0 });
while (state.pending) {
  const action = chooseFrom(state.pending.options); // Mensch, KI oder Test
  const events = engine.apply(state, action); // läuft bis zur nächsten Entscheidung
}
state.result; // { winner: 0 | 1 | null, reason: "damage" | "deckOut" | "turnLimit", turn }
```

- **`GameState`** ist reines JSON (keine Klassen, Maps oder Funktionen): klonbar, speicherbar, per
  `postMessage` an Worker übertragbar. `apply` ändert den Zustand direkt (schnell für Massenläufe); wer
  den alten Zustand braucht, klont vorher (`structuredClone`).
- **`pending: Decision`** = wer entscheidet, Art (`mulligan`, `main`, `block`, `action`, `discard`) und alle
  legalen `options`. `apply` lehnt alles andere ab. Gleiche Kartennummern auf der Hand werden zu einer
  Option zusammengefasst (Kopien sind gleichwertig, 2-1-1).
- **Events** beschreiben jede Änderung (`draw`, `deploy`, `pair`, `attack`, `block`, `damage`,
  `shieldBreak`, `destroyed`, `toTrash`, …) für Animationen, Log und Statistik. Sie enthalten Karten-Ids
  und sind nicht nach Sichtbarkeit gefiltert; das Spiel-Log (`src/app/lib/gamelog.ts`) nennt nur Karten,
  die der Mensch in dem Moment sehen darf.
- **Zufall:** eigener Generator (xoshiro128\*\*) im Zustand. Seed + Decks + Aktionen ⇒ exakt dasselbe
  Spiel (`replay()` in `src/sim/match.ts`). **Rollback = Replay eines Präfixes.** Die KI hat einen eigenen
  Generator und verändert den Spielzufall nie.
- **Verdeckte Information:** `viewFor(state, player)` ersetzt verdeckte Karten (eigenes/fremdes Deck,
  Schilde, gegnerische Hand) durch die Nummer `"?"` und leert den Zufallsgenerator. Policies bekommen nur
  diese Sicht (`playMatch`), außer sie erklären `usesView = false` (Zufalls-KI).

## Aufbau

| Datei                          | Inhalt                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/engine/types.ts`          | Zustand, Aktionen, Entscheidungen, Events                                                   |
| `src/engine/engine.ts`         | Ablauf als Zustandsmaschine (`Step`), Optionen, Aktionen, Kampf                             |
| `src/engine/core.ts`           | Werte mit Effekten, Filter, Bedingungen, Kartenbewegung, Schaden, Trigger, Rules Management |
| `src/engine/interpret.ts`      | Führt Karteneffekte aus (Frames), Effekt-Entscheidungen                                     |
| `src/effects/`                 | Effekt-DSL, Übersetzer, Compiler, Handskripte – siehe `docs/EFFECTS.md`                     |
| `src/engine/cardlib.ts`        | Regelrelevante Kartendaten: Keywords, Pilotname, Link-Prüfung                               |
| `src/engine/deck.ts`           | Deckbau-Regeln (6-1), Zufallsdecks                                                          |
| `src/engine/view.ts`           | Spielersicht ohne verdeckte Information                                                     |
| `src/engine/invariants.ts`     | Konsistenzprüfungen für Tests und Fuzzing                                                   |
| `src/engine/rng.ts`, `hash.ts` | Zufall, Zustands-Fingerabdruck                                                              |
| `src/ai/random.ts`             | Zufalls-KI (gewichtet: lieber handeln als die Main Phase beenden)                           |
| `src/sim/match.ts`             | `playMatch`, `replay`                                                                       |
| `src/sim/session.ts`           | `GameSession`: Mensch gegen KI mit Rollback, Log-Schritten, Speichern                       |
| `src/sim/runner.ts`            | Match-Runner: Job (Decks, KIs, Spiele, Seed) → Spiel Nr. i, `GameSummary`                   |
| `src/sim/pool.ts`              | Verteilt Spiele auf Worker (Node-Threads, Web Worker), Nachrichtenformat                    |
| `src/sim/stats.ts`             | Siegquoten mit Wilson-Intervall pro KI, Deck, Matchup; Startspieler, Länge, Mulligan        |
| `src/sim/worker.ts`            | Web Worker des Simulators im Browser (`tools/sim-worker.ts` für Node)                       |
| `src/engine/clone.ts`          | `cloneState`: schnelle tiefe Kopie (statt `structuredClone`), für Sicht und KI-Suche        |
| `tools/sim.ts`                 | `npm run sim` / `npm run fuzz`                                                              |

Ablauf: `run()` arbeitet zuerst laufende Effekte ab (`frames`), dann wartende Trigger (`queue`), sonst den
nächsten Schritt (`startTurn → draw → resource → main ↔ attack → block → battleAction →
damage → battleEnd`, `endAction → endStep → handStep → cleanup`), nach jedem Schritt Rules Management
(Niederlage, Zerstörung), bis eine Entscheidung ansteht oder das Spiel endet. Action Steps laufen mit
abwechselnder Priorität; wer nur passen kann, passt automatisch.

## Umgesetzt (M1)

- Vorbereitung (6-2): Mischen, 5 Karten, Mulligan in Reihenfolge, 6 Schilde, EX Base, EX Resource für
  Spieler 2. Spieler 1 zieht im ersten Zug (die Regeln nehmen ihn nicht aus).
- Phasen und Schritte (7), Handlimit 10 (nur der aktive Spieler), Zuglimit als Unentschieden.
- Ausspielen: Lv. = Anzahl Ressourcen, Kosten = aktive Ressourcen ruhen (normale zuerst, EX Resource zuletzt
  und dann aus dem Spiel). Units (7. Unit ersetzt eine gewählte, nicht „zerstört“), Bases (ersetzen die alte),
  Pilots und Commands mit 【Pilot】 als Pilot (Werte addiert, Link über Namensteil oder Trait).
- Angriff nur mit aktiven Units, nicht im Einsatzzug außer Link Units; Ziel Spieler oder geruhte Unit;
  Base vor Schilden, Schild bei ≥ 1 Schaden zerstört, Sieg bei Schaden ohne Schilde/Base, AP 0 macht keinen
  Schaden; Unit-Kampf gleichzeitig.
- Keywords (wenn die Zeile mit dem Keyword beginnt): Blocker, First Strike, High-Maneuver, Suppression,
  Breach, Repair, Support.
- Rules Management: Niederlage bei leerem Deck, Zerstörung bei Schaden ≥ HP (gleichzeitig), Pilot geht mit,
  Tokens verlassen das Spiel außerhalb des Feldes.

## Umgesetzt (M2)

Karteneffekte über die Effekt-DSL (`docs/EFFECTS.md`): Trigger, Commands (Main und Action, auch im Action
Step), Activate-Effekte mit Kosten, Bursts, Dauereffekte, Pilot-Texte für die Unit, Tokens, Flags wie
„can't attack“, „may attack active Units“, Schutz vor Schaden. Neue Optionen: `playCommand`, `activate`;
Effekt-Entscheidungen haben `kind: "effect"`. Im Action Step wechselt nach einer Aktion die Priorität
(9-4-1).

## Umgesetzt (M5)

Neue Mechaniken für die Meta-Karten (Details in `docs/EFFECTS.md`): Schaden mit Quelle (`dealDamage(…,
source)`) für Schutz/Reduktion/Erhöhung, `pairPilot` (auch aus dem Trash), Trigger anderer eigener Units,
`traitsOf` mit verliehenen Traits, Hand-Kostensenkung (`levelOf`/`costOf`), Angriff im Einsatzzug per Flag,
Angriffszwang, Pilot als Unit (`CardInstance.asUnit`, `CardLib.unitForm`), Zug-Markierungen
(`GameState.marks`), Wahl durch den Gegner (`choose … by: "opponent"`).

## Offen

- (erledigt in M9) Reihenfolge gleichzeitiger eigener Trigger wählbar (10-1-6-5, FAQ Q107); in Szenario-Tests
  per `GameState.orderChoice = false` aus.
- Rund die Hälfte der Karten hat noch nicht verstandene Zeilen (`npm run coverage`).

## Prüfung

- `tests/engine/rules.test.ts`: Regeltests mit Testkarten (`tests/engine/helpers.ts`, Set `X`) und einem
  Baukasten für Spielsituationen (`scenario()`).
- `tests/engine/fuzz.test.ts`: 1000 Spiele mit Zufallsdecks aus allen echten Karten, Invarianten nach jedem
  Schritt, exakte Replays, JSON-Runde mitten im Spiel.
- `tests/cards/starters.test.ts`: jede Effektkarte von ST01–ST04 mit echten Karten, dazu 400 Spiele
  zwischen allen Starter-Paarungen mit Invarianten.
- `tests/effects/parse.test.ts`: Übersetzer und Compiler.
- `npm run fuzz`: 100 000 Spiele mit Zufallsdecks aus allen Karten (inklusive aller verstandenen Effekte).
