// Deck construction rules (6-1) and random legal decks for tests and fuzzing.

import type { CardLib, EngineCard } from "./cardlib";
import { nextInt, pick, type RngState } from "./rng";
import type { DeckList } from "./types";

export const DECK_SIZE = 50;
export const RESOURCE_DECK_SIZE = 10;
export const MAX_COPIES = 4;
export const DEFAULT_RESOURCE = "R-001";

const MAIN_TYPES = new Set(["UNIT", "PILOT", "COMMAND", "BASE"]);

export function validateDeck(lib: CardLib, deck: DeckList): string[] {
  const errors: string[] = [];
  if (deck.main.length !== DECK_SIZE) errors.push(`deck has ${deck.main.length} cards, needs ${DECK_SIZE}`);
  if (deck.resources.length !== RESOURCE_DECK_SIZE) {
    errors.push(`resource deck has ${deck.resources.length} cards, needs ${RESOURCE_DECK_SIZE}`);
  }
  const counts = new Map<string, number>();
  const colors = new Set<string>();
  for (const no of deck.main) {
    if (!lib.has(no)) {
      errors.push(`unknown card ${no}`);
      continue;
    }
    const card = lib.get(no);
    if (!MAIN_TYPES.has(card.type) || card.token) errors.push(`${no} (${card.type}) cannot be in the deck`);
    if (card.color) colors.add(card.color);
    counts.set(no, (counts.get(no) ?? 0) + 1);
  }
  for (const [no, n] of counts)
    if (n > MAX_COPIES) errors.push(`${n} copies of ${no}, at most ${MAX_COPIES}`);
  if (colors.size > 2) errors.push(`deck has ${colors.size} colors (${[...colors].join(", ")}), at most 2`);
  for (const no of deck.resources) {
    if (!lib.has(no) || lib.get(no).type !== "RESOURCE") errors.push(`${no} is not a Resource card`);
  }
  return errors;
}

/** A random legal deck of one or two colors; mostly Units, as a real deck would be. */
export function randomDeck(lib: CardLib, rng: RngState): DeckList {
  const pool = [...lib.all()].filter((c) => MAIN_TYPES.has(c.type) && !c.token && c.color);
  const colors = [...new Set(pool.map((c) => c.color!))].sort();
  const chosen = new Set([pick(rng, colors)]);
  if (nextInt(rng, 4) > 0) chosen.add(pick(rng, colors));
  const candidates = pool.filter((c) => chosen.has(c.color!));
  const byType = (type: string) => candidates.filter((c) => c.type === type);
  const want: [EngineCard[], number][] = [
    [byType("UNIT"), 30],
    [byType("PILOT"), 10],
    [byType("COMMAND"), 6],
    [byType("BASE"), 4],
  ];
  const counts = new Map<string, number>();
  const main: string[] = [];
  const add = (list: EngineCard[]) => {
    for (let tries = 0; tries < 200; tries++) {
      const card = pick(rng, list);
      if ((counts.get(card.no) ?? 0) < MAX_COPIES) {
        counts.set(card.no, (counts.get(card.no) ?? 0) + 1);
        main.push(card.no);
        return true;
      }
    }
    return false;
  };
  for (const [list, n] of want) for (let i = 0; i < n && list.length; i++) add(list);
  while (main.length < DECK_SIZE) if (!add(candidates)) break;
  return { main, resources: Array<string>(RESOURCE_DECK_SIZE).fill(DEFAULT_RESOURCE) };
}
