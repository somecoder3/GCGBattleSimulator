import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fieldPosterior, sampleState } from "../../src/ai/opponent";
import { SearchPolicy } from "../../src/ai/search";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { checkInvariants } from "../../src/engine/invariants";
import { seedRng } from "../../src/engine/rng";
import { HIDDEN, viewFor } from "../../src/engine/view";
import { RandomPolicy } from "../../src/ai/random";
import { playMatch } from "../../src/sim/match";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const [st1, st2, st3] = STARTER_DECKS.map((d) => d.deck);

describe("opponent model", () => {
  it("prefers field decks that contain the cards seen so far", () => {
    const field = [
      { deck: st1!, weight: 1 },
      { deck: st3!, weight: 1 },
    ];
    const [a, b] = fieldPosterior(field, ["ST03-006", "ST03-008"]);
    expect(b!).toBeGreaterThan(a! * 100);
    expect(fieldPosterior(field, [])).toEqual([1, 1]);
  });

  it("fills every hidden card: own ones from the own list, the opponent's from a field deck", () => {
    const { state } = engine.newGame([st1!, st3!], { seed: 5 });
    const view = viewFor(state, 0);
    expect(view.cards.some((c) => c.no === HIDDEN)).toBe(true);
    const s = sampleState(
      view,
      0,
      engine.lib,
      { deck: st1!, field: [{ deck: st3!, weight: 1 }] },
      seedRng(1),
    );
    expect(s.cards.some((c) => c.no === HIDDEN)).toBe(false);
    const own = s.cards.filter(
      (c) => c.owner === 0 && (c.zone === "deck" || c.zone === "shields" || c.zone === "hand"),
    );
    const counts = (nos: string[]) =>
      nos.reduce<Record<string, number>>((m, no) => ((m[no] = (m[no] ?? 0) + 1), m), {});
    expect(counts(own.map((c) => c.no))).toEqual(counts(st1!.main)); // nothing played yet: the whole list
    const theirs = s.cards.filter(
      (c) => c.owner === 1 && (c.zone === "deck" || c.zone === "shields" || c.zone === "hand"),
    );
    expect(theirs.every((c) => st3!.main.includes(c.no))).toBe(true);
    expect(view.cards.some((c) => c.no === HIDDEN)).toBe(true); // the view itself is unchanged
  });
});

describe("search AI", () => {
  it("plays complete games on its own view with all invariants", () => {
    for (const seed of [1, 2]) {
      const record = playMatch(
        engine,
        [st1!, st2!],
        { seed, firstPlayer: (seed % 2) as 0 | 1 },
        [
          new SearchPolicy(engine, { deck: st1!, field: [{ deck: st2!, weight: 1 }] }, seed, {
            samples: 2,
            width: 3,
          }),
          new RandomPolicy(seed),
        ],
        {
          onStep: (state) => {
            const errors = checkInvariants(engine, state, [60, 60]);
            if (errors.length) throw new Error(errors.join("; "));
          },
        },
      );
      expect(record.result.winner).toBe(0);
    }
  }, 60_000);
});
