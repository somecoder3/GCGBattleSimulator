# Meta

Stand: 17. Nov. 2026 (Limitless + Egman). Plan: `docs/PLAN.md` Abschnitt 7.

## Ablauf

```
Limitless-API ──limitless.ts──▶ Snapshot (data/meta/<datum>.json) ──archetypes.ts──▶ Archetypen ──decks.ts──▶ Decks
                                 wöchentlich per GitHub Action                       Konsensliste, Anteil       Spiel, Simulator
```

| Datei                        | Inhalt                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `src/meta/limitless.ts`      | Turniere und Platzierungen laden (CORS `*`, auch im Browser), Karten auf GCGDB abbilden  |
| `src/meta/egman.ts`          | Egman Deck Builder: große Regionals mit Decklisten (ein Abruf, nur im Snapshot-Werkzeug) |
| `src/meta/archetypes.ts`     | Gewichtung, Zuordnung unbenannter Decks, Konsensliste, Legalität                         |
| `src/meta/banlist.ts`        | Offizielle Banned/Restricted-Liste (Stand 25. Sep. 2026), von Hand gepflegt              |
| `src/meta/decks.ts`          | Archetypen als Decks (`M01` = meistgespielt …), neuester Snapshot                        |
| `tools/meta-snapshot.ts`     | `npm run meta` (laden und schreiben), `npm run meta -- --report` (nur Bericht)           |
| `.github/workflows/meta.yml` | montags 05:00 UTC: Snapshot laden, Tests, bei Änderung committen                         |

## Snapshot

- Turniere der letzten **8 Wochen** mit mindestens **8 Spielern**, je die **Top 16** (Schalter `--weeks`,
  `--min-players`, `--top`). Viele Turniere auf Limitless haben keine Decklisten; die werden übersprungen.
- **Paarungen** (seit 21. Nov. 2026, `…/tournaments/<id>/pairings`): Spiele zwischen zwei behaltenen
  Platzierungen als `{ tournament, a, b, result }` (`toPairings`); die Spielernamen dienen nur zum Zuordnen und
  werden nicht gespeichert. Für die Kalibrierung des Deck-Labors (`docs/DECKSEARCH.md`).
- Gespeichert werden Turnier (Id, Name, Datum, Spielerzahl), Platzierung, Bilanz, Archetyp und Karten.
  **Keine Spielernamen.** Karten, die GCGDB nicht kennt, stehen unter `unknown`.
- Limitless liefert kein Ressourcen-Deck; alle Decks bekommen 10× `R-001`.
- Erster Snapshot 16. Nov. 2026: 16 Turniere, davon 6 mit Listen, 72 Decks, 15 Archetypen.

## Zweite Quelle: Egman Deck Builder (seit 17. Nov. 2026)

- `https://deckbuilder.egmanevents.com/api/tournaments/gundam`: alle Gundam-Turniere der Egman-„Deck
  Database“ in einer JSON-Datei (~650 KB): Name, Datum, Format, Spielerzahl, Turnierart („Large Official
  Event“ …), Platzierungen mit Bilanz, Farben, Leitkarte (`deck_type`) und **kompletter Deckliste als
  Kartennummern** im Link (`?deck=GD01-008:4,…`; bei Turnieren mit Sideboard folgt es nach `|` und zählt
  nicht). Vor allem große offizielle Regionals (141–512 Spieler, weltweit), dazu kleinere Events.
- **Ein Abruf pro Snapshot**, nur in `npm run meta` (wöchentliche Action), nie aus dem Browser. Kennung
  `gcg-battle-simulator (private meta statistics, weekly)`, keine persönlichen Daten. Zwischenspeicher
  `build/egman-gundam.json` (1 Tag, nicht im Repo) für wiederholte lokale Läufe. `--no-egman` lässt Egman weg.
- **Keine Spielernamen, keine Social-Links** (werden beim Einlesen verworfen; Test prüft das).
- Prüfung 17. Nov. 2026: keine Nutzungsbedingungen; `robots.txt` erlaubt normale Clients (`Allow: /`),
  verbietet nur KI-Crawler und KI-Training (`ai-train=no`). Die App nennt die Quelle im Meta-Reiter.
  Auch in der öffentlichen Version genutzt (Nutzerentscheidung 21. Nov. 2026: Egman verbietet es nicht).
