# KI

Stand: M8 (16. Nov. 2026). Plan und spätere Stufen: `docs/PLAN.md` Abschnitt 6.

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

## Such-KI (M7, `src/ai/search.ts`, `src/ai/opponent.ts`)

**Gegnermodell:** Die KI kennt ihre eigene Liste und ein **Feld** möglicher Gegnerdecks (im Spiel: die
Meta-Archetypen mit ihren Anteilen, Starter-Decks mit kleinem Gewicht; im Simulator: die Decks des Laufs,
gleich wahrscheinlich). Aus den gesehenen Karten des Gegners (Feld, Trash, Verbannung, Base, Piloten)
schätzt sie, welches Deck er spielt: Anteil × 0,02 je gesehener Karte, die das Deck nicht (so oft) enthält.
Für eine Stichprobe zieht sie ein Deck nach diesem Gewicht und füllt die verdeckten Karten (Hand, Deck,
Schilde) mit dessen noch nicht gesehenen Karten in zufälliger Reihenfolge; ihre eigenen verdeckten Karten
sind der Rest ihrer Liste. Sie sieht nie die echten verdeckten Karten.

**Suche:** Für jede Entscheidung (Main, Block, Action, Effekte) nimmt sie die besten 6 Optionen nach v1
(`LookaheadPolicy.rank`), zieht 6 Stichproben (stark: 16 Stichproben, 8 Optionen) und spielt jede Option in
jeder Stichprobe mit v0 für beide Spieler **bis zu ihrer nächsten Main Phase** weiter, also durch den
ganzen Zug des Gegners mit Karten, die er wirklich haben könnte. Gewählt wird der beste Durchschnitt der
Bewertung (`Evaluator`). Das ist Monte Carlo über Determinisierungen („PIMC“), **kein vollständiger
ISMCTS-Baum**: Die Engine fragt sehr feinkörnig (jedes Ziel, jedes Passen); ein Baum würde fast sein
ganzes Budget auf triviale Zweige verwenden.

**Stärke (Top-8-Meta-Decks, alle Paarungen):**

| Paarung                      | Spiele | Ergebnis (95 %)          | Rechenzeit/Spiel |
| ---------------------------- | ------ | ------------------------ | ---------------- |
| Suche – v1                   | 800    | **54,3 %** (50,8–57,7 %) | 2,7 s            |
| Suche stark – v1             | 800    | 53,5 % (50,0–56,9 %)     | 6,8 s            |
| Suche stark – Suche          | 256    | 57,0 % (50,9–62,9 %)     | 9,3 s            |
| Suche, Horizont Zugende – v1 | 800    | 52,5 % (49,0–55,9 %)     | –                |
| Suche – v1 (Starter-Decks)   | 128    | 62,5 % (53,9–70,4 %)     | 1,9 s            |

Die Suche ist messbar stärker als v1, aber nicht deutlich; mehr Stichproben helfen kaum. Die Grenze ist die
Fortsetzung: Für alle weiteren Entscheidungen (auch die eigenen im restlichen Zug) spielt v0. Nächste
Hebel: eine bessere Fortsetzungspolitik (z. B. v1 für die eigenen Entscheidungen im laufenden Zug), Gewichte
neu abstimmen, wenn die Suche sie nutzt (`npm run tune` mit `search`), echte Baumsuche über
Makro-Aktionen (ganzer Zug als Plan).

