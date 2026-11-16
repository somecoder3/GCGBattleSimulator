import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CardPool } from "../src/data/cards";
import type { RawCardsDoc } from "../src/data/types";
import { CardLib } from "../src/engine/cardlib";
import type { MetaSnapshot } from "../src/meta/types";

export const ROOT = resolve(import.meta.dirname, "..");

export function loadPool(): CardPool {
  const doc = JSON.parse(readFileSync(resolve(ROOT, "gcgdb/data/cards.json"), "utf8")) as RawCardsDoc;
  return new CardPool(doc);
}

export function loadLib(): CardLib {
  return CardLib.fromPool(loadPool());
}

/** The newest meta snapshot in data/meta. */
export function loadSnapshot(): MetaSnapshot {
  const dir = resolve(ROOT, "data/meta");
  const newest = readdirSync(dir)
    .filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f))
    .sort()
    .at(-1);
  if (!newest) throw new Error("no meta snapshot in data/meta (npm run meta)");
  return JSON.parse(readFileSync(resolve(dir, newest), "utf8")) as MetaSnapshot;
}
