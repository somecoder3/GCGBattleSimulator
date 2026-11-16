import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RandomPolicy } from "../../src/ai/random";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { cloneState } from "../../src/engine/clone";
import { randomDeck } from "../../src/engine/deck";
import { Engine } from "../../src/engine/engine";
import { hashState } from "../../src/engine/hash";
import { seedRng } from "../../src/engine/rng";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));

describe("cloneState", () => {
  it("equals structuredClone and is independent of the original in every step of random games", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = seedRng(seed);
      const { state } = engine.newGame([randomDeck(engine.lib, rng), randomDeck(engine.lib, rng)], { seed });
      const policy = new RandomPolicy(seed);
      while (state.pending) {
        const copy = cloneState(state);
        expect(copy).toEqual(structuredClone(state));
        const action = policy.choose(state, state.pending);
        const before = hashState(state);
        engine.apply(copy, action); // changing the copy leaves the original alone
        expect(hashState(state)).toBe(before);
        engine.apply(state, action);
        expect(hashState(copy)).toBe(hashState(state));
      }
    }
  });
});