**Letzte Chance (17. Nov.):** Verliert in einer Main-Phase-Entscheidung selbst die beste Option im
Durchschnitt der Stichproben, sucht die Suche weiter, bevor sie aufgibt: alle Optionen (bis 16) statt der 6
besten nach v1, bis zu 64 Stichproben (Abbruch, sobald eine Option besser als „verloren“ steht, oder nach
24 ohne jeden Ausweg) und Simulation über **zwei** Runden, damit „überlebt eine Runde durch einen Burst“ nicht
als offene Stellung zählt. Prüfstellung (Gegner gewinnt sicher im nächsten Zug; eigene volle 6-HP-Base, ein
Schild, Gundam + Base auf der Hand; die Base nimmt den Schild auf die Hand, ist er Amuro Ray, gewinnt Gundam
sofort): Base gelegt vorher Schwer 16/30, Sehr schwer 25/30, jetzt **30/30** bzw. **29/30**, unabhängig davon,
ob der Schild wirklich Amuro ist (die KI kennt ihn nicht). Gemessen in der Stellung: Base 9,5 % Sieg,
Main Phase beenden 0 % Sieg, aber 14 % „überlebt eine Runde“ (über zwei Runden 0 %). Leicht und Normal
erkennen solche Auswege nicht (v1 ersetzt verdeckte Karten durch Platzhalter). Kosten: Suche – v1 auf den
Top-8-Meta-Decks 110 statt 83 s für 864 Spiele (+33 %), Spielstärke gleich (50,8 % gegen 50,8 % ohne).
Hinweis: Suche – v1 lag in diesem Lauf bei 50,8 % (47,5–54,1 %, 864 Spiele), in M7 bei 54,3 % (800 Spiele);
die Intervalle überlappen.

**Successive Halving (17. Nov.):** Statt jeder Option alle Stichproben zu geben, bekommen alle zuerst wenige,
nach jeder Runde fällt die schlechtere Hälfte heraus, die übrigen bekommen doppelt so viele; die letzten zwei
werden mit `samples` Stichproben verglichen wie vorher. Alle Optionen laufen auf denselben ausgewürfelten
Stellungen. Sehr schwer (8 Optionen, 16 Stichproben): 4 / 8 / 16 = 64 statt 128 Simulationen pro
Entscheidung; Schwer (6 / 6): 21 statt 36. `SearchOptions.halving: false` ergibt das alte Verfahren.
Gemessen (Top-8-Meta, neu gegen alt direkt, Sitze/Startspieler/Deckseiten ausgeglichen):

| Stufe       | Spiele | neu gegen alt        | Zeit pro Entscheidung (neu / alt) |
| ----------- | ------ | -------------------- | --------------------------------- |
| Schwer      | 1296   | 50,9 % (48,2–53,6 %) | 29,9 / 39,0 ms (1,30×)            |
| Sehr schwer | 648    | 49,8 % (46,0–53,7 %) | 62,9 / 93,0 ms (1,48×)            |

Gleich stark, schneller; weniger als die rechnerischen 2×, weil die v1-Vorauswahl und Entscheidungen mit
nur zwei Optionen gleich viel kosten. Simulator Suche – v1 (864 Spiele, Seed 1): 91,5 statt 110 s, 52,3 %
(49,0–55,6 %); Suche stark – v1 (288 Spiele): 58,7 % (52,9–64,2 %), 202 ms pro Spiel insgesamt.

**Schwierigkeitsgrade im Spiel** (`DIFFICULTIES` in `src/ai/registry.ts`): Leicht = v0, Normal = v1,
Schwer = Suche (Standard), Sehr schwer = Suche stark.

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

## Abstimmung der Gewichte (`npm run tune`)

Koordinatensuche per Selbstspiel: Jedes Gewicht wird mit ×0,5 und ×1,6 gegen die aktuellen Gewichte
gespielt (v1 gegen v1, je 1000 Spiele mit den Top-8-Meta-Decks, Sitze, Decks und Startspieler
ausgeglichen). Gewinnt der Kandidat mindestens 53,5 % **und** bestätigt ein zweiter, unabhängiger Lauf mit
doppelt so vielen Spielen den Vorteil (untere Intervallgrenze > 50 %), wird er übernommen. Der Runner kann dafür pro KI
eigene Gewichte mitgeben (`SimJob.weights`, `GameSpec.slots` sagt, welche KI auf welchem Sitz spielt).

