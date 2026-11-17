// Banned/Restricted list of the official site, as of 25 Sep 2026
// (https://www.gundam-gcg.com/en/news/01_279.html, checked 16 Nov 2026). Update by hand when it changes.

import { STARTER_DECKS } from "../data/decks";
import type { EngineCard } from "../engine/cardlib";

export const BANLIST_DATE = "2026-09-25";

/** No copies allowed. */
export const BANNED = ["GD01-020"];

/** Maximum number of copies. */
export const RESTRICTED: Record<string, number> = { "ST02-016": 2 };

/** Cards of `a` and `b` can't be in the same deck. */
export const BANNED_PAIRS: { a: string[]; b: string[] }[] = [
  { a: ["ST01-010"], b: ["ST05-010"] },
  // Guntank and M1 Astray Shrike have the same effect (Lv.2, cost 1, 1 damage to a rested enemy Unit).
  { a: ["GD01-008"], b: ["GD05-015"] },
];

/**
 * The cards the official list names for "a Unit card that is Lv.2 with cost 1, 2 AP, and 2 HP, and without
 * effects". Every two different such cards are a banned pair, so a deck may play one of them (up to 4
 * copies). The rule covers every card that fits the description (isVanillaTwoTwo), not only these.
 *
 * Until 17 Nov 2026 this list was wrongly paired with Guntank; 13 real lists (among them the winner of
 * a 208-player official regional) play Guntank with one of these, none plays two of them.
 */
export const VANILLA_TWO_TWO = [
  "GD01-035",
  "GD01-060",
  "GD01-085",
  "GD02-013",
  "GD02-080",
  "GD03-032",
  "GD03-063",
  "GD04-078",
  "GD05-014",
  "GD05-027",
  "GD05-042",
  "GD05-062",
  "GD05-077",
  "ST01-005",
  "ST04-008",
  "ST05-004",
  "ST05-009",
  "ST06-004",
  "ST09-005",
  "ST10-005",
  "ST11-008",
  "ST12-010",
];

/** "A Unit card that is Lv.2 with cost 1, 2 AP, and 2 HP, and without effects" (see VANILLA_TWO_TWO). */
export function isVanillaTwoTwo(card: EngineCard): boolean {
  return (
    card.type === "UNIT" &&
    card.level === 2 &&
    card.cost === 1 &&
    card.ap === 2 &&
    card.hp === 2 &&
    !card.text.trim()
  );
}

/** Is the deck exactly one of the starter decks as sold (no card added, removed or swapped)? */
export function isUnchangedStarter(counts: Record<string, number>): boolean {
  const own = Object.entries(counts).filter(([, n]) => n > 0);
  return STARTER_DECKS.some((d) => {
    const starter: Record<string, number> = {};
    for (const no of d.deck.main) starter[no] = (starter[no] ?? 0) + 1;
    const entries = Object.entries(starter);
    return entries.length === own.length && entries.every(([no, n]) => counts[no] === n);
  });
}

/**
 * Problems of a deck (card number → count) with the list; empty = legal. Starter decks in their unchanged
 * form stay legal despite the list (e.g. ST02 with 3× ST02-016, ST05 with two vanilla 2/2 Units).
 */
export function banlistProblems(
  counts: Record<string, number>,
  get: (no: string) => EngineCard | undefined,
): string[] {
  if (isUnchangedStarter(counts)) return [];
  const problems: string[] = [];
  for (const no of BANNED) if (counts[no]) problems.push(`${no} ist verboten`);
  for (const [no, max] of Object.entries(RESTRICTED)) {
    if ((counts[no] ?? 0) > max) problems.push(`${no} höchstens ${max}×`);
  }
  for (const pair of BANNED_PAIRS) {
    const a = pair.a.filter((no) => counts[no]);
    const b = pair.b.filter((no) => counts[no]);
    if (a.length && b.length) problems.push(`${a.join(", ")} nicht zusammen mit ${b.join(", ")}`);
  }
  const vanilla = Object.keys(counts).filter((no) => {
    const card = get(no);
    return counts[no]! > 0 && card !== undefined && isVanillaTwoTwo(card);
  });
  if (vanilla.length > 1) {
    problems.push(`${vanilla.join(", ")}: nur eine Sorte Unit Lv.2/Kosten 1/2 AP/2 HP ohne Effekt erlaubt`);
  }
  return problems;
}