- **Doppelte:** Egman-Turniere, die auf ein Limitless-Turnier des Snapshots verweisen (`source`) oder am
  selben Tag gleich heißen (`sameEvent`), werden übersprungen.
- **Archetyp:** Egman benennt nach Leitkarte (+ erster Nebenkarte), z. B. „Strike Freedom Gundam (Victory
  Gundam)“, wie Limitless. Pro Egman-Gruppe einmal entschieden: Limitless-Archetyp gleichen Namens, sonst
  der ähnlichste (Jaccard ≥ 0,5 zur Gruppen-Konsensliste), sonst eigener Archetyp `egman:<Leitkarte>…`.
  So landet z. B. „Strike Freedom Gundam“ (nur Leitkarte, 17 Listen) im ähnlichen „Blue White Control“.
- Fehlende Spielerzahl: zählt mit der Mindestzahl (Größe unbekannt).
- Im Browser („Neu von Limitless laden“) bleiben die Egman-Turniere des mitgelieferten Snapshots erhalten.

## Archetypen

- Archetyp = Limitless-Name (`deck.id`). Decks ohne Namen („Other“) kommen zum ähnlichsten Archetyp, wenn
  die gewichtete Jaccard-Ähnlichkeit (Σ min / Σ max der Kartenanzahlen) zu dessen Konsens ≥ 0,5 ist.
- **Gewicht eines Decks** = Aktualität (Halbwertszeit 28 Tage) × log₂(Spieler) × 1/√Platz. Der Meta-Anteil
  eines Archetyps ist die Summe seiner Gewichte.
- **Konsensliste:** gewichteter Mittelwert jeder Karte, abgerundet, dann nach größtem Rest auf genau 50
  aufgefüllt (bzw. die seltensten gekürzt). Damit sie legal ist: höchstens 4 (bzw. Restricted), keine
  verbotenen Karten, nur die **zwei Farben mit den meisten Karten** (Archetypen wie „Strike Freedom (Base)“
  mischen Varianten mit verschiedenen Farben), von einem verbotenen Paar nur die häufiger gespielte Seite.
- **Alle echten Listen** eines Archetyps stehen in `Archetype.entries`, sortiert nach **Ergebnis**
  `resultScore` = log₂(Spieler) / √Platz (ohne Aktualität; bei Gleichstand das höhere Gewicht, also neuer):
  Platz 1 bei 9 Spielern (3,2) steht hinter Platz 2 bei 200 Spielern (5,4). Unverändert, wie gespielt.
  Zu sehen im Meta-Reiter („Turnierlisten“), kopierbar im Decks-Reiter (Archetyp wählen, dann Liste).
  „Gegen die KI spielen“/„Gegen das Feld simulieren“ im Meta-Reiter nehmen die **angezeigte** Liste: die
  Konsensliste (`M03`) oder die Turnierliste als vorübergehendes Deck `M03T5` (5. Liste, `pickDeck` in
  `src/app/lib/decks.ts`, nur bis zum Neuladen). Nicht turnierlegale Listen sind dort nicht spielbar.
- Die erste davon ist die **beste Liste** (`best`), mit derselben Bereinigung wie die Konsensliste. Bis zum 17. Nov. war es die bestplatzierte (Platz zuerst, Turniergröße egal).
- **Welche Liste spielt?** Standard überall (Spiel, Simulator, CLI) ist die Konsensliste (`M01` …). Im
  Simulator wählt „Meta-Listen“ zwischen Konsens, **bester Liste** (`M01B` …, gleiche Nummer wie der
  Archetyp, Name „– beste Liste (Platz n von Spielern)“) und **beiden** nebeneinander; CLI `--list consensus|best|both`.
  Eine beste Liste, die nicht legal ist, fehlt (`metaDecks` in `src/meta/decks.ts`, `metaBaseId`).
  Erster Blick (noch mit der bestplatzierten Liste; Top 4, v1, je 56 Spiele, weite Intervalle): bei allen vier war die beste Liste stärker als
  die Konsensliste (z. B. Nu Gundam 73 % gegen 55 %); Konsenslisten mischen offenbar Varianten.
