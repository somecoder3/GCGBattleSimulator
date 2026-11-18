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
- **Commands** (seit 18. Nov. 2026, `mainCommandScore` und `commandMatters`), nach Wirkung und Dauer:
  - Entfernen (zerstören, auf die Hand, verbannen, oder Schaden, der eine gegnerische Unit zerstört): in der
    Main Phase früh, im Action Step sofort.
  - Nur „during this battle“: nie in der Main Phase; im Action Step, wenn sie den laufenden Kampf ändern
    (AP, Keywords, Schutz der eigenen kämpfenden Unit, neues Angriffsziel).
  - „During this turn“ für eigene Units: in der Main Phase vor den Angriffen, nur wenn sie diesen Zug helfen
    (AP+ ermöglicht einen Kill oder trifft eine gegnerische Base; Keywords/Angriffsflags, wenn es Angreifer gibt).
  - „During this turn“ gegen gegnerische Units (AP−, ruhen): nur, wenn eigene Units diesen Zug angreifen können.
  - Ziehen und Sonstiges (Token, Ressourcen, Karte aus dem Trash, heilen): am Ende der Main Phase, wenn sonst
    nichts mehr sinnvoll ist, und nur, wenn danach genug aktive Ressourcen für jedes Action-Command auf der
    Hand bleiben (für den gegnerischen Zug); im Action Step am Ende des gegnerischen Zuges.
  - **Dringendes Ziehen** (18. Nov., Nutzerwunsch): mit höchstens 3 weiteren Handkarten zuerst (vor dem
    Einsetzen, damit gezogene Karten noch diesen Zug spielbar sind), ohne eigene Unit im Spiel und ohne
    einsetzbare Unit/Base ebenfalls sofort und ohne Reserve für Action-Commands. Alte Regel: `late-draw`.
    Gemessen (Meta Top 8, `npm run ab`): nur Action-Regel: v0 49,9 % (36 864 Spiele), v1 50,7 % (50,0–51,4 %,
    18 432); nur Main-Phase-Regel: v0 50,6 % (50,1–51,1 %, 36 864); beide gegen die alten Regeln
    (`old-commands`): **v1 51,0 % (50,3–51,7 %, 18 432 Spiele)**. v1 entscheidet seine eigenen Züge per
    Vorausschau; die Regeln wirken dort über die Fortsetzungen.
- **Main Phase** (Reihenfolge ergibt sich aus den Punkten): tödlicher Angriff › Units einsetzen (höheres
  Lv. zuerst) › Pilot setzen (Link bevorzugt; Commands mit 【Pilot】 nur bei Link) › Base (siehe unten) › Commands › Activate-Effekte › Angriff auf eine geruhte Unit, die zerstört wird und die eigene
  überlebt › Spieler angreifen (außer ein aktiver <Blocker> würde die Unit ohne Verlust zerstören) ›
  Tausch, wenn die gegnerische Unit mehr wert ist.
- **Blocken:** immer bei tödlichem Angriff; sonst wenn der Blocker überlebt oder einen wertvolleren Angreifer
  zerstört, oder um eine wertvollere eigene Unit zu schützen.
- **Action Step:** nutzt Commands und Activate-Effekte, sobald es kann.
- **Wirkungslose Commands auch nicht suchen (18. Nov.):** `allowed()` lässt im Action Step Commands weg, die
  jetzt nichts ändern (`commandMatters`); das gilt damit auch für v1 und die Such-KI, die vorher jede Option
  durchrechneten. Gefunden in einer eigenen Partie gegen „Sehr schwer“: Die Suche spielte Unforeseen Incident
  (AP−3 „during this turn“) am Ende des gegnerischen Zuges, eine verschwendete Karte, weil die Stichproben
  rauschten (nur `search-strong` mit dem Meta-Feld, v0/v1/search passten). Gemessen (Meta Top 8): v1 49,6 %
  (48,6–50,6 %, 9216 Spiele), Suche 49,4 % (47,4–51,5 %, 2304 Spiele) gegen die alte Fassung
  (`idle-commands`): kein messbarer Unterschied, der Fall ist selten. Behalten, weil er einen klaren Fehlzug
  verhindert.
