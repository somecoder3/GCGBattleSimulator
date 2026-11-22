# Neue starke Decks finden (Überlegungen, 20. Nov. 2026)

Noch nichts davon ist gebaut. Das Dokument sammelt Ideen, Hindernisse, grobe Kosten und einen Vorschlag für die
Reihenfolge. Zahlen zur Rechenzeit stammen aus `docs/AI.md`; was mit „geschätzt“ markiert ist, muss vor dem
Bau gemessen werden.

## 1. Was heißt „stark“ und „neuartig“?

- **Stark:** hohe Siegquote gegen das Feld, so wie es gespielt wird. Gemessen als meta-gewichtete Siegquote
  gegen die Archetypen des Snapshots (gibt es schon im Simulator, `metaWeighted`). Daneben zählt die
  **Robustheit**: das schlechteste wichtige Matchup. Ein Deck mit 56 % im Schnitt, aber 25 % gegen den
  meistgespielten Archetyp ist im Turnier riskant.
- **Neuartig:** weit weg von allen bekannten Archetypen, z. B. gewichtete Jaccard-Ähnlichkeit < 0,5 zu jeder
  Konsensliste (dieselbe Schwelle, mit der `archetypes.ts` unbenannte Decks zuordnet). Zwischenstufe: eine
  bekannte Liste mit deutlich anderem Zuschnitt („Tech“), etwa eine kaum gespielte Karte in vier Kopien.
- Beides zusammen ist das eigentliche Ziel. Reine Stärke findet meist nur geschliffene Varianten der
  Meta-Listen. Die sind nützlich, aber nicht neu.

## 2. Die vier großen Hindernisse

### 2.1 Die KI ist ein Teil der Messung

Eine Siegquote misst immer **Deck + KI-Spielweise**. Beispiele aus dem Projekt:

- Shining Gundam (M01, meistgespielt) gewinnt bei v1 nur etwa 40 %. Das liegt am schlechten Timing der
  Special Moves, nicht an den Karten.
- Die Optimierung sucht genau dort, wo die KI schwach ist. Wenn v1 schlecht blockt, gewinnen aggressive
  Decks zu oft. Wenn die KI Kombos nicht zündet, wirken Kombo-Decks zu schwach. Am Ende stünde ein „Deck,
  das die KI gut spielt“ statt eines starken Decks.

Gegenmittel:

1. **Kalibrieren gegen echte Ergebnisse.** Der Snapshot hat für jede Liste die Turnierbilanz (`record`:
   Siege, Niederlagen, Unentschieden). Daraus folgt eine echte Siegquote je Archetyp (gewichtet,
   Turnierstärke grob berücksichtigt). Vergleicht man sie mit der KI-Siegquote im Gauntlet, zeigt der
   Abstand, welche Archetypen die KI unter- oder überschätzt. Für neue Kandidaten wäre das ein Warnsignal:
   „ähnelt Archetypen, die die KI überschätzt“. Zu prüfen: Liefert Limitless auch Paarungen einzelner Runden?
   Dann ließen sich echte Matchup-Siegquoten berechnen, nicht nur Gesamtbilanzen.
2. **Mehrere KI-Stufen.** Ein Kandidat muss auch mit der Such-KI vorn liegen. Ein großer Abstand zwischen
   v1 und Suche ist ein Zeichen, dass die Stärke von einer KI-Schwäche kommt.
3. **Gewinnwege ansehen.** Wie gewinnt der Kandidat (Züge, Schaden, Deck leer)? Dazu Beispiel-Replays per
   Spiel-Hash. Ein Deck, das fast nur gewinnt, weil der Gegner nie blockt, ist verdächtig.
4. **KI-Schwächen vorher beheben,** wo sie ganze Archetypen betreffen (Special-Move-Timing bei Shining).
   Jede Verbesserung der KI macht die Decksuche ehrlicher.
5. **Der Mensch als letzte Instanz.** Die besten Kandidaten selbst spielen, im Spiel-Reiter oder mit
   `npm run play`.

### 2.2 Rauschen und der Fluch des Gewinners

- Bei 1000 Spielen liegt eine Siegquote auf etwa ±3 % genau (95 %). Unterschiede zwischen guten Listen sind
  oft 1–3 Punkte.
- Wer 500 Kandidaten mit je 200 Spielen misst, findet rein zufällig welche mit +7 %. **Der beste gemessene
  Kandidat ist fast immer überschätzt.** Darum müssen Auswahl und Bestätigung getrennt sein: frische Seeds,
  mehr Spiele, erst dann melden. `npm run tune` arbeitet schon so; dort war der einzige Treffer Zufall.
