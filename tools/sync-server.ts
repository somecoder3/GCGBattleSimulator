// The cloud sync server (docs/SYNC.md). Locally: `npm run sync` (http://127.0.0.1:8790); on the server
// the bundle from `npm run sync:build` runs as a systemd service behind Caddy.
//
// Environment: SYNC_ALLOWED  e-mail addresses that may sign in, comma separated (required)
//              SYNC_DB       SQLite file (default data-sync/sync.db)
//              SYNC_PORT     port on 127.0.0.1 (default 8790)

import { createServer } from "node:http";
import { createSyncHandler } from "../src/sync/api";
import { GOOGLE_CLIENT_ID, SYNC_PORT } from "../src/sync/config";
import { googleKeys } from "../src/sync/google";
import { SyncStore } from "../src/sync/store";

const allowed = new Set(
  (process.env.SYNC_ALLOWED ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);
if (!allowed.size) console.warn("SYNC_ALLOWED ist leer: niemand kann sich anmelden.");
const port = Number(process.env.SYNC_PORT ?? SYNC_PORT);
const store = new SyncStore(process.env.SYNC_DB ?? "data-sync/sync.db");
const dropped = store.dropSessionsExcept(allowed);
if (dropped) console.log(`${dropped} Sitzungen nicht mehr freigeschalteter Konten beendet.`);

const handle = createSyncHandler({ store, clientId: GOOGLE_CLIENT_ID, allowed, keys: googleKeys() });
const server = createServer(handle);
server.listen(port, "127.0.0.1", () => {
  console.log(`Sync-Server auf http://127.0.0.1:${port} (${allowed.size} Konten freigeschaltet)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close();
    store.close();
    process.exit(0);
  });
