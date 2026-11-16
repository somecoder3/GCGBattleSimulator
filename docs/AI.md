# KI

Stand: M3 (16. Nov. 2026). Plan und spätere Stufen: `docs/PLAN.md` Abschnitt 6.

## Schnittstelle

Eine KI ist eine `Policy` (`src/ai/types.ts`): `choose(view, decision)` wählt eine der `decision.options`.
Sie bekommt nur `viewFor(state, player)` (verdeckte Karten als `"?"`, Zufallsgenerator geleert), außer sie
erklärt `usesView = false` (Zufalls-KI). `playMatch` (`src/sim/match.ts`) und `GameSession.stepAI`
(`src/sim/session.ts`) halten sich daran.

| KI               | Datei                 | Einsatz                                        |
| ---------------- | --------------------- | ---------------------------------------------- |
| Zufall           | `src/ai/random.ts`    | Fuzzing, schwächster Gegner                    |
| **Heuristik v0** | `src/ai/heuristic.ts` | Gegner in der Oberfläche (M3), Vergleichsbasis |

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

### Stärke (Starter-Decks ST01–ST04, alle Paarungen, `npm run sim`)

| Paarung               | Spiele | Ergebnis                           |
| --------------------- | ------ | ---------------------------------- |
| Heuristik v0 – Zufall | 1000   | **93,8 %** für die Heuristik       |
| Heuristik v0 – v0     | 1000   | 51,4 / 48,6 %, Startspieler 63,0 % |

Ø 14 Züge, rund 5–11 ms pro Spiel. Bekannte Schwächen (für v1 in M4): keine Vorausschau, keine Planung des
Ressourcen-Einsatzes über den Zug, spielt Commands sofort statt passend, hält keine Blocker zurück,
Support kaum genutzt, keine Abschätzung der gegnerischen Hand.

```bash
npm run sim -- --ai heuristic,random --decks starters --games 1000
npm run sim -- --ai heuristic --decks starters --games 1000
```