- Varianz senken mit **gemeinsamen Zufallszahlen**: Kandidat und Basisliste spielen mit denselben Seeds,
  Sitzen und Gegnern. Dann vergleicht man gepaart und braucht deutlich weniger Spiele für dieselbe
  Sicherheit. Der Runner ist dafür schon deterministisch (Spiel = Job + Index).

### 2.3 Der Suchraum ist riesig

- 1123 Karten, 50 Karten pro Deck, höchstens 4 Kopien, zwei Farben, dazu Bannliste und Bann-Paare.
- Selbst innerhalb einer Farbkombination gibt es unvorstellbar viele Decks. Blinde Zufallssuche ist
  hoffnungslos; man braucht gute Startpunkte und gute Nachbarn.

### 2.4 Das Meta bewegt sich

- Ein Deck, das gegen das heutige Feld stark ist, bleibt es nur, solange das Feld so bleibt. Konter-Decks
  sind oft eng (stark gegen zwei Archetypen, schwach gegen den Rest).
- Darum gehört ein spieltheoretischer Blick dazu (Abschnitt 4.8).

## 3. Rechenbudget (Größenordnung)

| KI               | pro Spiel, ein Kern              | 15 Worker, grob                 |
| ---------------- | -------------------------------- | ------------------------------- |
| v1 (`round`)     | 0,19 s                           | ~80 Spiele/s, ~280 000 pro Std. |
| Suche („Schwer“) | 1,75 s                           | ~9 Spiele/s, ~30 000 pro Std.   |
| v0               | geschätzt 5–20× schneller als v1 | geschätzt > 1 Mio. pro Std.     |

Damit kostet ein Kandidat mit 1000 Spielen bei v1 etwa 12 Sekunden. In einer Nacht (8 Std.) wären das gut
2000 voll gemessene Kandidaten. Mit gestufter Messung (Abschnitt 4.1) kann man ein Vielfaches **anschauen**,
aber nur wenige **voll messen**. Das bestimmt, welche Verfahren in Frage kommen: Methoden, die Zehntausende
Bewertungen brauchen (große genetische Läufe mit v1), gehen nur mit einem billigen Vorfilter.

## 4. Bausteine

### 4.1 Messwerkzeug „Deck-Fitness“ (Grundlage für alles andere)

- Eingabe: Kandidat, Feld (Archetypen mit Anteilen), KI, Budget.
- Gestufte Messung wie beim Successive Halving der Such-KI: alle Kandidaten bekommen 64 Spiele, die bessere
  Hälfte weitere 128, dann 256 … Schlechte Kandidaten kosten so fast nichts.
- Gepaart gegen eine Basisliste mit gemeinsamen Seeds (2.2); Ergebnis als Differenz mit Intervall.
- Cache je (Deck-Hash, Gegner, Seed-Block, KI-Version), damit Wiederholungen nichts kosten.
- Zwei Seed-Mengen: **Such-Seeds** zum Auswählen, **Bestätigungs-Seeds** nur für die Schlussmessung.
- Billiger Vorfilter mit v0, Schlussmessung mit v1, Gegenprobe mit der Suche (2.1).

### 4.2 Kartentausch-Experimente an Meta-Listen (schneller Nutzen, gut zu verstehen)

- Ausgangspunkt: Konsensliste oder beste Turnierliste eines Archetyps.
- Nachbarn: −1/+1 oder −2/+2 Karten. Herausnehmen: Karten mit wenig Nutzen laut Kartenleistung. Hereinnehmen:
  Karten der Deckfarben, Kombo-Partner (`synergy.ts`), Karten aus anderen Turnierlisten desselben Archetyps.
- Lokale Suche mit Zurücknahme (Bergsteigen, Tabu-Liste gegen Kreisen), jeder Schritt gepaart gemessen.
- Ergebnis ist direkt verständlich: „−2 Karte X, +2 Karte Y: +3,1 % (±1,2) gegen das Feld“.
- Anders als die 17lands-Werte (`cardStats`) ist das **ursächlich**. „Gewinnt, wenn gezogen“ ist dagegen nur
  eine Korrelation: Karten, die man spät zieht, sehen besser aus, weil das Spiel dann schon lange läuft.

### 4.3 Ein Ersatzmodell für Kartenwerte

