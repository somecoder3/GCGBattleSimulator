// Prepares the official card images for local use (never committed, never bundled):
//   build/images/full/<file>.webp   original 600x837 from gundam-gcg.com
//   build/images/small/<file>.webp  240 px wide for the board and lists
//
//   npm run images                      take images from GCGScanner's cache (default) and build sizes
//   npm run images -- --source <dir>    take them from another folder
//   npm run images -- --download        fetch images missing in the source from gundam-gcg.com (slowly)
//   npm run images -- --force           rebuild the small size even if it exists

import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import type { RawCardsDoc } from "../src/data/types";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "build/images");
const OFFICIAL = "https://www.gundam-gcg.com/en/images/cards/card/";
const SMALL_WIDTH = 240;
const DOWNLOAD_DELAY_MS = 400;

const { values: args } = parseArgs({
  options: {
    source: { type: "string", default: resolve(ROOT, "../GCGScanner/build/carddb-cache/images") },
    download: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newer(a: string, b: string): Promise<boolean> {
  if (!existsSync(b)) return true;
  return (await stat(a)).mtimeMs > (await stat(b)).mtimeMs;
}

async function main() {
  const doc = JSON.parse(await readFile(resolve(ROOT, "gcgdb/data/cards.json"), "utf8")) as RawCardsDoc;
  const files = [...new Set(doc.variants.map((v) => v.image))].sort();
  await mkdir(resolve(OUT, "full"), { recursive: true });
  await mkdir(resolve(OUT, "small"), { recursive: true });

  const missing: string[] = [];
  let copied = 0;
  for (const file of files) {
    const src = resolve(args.source!, file);
    const full = resolve(OUT, "full", file);
    if (existsSync(src)) {
      if (await newer(src, full)) {
        await copyFile(src, full);
        copied++;
      }
    } else if (!existsSync(full)) {
      missing.push(file);
    }
  }
  console.log(`${files.length} images, ${copied} copied from ${args.source}, ${missing.length} missing`);

  if (missing.length && args.download) {
    console.log(`downloading ${missing.length} images from ${OFFICIAL} …`);
    for (const [i, file] of missing.entries()) {
      const response = await fetch(OFFICIAL + file, { headers: { "User-Agent": "gcg-battle-simulator" } });
      if (response.ok) {
        await writeFile(resolve(OUT, "full", file), Buffer.from(await response.arrayBuffer()));
      } else {
        console.warn(`  ${file}: HTTP ${response.status}`);
      }
      if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${missing.length}`);
      await sleep(DOWNLOAD_DELAY_MS);
    }
  } else if (missing.length) {
    console.log(`  first missing: ${missing.slice(0, 5).join(", ")} (use --download to fetch them)`);
  }

  let resized = 0;
  const queue = files.filter((f) => existsSync(resolve(OUT, "full", f)));
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const full = resolve(OUT, "full", file);
      const small = resolve(OUT, "small", file);
      if (!args.force && !(await newer(full, small))) continue;
      await sharp(full).resize({ width: SMALL_WIDTH }).webp({ quality: 82, alphaQuality: 90 }).toFile(small);
      resized++;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`${resized} small images written to ${resolve(OUT, "small")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
