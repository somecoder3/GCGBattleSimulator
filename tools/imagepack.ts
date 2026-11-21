// Encrypts the card images for the app build (src/data/imagecrypt.ts): one file per image in original
// size (600 px, as from gundam-gcg.com), public/cards/<name>.bin, from build/images/full. The browser scales
// them down where they are shown small (user's decision, 21 Nov 2026: one variant, ~129 MB in all).
// Needs `npm run images` first. Unchanged images give byte-identical files (IV from the content), so only
// new or changed images show up in git. Files of images that are no longer in GCGDB are removed.
//
//   npm run images:pack            write what changed
//   npm run images:pack -- --check only report what would change

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { encryptImage, encryptedPath } from "../src/data/imagecrypt";
import type { RawCardsDoc } from "../src/data/types";
import { ROOT } from "./lib";

const SOURCE = resolve(ROOT, "build/images/full");
const OUT = resolve(ROOT, "public/cards");
const check = process.argv.includes("--check");

async function main() {
  const doc = JSON.parse(await readFile(resolve(ROOT, "gcgdb/data/cards.json"), "utf8")) as RawCardsDoc;
  const files = [...new Set(doc.variants.map((v) => v.image))].sort();
  const stats = { written: 0, same: 0, missing: 0, removed: 0, bytes: 0 };
  {
    const dir = OUT;
    await mkdir(dir, { recursive: true });
    const wanted = new Set(files.map((f) => encryptedPath(f)));
    const queue = [...files];
    await Promise.all(
      Array.from({ length: availableParallelism() }, async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          const path = resolve(SOURCE, file);
          const bytes = existsSync(path) ? new Uint8Array(await readFile(path)) : undefined;
          if (!bytes) {
            stats.missing++;
            continue;
          }
          const encrypted = await encryptImage(bytes);
          stats.bytes += encrypted.length;
          const target = resolve(dir, encryptedPath(file));
          const old = existsSync(target) ? await readFile(target) : undefined;
          if (old && Buffer.compare(old, encrypted) === 0) {
            stats.same++;
            continue;
          }
          stats.written++;
          if (!check) await writeFile(target, encrypted);
        }
      }),
    );
    for (const name of await readdir(dir)) {
      if (wanted.has(name)) continue;
      stats.removed++;
      if (!check) await rm(resolve(dir, name));
    }
  }
  const mb = (stats.bytes / 1e6).toFixed(0);
  console.log(
    `${check ? "Prüfung: " : ""}${stats.written} ${check ? "zu schreiben" : "geschrieben"}, ${stats.same} unverändert, ` +
      `${stats.removed} ${check ? "zu entfernen" : "entfernt"}, ${stats.missing} fehlen in build/images; ${mb} MB gesamt`,
  );
  if (stats.missing) console.log("Fehlende Bilder: erst `npm run images` (ggf. mit --download).");
}

await main();