- Viele leicht abgewandelte Listen spielen (zufällige Tausche um eine Basisliste) und die Siegquote per
  logistischer Regression aus den Kartenanzahlen schätzen. Ergebnis: Wert jeder Karte **in diesem Deck**,
  mit Unsicherheit.
- Paar-Merkmale für bekannte Kombos (aus `synergy.ts`: Link-Paare, Trash-Treibstoff, Trait-Zähler) fangen
  Wechselwirkungen ein, ohne alle Paare schätzen zu müssen.
- Nutzen: schlägt gute Tausche vor, bevor sie teuer gemessen werden (4.2 wird viel schneller). Pro Archetyp
  ein Modell.

### 4.4 Unterschätzte Karten („verborgene Perlen“)

- Karten, die im Meta kaum vorkommen, aber auf dem Papier stark sind:
  - Werte gegen eine Grundkurve (AP+HP je Level und Kosten im Vergleich zu Vanilla-Units derselben Stufe),
  - Keywords (Blocker, First Strike, Breach, Repair …),
  - Kartenvorteil (Ziehen, Suchen, Token),
  - wirkungsvolle Trigger (Deploy/Destroyed/Burst).
- Kandidaten dann in 4.2 gezielt einsetzen. Eine Rangliste „stark auf dem Papier, selten gespielt“ ist auch
  für Menschen beim Deckbau interessant.
- Vorsicht: Die Engine versteht seit M9 alle Karten, aber manche Auslegungen sind Annahmen
  (`docs/EFFECTS.md`, `docs/QA.md`). Eine Perle, die nur durch eine falsche Auslegung stark ist, wäre ein
  Engine-Fehler. Darum Gewinner-Karten immer gegen Text und FAQ lesen.

### 4.5 Neue Archetypen aus dem Kombo-Graphen

- `synergy.ts` liest schon heute, welche Karten andere Karten wollen (Traits, Namen, Trash-Treibstoff,
  Link-Paare). Über **alle** Karten einer Farbkombination ergibt das einen Graphen.
- Dichte Gruppen darin (Cluster) sind Archetyp-Keime: ein Satz Karten, die sich gegenseitig stärken.
  Gruppen, die keinem Meta-Archetyp ähneln, sind Kandidaten für „neuartig“.
- Auffüllen nach Bauplan: Anteile von Units, Piloten, Commands und Bases sowie die Level-Kurve aus erfolgreichen
  Meta-Listen übernehmen, Lücken mit Karten füllen, die nach 4.3/4.4 allgemein gut sind.
- Danach lokal verbessern (4.2). Auch bisher unbeachtete Link-Paare (Unit + Pilot mit Link-Bonus, die
  zusammen in keiner Turnierliste vorkommen) sind gute Keime.

### 4.6 Evolution mit Vielfalt (MAP-Elites)

- Ein genetischer Algorithmus allein läuft schnell in eine Ecke und findet nur Varianten eines Decks.
  **MAP-Elites** führt ein Raster von Nischen, und in jeder Nische lebt das beste Deck. Mögliche Achsen:
  - Farbpaar,
  - mittleres Level beziehungsweise Kurve (früh/spät),
  - Anteil Units zu Commands,
  - Aggression (Ø Zug des Sieges aus den Spielen).
- Kreuzung arbeitet mit Blöcken (ein Kombo-Kern als Ganzes), nicht mit einzelnen Karten, sonst zerfallen die
  Kerne. Mutation: Tausche wie in 4.2.
- Ergebnis ist eine **Landkarte**: bestes bekanntes Deck je Spielweise und Farbpaar, darunter vermutlich
  auch neuartige.
- Bewertung mit v0 als Vorfilter, nur Nischen-Sieger mit v1, sonst reicht das Budget nicht (Abschnitt 3).
- Optional **Neuheitsbonus**: Abstand zu allen bekannten Archetypen als Zusatzpunkte, damit die Suche nicht
  in die Meta zurückläuft.

### 4.7 Ko-Evolution statt festem Feld

- Optimiert man nur gegen das heutige Feld, findet man Spezialisten.
- Besser: Das Feld enthält die Meta-Archetypen **und** die bisher besten Kandidaten („Hall of Fame“). Ein neuer
  Kandidat muss auch gegen frühere Gewinner bestehen. Das ist robuster und nimmt vorweg, wie das Meta reagieren
  würde.

### 4.8 Meta-Spieltheorie

