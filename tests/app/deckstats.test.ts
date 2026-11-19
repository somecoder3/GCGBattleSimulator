// Deck statistics of the deck builder (src/app/lib/deckstats.ts) on ST01 with the real card data.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deckStats, handOdds, hitChance, missChance, type DeckEntry } from "../../src/app/lib/deckstats";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib, satisfiesLink } from "../../src/engine/cardlib";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const pool = new CardPool(doc);
const lib = new CardLib(pool.cards);
const links = (u: { no: string }, p: { no: string }) => satisfiesLink(lib.get(u.no), lib.get(p.no));

const st01: DeckEntry[] = (() => {
  const counts = new Map<string, number>();
  for (const no of STARTER_DECKS[0]!.deck.main) counts.set(no, (counts.get(no) ?? 0) + 1);
  return [...counts].map(([no, n]) => ({ card: pool.get(no)!, n }));
})();
const columns = (h: { buckets: { label: string; count: number }[] }) =>
  Object.fromEntries(h.buckets.filter((b) => b.count).map((b) => [b.label, b.count]));

describe("deck stats", () => {
  it("counts ST01 like ExBurst's deck page", () => {
    const s = deckStats(st01, links);
    expect(s.total).toBe(50);
    // Values from exburst.dev/gundam/starter-decks/st01 (19 Nov 2026).
    expect(columns(s.curve.cost)).toEqual({ 1: 25, 2: 17, 3: 6, 4: 2 });
    expect(columns(s.curve.level)).toEqual({ 1: 3, 2: 12, 3: 15, 4: 14, 5: 6 });
    expect(columns(s.units.cost)).toEqual({ 1: 6, 2: 14, 3: 6, 4: 2 });
    expect(columns(s.units.level)).toEqual({ 1: 3, 2: 6, 3: 7, 4: 6, 5: 6 });
    expect(s.colors).toEqual([
      { value: "Blue", count: 29 },
      { value: "White", count: 21 },
    ]);
    expect(s.types.map((t) => t.count)).toEqual([28, 8, 8, 6]);
    expect(s.traits.slice(0, 3)).toEqual([
      { value: "Earth Federation", count: 29 },
      { value: "White Base Team", count: 26 },
      { value: "Academy", count: 19 },
    ]);
    expect(s.links[0]!.count).toBe(6);
    expect(s.keywords).toContainEqual({ value: "Burst", count: 16 });
    expect(s.curve.cost.mean).toBeCloseTo(1.7, 1);
    // Gundam (ST01-001) links Amuro Ray (ST01-010).
    const gundam = s.linkPairs.find((p) => p.unit.card.no === "ST01-001")!;
    expect(gundam.pilots.map((p) => p.card.no)).toEqual(["ST01-010"]);
    expect(s.lonelyPilots).toEqual([]);
  });
});

describe("opening hand odds", () => {
  it("hypergeometric, with the redraw from the other cards", () => {
    expect(missChance(50, 6, 5)).toBeCloseTo((44 * 43 * 42 * 41 * 40) / (50 * 49 * 48 * 47 * 46), 12);
    expect(missChance(50, 0, 5)).toBe(1);
    expect(missChance(10, 8, 5)).toBe(0);
    const { keep, redraw } = hitChance(50, 6, 1);
    expect(keep).toBeCloseTo(1 - missChance(50, 6, 6), 12);
    expect(redraw).toBeGreaterThan(keep);
  });

  it("matches a simulation of shuffle, redraw (hand to the bottom, draw 5, shuffle) and draws", () => {
    // 6 hits in 50 cards, 2 draws.
    // mulberry32
    let seed = 7;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const shuffle = (a: number[]) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    };
    let keep = 0;
    let redraw = 0;
    const N = 40_000;
    for (let t = 0; t < N; t++) {
      let deck = shuffle(Array.from({ length: 50 }, (_, i) => (i < 6 ? 1 : 0)));
      const hit = (cards: number[]) => cards.some((c) => c === 1);
      keep += hit(deck.slice(0, 7)) ? 1 : 0;
      if (hit(deck.slice(0, 5))) redraw++;
      else {
        const hand = deck.slice(0, 5);
        deck = [...deck.slice(5), ...hand];
        const second = deck.slice(0, 5);
        deck = shuffle(deck.slice(5));
        redraw += hit([...second, ...deck.slice(0, 2)]) ? 1 : 0;
      }
    }
    const exact = hitChance(50, 6, 2);
    expect(keep / N).toBeCloseTo(exact.keep, 2);
    expect(redraw / N).toBeCloseTo(exact.redraw, 2);
  });

  it("one more level on the draw (EX Resource)", () => {
    const play = handOdds(st01, false);
    const draw = handOdds(st01, true);
    expect(play.map((o) => o.level)).toEqual([1, 2, 3, 4]);
    expect(draw.map((o) => o.level)).toEqual([2, 3, 4, 5]);
    // ST01 has 3 Units with Lv. 1 and cost 1 (Demi Trainer): 6 cards seen in turn 1.
    expect(play[0]!.unit.keep).toBeCloseTo(1 - missChance(50, 3, 6), 12);
    expect(draw[0]!.unit.keep).toBeGreaterThan(play[0]!.unit.keep);
    for (const o of [...play, ...draw]) expect(o.any.keep).toBeGreaterThanOrEqual(o.unit.keep);
  });
});
