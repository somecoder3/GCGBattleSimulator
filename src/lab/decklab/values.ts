// Card values in a deck (docs/DECKSEARCH.md stage 2): many slightly changed lists of a base deck are measured
// against the field (paired with the base), and a ridge regression estimates what one more copy of each card
// is worth (win rate against the field per copy). Node only (lab tools).

import type { CardLib } from "../../engine/cardlib";
import { nextInt, seedRng } from "../../engine/rng";
import type { DeckList } from "../../engine/types";
import { pairedDiff, type FieldDeck, type Measurer } from "./measure";
import { applySwap, type Swap } from "./swaps";

export interface CardValue {
  no: string;
  /** Estimated change of the win rate against the field per extra copy (± standard error). */
  value: number;
  se: number;
  /** Variants in which the count of this card differed from the base. */
  variants: number;
}

const counts = (deck: DeckList) => {
  const m = new Map<string, number>();
  for (const no of deck.main) m.set(no, (m.get(no) ?? 0) + 1);
  return m;
};

/** Solves A x = b (A symmetric positive definite, small) by Gaussian elimination; also returns A⁻¹. */
function solve(a: number[][], b: number[]): { x: number[]; inv: number[][] } {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    const d = m[c]![c]! || 1e-12;
    for (let j = c; j < m[c]!.length; j++) m[c]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      if (f) for (let j = c; j < m[r]!.length; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return { x: m.map((row) => row[n]!), inv: m.map((row) => row.slice(n + 1)) };
}

/** Ridge regression y ≈ X β (no intercept: the base list is the zero point), with standard errors. */
export function ridge(x: number[][], y: number[], lambda: number): { beta: number[]; se: number[] } {
  const p = x[0]?.length ?? 0;
  const xtx = Array.from({ length: p }, (_, i) =>
    Array.from(
      { length: p },
      (_, j) => x.reduce((s, row) => s + row[i]! * row[j]!, 0) + (i === j ? lambda : 0),
    ),
  );
  const xty = Array.from({ length: p }, (_, i) => x.reduce((s, row, k) => s + row[i]! * y[k]!, 0));
  const { x: beta, inv } = solve(xtx, xty);
  const rss = y.reduce((s, yi, k) => s + (yi - x[k]!.reduce((t, v, i) => t + v * beta[i]!, 0)) ** 2, 0);
  const sigma2 = rss / Math.max(1, y.length - p);
  return { beta, se: inv.map((row, i) => Math.sqrt(Math.max(0, sigma2 * row[i]!))) };
}

/**
 * Random variants of the base (each `swapsPer` swaps from `pool`, legal ones only), measured paired against
 * the base; then the regression. `pool` are swaps a variant may use (e.g. rankedSwaps + pearls).
 */
export async function cardValues(
  lib: CardLib,
  base: DeckList,
  pool: Swap[],
  field: FieldDeck[],
  measurer: Measurer,
  o: {
    variants: number;
    swapsPer: number;
    blocks: number;
    seed: number;
    legal: (d: DeckList) => boolean;
    log?: (t: string) => void;
  },
): Promise<CardValue[]> {
  const rng = seedRng(o.seed);
  const variants: DeckList[] = [];
  for (let tries = 0; variants.length < o.variants && tries < o.variants * 50; tries++) {
    let deck = base;
    for (let k = 0; k < o.swapsPer; k++) {
      const s = pool[nextInt(rng, pool.length)]!;
      if (!deck.main.includes(s.remove)) continue;
      const next = applySwap(deck, { remove: s.remove, add: s.add });
      if (o.legal(next)) deck = next;
    }
    if (deck !== base) variants.push(deck);
  }
  o.log?.(`${variants.length} Varianten, je ${o.blocks} Blöcke gegen ${field.length} Gegner …`);
  const [baseR, ...results] = await measurer.blocks([base, ...variants], field, o.blocks);
  const have = counts(base);
  const cardsTouched = [
    ...new Set(
      variants.flatMap((v) =>
        [...counts(v).keys(), ...have.keys()].filter(
          (no) => (counts(v).get(no) ?? 0) !== (have.get(no) ?? 0),
        ),
      ),
    ),
  ].sort();
  const x = variants.map((v) => {
    const c = counts(v);
    return cardsTouched.map((no) => (c.get(no) ?? 0) - (have.get(no) ?? 0));
  });
  const y = results.map((r) => pairedDiff(r, baseR!, field).diff);
  const { beta, se } = ridge(x, y, 0.5);
  return cardsTouched
    .map((no, i) => ({ no, value: beta[i]!, se: se[i]!, variants: x.filter((row) => row[i] !== 0).length }))
    .sort((a, b) => b.value - a.value);
}
