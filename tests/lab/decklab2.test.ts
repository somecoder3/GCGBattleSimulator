// Deck lab stages 2 and 3: regression for card values, pearls, decks around seeds, niches.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { validateDeck } from "../../src/engine/deck";
import { buildAround, cardScores, composition, nicheOf, seeds } from "../../src/lab/decklab/evolve";
import { pearls } from "../../src/lab/decklab/pearls";
import { legal } from "../../src/lab/decklab/swaps";
import { ridge } from "../../src/lab/decklab/values";
import type { MetaSnapshot } from "../../src/meta/types";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const lib = CardLib.fromPool(new CardPool(doc));
const snapshot = JSON.parse(
  readFileSync(new URL("../../data/meta/2026-11-21.json", import.meta.url), "utf8"),
) as MetaSnapshot;

describe("deck lab stage 2", () => {
  it("finds known coefficients with the ridge regression", () => {
    const x = [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 0],
      [0, 2],
      [1, -1],
    ];
    const y = x.map(([a, b]) => 0.03 * a! - 0.02 * b!);
    const { beta } = ridge(x, y, 1e-9);
    expect(beta[0]).toBeCloseTo(0.03, 6);
    expect(beta[1]).toBeCloseTo(-0.02, 6);
  });

  it("ranks pearls of a deck's colors, rarely played first", () => {
    const list = pearls(lib, snapshot, ["White", "Red"]);
    expect(list.length).toBeGreaterThan(50);
    expect(list.every((p) => p.color === null || ["White", "Red"].includes(p.color))).toBe(true);
    expect(list[0]!.score).toBeGreaterThanOrEqual(list[1]!.score);
  });
});

describe("deck lab stage 3", () => {
  it("builds a legal 50-card deck around a seed and names its niche", () => {
    const colors = ["White", "Red"];
    const seed = seeds(lib, colors)[0]!;
    const deck = buildAround(lib, seed.cards, colors, cardScores(lib, snapshot), composition(snapshot, lib));
    expect(deck).toBeDefined();
    expect(validateDeck(lib, deck!)).toEqual([]);
    expect(legal(lib, deck!)).toBe(true);
    expect(deck!.main.filter((no) => no === seed.source)).toHaveLength(4);
    expect(seed.cards.filter((no) => deck!.main.includes(no)).length).toBeGreaterThanOrEqual(3);
    expect(nicheOf(lib, deck!)).toMatch(/^(Red\/White|Red|White) · (früh|mittel|spät) · (Units|Effekte)$/);
  });
});