- **AP-Ziele (18. Nov., gehäufte Effekte):** AP− auf gegnerische und AP+ auf eigene Units wählt v0 nach den
  Kämpfen, die sich ändern (`apChangeValue`): ausgehend vom aktuellen AP (enthält frühere Änderungen dieses
  Zuges) zählt jede eigene bzw. gegnerische Unit, die vorher zerstört würde und danach nicht mehr (bzw.
  umgekehrt), dazu ein kleiner Teil des Werts und bei AP+ Schaden an der Base. Dadurch gehen mehrere AP−2
  (z. B. GD04-066 Unicorn Awakened + GD05-121 Cyclone Punch + GD05-069 Maxter) auf dieselbe Unit, solange das
  noch einen Kampf ändert, danach auf die nächste; AP 0 wird nicht weiter gesenkt. Vorher nur nach Wert
  (`plain-ap-targets`).
  Gemessen (Meta Top 8, je 9216 Spiele): Ziehen v0 50,0 %, v1 50,5 % (49,5–51,5 %); AP-Ziele v0 50,5 %, v1
  50,2 %: kein messbarer Unterschied (die Fälle sind selten, v1 sieht Häufung ohnehin per Vorausschau).
  Behalten, weil die Entscheidungen in den Prüfstellungen richtig sind und nichts schlechter wird.
- **Resten (18. Nov., Nutzerwunsch, `restValue`):** Was das Resten einer gegnerischen Unit jetzt ändert. Im
  eigenen Zug: der beste lohnende Angriff auf sie (nur geruhte Units sind angreifbar; wie `attackScore`:
  zerstören und überleben 2 + Wert, Tausch Wertdifferenz), dazu mit <Breach> 2 + Breach (+2 bei ≤ 2
  Schilden), wenn Schild oder Base getroffen werden, und +2, wenn ein <Blocker> den Angreifern aus dem Weg
  geht. Im gegnerischen Zug: eine aktive Unit, die noch angreifen könnte, 1 + AP/2 (+3 bei ≤ 1 Schild).
  Verwendet für Rest-Commands in der Main Phase (110 nur ab Wert 2, vorher immer, wenn es Angreifer und eine
  aktive gegnerische Unit gab), im Action Step (vorher **nie**), Activate-Effekte, die nur gegnerische
  Units resten (vorher immer), und die Zielwahl aller Rest-Effekte (vorher nach Wert, auch schon geruhte).
  Alte Regel: `plain-rest`. Gemessen: v0 **51,1 %** (50,1–52,1 %, 9216 Spiele, Top 8), mit 15 Archetypen
  50,4 %; v1 50,7 % (9216) und 50,4 % (49,7–51,2 %, 18 432): kleiner Vorteil für v0, bei v1 nicht messbar.
  Nur 5 von 15 Archetypen haben Rest-Karten (M01, M04, M08, M11, M12), dazu Burst-Effekte; der Effekt ist
  verdünnt. `npm run ab -- --by-deck` zeigt dieselbe Messung je Deck (A und B mit demselben Deck), ist bei
  1152 Spielen je Seite aber noch ±4 Punkte ungenau.
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

## Startspieler (`src/sim/start.ts`, `src/ai/turnorder.ts`, `npm run first`)

Regel (Rules Q&A Q8): Schere-Stein-Papier oder Ähnliches, der Gewinner wählt vor dem Ansehen der Starthand,
wer beginnt. Im Spiel gegen die KI (Standard „Würfeln, Gewinner wählt“) würfeln beide einen W6, bei
Gleichstand neu; der Wurf hängt nur vom Seed ab (gleicher Seed, gleicher Wurf) und steht im Log. Gewinnt der
Mensch, wählt er; gewinnt die KI, wählt `aiWantsFirst`.