**Erste Runde (16. Nov. 2026, 36 Vergleiche, 12 min auf 15 Workern):** Kein Gewicht ist klar besser. Der
einzige Treffer (Lv.-Gewicht 0,3 → 0,48: 54,6 %) war Zufall; mit 3000 neuen Spielen 49,5 % (47,7–51,3 %).
Deshalb gibt es jetzt den Bestätigungslauf. Ergebnis: Die Handgewichte liegen auf einem Plateau; die
Grenzen von v1 liegen in der Suche (nur v0 als Fortsetzung, keine gegnerischen Handkarten), nicht in der
Bewertung. Das ist die Ausgangslage für M7 (ISMCTS).

## Heuristik v0

Feste Regeln mit einer einfachen Bewertung, **ohne Vorausschau**. Jede Option bekommt eine Punktzahl, die
beste positive gewinnt (sonst Main Phase beenden bzw. passen). Deterministisch (kein eigener Zufall).

- **Wert einer Unit:** AP + verbleibende HP + Lv./2, Zuschläge für Keywords und Pilot.
- **Mulligan:** siehe Abschnitt „Mulligan“ (gilt für alle KIs).
- **Action-Commands** (seit 18. Nov. 2026, `commandMatters`, **nicht gemessen**): nur, wenn sie jetzt etwas
  ändern: eine gegnerische Unit entfernen oder durch Schaden zerstören, den laufenden Kampf beeinflussen (AP,
  Keywords, Schutz der eigenen kämpfenden Unit, neues Angriffsziel) oder eine beschädigte eigene Unit heilen;
  sonstige Effekte (Ziehen …) am Ende des gegnerischen Zuges. Vorher spielte v0 jedes Action-Command sofort.
  Wirkt auch auf v1 und die Suche, die mit v0 weiterspielen. In der Main Phase unverändert.
- **Main Phase** (Reihenfolge ergibt sich aus den Punkten): tödlicher Angriff › Units einsetzen (höheres
  Lv. zuerst) › Pilot setzen (Link bevorzugt; Commands mit 【Pilot】 nur bei Link) › Base (siehe unten) › Commands › Activate-Effekte › Angriff auf eine geruhte Unit, die zerstört wird und die eigene
  überlebt › Spieler angreifen (außer ein aktiver <Blocker> würde die Unit ohne Verlust zerstören) ›
  Tausch, wenn die gegnerische Unit mehr wert ist.
- **Blocken:** immer bei tödlichem Angriff; sonst wenn der Blocker überlebt oder einen wertvolleren Angreifer
  zerstört, oder um eine wertvollere eigene Unit zu schützen.
- **Action Step:** nutzt Commands und Activate-Effekte, sobald es kann.
- **Effekt-Entscheidungen:** Burst und „you may“ immer ja; bei Zielen liest sie im übersetzten Programm, was
  mit dem Ziel geschieht (Schaden, Zerstörung, Ruhen … = schaden; AP+, Bereitmachen, Erholen … = helfen) und
  wählt danach gegnerische bzw. eigene Karten, bei Schaden bevorzugt solche, die dadurch zerstört werden.
  Überzahl und Abwerfen trifft die schwächste Karte, „Look at the top“ nimmt die beste.
- **Base legen (17. Nov.):** nur, wenn es sich in den Einheiten der v1-Bewertung lohnt: 0,8 × (HP der neuen
  Base − verbleibende HP der alten), minus 4/i für jeden Schild, den 【Deploy】 auf die Hand nimmt (der i-te
  verbleibende Schild ist 2 + 4/i wert, die Karte dafür 2), plus 1 je weiterem Effekt der neuen Base;
  getauscht ab 0,5. Vorher legte v0 jede Base, sobald nichts Wichtigeres anstand, auch über eine
  unbeschädigte. Eine angeschlagene Base wird ersetzt, eine gesunde nicht nur für „Schild gegen Karte“; bei
  2 Schilden lohnt die EX Base (3 → 6 HP) nicht mehr. Entscheidet in den acht Prüfstellungen wie v1.
  Spielstärke unverändert: neue v0 gegen alte 50,7 % (2304 Spiele), v1 mit neuer gegen v1 mit alter v0 als
  Fortsetzung 50,4 % (49,3–51,6 %, 6912 Spiele, Top-8-Meta).
