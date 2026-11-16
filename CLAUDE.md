# GCGBattleSimulator

Privates Projekt des Nutzers: Kampfsimulator für das **Gundam Card Game** auf Basis von **GCGDB**
(`E:\programming\GCGDB`, Kartendatenbank, siehe dessen `CLAUDE.md`). Vorbild für Aufbau und Abläufe ist
**GCGScanner** (`E:\programming\GCGScanner`). Kommunikation auf Deutsch. Der Nutzer kommt aus der
Webentwicklung. Plan und Begründungen: `docs/PLAN.md`.

## Ziele (aus der ursprünglichen Anfrage)

1. Mensch gegen Computer-KI; das Spiel soll gut aussehen und sich sehr gut anfühlen, auf Desktop und Handy (PWA).
2. Rollback, um eigene Spielfehler zum Üben rückgängig zu machen.
3. Zwei KIs spielen selbstständig tausende Matches, um die Chancen von Decks zu ermitteln.
4. Aktuelle Meta-Decks automatisch online ermitteln, mit sinnvollen Einstellungen gegeneinander antreten lassen,
   alle Statistiken erfassen.
5. Offizielle Kartenbilder verwenden (Erlaubnis des Nutzers). Erst privat und am Desktop testen, später
   öffentlich auf GitHub Pages.

## Stand (16. Nov. 2026)

- Repo `https://github.com/somecoder3/GCGBattleSimulator` (**privat**) über Chrome angelegt, Branch `main`,
  lokal per `git init` + `origin` eingerichtet (ein `git clone` ohne Anmeldung scheitert beim privaten Repo;
  das Repo war leer). Noch nichts committet oder gepusht.
- `docs/PLAN.md` geschrieben (Entwurf), **wartet auf Freigabe** und Antworten auf die offenen Fragen dort.

## Fakten (geprüft am 16. Nov. 2026)

- Regeln: Comprehensive Rules **Ver. 1.10.0 (16. Okt. 2026)**,
  `https://www.gundam-gcg.com/en/pdf/comprehensiverules_en.pdf`. Rules Q&A: `…/en/pdf/rule-qa_en.pdf`,
  FAQ `…/en/rules/faqs/`, Banned/Restricted aktuell `…/en/news/01_279.html`.
- Limitless: `https://play.limitlesstcg.com/api/tournaments?game=GUNDAM&limit=N`,
  `…/tournaments/<id>/standings` mit `decklist` (`unit`/`pilot`/`command`/`base`, je `count,name,set,number`,
  **ohne Ressourcen-Deck**), `deck.name` = Archetyp, `placing`, `record`. Sendet `Access-Control-Allow-Origin: *`.
- Probe (30 Turniere ≥ 12 Spieler, Mai–Nov. 2026, Top 8 = 176 Decks): 343 verschiedene Karten; Top 100 Karten
  decken 80 %, Top 200 94 %, Top 300 98,5 % der Kartenplätze.
- Kartenbilder: alle 2205 liegen in `E:\programming\GCGScanner\build\carddb-cache\images\`. gundam-gcg.com
  sendet `Cross-Origin-Resource-Policy: same-site` (kein Einbinden von fremden Seiten). Bilder nicht ins Repo
  und nicht frei auf Pages (Pages ist öffentlich).
- `gh` ist nicht installiert; GitHub-Oberfläche über Claude in Chrome (Nutzer angemeldet als `somecoder3`).
  Node v26 und Python 3.11 sind vorhanden.

## Konventionen

- **Diese CLAUDE.md immer aktuell halten** (wie in GCGDB/GCGScanner): Änderungen, Erkenntnisse und
  Entscheidungen im selben Commit nachtragen, Veraltetes korrigieren.
- Abhängigkeiten exakt pinnen und gegen die Registry prüfen; keine Version unter 2 Wochen Alter
  (auch GitHub Actions, per Commit-SHA).
- Unter Windows mit Python-Pfaden `E:/...` statt `/e/...`.
