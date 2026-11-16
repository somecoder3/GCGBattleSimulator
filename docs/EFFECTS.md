# Karteneffekte

Stand: M5 (16. Nov. 2026). Wie Kartentexte zu ausführbaren Effekten werden, und wie man eine Karte
ergänzt oder korrigiert.

## Überblick

```
Kartentext (GCGDB)  ──parse.ts──▶  Effekt-DSL (dsl.ts)  ──compile.ts──▶  Programm  ──interpret.ts──▶  Spiel
                     manual.ts ──┘  (Handskripte haben Vorrang)
```

- **DSL** (`src/effects/dsl.ts`): Effekte als Daten. Arten: `trigger` (【Deploy】, 【Attack】,
  【Destroyed】, 【When Paired･…】, 【When Linked】, „when this Unit destroys …“, Zugbeginn/-ende),
  `activated` (【Activate･Main/Action】 mit Kosten), `command` (【Main】/【Action】), `burst`, `static`
  (Dauereffekte, auch bedingt: 【During Pair】, 【During Link】, „During your turn“). Schritte wie `choose`,
  `all`, `rest`, `damage`, `bounce`, `mod`, `grant`, `flag`, `draw`, `discard`, `token`, `lookTop`, …
  plus `if`, `may` und `choice`.
- **Segmente:** Sätze nach „Then,“ beginnen ein neues Segment. Findet ein `choose` kein Ziel, endet nur
  sein Segment (5-20-2); alles nach „If you do,“ hängt am vorigen Satz (5-20-1).
- **Übersetzer** (`src/effects/parse.ts`): erkennt Kopf (Timing-Keywords, Kosten vor `：`) und Sätze
  nach festen Mustern. Unbekanntes wird **nicht geraten**: Die Zeile kommt in `unsupported` und wirkt im
  Spiel nicht; die Karte hat dann den Status `partial`.
- **Pilot-Texte:** Bei Pilot-Karten gehören nur 【Burst】-Zeilen dem Piloten; alle anderen Zeilen erhält
  die gepaarte Unit (3-3-9-2) und stehen in `granted`. Commands mit 【Pilot】 geben nur AP/HP.
- **Compiler** (`src/effects/compile.ts`): macht aus Segmenten und `if`/`may`/`choice` ein flaches
  Programm mit Sprüngen. Ein laufender Effekt ist damit nur `pc` + Variablen (`Frame` im Spielzustand),
  bleibt also serialisierbar (Rollback, Worker, Replays).

## Ablauf im Spiel (engine/core.ts, interpret.ts)

- Ereignisse lösen Trigger aus (`raise`); neue Trigger kommen nach dem laufenden Effekt **vor** die
  wartenden (10-1-6-7), Bursts zuerst (10-1-6-8), dann die des aktiven Spielers (10-1-6-6). Innerhalb eines
  Spielers in Reihenfolge des Auftretens (eine Wahl der Reihenfolge, 10-1-6-5, gibt es noch nicht).
- 【Destroyed】-Bedingungen (z. B. „During Pair“) werden am letzten Ort geprüft (13-2-8-2-1).
- Ein Schild mit 【Burst】 wartet in `limbo`, bis sein Besitzer entscheidet; danach in den Trash.
  Commands liegen beim Auflösen ebenfalls in `limbo` (3-4-3).
- Commands und Activate-Effekte, deren erste Auswahl kein Ziel hätte, werden nicht angeboten (10-1-8-1-1).
- Dauereffekte (`static`) werden bei jeder Abfrage von AP/HP/Keywords/Flags neu ausgewertet; zeitlich
  begrenzte Änderungen sind `modifiers` mit `until: "turn" | "battle" | "nextStart"`.
- Entscheidungen in Effekten haben `kind: "effect"` und `prompt`: `target`, `may`, `option`, `discard`,
  `lookPick`, `lookTop`, `burst`, `overflow` (volle Battle Area, 11-4-2). Gibt es genau so viele Ziele wie
  verlangt, wählt die Engine automatisch.

## Abdeckung

```bash
npm run coverage                          # Übersicht pro Set
npm run coverage -- --set GD01,ST05       # dazu jede nicht verstandene Zeile mit Grund
npm run coverage -- --card ST01-015       # Skript einer Karte
```

Stand 16. Nov. 2026 (1123 Karten ohne Ressourcen/EX-Token): **59,5 % vollständig** (164 ohne Text,
496 automatisch, 8 von Hand), 455 teilweise. **ST01–ST04 und alle 113 Karten der Top-8-Archetypen zu
100 %** (M5, `docs/META.md`). Vor M5: 51,6 %.

## Erweiterungen in M5

