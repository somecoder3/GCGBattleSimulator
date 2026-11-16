# KI

Stand: M4 (16. Nov. 2026). Plan und spätere Stufen: `docs/PLAN.md` Abschnitt 6.

## Schnittstelle

Eine KI ist eine `Policy` (`src/ai/types.ts`): `choose(view, decision)` wählt eine der `decision.options`.
Sie bekommt nur `viewFor(state, player)` (verdeckte Karten als `"?"`, Zufallsgenerator geleert), außer sie
erklärt `usesView = false` (Zufalls-KI). `playMatch` (`src/sim/match.ts`) und `GameSession.stepAI`
(`src/sim/session.ts`) halten sich daran.

| KI (Name)                         | Datei                                       | Einsatz                                        |
| --------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| Zufall (`random`)                 | `src/ai/random.ts`                          | Fuzzing, schwächster Gegner                    |
| Heuristik v0 (`heuristic-v0`)     | `src/ai/heuristic.ts`                       | Regeln; Fortsetzung in den Simulationen von v1 |
| **Heuristik v1** (`heuristic-v1`) | `src/ai/lookahead.ts`, `src/ai/evaluate.ts` | Standard-Gegner im Spiel, Massensimulation     |

Namen und Erzeugung: `src/ai/registry.ts` (`makePolicy`, Kurzformen `v0`, `v1`, `heuristic` = v1).

## Heuristik v1 (Bewertung + Vorausschau)

Für jede Entscheidung in Main Phase, Block, Action Step und Effekten probiert v1 **jede Option** auf einer
Kopie ihrer Sicht aus, lässt dann **v0 für beide Spieler bis zur Main Phase des nächsten Zuges**
weiterspielen und bewertet die Stellung (`Evaluator`). Die beste Bewertung gewinnt; bei Gleichstand die
Wahl von v0. Mulligan und Handlimit-Abwurf übernimmt v0.

- **Verdeckte Karten** (Decks, Schilde, gegnerische Hand) ersetzt `determinize()` für die Simulation durch
  eine Resource-Karte ohne Effekt: Sie kann nicht gespielt werden und hat keinen Burst. Die KI weiß also
  nichts, was sie nicht sehen darf; gegnerische Antworten aus der Hand sieht sie nicht voraus.
- **Bewertung** (Unterschied beider Seiten, `DEFAULT_WEIGHTS`): Schilde mit steigendem Wert der letzten
  (i-tes verbleibendes Schild 2 + 4/i), Base-HP × 0,8, Handkarten × 2 (bis 8), Units je 2 + AP + 0,7 × HP +
  0,3 × Lv. + Keywords; geruhte Units, die der Gegner vor dem nächsten Bereitmachen zerstören kann, −15 %;
  ohne gegnerische Schilde und Base +6 je Angreifer über der Zahl der gegnerischen Blocker; Sieg ±1 000 000.
- **Horizont:** Bis zur Main Phase des nächsten Zuges (Zug zu Ende spielen) statt nur bis zur nächsten
  Entscheidung. Das war der entscheidende Schritt: Mit kurzem Horizont gewann v1 nur 37–58 % gegen v0, mit
  ganzem Zug ~75 %. Eine hohe Strafe für geruhte Units machte die KI zu passiv und schadete.
- **Tempo:** Zustände werden mit `cloneState` (`src/engine/clone.ts`) kopiert statt mit `structuredClone`
  (3× schneller; das Kopieren waren 55 % der Rechenzeit). Ø rund 50 ms pro Spiel v1 gegen v1 auf einem Kern.

Bekannte Schwächen: Die Fortsetzung spielt nur v0, also keine echte Planung mehrerer eigener Aktionen;
keine Vorstellung von gegnerischen Handkarten (für M7: ISMCTS mit Gegnermodell); Gewichte von Hand gesetzt
(Tuning per Selbstspiel in M7).

## Heuristik v0

Feste Regeln mit einer einfachen Bewertung, **ohne Vorausschau**. Jede Option bekommt eine Punktzahl, die
beste positive gewinnt (sonst Main Phase beenden bzw. passen). Deterministisch (kein eigener Zufall).

- **Wert einer Unit:** AP + verbleibende HP + Lv./2, Zuschläge für Keywords und Pilot.
- **Mulligan:** behalten bei mindestens zwei Units bis Lv. 3 (oder einer und einer Karte bis Lv. 2).
- **Main Phase** (Reihenfolge ergibt sich aus den Punkten): tödlicher Angriff › Units einsetzen (höheres
  Lv. zuerst) › Pilot setzen (Link bevorzugt; Commands mit 【Pilot】 nur bei Link) › Base, wenn nur die EX Base
  liegt › Commands › Activate-Effekte › Angriff auf eine geruhte Unit, die zerstört wird und die eigene
  überlebt › Spieler angreifen (außer ein aktiver <Blocker> würde die Unit ohne Verlust zerstören) ›
  Tausch, wenn die gegnerische Unit mehr wert ist.
- **Blocken:** immer bei tödlichem Angriff; sonst wenn der Blocker überlebt oder einen wertvolleren Angreifer
  zerstört, oder um eine wertvollere eigene Unit zu schützen.
- **Action Step:** nutzt Commands und Activate-Effekte, sobald es kann.
- **Effekt-Entscheidungen:** Burst und „you may“ immer ja; bei Zielen liest sie im übersetzten Programm, was
  mit dem Ziel geschieht (Schaden, Zerstörung, Ruhen … = schaden; AP+, Bereitmachen, Erholen … = helfen) und
  wählt danach gegnerische bzw. eigene Karten, bei Schaden bevorzugt solche, die dadurch zerstört werden.
  Überzahl und Abwerfen trifft die schwächste Karte, „Look at the top“ nimmt die beste.

Werte, die sich in der Sicht nicht berechnen lassen (ein Dauereffekt prüft verdeckte Karten), fallen auf
die aufgedruckten Werte zurück.

Schwächen von v0: keine Vorausschau, keine Planung des Ressourcen-Einsatzes, spielt Commands sofort,
hält keine Blocker zurück, Support kaum genutzt.

## Stärke (Starter-Decks ST01–ST04, alle Paarungen, beide Sitze und Startspieler ausgeglichen)

Gemessen am 16. Nov. 2026, Seed 1, 16 logische Kerne:

| Paarung               | Spiele | Ergebnis (95-%-Intervall)        | Zeit                 |
| --------------------- | ------ | -------------------------------- | -------------------- |
| v1 – Zufall           | 4000   | **97,5 %** (97,0–98,0 %)         | 23,7 s (15 Worker)   |
| v1 – v0               | 4000   | **75,5 %** (74,1–76,8 %)         | 32,0 s (15 Worker)   |
| v0 – Zufall           | 4000   | 92,9 % (92,0–93,6 %)             | 2,5 s (15 Worker)    |
| v1 – v1 (Deck-Matrix) | 10 000 | Startspieler 64,1 %, Ø 15,9 Züge | **128 s (8 Worker)** |

Starter-Decks bei v1 gegen v1: ST04 58,3 %, ST01 57,9 %, ST03 49,3 %, ST02 34,5 % (je 3000 Spiele).
Die Werte zeigen das Spiel der KI, nicht das von Menschen. M4-Abnahme (10 000 Spiele < 5 min auf 8 Kernen,
Heuristik schlägt Zufall > 95 %) ist erfüllt.

```bash
npm run sim -- --ai v1,random --decks starters --games 4000
npm run sim -- --ai v1 --decks starters --games 10000 --workers 8
```
