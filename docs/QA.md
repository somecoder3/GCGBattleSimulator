# Offizielle Q&A und FAQ

Stand: 17. Nov. 2026. Abgeglichen wurden

- das **Rules Q&A** (`https://www.gundam-gcg.com/en/pdf/rule-qa_en.pdf`, 112 Fragen Q1–Q112) und
- die **Karten-FAQ** aller Produkte (`https://www.gundam-gcg.com/en/rules/faqs/list.php?series=<Set>`,
  ST01–ST14, GD01–GD06, EB01; 437 Einträge Q113–Q557, Stand der Seite 16. Okt. 2026).

Jeder Eintrag wurde gegen das Verhalten der Engine gelesen. Fast alle bestätigen sie (z. B. „Block bleibt
bestehen, wenn <Blocker> wegfällt“, „gleichzeitig zerstört: der Effekt wirkt trotzdem“, „durch Effekt
eingesetzte Units kosten nichts und lösen 【Deploy】 aus“, „Look at the top …“ ist Pflicht bis zum Ansehen).
Die Abweichungen unten sind behoben; Tests in `tests/cards/qa.test.ts` (FAQ-Nummer im Testnamen).

Die Texte selbst liegen nicht im Repo (offizielle Inhalte). Zum erneuten Abgleich: die Set-Listen abrufen
(Einträge stehen in `<li class="faqResult_listItem">` mit `faqResult_number`, `faqResult_title` und zwei
`faqResult_text`) und neue Nummern seit Q557 lesen.

## Behobene Abweichungen

| FAQ                    | Regel                                                                                       | Vorher                   | Jetzt                                  |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------- |
| Q96, Q224              | „with N or less HP“, „lowest HP“: aktuelle HP (HP minus Schaden)                            | HP-Wert der Karte        | `matches`, `lowestHp`                  |
| Q107                   | Gleichzeitige eigene Effekte: der Spieler wählt die Reihenfolge                             | Auftrittsreihenfolge     | Entscheidung `prompt: "order"`         |
| Q153, Q168, Q230 u. a. | „Choose 1 of your Units and 1 enemy Unit“: nur spielbar, wenn beide Ziele da sind           | nur das erste geprüft    | `canStart`                             |
| Q245, Q538             | Beginnt der Effekt mit einer unerfüllten Bedingung, ist die Karte nicht spielbar            | spielbar, ohne Wirkung   | `canStart`                             |
| Q401, Q450, Q468 u. a. | „Choose 1 of the following effects“: nur Optionen mit Ziel; keine → nicht spielbar          | alle Optionen            | `pick`, `canStart`                     |
| Q175, Q233             | „Then, …“ nach „If …,“ oder „You may …. If you do, …“ gehört dazu                           | eigener Abschnitt        | Schritt `segments`                     |
| Q197                   | „Set this Unit as active“ bei aktiver Unit: kein Auslösen, 【Once per Turn】 bleibt         | löste aus                | Bedingung „geruht“                     |
| Q222                   | „mit 【Destroyed】-Effekt“ nur, wenn er gerade wirken würde                                 | jeder                    | `hasDestroyed`                         |
| Q277                   | ∀ Gundam (GD04-067) darf auch aus dem gegnerischen Trash wählen                             | nur eigener              | Handskript                             |
| Q286, Q297, Q400       | „Pay its cost to deploy it“ in einem Unit-Effekt zählt als Zahlung für einen Effekt         | nein                     | `paidForEffect`                        |
| Q289, Q290, Q300       | Angriffszwang per Effekt (Destined Battle) geht vor dauerhaftem; nur angreifbare Units      | beide gleich             | `attackTargets`                        |
| Q346, Q347, Q446       | Kampf per Effekt: First Strike und „battling“-Effekte wirken, Kills zählen, dann Battle End | gleichzeitig, kein Kampf | `fight`                                |
| Q355, Q366, Q385       | Nur „darf frisch eingesetzt geruhte Units angreifen“: keine aktiven Units als Ziel          | erlaubt                  | `attackTargets`                        |
| Q361, Q497             | „destroys an enemy shield area card with damage“: auch <Breach>/Effektschaden               | nur Kampf                | `shieldAreaKilledByEffect`             |
| Q368                   | „destroyed by an effect“: nur „destroy“-Effekte, nicht Effektschaden                        | beides                   | `destroyedBy`, `allyDestroyedByEffect` |
| Q485                   | Zwei EX Resources in einer Zahlung: „when … exiled“ einmal                                  | je Ressource             | `pay`                                  |
| Q494                   | Kampfschaden-Umleitungen: jede einmal (A↔B landet bei A)                                    | eine Stufe               | `battleHit`                            |
| Q151, Q539             | Schildzonen-Schutz gegen Units gilt auch für ihren Effektschaden                            | nur Kampf/<Breach>       | `damageShieldArea`                     |
| Q556, Q557             | „That player chooses 2 Unit cards“: genau zwei, sonst nichts                                | so viele wie da          | `exact`                                |

## Bewusst vereinfacht

- Mehrspieler-Fragen (Team, Battle Royale) entfallen; die Engine kennt zwei Spieler.
- Q339, Q427: Reihenfolge beim Zurücklegen mehrerer Karten unter das Deck bestimmt die Engine.
- Q407: Mehrere aufgedeckte 【Burst】 laufen in Aufdeckreihenfolge (die Reihenfolge-Wahl gilt für Trigger).
- Q142/Q198/Q260 u. a.: „choose 1 of your Resources. Set it as active“ wählt immer eine geruhte, weil die
  Wahl einer aktiven nichts bewirkt.
