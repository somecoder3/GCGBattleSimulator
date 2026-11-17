# Karteneffekte

Stand: M9, alle Karten (17. Nov. 2026). Wie Kartentexte zu ausführbaren Effekten werden, und wie man eine Karte
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

Stand 17. Nov. 2026 (1123 Karten ohne Ressourcen/EX-Token): **100 % vollständig** (164 ohne Text,
925 automatisch, 34 von Hand), keine teilweise. Ein Test (`tests/cards/m9.test.ts`) schlägt fehl, sobald
eine Karte (z. B. nach einem GCGDB-Update) nicht mehr vollständig verstanden wird. Verlauf: vor M5 51,6 %,
nach M5 59,5 %, alle Archetypen 65,1 %, alle Starter 73,2 %, M9 100 %.

„Vollständig“ heißt: Jede Zeile wird von einem Muster oder Handskript erfasst. Ob die Auslegung stimmt,
sichern Kartentests (für die meisten neuen Mechaniken einer), Fuzz-Läufe mit Invarianten und die
Auslegungen unten; einzelne seltene Texte sind vereinfacht (siehe „Auslegungen“).

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

## Erweiterungen nach M5 (Archetypen M09–M15)

- „Pay its cost to deploy it“ (Kosten mit Rabatten, Lv. egal), „If you deploy this Unit from your trash“
  (`CardInstance.from`), Rabatt im Trash (`handCost` mit `zone: "trash"`, GD06-050), „Deploy 1 EX Base“,
  „Return them to their owner's deck and shuffle it“, „look at the top 2 … Place the remaining card into your
  trash“, „If it is a (CB) card, you may reveal it and add it to your hand“.
- Kosten „return this Unit to the bottom of its owner's deck“ und „Exile 4 cards in your trash“ (alle oder
  keine; der Activate-Effekt wird nur mit genug Karten angeboten).
- Schaden: „reduce the next damage it receives by 2“ (einmal), Reduktion von gegnerischem Kampfschaden,
  Reduktion von Effektschaden auf die Schildzone (Spieler-Flag), „When this Unit deals battle damage to an
  enemy Unit that is Lv.4 or lower that has no paired Pilot, destroy that enemy Unit“.
- Schutz: „enemy Units can't choose this Unit as their attack target“, „friendly Units can't be destroyed by
  enemy effects“ (nur „Destroy“-Effekte, nicht Zerstörung durch Effektschaden).
- Angriff: „On the turn this Unit is deployed, it may … attack a rested enemy Unit“ (nur Units).
- Werte: „gets AP+2 for each of your rested (CB) Units“, „While you have a red (Super Soldier) Pilot in
  play, this Unit gains <First Strike>“, „During your turn, while …, this Unit gets/can't receive …“.
- Trigger zu Beginn des gegnerischen Zuges; Token für den Besitzer einer zerstörten Unit; Wahl durch den
  Gegner auch bei „You and that player each choose“ (ST12-013).
- Handskripte: GD01-003, GD03-109, GD06-050, GD06-115, ST11-006, ST12-012, ST12-013.

## Erweiterungen für die Starter-Decks ST05–ST14

Die neuen Satzmuster gelten für alle Sets; dadurch sind 91 weitere Karten vollständig (65,1 % → 73,2 %).

- **Text:** „■…“-Zeilen gehören zur Zeile davor. „When playing this card, choose 1 of the following effects
  and activate it：■A ■B“ wird zu einer Wahl (`choice`). 【Deploy･Development N】/【When Linked･Development N】:
  „You may exile the specified number of (Trait) cards in your trash …“ (genau N oder nichts), dann der
  ■-Effekt. 【During Pair･Lv.5 or Higher Pilot】 (Bedingung `selfPilot`).
- **Bezüge:** „this“ (ST06-001), „they“, „it“ als diese Unit in Ereignis-Triggern, „Unit card/Pilot card“,
  „with the highest Lv.“, „battling this Unit“, „other than Unit tokens“, „with AP equal to or less than it“.
- **Bedingungen:** „this (Unit) is damaged“, „this is a blue Unit“, „this Unit is attacking an enemy Unit /
  the enemy player“, „a (rested) friendly … (is) in play“, „N or more rested Units are in play“, „there are
  N or more purple/Command/(CB) cards in your trash“.
