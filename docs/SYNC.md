# Cloud-Synchronisierung

Eigene Decks auf allen Geräten, Decks der anderen ansehen, damit spielen und kopieren (Nutzerwunsch
21./24. Nov. 2026). Nur in der PWA, nicht im Labor (dort liegen Decks auf dem Labor-Server).

## Ablauf

- **Anmeldung:** Kontomenü am rechten Rand der Kopfleiste (`AccountMenu.svelte`; angemeldet: Name mit
  Status-Punkt grün/gelb/rot, Menü mit „Jetzt abgleichen“ und „Abmelden“), darin „Mit Google anmelden“ (Google Identity Services, Skript
  `accounts.google.com/gsi/client` wird erst dort geladen). Google gibt ein ID-Token; der Server prüft Signatur
  (Googles öffentliche Schlüssel, RS256), Aussteller, Client-Id, Ablauf und bestätigte E-Mail
  (`src/sync/google.ts`) und gibt einen eigenen Sitzungsschlüssel zurück (nur dessen SHA-256 liegt in der
  Datenbank, 180 Tage ohne Nutzung gültig). Die App schickt ihn als `Authorization: Bearer …`; Cookies gehen
  nicht, weil App (`github.io`) und Server verschiedene Sites sind.
- **Freischaltung:** nur E-Mail-Adressen aus `SYNC_ALLOWED` (auf dem Server in `/etc/gcg-sync/env`, nicht
  im Repo). Zusätzlich lässt Google im Testmodus nur die eingetragenen Testnutzer zu. Wird eine Adresse von der
  Liste genommen, enden ihre Sitzungen beim nächsten Start bzw. bei der nächsten Anfrage.
- **Rechte:** Jedes Deck gehört einem Konto (Google-Id). Alle Angemeldeten lesen alle Decks; ändern und
  löschen darf nur der Besitzer (Server prüft). Fremde Decks erscheinen im Decks-Reiter unter „Decks von …“
  (nur ansehen, „Kopieren und bearbeiten“, „Gegen die KI spielen“) und im Spiel unter „Decks der anderen“
  (Ids `s:<id>`). Kopien merken sich `copiedFrom`.
- **Abgleich** (`src/app/lib/sync.ts`): Decks werden zuerst lokal (IndexedDB) gespeichert, abgeglichen wird
  beim Start, nach Speichern/Löschen, wenn das Netz zurückkommt und wenn die App wieder sichtbar wird. Die
  letzte Änderung gewinnt (`updatedAt` des Geräts). Gelöschte Decks bleiben auf dem Server als Marker, damit
  andere Geräte sie auch löschen; offline Gelöschtes merkt sich die App (`localStorage` `…sync-deleted`).
  Lokale Decks ohne Besitzer lädt hoch, wer sich auf dem Gerät anmeldet. Meldet sich danach ein anderes Konto
  an, verschwinden die Decks des ersten Kontos lokal (sie bleiben auf dem Server und erscheinen als fremde).
- **Grenzen:** 500 Decks je Konto, 120 Karten je Liste, Kartennummern-Muster, 64 KB je Anfrage,
  20 Anmeldeversuche je Minute und Adresse. CORS nur für `somecoder3.github.io` und lokale Server.

## Schnittstelle (`src/sync/api.ts`)

| Methode | Pfad               |                                                                                   |
| ------- | ------------------ | --------------------------------------------------------------------------------- |
| POST    | `/api/auth/google` | `{credential}` → `{token, user}`                                                  |
| POST    | `/api/auth/logout` | beendet die Sitzung                                                               |
| GET     | `/api/me`          | angemeldetes Konto                                                                |
| GET     | `/api/decks`       | alle Decks aller Konten (mit Löschmarkern)                                        |
| PUT     | `/api/decks/:id`   | eigenes Deck speichern oder löschen (`deleted: true`); Antwort: Stand des Servers |
| GET     | `/api/health`      |                                                                                   |

## Server

IONOS VPS (Ubuntu 26.04, 1 vCPU, ~830 MB RAM), Grundsicherung in `docs/LAB.md`. Adresse und Client-Id stehen
in `src/sync/config.ts`.

- Node 22 und Caddy 2.6 aus den Ubuntu-Paketen (kein Fremd-Repo). `node:sqlite` gibt unter Node 22 eine
  „experimental“-Warnung aus, läuft aber.
- `/opt/gcg-sync/server.mjs`: Bündel aus `npm run sync:build` (esbuild, ~15 KB, keine Abhängigkeiten).
- Dienst `gcg-sync` (`deploy/sync/gcg-sync.service`) als Systembenutzer `gcgsync`, nur 127.0.0.1:8790,
  darf nur `/var/lib/gcg-sync` schreiben, `MemoryMax=200M`.
- Caddy (`deploy/sync/Caddyfile`): HTTPS mit Let's-Encrypt-Zertifikat für den IONOS-Hostnamen, `/api/*` an den
  Dienst, sonst 404.
- Sicherung: `gcg-sync-backup.timer` täglich 03:30 UTC, `sqlite3 .backup` nach `/var/lib/gcg-sync/backup/`,
  die letzten 14 bleiben. Liegt auf demselben Server (schützt vor Fehlbedienung, nicht vor Verlust des Servers).

### Neue Version einspielen

```sh
npm run sync:build
scp build/sync/server.mjs gcg@<host>:/home/gcg/
ssh gcg@<host> 'sudo install -m 644 server.mjs /opt/gcg-sync/ && rm server.mjs && sudo systemctl restart gcg-sync'
```

### Konten freischalten

`/etc/gcg-sync/env` (Besitzer root, Gruppe gcgsync, 640): `SYNC_ALLOWED=a@gmail.com,b@gmail.com`, danach
`sudo systemctl restart gcg-sync`. Neue Nutzer auch bei Google als Testnutzer eintragen (Google Auth Platform →
Zielgruppe), solange die App im Testmodus ist.

### Lokal entwickeln

`SYNC_ALLOWED=… npm run sync` startet den Server auf 127.0.0.1:8790 (Datenbank `data-sync/`, nicht im Repo).
Die App nimmt einen anderen Server, wenn `localStorage["gcg-battle-simulator.sync-origin"]` gesetzt ist
(JSON-String, z. B. `"http://localhost:8790"`). Bei Google sind als JavaScript-Quellen
`https://somecoder3.github.io`, `http://localhost`, `:5173`, `:4173` und `:5180` (Labor) eingetragen; im Labor
ist der Abgleich aber aus.

## Später

Mehrspieler über WebSockets auf demselben Server (Caddy leitet sie durch). Sicherung außerhalb des Servers.