- Aus der Matchup-Matrix (Meta-Archetypen + Kandidaten) das **Nash-Gleichgewicht** des Spiels „Welches Deck
  bringe ich mit?“ berechnen. Decks mit positivem Anteil im Gleichgewicht sind die, die man in einem
  eingespielten Meta braucht. Ein Kandidat mit Anteil 0 ist dominiert, auch wenn er heute gut aussieht.
- **Beste Antwort:** das Deck mit der höchsten Siegquote gegen das aktuelle Feld. Wiederholtes Beste-Antwort-
  Spielen (das Feld nimmt den Gewinner auf) zeigt, wohin sich das Meta drehen könnte.
- Der Rechenaufwand ist klein (Matrix-Spiel), die Matrix gibt es schon im Simulator.

### 4.9 Lernende Modelle (später)

- **Karten-Einbettungen** aus gemeinsamem Vorkommen in Turnierlisten: Karten, die in ähnlichen Listen
  stehen, liegen nahe beieinander. Das liefert gute Tausch-Vorschläge („wird gespielt wie X“).
- Ein Bewertungsnetz für Decks (Deck rein, geschätzte Siegquote gegen das Feld raus), trainiert auf allen
  gemessenen Kandidaten, als noch billigerer Vorfilter. Das ist eher ein Forschungsprojekt (wie beim
  Bewertungsnetz für die Such-KI besprochen).

## 5. Ergebnis zeigen

Ein Reiter „Deck-Labor“ oder ein Bericht pro Lauf, je Kandidat:

- Liste mit Unterschied zur Basis (+/−), Ähnlichkeit zum nächsten Archetyp, „neuartig“ ja/nein,
- meta-gewichtete Siegquote mit Intervall (Bestätigungs-Seeds), Matchup-Zeile, schlechtestes Matchup,
- Abstand v1/Suche (KI-Empfindlichkeit), Warnung bei Ähnlichkeit zu Archetypen, die die KI überschätzt,
- Kartenleistung, Gewinnwege und 3–5 Beispiel-Replays per Spiel-Hash,
- Knopf „im Decks-Reiter speichern“ und „gegen die KI spielen“.

## 6. Vorschlag für die Reihenfolge

| Stufe | Inhalt                                                                         | Nutzen                                            |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| 0     | Messwerkzeug (4.1) und Kalibrierung KI gegen echte Bilanzen (2.1)              | Grundlage; zeigt, wie weit man der KI trauen darf |
| 1     | Kartentausch an Meta-Listen (4.2), Bericht als `npm run decklab`               | Schnell, verständlich, sofort spielbar            |
| 2     | Ersatzmodell (4.3) und verborgene Perlen (4.4)                                 | Macht Stufe 1 schneller, findet Tech-Karten       |
| 3     | Neue Archetypen: Kombo-Graph (4.5) und MAP-Elites (4.6) mit Hall of Fame (4.7) | Das eigentlich Neuartige                          |
| 4     | Spieltheorie (4.8) und Deck-Labor in der App (5)                               | Robustheit, Meta-Vorhersage, bequeme Auswertung   |

Stufe 0 und 1 lassen sich in wenigen Sitzungen bauen und liefern schon brauchbare Ergebnisse. Stufe 3 ist der
Teil mit dem größten Risiko: Die Ergebnisse hängen am stärksten von der KI ab.

## 7. Antworten des Nutzers (21. Nov. 2026)

- **Rechenzeit:** keine Nachtläufe (Laptop im Schlafzimmer, Lüfter). Darum rechnet das Deck-Labor
  standardmäßig auf der Hälfte der Kerne (`--workers`) und speichert jeden Achterblock sofort: Läufe lassen sich
  abbrechen und tagsüber in Etappen fortsetzen.
- **KI:** v1 für erste Tests, eigentlich die Suche, sofern sie deutlich besser ist.
- **Karten:** nur die aktuelle Bannliste; die Sammlung (ExBurst) vielleicht später.
- **Format:** Bo1.
- **KI-Schwächen:** zuerst beheben, wo sie ganze Archetypen betreffen.

## 8. Stand: Stufe 0 und 1 gebaut (21. Nov. 2026)

`npm run decklab` (`tools/decklab.ts`, Kern in `src/lab/decklab/`):