- `partial`: Karten der Konsensliste, deren Text die Engine nicht vollständig versteht. Solche Decks sind
  im Simulator als „unvollständig“ markiert und nicht vorausgewählt.

## Bannliste

Verboten GD01-020; ST02-016 höchstens 2×; verbotene Paare ST01-010 + ST05-010 und **GD01-008 (Guntank) +
GD05-015 (M1 Astray Shrike)** (gleicher Effekt). Die Vanilla-Units „Lv.2, Kosten 1, 2 AP, 2 HP, ohne Effekt“
(`VANILLA_TWO_TWO` plus alle Karten nach der Beschreibung): **je zwei verschiedene sind ein Bann-Paar**, also
nur eine Sorte, höchstens 4. **Korrektur 17. Nov. 2026:** Bis dahin war Guntank fälschlich mit allen
Vanilla-Units gepaart. Belege: In der Tabelle der offiziellen Seite stehen nur Guntank (A) und Shrike (B) als
Paar, die Vanilla-Liste folgt ohne A/B; 13 echte Listen spielen Guntank mit einer Vanilla-Sorte (u. a. Platz 1
eines offiziellen Regionals mit 208 Spielern), keine spielt zwei Vanilla-Sorten. Starter-Decks in ihrem unveränderten Aufbau bleiben trotz Bannliste legal (Auskunft des Nutzers, 17. Nov.
2026), z. B. ST02 mit 3× ST02-016 und ST05 mit zwei Vanilla-Sorten (ST05-004, ST05-009);
`isUnchangedStarter` in `src/meta/banlist.ts`. Sobald eine Karte geändert wird, gilt die Bannliste.

## Stand 17. Nov. 2026 (Limitless + Egman)

152 Listen aus 13 Turnieren mit Listen (Limitless 6, Egman 7: Düsseldorf 191, Milwaukee 500, Lille 200,
Brisbane 166, DC 512, noHeroes CardCon 208, Egman Cup 29), 29 Archetypen. Top 8 laut Meta-Reiter: Shining
Gundam (Master Gundam) 16,2 %, Blue White Control 15,1 %, Nu Gundam 9,4 %, Strike Freedom (Victory) 8,1 %,
White Red Zaft 6,1 %, Char's Zaku Ⅱ (Barbatos) 4,8 %, Strike Freedom (Base) 3,6 %, Victory Gundam (Aerial)
3,1 %. **Alle Karten der Top 8 voll unterstützt** (neu dafür: GD01-023 Char's Gelgoog, GD01-076 Michaelis);
Abdeckung gesamt 65,8 %. Zum Vergleich MetaSheep (60 Tage, inkl. Japan, nur angesehen): Mobile Fighter 21 %,
Nu Aggro 15 %, Char IBO 13 %, Aggro Orb 13 %, Justice Aerial Control 10 %.

## Stand 16. Nov. 2026 (nur Limitless)

| #   | Archetyp                                   | Anteil | Listen | Unterstützt |
| --- | ------------------------------------------ | -----: | -----: | ----------- |
| M01 | Shining Gundam (Master Gundam)             | 21,8 % |     13 | voll        |
| M02 | White Red Zaft                             | 10,9 % |      9 | voll        |
| M03 | Blue White Freedom Blockers                |  6,9 % |      3 | voll        |
| M04 | Strike Freedom Gundam (Base)               |  6,9 % |      4 | voll        |
| M05 | Strike Freedom Gundam (Aile Strike Gundam) |  4,0 % |      5 | voll        |
| M06 | Sazabi (Char's Zaku II)                    |  3,6 % |      2 | voll        |
| M07 | Nu Gundam                                  |  3,2 % |      3 | voll        |
| M08 | Strike Freedom Gundam (Victory Gundam)     |  3,1 % |      3 | voll        |

Dazu M09–M15 (je < 3 %), inzwischen **alle voll unterstützt** (`npm run coverage -- --meta`). Die Top 8
nutzen 113 verschiedene Karten.
Die Stichprobe ist klein (72 Listen); die Anteile schwanken entsprechend.
