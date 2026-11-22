// Card swaps on a meta list (docs/DECKSEARCH.md, stage 1). Node only (lab tools).
//
// From a base list, neighbours swap one card for another (−1 X, +1 Y). Candidates for Y: cards the
// archetype's real tournament lists play (more often than the base list) and the deck's own cards; for X:
// every card of the list. Neighbours are ranked by how much the real lists support the swap, the best K
// are raced against the field (successive halving, paired with the base), and the winner must beat the
// base on fresh seeds (confirmation) to be taken. Then the next step starts from it.

import type { CardLib } from "../../engine/cardlib";
import { validateDeck } from "../../engine/deck";
import type { DeckList } from "../../engine/types";
import { banlistProblems } from "../../meta/banlist";
import type { MetaDeck } from "../../meta/decks";
import { pairedDiff, type FieldDeck, type Measurer } from "./measure";

export interface Swap {
  remove: string;
  add: string;
  /** Copies swapped (1 or 2; default 1). Two copies change more, so they are easier to measure. */
  n?: number;
}

export interface SwapStep {
  swap: Swap;
  /** Paired difference to the step's base on the search seeds and on the confirmation seeds. */
  search: { diff: number; low: number; high: number; blocks: number };
  confirm: { diff: number; low: number; high: number; blocks: number };
  accepted: boolean;
}

const counts = (deck: DeckList) => {
  const m = new Map<string, number>();
  for (const no of deck.main) m.set(no, (m.get(no) ?? 0) + 1);
  return m;
};

export function applySwap(deck: DeckList, s: Swap): DeckList {
  const main = [...deck.main];
  for (let i = 0; i < (s.n ?? 1); i++) {
    main.splice(main.indexOf(s.remove), 1);
    main.push(s.add);
  }
  return { main: main.sort(), resources: deck.resources };
}

export function legal(lib: CardLib, deck: DeckList): boolean {
  if (validateDeck(lib, deck).length) return false;
  const c: Record<string, number> = {};
  for (const no of deck.main) c[no] = (c[no] ?? 0) + 1;
  return banlistProblems(c, (no) => (lib.has(no) ? lib.get(no) : undefined)).length === 0;
}

/**
 * Swaps supported by the archetype's real lists, best first: an add is worth more if the lists play more
 * copies of it than the base, a removal if they play fewer.
 */
export function rankedSwaps(
  lib: CardLib,
  base: DeckList,
  meta: MetaDeck,
  /** More cards to try (e.g. pearls), with the support they get instead of the real lists' copies. */
  extra: Map<string, number> = new Map(),
  /** Cards that stay (never removed), e.g. the card a deck is built around. */
  keep: ReadonlySet<string> = new Set(),
): Swap[] {
  const have = counts(base);
  const entries = meta.archetype.entries;
  const avg = new Map<string, number>();
  for (const e of entries)
    for (const [no, n] of Object.entries(e.cards)) avg.set(no, (avg.get(no) ?? 0) + n / entries.length);
  for (const [no, support] of extra) if (!avg.has(no)) avg.set(no, (have.get(no) ?? 0) + support);
  const supported = (no: string) => lib.has(no) && lib.get(no).script.status !== "partial";
  const adds = [...avg.keys()].filter((no) => supported(no) && (have.get(no) ?? 0) < 4);
  const scored: { swap: Swap; score: number }[] = [];
  for (const remove of have.keys()) {
    if (keep.has(remove)) continue;
    for (const add of adds) {
      if (add === remove) continue;
      const addGain = (avg.get(add) ?? 0) - (have.get(add) ?? 0);
      const removeGain = (have.get(remove) ?? 0) - (avg.get(remove) ?? 0);
      for (const n of [1, 2]) {
        if ((have.get(remove) ?? 0) < n || (have.get(add) ?? 0) + n > 4) continue;
        const swap = n === 1 ? { remove, add } : { remove, add, n };
        if (!legal(lib, applySwap(base, swap))) continue;
        // A double swap only if the real lists support both copies.
        if (n === 2 && (addGain < 1.5 || removeGain < 1)) continue;
        scored.push({ swap, score: (addGain + removeGain) * (n === 2 ? 1.2 : 1) });
      }
    }
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.swap);
}

