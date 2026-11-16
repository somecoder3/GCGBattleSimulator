// Banned/Restricted list of the official site, as of 25 Sep 2026
// (https://www.gundam-gcg.com/en/news/01_279.html, checked 16 Nov 2026). Update by hand when it changes.

import type { EngineCard } from "../engine/cardlib";

export const BANLIST_DATE = "2026-09-25";

/** No copies allowed. */
export const BANNED = ["GD01-020"];

/** Maximum number of copies. */
export const RESTRICTED: Record<string, number> = { "ST02-016": 2 };

/** Cards of `a` and `b` can't be in the same deck. */
export const BANNED_PAIRS: { a: string[]; b: string[] }[] = [
  { a: ["ST01-010"], b: ["ST05-010"] },
  {
    a: ["GD01-008"],
    b: [
      "GD05-015",
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
    ],
  },
];

/**
 * "A Unit card that is Lv.2 with cost 1, 2 AP, and 2 HP, and without effects": such cards are part of the
 * Guntank pair, and at most four of them in total may be in a deck.
 */
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

/** Problems of a deck (card number → count) with the list; empty = legal. */
export function banlistProblems(
  counts: Record<string, number>,
  get: (no: string) => EngineCard | undefined,
): string[] {
  const problems: string[] = [];
  for (const no of BANNED) if (counts[no]) problems.push(`${no} ist verboten`);
  for (const [no, max] of Object.entries(RESTRICTED)) {
    if ((counts[no] ?? 0) > max) problems.push(`${no} höchstens ${max}×`);
  }
  const vanilla = Object.keys(counts).filter((no) => {
    const card = get(no);
    return card !== undefined && isVanillaTwoTwo(card);
  });
  for (const pair of BANNED_PAIRS) {
    const a = pair.a.filter((no) => counts[no]);
    const bList = pair.a.includes("GD01-008") ? [...new Set([...pair.b, ...vanilla])] : pair.b;
    const b = bList.filter((no) => counts[no]);
    if (a.length && b.length) problems.push(`${a.join(", ")} nicht zusammen mit ${b.join(", ")}`);
  }
  const vanillaTotal = vanilla.reduce((n, no) => n + counts[no]!, 0);
  if (vanillaTotal > 4)
    problems.push(`${vanillaTotal} Units Lv.2/Kosten 1/2 AP/2 HP ohne Effekt, höchstens 4`);
  return problems;
}