- **Messen** (`measure.ts`): Einheit ist ein Achterblock eines Decks gegen einen Gegner (beide Startspieler,
  Sitze, KI-Plätze). Der Seed eines Blocks hängt nur vom Basis-Seed und vom Gegner ab, nicht vom Kandidaten:
  Alle Kandidaten spielen dieselben Situationen (gemeinsame Zufallszahlen), Vergleiche sind gepaart
  (`pairedDiff`: gewichtetes Mittel der Blockdifferenzen mit 95-%-Intervall). Jeder Block liegt im
  Labor-Speicher (`kv`, Schlüssel mit Code-Version, KI, Seed, Deck-Hashes, Block): Wiederholungen kosten nichts.
- **Feld** (`field.ts`): die meistgespielten Archetypen (Konsenslisten, voll unterstützt), Gewichte = Meta-Anteile.
- **Kalibrierung** (`npm run decklab -- calibrate`): Jeder Archetyp gegen jeden; daneben echte Ergebnisse aus
  den **Paarungen** der Limitless-Turniere (neu im Snapshot: `MetaSnapshot.pairings`, je Spiel Turnier, die
  Platzierungen beider Spieler und das Ergebnis, ohne Spieler). Die Platzierungen werden über die Listen
  (`Archetype.entries`) dem Archetyp zugeordnet, auch „other“-Listen.
- **Kartentausch** (`swaps.ts`, `npm run decklab -- swaps M01`): Nachbarn „−1 X / +1 Y“, Y aus den echten
  Listen des Archetyps (mehr Kopien als die Basis), sortiert nach Unterstützung durch diese Listen; Rennen mit
  Successive Halving gegen das Feld, Sieger auf frischen Seeds (Basis-Seed + 1000) bestätigt, übernommen nur
  bei 95 % > 0; dann der nächste Schritt.

**Erste Kalibrierung (v1, Feld 12, 4 Blöcke je Paarung = 4608 Spiele, 3 min auf 8 Workern):** Die echten
Daten sind dünn. Limitless hat in 8 Wochen nur 148 Paarungen zwischen Spielern mit Liste (Egman liefert keine
Paarungen), also 0–20 echte Spiele je Archetyp; die Spalte „echt“ ist deshalb nur ein grober Hinweis. Deutlich
und zu früheren Beobachtungen passend: **Shining Gundam (M01, 18 % des Metas)** echt 65 % (16 Spiele), bei
der KI 35,5 % gegen das Feld. Das ist der erste Kandidat für „KI-Schwächen zuerst beheben“.

### KI-Korrektur und erster Kartentausch-Lauf (22. Nov. 2026)

- Nach der Kalibrierung zuerst die KI für Shining verbessert (`docs/AI.md` „Shining Gundam“): M01 gegen das Feld
  39,3 → 44,5 % (v1).
- **Kartentausch M01** (v1, Feld 12, 32 Kandidaten, je Lauf gut 4 Minuten auf 8 Workern):
  - Lauf 1 (erste Runde 1 Block, Bestätigung 6): Sieger +2,0 % in der Suche, −3,3 % in der Bestätigung. Die erste
    Runde mit einem Block war zu verrauscht (±36 %).
  - Darum jetzt: erste Runde 2 Blöcke, Bestätigung 8 Blöcke und **sequenziell** (positiv, aber unsicher →
    doppelt so viele Blöcke, bis 32), Doppel-Tausche (−2/+2), wenn die echten Listen beide Kopien stützen.
  - Lauf 3: bester Tausch „−1 Silver Bullet / +1 Shining Gundam (ST12-002)“, Suche +2,3 %, Bestätigung mit 8 → 16 →
    32 Blöcken: +2,4 → +0,6 → **+0,7 % (−1,9 … +3,2 %)**, nicht übernommen. Einzeltausche an der Konsensliste
    bewegen bei v1 höchstens 1–2 Punkte; das liegt an der Grenze dessen, was mit vertretbarer Rechenzeit messbar
    ist. Größere Hebel: Stufe 2/3 (andere Kerne, neue Archetypen) und die KI selbst.

## 10. Stufe 2 und 3 gebaut (22. Nov. 2026)

Neue Befehle von `npm run decklab` (Kern in `src/lab/decklab/pearls.ts`, `values.ts`, `evolve.ts`):

- **`pearls [M01 | --colors White/Red]`** – unterschätzte Karten: Papierstärke (AP+HP gegen den Median der Units
  gleichen Levels, Keywords, Zahl der Effekte, Kosten unter Level; je Kartentyp standardisiert) minus 4 ×
  Spielrate in den Turnierlisten. Nur eine Vorauswahl; ob eine Karte hilft, misst die Simulation.
