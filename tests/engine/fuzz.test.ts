// Whole games with random decks from the real card pool and random play: invariants after every step,
// exact replays, and serializable states. `npm run fuzz` runs the same with 100 000 games.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RandomPolicy } from "../../src/ai/random";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { randomDeck } from "../../src/engine/deck";
import { Engine } from "../../src/engine/engine";
import { hashState } from "../../src/engine/hash";
import { checkInvariants } from "../../src/engine/invariants";
import { seedRng } from "../../src/engine/rng";
import type { DeckList } from "../../src/engine/types";
import { playMatch, replay } from "../../src/sim/match";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const lib = CardLib.fromPool(new CardPool(doc));
const engine = new Engine(lib);

function game(seed: number, check = false) {
  const rng = seedRng(seed);
  const decks: [DeckList, DeckList] = [randomDeck(lib, rng), randomDeck(lib, rng)];
  const options = { seed, firstPlayer: (seed % 2) as 0 | 1 };
  return playMatch(engine, decks, options, [new RandomPolicy(seed), new RandomPolicy(seed + 1)], {
    onStep: check
      ? (state) => {
          const errors = checkInvariants(engine, state, [60, 60]);
          if (errors.length) throw new Error(`seed ${seed}: ${errors.join("; ")}`);
        }
      : undefined,
  });
}

describe("fuzz", () => {
  it("keeps all invariants in 1000 random games", () => {
    let damageWins = 0;
    for (let seed = 1; seed <= 1000; seed++) if (game(seed, true).result.reason === "damage") damageWins++;
    expect(damageWins).toBeGreaterThan(900);
  });

  it("replays a game exactly from seed, decks and actions", () => {
    for (const seed of [11, 12, 13]) {
      const record = game(seed);
      const again = replay(engine, record.decks, record.options, record.actions);
      expect(hashState(again)).toBe(hashState(record.state));
      // A rollback is a replay of a prefix.
      const half = Math.floor(record.actions.length / 2);
      const a = replay(engine, record.decks, record.options, record.actions.slice(0, half));
      const b = replay(engine, record.decks, record.options, record.actions.slice(0, half));
      expect(hashState(a)).toBe(hashState(b));
      expect(a.pending).not.toBeNull();
    }
  });

  it("plays the same game for the same seed and a different one for another", () => {
    expect(hashState(game(21).state)).toBe(hashState(game(21).state));
    expect(hashState(game(21).state)).not.toBe(hashState(game(22).state));
  });

  it("survives a JSON round trip in the middle of a game", () => {
    const record = game(31);
    const half = Math.floor(record.actions.length / 2);
    const state = replay(engine, record.decks, record.options, record.actions.slice(0, half));
    const copy = JSON.parse(JSON.stringify(state));
    for (const action of record.actions.slice(half)) {
      engine.apply(state, action);
      engine.apply(copy, action);
    }
    expect(hashState(copy)).toBe(hashState(state));
    expect(hashState(state)).toBe(hashState(record.state));
  });
});