- **Handlimit-Abwurf (Fehler bis 17. Nov.):** Die Punktzahl war negativ, `best()` nimmt nur positive; v0
  lieferte keine Wahl, der Runner zählte das Spiel als Fehler (selten: etwa 1 von 7000 Spielen).

Werte, die sich in der Sicht nicht berechnen lassen (ein Dauereffekt prüft verdeckte Karten), fallen auf
die aufgedruckten Werte zurück.

Schwächen von v0: keine Vorausschau, keine Planung des Ressourcen-Einsatzes, spielt Commands sofort,
hält keine Blocker zurück, Support kaum genutzt.

## Mulligan (`src/ai/mulligan.ts`, `npm run mulligan`)

Alle KIs (v0, v1, Suche) behalten ihre Starthand nur mit **mindestens zwei Units bis Lv.4**, sonst ziehen
sie einmal neu (Regel `units`, seit 17. Nov. 2026). Vorher (`basic`, M5): behalten bei einer Unit bis Lv.3
oder zwei beliebigen Karten bis Lv.4.

**Herleitung:** v1 spielte die Top-8-Meta-Decks gegen sich selbst und behielt jede Hand (9216 Spiele,
18 432 Starthände). Ein Mulligan bringt im Mittel eine zufällige Hand, also die mittlere Siegquote des Decks
auf derselben Position; neu ziehen lohnt sich genau bei Händen darunter. Stärkstes Merkmal ist die Zahl der
Units bis Lv.4 (0: −5,8 Punkte, 1: −1,6, 2: +0,7, 3: +2,5, 4: +5,0); Piloten, Commands und Karten ab Lv.6
erklären wenig zusätzlich. Geschätzter Gewinn pro Spiel gegenüber „immer behalten“:

| Regel                            | Mulligans  | Gewinn (Hälften der Daten) |
| -------------------------------- | ---------- | -------------------------- |
| `basic` (alt)                    | 1,6 %      | +0,11 Pkt. (0,09 / 0,14)   |
| ≥ 1 Unit bis Lv.4                | 11,4 %     | +0,66                      |
| ≥ 1 Unit bis Lv.4 und ≥ 2 Units  | 16,6 %     | +0,83                      |
| **≥ 2 Units bis Lv.4 (`units`)** | **42,5 %** | **+1,14 (1,14 / 1,14)**    |
| ≥ 2 Units bis Lv.4 und ≥ 3 Units | 51,2 %     | +1,09                      |
| ≥ 3 Units bis Lv.4               | 73,5 %     | +0,92 (1,21 / 0,63)        |
| Punktwert (Units gewichtet)      | 35–45 %    | +1,02 bis +1,03            |

**Bestätigung im direkten Vergleich** (v1 gegen v1, Meta Top 8, neuer Seed, Sitze und Startspieler
ausgeglichen): `units` gegen `basic` **51,4 %** (50,9–51,9 %, 36 864 Spiele); Mulligans 43,2 % gegen 2,0 %.

Folge: Simulationsergebnisse vor und nach dem 17. Nov. sind nicht direkt vergleichbar. Grenzen: gemessen
mit v1 und den Meta-Decks; Decks mit vielen teuren Units ziehen öfter neu, als ein Mensch es täte, ein
Mulligan nach Deckliste (z. B. Schlüsselkarten) gibt es nicht.

```bash
npm run mulligan -- --games 9216               # Studie: alle Hände behalten, Merkmale auswerten
npm run mulligan -- --load                     # dieselbe Auswertung aus build/mulligan-hands.json
npm run mulligan -- --compare units,basic      # direkter Vergleich zweier Regeln
```

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