Messung (18. Nov. 2026, v1, 15 Meta-Archetypen untereinander und 16 Starter-Decks untereinander, je 5760
bzw. 5440 Spiele, je Deck 336 Spiele als Erster und als Zweiter ohne Spiegel): **jedes Deck gewinnt als
Startspieler öfter**, um 9 bis 30 Prozentpunkte; insgesamt 62,0 %. Die Vermutung „ohne Karte mit Lv. 1 und
Kosten 1 lieber als Zweiter“ trifft nicht zu: M11 (keine solche Karte, Ø Lv. 4,1) hat den größten Vorteil
(+30), M02/M04/M12 ohne solche Karte +28/+28/+28; die kleinsten Vorteile haben ST09R (+9), ST13 (+10),
ST11 (+14), ST09W (+16). Ein Zusammenhang mit billigen Units oder Ø-Level ist nicht zu erkennen. Darum
wählt die KI immer zu beginnen. Gründe: Spieler 1 zieht schon im ersten Zug und greift zuerst an; die EX
Resource von Spieler 2 gleicht das nicht aus. Mit anderer KI oder Regeln neu messen: `npm run first`.
Nachmessung mit der neuen EX-Resource-Regel (18. Nov., 15 Archetypen untereinander, 11 520 Spiele, je Deck
672 Spiele als Erster und als Zweiter, Seed 7, `npm run first -- --list best --starters false`):

- **Beste Turnierlisten (M01B…M15B):** alle beginnen lieber, Vorteil +7,3 (M15B) bis +19,2 Punkte (M01B);
  Startspieler gesamt 56,6 % (55,7–57,5 %). Die Spanne einer Differenz ist etwa ±5 Punkte, also auch der
  kleinste Vorteil klar über 0.
- **Konsenslisten zum Vergleich:** +6,8 (M06) bis +16,8 (M01), gesamt 56,1 %.
- Der Vorteil ist von 62 % auf 56 % geschrumpft, bei Konsens- wie Turnierlisten gleich: Ursache ist die
  EX-Resource-Regel (Spieler 2 nutzt seinen Level-Vorsprung jetzt länger), nicht die Liste. Am Ergebnis
  „immer beginnen“ ändert das nichts.

Im Simulator bleibt der Startspieler ausgeglichen (Blöcke à 8): Da die KI immer beginnen will, wäre Würfeln
dort nur ein zufälliger Startspieler mit mehr Streuung.

## EX Resource (`RuleOptions.ex`, 18. Nov. 2026, Nutzerwunsch)

Die Engine zahlt Kosten mit normalen Ressourcen zuerst und nimmt die EX Resource nur, wenn die normalen
nicht reichen; bis dahin zählt sie fürs Level mit. Ob eine Option sie verbraucht, sagt
`Engine.spendsEx` (Kosten aus `resourceCost`, auch Pair-, Ersatz- und Activate-Kosten). Die Regel filtert
in v0 die Optionen der Main Phase und des Action Steps (`HeuristicPolicy.allowed`), v1 und die Suche
nehmen nur erlaubte Optionen in die Vorausschau (`LookaheadPolicy.rank`), und alle Fortsetzungen spielen
v0. Erlaubt keine Regel etwas, bleiben alle Optionen. Vorher (`ex-free`) nahm jede KI sie, sobald sie für
eine bezahlbare Karte nötig war; die Bewertung kennt keine Ressourcen, darum sah keine KI das fehlende Level.

Regeln (`npm run ab -- --b <Variante>`):

- `free`: wie vorher.
- `never`: nie.
- `hand` (Idee 1 des Nutzers): nicht, solange eine andere Unit auf der Hand danach nicht mehr erreichbar
  wäre (Lv. > Level nach dem Verbrauch).
- `deck` (Idee 3): erst, wenn die höchste Unit des eigenen Decks auch ohne sie erreichbar bleibt (Level nach
  dem Verbrauch ≥ höchstes Unit-Level; die Deckliste kennt die KI, `Knowledge.deck`). Ohne Deckliste wie `hand`.
- `level` mit `exLevel` 5/7/8/9: erst ab diesem Level nach dem Verbrauch.
- Ausnahmen: `+link` (Idee 2) ein Pilot, der linkt, darf sie immer nehmen (v0 setzt Units vor Piloten, die
  normalen Ressourcen gehen zuerst: Unit mit 3 normalen, Pilot für den Link mit der EX Resource);
  `+sos` ohne eigene Unit im Spiel immer.

Gemessen (Meta Top 8, je 9216 Spiele, Anteil der neuen Regel gegen `free`):

