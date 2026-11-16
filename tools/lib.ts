import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CardPool } from "../src/data/cards";
import type { RawCardsDoc } from "../src/data/types";
import { CardLib } from "../src/engine/cardlib";

export const ROOT = resolve(import.meta.dirname, "..");

export function loadPool(): CardPool {
  const doc = JSON.parse(readFileSync(resolve(ROOT, "gcgdb/data/cards.json"), "utf8")) as RawCardsDoc;
  return new CardPool(doc);
}

export function loadLib(): CardLib {
  return CardLib.fromPool(loadPool());
}