- **„instead“:** „If …, choose 1 enemy Unit instead“ und „If …, deal 2 damage instead“ ersetzen die letzte
  Wahl bzw. den letzten Schaden (`if`/`else`).
- **Neue Schritte:** `mill` mit Variable („If you place a (CB) card with this effect, draw 1“), `redirect`
  („Change the attack target of the battling enemy Unit to it“), `deploy` geruht, `lookTop` mit Einsetzen
  („You may deploy 1 Unit card … among them“), `placeResource` (geruhte Ressource), `grantEffect` (ein Effekt
  dieser Karte gilt für die gewählte Unit, ST12-014), „Reveal 1 … from your hand. Return it to the bottom of
  your deck“, „That player chooses 2 Unit cards from their trash. Exile them“.
- **Trigger:** eigene Unit linkt (`allyLinked`, ST06-015, ST14-016), „When you draw with an effect“
  (`effectDraw`, ST08-011), „destroys an enemy Unit with damage“ (`anyDamage`: auch durch Effektschaden
  dieser Unit, über `CardInstance.lastSource`).
- **Dauereffekte:** „While …, it gets/gains …“, „this Base can't receive damage from enemy Units …“
  (`noDamageFrom`, ST07-015), „Each enemy player's rested Units with the lowest Lv. won't be set as active“
  (ST14-001), 【Once per Turn】„When this Unit would receive battle damage from …, it doesn't receive that
  damage“ (`noBattleDamageFromOnce`), Rabatt „for each enemy Unit in play“ (ST08-001).
- **Alternative Kosten:** ST10-014 „you may discard 1 (G Generation) Unit card. If you do, play this card as
  if it has 2 Lv. and cost“ ist eine eigene Option `playCommand` mit `discard` (je abwerfbarer Karte).
- **Handskripte:** ST07-009 (AP+1 oder alle (CB) Units, „instead“), ST12-014 (Effekt für eine Unit während
  des Kampfes), ST14-015 (geruhte Ressource, dann eine aktiv, wenn diesen Zug noch keine durch Effekt).
- Kartentests: `tests/cards/starters2.test.ts`.

## Erweiterungen in M9 (alle Karten)

- **Ereignis-Trigger** (`raiseForPlayer` in `core.ts`, Ereignis-Infos `EventInfo`): eigene Unit zerstört
  eine gegnerische Unit/Schildzonen-Karte (`allyDestroys`, auch über Effektschaden der Unit), wird angegriffen
  (`attacked`), eine Unit greift an (`unitAttacks`), eigene Karte erhält Schaden (`allyDamaged`, Kampf/Effekt,
  vom Gegner, Quelle mit `sourceFilter`), heilt (`recovered`), wird durch Effekt geruht/aktiv gesetzt, EX
  Resource gelegt/verbraucht, Command-【Main】/【Action】 aktiviert (`commandUsed`, „using an EX Resource“ über
  `CardInstance.paidEx`), eigene Unit durch Effekt zerstört, AP durch Gegner gesenkt, Zugende jedes Spielers
  (`anyTurnEnd`), <Blocker>/<Support> benutzt, Kosten für einen Unit-Effekt bezahlt (`effectPaid`), eigene Unit
  fügt Kampfschaden zu. Ein Schnellweg (`triggerKinds` je Karte) überspringt Karten ohne passenden Trigger.
- **Verzögerte und verliehene Effekte:** „During this turn, when one of your … destroys …“ (Spieler-Modifier
  mit Effekt), „When it destroys … during this turn“, „It gains the following effect during this turn: ■…“.
  Der verliehene Effekt steht als `dormant` im Skript der Karte, wirkt dort nie selbst und wird per
  `grantEffect` (Index) verliehen; der Übersetzer vergibt die Indizes (`hide`, Platzhalter für ■-Texte).
- **Kosten:** Ersatzkosten für Units/Commands (`altCost`: abwerfen, eigene Unit zerstören, oder nur Bedingung;
  Aktionen `deployUnit`/`playCommand` mit `sacrifice`/`discard`/`alt`), günstigeres Pairen je Ziel-Unit
  (`pairCost`), Kostensenkungen nur für Kosten (`costOnly`), nach Anzahl im Trash, im Trash, bedingt; Effekt-
  Kosten „Rest 2 of your Units“, „Exile 3 (Titans) cards“, „Pay ①“ im Effekt (`payCost`).
