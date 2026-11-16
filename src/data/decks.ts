// Fixed deck lists. Starter decks from the published lists (coolstuffinc.com, 17 Jul 2025); ST01 sums
// to 51 there, so Guntank (ST01-004) is counted 3× like the third Unit of the other starters.

import { DEFAULT_RESOURCE, RESOURCE_DECK_SIZE } from "../engine/deck";
import type { DeckList } from "../engine/types";

export interface NamedDeck {
  id: string;
  name: string;
  colors: string;
  deck: DeckList;
}

function list(counts: Record<string, number>): DeckList {
  const main = Object.entries(counts).flatMap(([no, n]) => Array<string>(n).fill(no));
  return { main, resources: Array<string>(RESOURCE_DECK_SIZE).fill(DEFAULT_RESOURCE) };
}

const starter = (set: string, counts: number[]) =>
  Object.fromEntries(counts.map((n, i) => [`${set}-${String(i + 1).padStart(3, "0")}`, n]));

// Counts for card numbers 001–016 of each starter deck.
export const STARTER_DECKS: NamedDeck[] = [
  {
    id: "ST01",
    name: "Heroic Beginnings",
    colors: "Blue/White",
    deck: list(starter("ST01", [2, 4, 4, 3, 3, 2, 4, 3, 3, 4, 4, 3, 3, 2, 3, 3])),
  },
  {
    id: "ST02",
    name: "Wings of Advance",
    colors: "Green/Blue",
    deck: list(starter("ST02", [2, 4, 4, 3, 3, 2, 4, 3, 3, 4, 4, 3, 3, 2, 3, 3])),
  },
  {
    id: "ST03",
    name: "Zeon's Rush",
    colors: "Red/Green",
    deck: list(starter("ST03", [2, 4, 4, 3, 3, 2, 3, 4, 3, 4, 4, 3, 3, 2, 3, 3])),
  },
  {
    id: "ST04",
    name: "SEED Strike",
    colors: "White/Red",
    deck: list(starter("ST04", [2, 4, 4, 3, 3, 2, 4, 3, 3, 4, 4, 3, 3, 2, 3, 3])),
  },
];