- **Satzmuster:** Mehrfachwahl „Choose 1 of your Units and 1 enemy Unit“ (Referenz `t0+t1`), „Destroy/Rest
  all …“, „It may attack on the turn it is deployed“, „Return it to the bottom of its owner's deck“, „deal N
  damage to the first card in your opponent's shield area“, „Deploy it“, „Activate this card's 【Action】“,
  „Activate 【Main】 on the card paired with this Unit“, „Begin a battle … only perform the damage step“,
  Schadensreduktion für eine Runde, „Reduce its AP by … the number of …“, „deploy 1 to 2 … tokens“, „When this
  effect destroys an enemy Unit, …“, „Look at the top card … Return it to the top or bottom“, „Look at the top
  3 cards … return 1 to the top. Return the remaining cards to the bottom“; Qualifier `with "X" in its card
name`, `with the lowest Lv.`, `whose Lv./AP is equal to or lower/less than this/that Unit`, `non-battling`.
- **Bedingungen:** „you have an (Orb) Pilot in play“, „this is an (Orb)/(…) Unit“, „you have a Unit with "X"
  in its card name in play“, „you are attacking the enemy player“, „another friendly … is in play“, „you have
  activated a (Special Move) Command card's 【Main】/【Action】 during this turn“, „one of your Units has been
  destroyed by one of your (Neo Zeon) card's effects during this turn“, zwei Bedingungen mit „and“, „During
  your turn, if …“.
- **Kosten mit Auswahl** („Rest 1 of your other (League Militaire) Units“, „exile 1 Pilot card from your
  trash“) werden zu Schritten vor dem Effekt; ein Activate-Effekt wird nur angeboten, wenn die erste Wahl
  Kandidaten hat. Der Kostentrenner darf auch „: “ sein.
- **Dauereffekte:** „While …, this Unit gets …“, Schutz und Reduktion von gegnerischem Effektschaden,
  Schadenserhöhung für eigene (Trait)-Karten (GD06-033), Traits verleihen („All your Units gain (Neo Zeon)“),
  Angriffszwang (GD05-086), günstigeres Ausspielen aus der Hand (`handCost`, GD05-004), Namensalias
  („This card's name is also treated as [X]“, für Links und Namensfilter).
- **Ereignis-Trigger:** eigene (Trait)-Unit eingesetzt (`allyDeployed`), Pilot mit eigener (Farbe/Trait)-Unit
  gepaart (`allyPaired`), „destroys an enemy card with battle damage“ (`destroysCard`), gegnerische Unit
  durch Effektschaden zerstört, während diese Unit angreift.
- **Handskripte:** GD05-049 Sazabi (der Gegner wählt), GD05-089 Master Asia (Burst als AP3/HP3-Unit),
  GD05-097 Domon Kasshu (abgeworfene Special Move ausführen), GD05-121 Cyclone Punch (aus dem Trash pairen).
- **Zug-Markierungen** (`GameState.marks`): gespielte Commands und durch eigene Effekte zerstörte eigene
  Units, für Bedingungen „during this turn“.

## Eine Karte ergänzen oder korrigieren

1. `npm run coverage -- --card <Nr>` zeigt Text, Skript und nicht verstandene Zeilen.
2. Kommt ein Satzmuster öfter vor: Muster in `parse.ts` ergänzen (und in `tests/effects/parse.test.ts`).
   Ist es ein Einzelfall: Skript in `src/effects/manual.ts` (ersetzt das ganze Skript der Karte; Kartentext
   als Kommentar dazuschreiben).
3. Fehlt ein Baustein: `Prim` in `dsl.ts` und `exec` in `engine/interpret.ts` ergänzen.
4. Kartentest in `tests/cards/` (Szenario mit echten Karten, siehe `starters.test.ts`).
5. `npm test`, `npm run sim -- --games 20000 --check`.

## Auslegungen

- „with N or less HP“ meint den HP-Wert der Karte (inkl. Pilot und Effekte), nicht die verbleibenden HP;
  Schaden senkt HP nicht (5-5-2).
- Effekt-Einsatz ohne Kosten (Full Frontal: „deploy … from your hand“) zahlt keine Kosten; nur „Pay its
  cost“ würde zahlen.
- ST04-009 Miguel's Ginn: 【During Pair】【Destroyed】 zählt nur, wenn beim Zerstören ein Pilot dabei war.
- ST03-001 Sinanju: Nur 【During Pair】 gibt <High-Maneuver>; der Satz „During your turn, when this Unit
  destroys an enemy shield area card …“ steht auf einer eigenen Zeile und gilt immer.
- „When this Unit destroys an enemy Unit with battle damage“ löst aus, wenn der Angreifer beim Schaden noch
  im Spiel ist (auch wenn beide zerstört werden).
- ST01 Starter-Deckliste: Die Quelle ergibt 51 Karten; Guntank (ST01-004) ist mit 3 statt 4 gezählt
  (`src/data/decks.ts`).
- „You may choose N … (N > 1). Exile them. If you do, …“: nur mit genau N Karten; nach der ersten Wahl
  folgen die übrigen zwingend.
- „Discard N. If you do, …“ und „You may discard N. If you do, …“ nur mit mindestens N Handkarten.
- „Choose 1 of your Units and 1 enemy Unit“: Fehlt eine der beiden, entfällt der Effekt.
- Geht eine Unit unter das Deck, geht ihr Pilot mit (wie bei Trash und Hand, 3-3-6).
- „Begin a battle … and only perform the damage step“: gleichzeitiger Kampfschaden, keine Angriffs- oder
  Block-Effekte, kein First Strike.
- Mehrere Freedom Gundam lösen beim Pairen jeweils aus (je Karte einmal pro Zug).
- „Choose N of your (rested) Resources. Set it/them as active.“ wird ohne Auswahl zu `readyResource`:
  Ressourcen sind gleichwertig, die Wahl einer aktiven Ressource würde den Effekt nur verschenken
  (ST01-011, GD05-066, GD06-053, ST07-001).