| Regel                      | v0                   | v1             |
| -------------------------- | -------------------- | -------------- |
| never                      | 52,0 %               | 52,3 %         |
| hand                       | 53,5 %               | 53,7 %         |
| hand+link                  | **54,9 %**           | 53,7 %         |
| hand+link+sos              | 52,7 %               |                |
| deck                       | 52,4 %               |                |
| deck+link                  | **54,9 %**           | **54,2 %**     |
| level5 / level7 / level9   | 53,9 / 52,9 / 52,2 % | – / 53,4 % / – |
| link-only (`never` + link) | **54,9 %**           | 54,0 %         |

Direkt (v1, 18 432 Spiele): deck+link gegen link-only 49,9 %, gegen hand+link 49,9 %: gleich stark.
**Standard ist `deck` + link** (`DEFAULT_EX`): beide Ideen des Nutzers verbunden, und anders als „nie“ kann
die KI sie spät noch nutzen. Bestätigt mit neuem Seed: v0 **55,8 %**, v1 **54,1 %** (53,1–55,1 %) gegen die
alte Regel. Deutlich größter Gewinn aller bisherigen Regeländerungen. Ausnahme „ohne Unit immer“ schadet.

**Commands mit der EX Resource** (Nutzerwunsch, 18. Nov.): Ausnahme `exCommandLevel` N – ein Command darf
sie ab Level N (Ressourcen inkl. EX) nehmen, sonst gilt der Standard (deck + link). Varianten `ex-cmd3` …
`ex-cmd9`, Seed 51, je 9216 Spiele, Anteil des **Standards** gegen die Ausnahme:

| ab Level | 3      | 4      | 5      | 6      | 7      | 8      | 9      |
| -------- | ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| v0       | 52,1 % | 51,6 % | 50,7 % | 50,2 % | 50,2 % | 50,2 % | 50,3 % |
| v1       | 51,5 % | 51,2 % | 50,5 % | 50,5 % | 50,5 % | 50,5 % | 50,4 % |

Früh (Lv. 3–4) schadet die Ausnahme messbar, ab Lv. 5 ist sie gleichauf (ab Lv. 5 greift sie selten: die KI
spielt Commands nur, wenn sie etwas bewirken, und spät erlaubt die Deck-Regel die EX Resource meist ohnehin).
Kein Level bringt einen Vorteil → Standard unverändert, die Option bleibt zum Messen.

## Kombos (`src/ai/synergy.ts`, `npm run combos`, 18. Nov. 2026, Nutzerwunsch)

Ausgangslage: Mit v1 schneiden die besten Turnierlisten (`M01B` …) im Schnitt **schlechter** ab als die
Konsenslisten (49,1 % gegen 50,9 %, 12 Archetypen, 4800 Spiele `--list both`), obwohl sie im Turnier besser
sind. Vermutung: Die Turnierlisten bauen auf Kombos, die die KI nicht nutzt. Am deutlichsten Shining Gundam
(M01/M01B 44 %/39 %).

**Erkennung:** `deckSynergies` liest aus den übersetzten Effekten jedes Filters auf eigene Karten mit Trait,
Name oder Kartentyp im Trash („2 (MF) Unit cards from your trash“, „3 or more (MF) cards in your trash“,
„a Unit with "Master Gundam" in its card name“) und sucht die passenden Karten im Deck; dazu Links zwischen
Units und Piloten des Decks. Allgemeine Filter („1 of your Units“) zählen nicht. `npm run combos -- M01B`
zeigt die Beziehungen eines Decks, `npm run combos` die der Meta-Archetypen. `deckPlan` macht daraus pro
Karte einen Trash-Wert (`trashFuel`: Kopien der suchenden Karten / Kopien der passenden) und pro Pilot die
Units, die er linkt.

**Versuche** (`npm run ab`, beste Listen der 12 Archetypen, `--list best`):