- **`swaps M01 --pearls`** – die 12 besten Perlen der Deckfarben kommen als zusätzliche Tausch-Kandidaten dazu.
- **`values M01 [--pearls]`** – Kartenwerte im Deck: zufällige Varianten (je 3 Tausche aus Archetyp-Karten und
  Perlen), gepaart gegen die Basis gemessen, Ridge-Regression (`ridge`) → Wert je zusätzlicher Kopie mit
  Standardfehler.
- **`seeds`** – Keime aus dem Kombo-Graphen je Farbpaar (`deckSynergies` über alle nutzbaren Karten; gleiche
  Partnergruppen nur einmal).
- **`evolve`** – MAP-Elites: Nischen = Farbpaar × Kurve (Ø Unit-Level früh/mittel/spät) × Units-Anteil; Start mit
  den Feld-Archetypen und Decks um die Keime (`buildAround`: Keim-Quelle 4×, Partner 2–3×, Rest nach Kartentyp
  wie der Median der Turnierlisten mit den stärksten Karten der Farben); Nachkommen per Tausch (1–3 Karten,
  gute Karten häufiger) oder Kreuzung (je Kartentyp von einem Elternteil); Endmessung der besten neuen Decks mit
  `--ai`; Speichern als Labor-Deck nur ab `--min` (Standard 50 %).

**Ergebnisse:**

- Kartenwerte M01 (v1, 40 Varianten, 7872 Spiele, 4 min): alle Werte innerhalb von etwa ±2 Standardfehlern;
  am ehesten eine zweite ZZ Gundam (+2,9 ± 1,9 %), Graze-Karten eher schädlich (−2 bis −3 %).
- Evolution mit v0 (40 Generationen à 16, 124 000 Spiele, 4 min): **v0 überschätzt neue Decks stark**: die besten
  neuen Decks lagen mit v0 bei 43–49 %, mit v1 nachgemessen bei 15–20 % (Meta-Decks: Nu Gundam 75 → 53 %).
  Kein konkurrenzfähiger neuer Archetyp; die drei damals gespeicherten Decks wieder gelöscht und eine
  Mindestquote eingebaut. Darum gibt es `--evo-ai v1` (gleicher `--seed` spielt aus dem Zwischenspeicher nach,
  lange Läufe gehen in Etappen).
- Evolution mit v1 (`--evo-ai v1 --generations 12 --batch 16 --seed 2`, 30 000 Spiele, in zwei Etappen: nach
  Generation 5 pausiert, mit demselben Befehl fortgesetzt, das Bisherige kam aus dem Zwischenspeicher):
  - Neue Archetypen bleiben schwach: bestes neues Deck (Keim Gundam Lfrith Thorn, Grün/Rot) 24 % gegen das Feld.
  - Die besten Nischen sind Abwandlungen von White Red Zaft (M04) mit 61–65 % auf den Such-Seeds. Gepaart auf
    frischen Seeds gegen M04 (8 Blöcke): **−4,2 %** (−9,2 … +0,8) bzw. **−2,1 %** (−6,2 … +2,1). Wieder der Fluch
    des Gewinners. Die Endmessung lief bis dahin auf den Such-Seeds und war dadurch geschönt; jetzt auf frischen
    (Seed + 1000).
- **Fazit Stufe 2/3:** Die Werkzeuge arbeiten, finden aber mit der heutigen KI keine Verbesserung, die eine
  Messung auf frischen Seeds übersteht. Die Meta-Listen sind für diese KI bereits gut, und neue Kerne aus dem
  Kombo-Graphen sind viel schwächer. Größter Hebel bleibt die Spielstärke der KI (jede KI-Schwäche verzerrt die
  Bewertung von Decks), dann größere Läufe mit v1 bzw. der Suche als Maßstab.

## 9. Ursprüngliche offene Fragen

- Wie viel Rechenzeit ist in Ordnung (eine Nacht, ein Wochenende)? Nur am Desktop per CLI oder auch im Browser?
- Welche KI ist der Maßstab: v1 (schnell) oder die Suche (genauer, ~9× langsamer)?
- Nur die aktuelle Bannliste? Sollen Karten bevorzugt werden, die man besitzt (Sammlung aus GCGScanner)?
- Spielen Turniere Bo1 oder Bo3 mit Sideboard? Egman-Listen haben teils ein Sideboard; im Bo3 zählt
  Robustheit noch mehr.
- Erst KI-Schwächen beheben, die ganze Archetypen betreffen (Shining Gundam), oder parallel?
