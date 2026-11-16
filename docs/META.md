# Meta

Stand: M5 (16. Nov. 2026). Plan: `docs/PLAN.md` Abschnitt 7.

## Ablauf

```
Limitless-API ──limitless.ts──▶ Snapshot (data/meta/<datum>.json) ──archetypes.ts──▶ Archetypen ──decks.ts──▶ Decks
                                 wöchentlich per GitHub Action                       Konsensliste, Anteil       Spiel, Simulator
```

| Datei                        | Inhalt                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `src/meta/limitless.ts`      | Turniere und Platzierungen laden (CORS `*`, auch im Browser), Karten auf GCGDB abbilden |
| `src/meta/archetypes.ts`     | Gewichtung, Zuordnung unbenannter Decks, Konsensliste, Legalität                        |
| `src/meta/banlist.ts`        | Offizielle Banned/Restricted-Liste (Stand 25. Sep. 2026), von Hand gepflegt             |
| `src/meta/decks.ts`          | Archetypen als Decks (`M01` = meistgespielt …), neuester Snapshot                       |
| `tools/meta-snapshot.ts`     | `npm run meta` (laden und schreiben), `npm run meta -- --report` (nur Bericht)          |
| `.github/workflows/meta.yml` | montags 05:00 UTC: Snapshot laden, Tests, bei Änderung committen                        |

## Snapshot

- Turniere der letzten **8 Wochen** mit mindestens **8 Spielern**, je die **Top 16** (Schalter `--weeks`,
  `--min-players`, `--top`). Viele Turniere auf Limitless haben keine Decklisten; die werden übersprungen.
- Gespeichert werden Turnier (Id, Name, Datum, Spielerzahl), Platzierung, Bilanz, Archetyp und Karten.
  **Keine Spielernamen.** Karten, die GCGDB nicht kennt, stehen unter `unknown`.
- Limitless liefert kein Ressourcen-Deck; alle Decks bekommen 10× `R-001`.
- Erster Snapshot 16. Nov. 2026: 16 Turniere, davon 6 mit Listen, 72 Decks, 15 Archetypen.

## Archetypen

- Archetyp = Limitless-Name (`deck.id`). Decks ohne Namen („Other“) kommen zum ähnlichsten Archetyp, wenn
  die gewichtete Jaccard-Ähnlichkeit (Σ min / Σ max der Kartenanzahlen) zu dessen Konsens ≥ 0,5 ist.
- **Gewicht eines Decks** = Aktualität (Halbwertszeit 28 Tage) × log₂(Spieler) × 1/√Platz. Der Meta-Anteil
  eines Archetyps ist die Summe seiner Gewichte.
- **Konsensliste:** gewichteter Mittelwert jeder Karte, abgerundet, dann nach größtem Rest auf genau 50
  aufgefüllt (bzw. die seltensten gekürzt). Damit sie legal ist: höchstens 4 (bzw. Restricted), keine
  verbotenen Karten, nur die **zwei Farben mit den meisten Karten** (Archetypen wie „Strike Freedom (Base)“
  mischen Varianten mit verschiedenen Farben), von einem verbotenen Paar nur die häufiger gespielte Seite.
- Zusätzlich die **bestplatzierte echte Liste** (`best`), mit derselben Bereinigung.
- `partial`: Karten der Konsensliste, deren Text die Engine nicht vollständig versteht. Solche Decks sind
  im Simulator als „unvollständig“ markiert und nicht vorausgewählt.

## Bannliste

Verboten GD01-020; ST02-016 höchstens 2×; verbotene Paare ST01-010 + ST05-010 sowie GD01-008 (Guntank) mit
den Vanilla-Units „Lv.2, Kosten 1, 2 AP, 2 HP, ohne Effekt“ (Liste plus alle Karten, die die Beschreibung
erfüllen), von denen insgesamt höchstens 4 im Deck sein dürfen. Das Starter-Deck ST02 enthält ST02-016 3×
(wie verkauft); für Turniere wäre es so nicht legal.

## Stand 16. Nov. 2026

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