export interface SearchOptions {
  /** Neighbours raced per step. */
  neighbours: number;
  /** Blocks per opponent in the first round; doubled each round while halving. */
  firstBlocks: number;
  /** Candidates left at the end of the race (they get the most blocks). */
  finalists: number;
  /** Blocks per opponent to confirm the winner on fresh seeds (doubled while positive but unsure). */
  confirmBlocks: number;
  /** Most blocks per opponent for a confirmation. */
  maxConfirmBlocks?: number;
  steps: number;
  /** More cards to try as adds (pearls), see rankedSwaps. */
  extraAdds?: Map<string, number>;
  /** Cards never removed. */
  keep?: ReadonlySet<string>;
  log?: (text: string) => void;
}

/** One race: the neighbours against the base, halving until the finalists; returns the best. */
async function race(
  measurer: Measurer,
  base: DeckList,
  swaps: Swap[],
  field: FieldDeck[],
  o: SearchOptions,
): Promise<{ swap: Swap; search: SwapStep["search"] } | undefined> {
  let alive = swaps;
  let blocks = o.firstBlocks;
  let best: { swap: Swap; search: SwapStep["search"] } | undefined;
  for (;;) {
    const decks = alive.map((s) => applySwap(base, s));
    const [baseResults, ...results] = await measurer.blocks([base, ...decks], field, blocks);
    const ranked = alive
      .map((swap, i) => ({ swap, search: pairedDiff(results[i]!, baseResults!, field) }))
      .sort((a, b) => b.search.diff - a.search.diff);
    best = ranked[0];
    o.log?.(
      `  Runde mit ${blocks} Blöcken: ${alive.length} Kandidaten, bester ${fmtSwap(best!.swap)} ` +
        `${pct(best!.search.diff)} (${pct(best!.search.low)} … ${pct(best!.search.high)}), ` +
        `${measurer.played} Spiele bisher`,
    );
    if (alive.length <= o.finalists) break;
    alive = ranked.slice(0, Math.max(o.finalists, Math.ceil(alive.length / 2))).map((r) => r.swap);
    blocks *= 2;
  }
  return best;
}

export const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`;
/** Card names for the output (set by the tool; numbers only without). */
let cardName: (no: string) => string = (no) => no;
export function setCardNames(name: (no: string) => string): void {
  cardName = name;
}
export const fmtSwap = (s: Swap) =>
  `−${s.n ?? 1} ${cardName(s.remove)} (${s.remove}) / +${s.n ?? 1} ${cardName(s.add)} (${s.add})`;

/**
 * Hill climbing with swaps. `search` measures on the search seeds, `confirm` on fresh ones; a swap is
 * taken only if its confirmed difference is positive with 95 % (low > 0).
 */
export async function swapSearch(
  lib: CardLib,
  meta: MetaDeck,
  field: FieldDeck[],
  search: Measurer,
  confirm: Measurer,
  o: SearchOptions,
): Promise<{ start: DeckList; final: DeckList; steps: SwapStep[] }> {
  const start = meta.deck;
  let base = start;
  const steps: SwapStep[] = [];
  for (let step = 0; step < o.steps; step++) {
    const swaps = rankedSwaps(lib, base, meta, o.extraAdds, o.keep).slice(0, o.neighbours);
    o.log?.(`Schritt ${step + 1}: ${swaps.length} Tausch-Kandidaten`);
    if (!swaps.length) break;
    const winner = await race(search, base, swaps, field, o);
    if (!winner) break;
    const next = applySwap(base, winner.swap);
    // Sequential: a positive but unsure result gets twice the blocks, up to maxConfirmBlocks.
    let blocks = o.confirmBlocks;
    let confirmed;
    for (;;) {
      const [nextR, baseR] = await confirm.blocks([next, base], field, blocks);
      confirmed = pairedDiff(nextR!, baseR!, field);
      if (confirmed.low > 0 || confirmed.diff <= 0 || blocks * 2 > (o.maxConfirmBlocks ?? 32)) break;
      o.log?.(`  Bestätigung ${pct(confirmed.diff)} noch unsicher, ${blocks * 2} Blöcke …`);
      blocks *= 2;
    }
    const accepted = confirmed.low > 0;
    steps.push({ swap: winner.swap, search: winner.search, confirm: confirmed, accepted });
    o.log?.(
      `  Bestätigung ${fmtSwap(winner.swap)}: ${pct(confirmed.diff)} (${pct(confirmed.low)} … ` +
        `${pct(confirmed.high)}) → ${accepted ? "übernommen" : "nicht übernommen, Ende"}`,
    );
    if (!accepted) break;
    base = next;
  }
  return { start, final: base, steps };
}
