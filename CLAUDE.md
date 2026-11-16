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
  das Repo war leer). Erster Commit `a73a236` (Plan, CLAUDE.md, .gitignore) vom Nutzer gepusht;
  Push mit seiner Anmeldung funktioniert.
- `docs/PLAN.md` vom Nutzer freigegeben. Entscheidungen (Abschnitt 13): TypeScript + Vite + Svelte;
  Rollback mit gleichem Zufall; **KI kennt das gegnerische Deck nicht**, darf es aber wie ein Mensch aus
  gesehenen Karten erraten; erstes Kartenziel Top-8-Archetypen der letzten 8 Wochen.
- **M0 (Gerüst) fertig, noch nicht committet:** Vite 8 + TypeScript 6 + Svelte 5 (Runes), Vitest, ESLint,
  Prettier, svelte-check; GCGDB als Submodul `gcgdb/` (Branch `main`); `npm run verify` = alles wie in der CI
  (`.github/workflows/ci.yml`, Node 24). Erste Seite: Kartenliste mit Filtern (Suche, Set, alle acht Typen wie auf gundam-gcg.com, Farbe)
  und Detaildialog mit allen Drucken; am Desktop und in Handybreite im Browser-Fenster geprüft.
  Befehle und Einrichtung: `README.md`.
- Aufbau bisher: `src/data/` (Kartenmodell `CardDef`, `CardPool` aus `cards.json`, Parser für Traits/Zonen/
  Link), `src/app/` (Svelte), `tools/images.ts`, `tests/`. Geplanter Rest siehe `docs/PLAN.md` Abschnitt 3.
- Nächster Schritt: **M1** Engine-Kern (Regeln ohne Kartentexte, Zufalls-KI, Fuzz-/Determinismus-Tests).

## Svelte-Fallen

- **Keine Variable `set` nennen, wenn sie mit `bind:` gebunden wird** (Svelte 5.57.3): Der Compiler
  erzeugt für `bind:value` eine Setter-Funktion namens `set`, die die Variable verdeckt; der Wert ändert sich
  dann nie. Darum hieß der Set-Filter der Kartenliste nicht mehr `set`, sondern `setCode` (gefunden am 16. Nov.).

## Entscheidungen

- **TypeScript 6.0.3 statt 7:** TS 7 (seit Juli 2026) wird von svelte-check (`^5 || ^6`) und
  typescript-eslint (`<6.1`) noch nicht unterstützt.
- Installiert mit `npm install --before=2026-11-02T23:59:59Z`, damit auch indirekte Abhängigkeiten
  mindestens 2 Wochen alt sind (Lockfile hält sie fest). Bei neuen Paketen genauso vorgehen.
- `npm audit` meldet beim Stand 16. Nov. nur Entwicklungswerkzeuge (deepmerge in vite-plugin-svelte ohne Fix,
  minimatch in ESLint/typescript-eslint); die App selbst ist nicht betroffen.
- `cards.json` wird per `?url` als gehashte Datei gebaut und zur Laufzeit geladen (787 KB, gzip 85 KB).
- Kartenbilder: `npm run images` kopiert aus GCGScanners Cache nach `build/images/full/` (600 px, 128 MB)
  und erzeugt `build/images/small/` (240 px, WebP q82, 49 MB) mit sharp. Ein Vite-Plugin in
  `vite.config.ts` liefert sie im Dev- und Preview-Server unter `cards/<size>/<file>`; im Build sind sie
  nicht enthalten. Die App lädt Bilder relativ (`base: "./"`).
- **Units mit AP „-“** (GCGDB `null`, z. B. GD01-048, EB01-013, 11 Karten) haben AP 0 (auf der Karte gedruckt,
  von Shops bestätigt); `CardPool` setzt fehlende AP/HP bei UNIT/UNIT TOKEN auf 0.
- **Token** = Set `T` (dort gibt es auch ein Base-Token mit Typ BASE ohne Lv./Kosten, T-037), EX Base,
  EX Resource, Resource. `EXB-001`, `EXR-001`, `R-001` haben keinen Druck ALT0; Bild ist dann der erste Druck.
- Link-Bedingungen: Alternativen mit `/`, je `[Pilotname]` (Teil des Namens, 3-2-6-4; Namen können Klammern
  enthalten) oder `(Trait) Trait` (bei einer Karte fehlt „Trait“).

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