| Variante                                                            | v0                | v1                              |
| ------------------------------------------------------------------- | ----------------- | ------------------------------- |
| `comboFuel`: Trash-Karten des Plans abwerfen (v0), im Trash +1 (v1) | 50,0 % (9360)     | 49,3 % (4992)                   |
| `linkValue`: gelinkte Unit +1,5 in der Bewertung                    | –                 | 49,5 % (4992)                   |
| beides                                                              | –                 | 49,2 % (4992), M01B −7,7 Punkte |
| Pilot wartet auf seine Link-Unit (Standard, alt `pairAnyPilot`)     | **50,8 %** (9360) | 49,9 % (4992)                   |

(Anteil der neuen Regel gegen die alte.) Feste Zusatzwerte für Kombo-Teile helfen also nicht; im Trash
sind die Karten v1 eine Runde lang mehr wert, als sie in der kurzen Vorausschau einbringen. Übernommen ist
nur die Pilot-Regel: v0 setzt einen Piloten nicht in eine Unit, die er nicht linkt, wenn eine Unit, die er
linkt, auf der Hand liegt und spätestens nächsten Zug spielbar ist (Lv. ≤ Level + 1). `comboFuel` und
`linkValue` bleiben als abschaltbare Versuche (`RuleOptions`, Varianten `fuel`, `links`, `combos`).

## Vorausschau (`Horizon` in `src/ai/lookahead.ts`, 18. Nov. 2026, Nutzerwunsch)

Nach den Kombo-Versuchen (oben) die zweite Idee: v1 länger vorausrechnen lassen, damit Pläne über den
eigenen Zug hinaus sichtbar werden. `RuleOptions.horizon` (Varianten `turn`, `round`, `through` in `npm run ab`):

| Horizont                                                      | beste Listen (12)              | Konsenslisten (12) |
| ------------------------------------------------------------- | ------------------------------ | ------------------ |
| `turn`: bis zur nächsten Main Phase (bisher)                  | –                              | –                  |
| `round`: bis zur eigenen nächsten Main Phase (Gegnerzug ganz) | **52,2 %** (51,2–53,2 %, 9360) | 49,8 % (9360)      |
| `through`: auch den eigenen nächsten Zug durchspielen         | 43,3 % (4992)                  | –                  |

(Anteil gegen `turn`; erste Runde `round` 51,2 %, 4992 Spiele.) Bei den besten Listen gewinnen vor allem
Nu Gundam (+13 Punkte), Char's Zaku Ⅱ (+12), Victory (+6), Blue White Control (+6); Shining Gundam +2.
`through` ist viel schlechter: verdeckte Karten sind in der Simulation wirkungslose Platzhalter, der Gegner
spielt in seinem Zug also nichts von der Hand, und die eigenen Angriffe im nächsten Zug sehen zu gut aus.
`round` bewertet vor den eigenen Angriffen und hat das Problem kaum.

**Standard für v1 (Normal) ist seit 18. Nov. `round`.** Rechenzeit (ein Kern, beste Listen, dieselben
Partien mit der Variante auf beiden Seiten): v1 `turn` 0,10 s pro Spiel / 0,9 ms pro Entscheidung (300 Spiele),
v1 `round` 0,19 s / 1,5 ms, also etwa 1,7–1,9×. Im Spiel gegen den Menschen nicht spürbar, Simulationen
mit v1 dauern knapp doppelt so lange.

Die Suche (Schwer) gewinnt gegen das neue v1 noch 51,7 % (48,4–55,1 %, 864 Spiele Meta; gegen das alte v1
54,3 %). **Suche mit `round` in der Vorauswahl** (`npm run ab -- --ai search --a round --b turn`): beste Listen
49,4 % (47,4–51,4 %), Konsenslisten 49,5 % (47,6–51,5 %), je 2496 Spiele, also kein Gewinn, ihre eigenen
Stichproben laufen schon über eine Runde. Kosten +10 % pro Spiel (1,75 → 1,92 s, 40 Spiele), +3 % pro
Entscheidung (14,1 → 14,5 ms). Nicht übernommen (Nutzer entscheidet); „Sehr schwer“ braucht ~3,5 s pro Spiel.

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

Allgemeiner Vergleich zweier Varianten derselben KI: `npm run ab -- --ai v1 --a default --b <Variante>`
(Varianten in `tools/ab.ts`: `eager-commands`, `mulligan-basic`, `mulligan-never`).

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