- **Filter:** Pilot als Ziel (`zone: "pilots"`, `pilotOf`), Unit oder Base (`zone: "field"`), „battling …“,
  „that is being attacked“, „paired with a (Newtype) Pilot“, „without <Breach>“, „non-blue“, „with a keyword
  effect“, „with a 【Destroyed】 effect“, „with the lowest HP“, „Lv.1 or lower or has 1 or less AP“ (`anyOf`),
  Link-Bedingung („a Unit with the [X] link condition“).
- **Dauereffekte:** Schutz („can't receive (battle/effect) damage from …“, Schilde, Bases), Angriffszwang
  auch für Link-Units (`tauntAll`), „deployed rested“, „can't be set as active“, „AP can't be reduced“, AP
  nach Schaden/Handkarten/Trash-Karten mit verschiedenen Namen, Keywords je Token, „While/If …“ und
  „During your (opponent's) turn …“ als allgemeine Hüllen, 【Once per Turn】 bei Schadensreduktionen.
- **Schritte:** Pilot zurück auf die Hand/aufs Deck, Kampfschaden umleiten (`redirectBattleDamage`), Token-
  Kopie, Base-Token, Schaden nach Anzahl/AP/gelegten Karten, Keywords einer Trash-Karte übernehmen, alle
  Spieler ziehen/EX Resource legen, Gegner entscheidet („That enemy player may discard 1“), Wahl mit
  verschiedenen Namen, Wahl aus gelegten Karten, Pilot aus den angesehenen Karten pairen.
- **Handskripte** (16 neu): EB01-003, EB01-023, EB01-059, EB01-062, EB01-078, GD02-011, GD03-117, GD04-036,
  GD04-067, GD04-116, GD05-026, GD05-034, GD06-018, GD06-039, GD06-042, GD06-118.
- **Leistung:** Dauereffekte werden nur bei Karten gesucht, die welche haben können (`hasStatic`). v1 mit
  Meta-Decks: 290 statt 368 ms Rechenzeit pro Spiel (vor M9), bei gleichen Ergebnissen.

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
- Zwei Spieler: „Choose 1 enemy player“ ist immer der Gegner, „a number of cards equal to the number of
  enemy players“ ist 1.
- „When this Unit destroys an enemy Unit with damage“ (ST12-001, ST12-003) zählt Kampfschaden und den
  Effektschaden dieser Unit; Epyon kann sich dadurch verketten, Tallgeese III nur einmal pro Zug.
- ST07-013 Armed Intervention wirkt nur während des Angriffs einer gegnerischen Unit; sonst verpufft es.
- ST07-015 Ptolemaios hält jeden Schaden solcher Units ab, auch <Breach>.
- ST14-001 The-O: Welche Units geruht bleiben, wird vor dem Aktivsetzen bestimmt.
- ST13-014 Final Duty setzt die Karte nur ein, wenn Platz ist.
- M9: „Choose 1 enemy player“, „all players“, „belonging to each enemy player“ gelten für zwei Spieler; Texte
  „If there are 2 or more enemy players“ sind nie erfüllt. Bei „All players each look at the top card …“
  (EB01-023, EB01-078) nimmt der Gegner eine passende Karte immer und lässt sonst alles oben.
- „While this Unit has 1 HP“ (GD03-061) meint die verbleibenden HP (HP minus Schaden).
- „destroys an enemy shield area card with damage“ zählt wie „with battle damage“ (nur der Angriff, nicht
  <Breach>).
- Ersatzwahlen „you may rest this Unit/Base instead“ (GD03-079, GD05-124) werden automatisch genutzt, wenn
  die Ersatzkarte aktiv ist.
- „At the end of a turn where you have paid ① or more for one of your other (Militia)/(Dianna Counter) Units'
  effects“ (GD04-069) prüft die Traits der bezahlten Karte, nicht „other“.
- Starter-Decklisten ST05–ST14: Produktlisten von exburst.dev (ST11 stimmt mit tcgtalk.com überein; für
  ST05 weicht eine Vorab-Liste von essential-japan.com in sechs Anzahlen ab). ST09 enthält Karten für
  zwei Decks; beide offiziellen Rezepte (gundam-gcg.com `deck-026` Lila-Weiß, `deck-027` Rot-Lila) sind
  als `ST09W` und `ST09R` hinterlegt.
