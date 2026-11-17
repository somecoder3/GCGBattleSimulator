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
import { scenario } from "../engine/helpers";

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

  it("takes the last chance: a Base for the last Shield, which may be the Pilot that wins this turn", () => {
    // The opponent has four 7-AP Units and no Shields or Base: they win next turn for sure. We have a full
    // 6-HP Base, one Shield, Gundam (links with [Amuro Ray]) and another Base in the hand. Deploying the
    // Base takes the Shield into the hand; if it is Amuro Ray (4 in our list), Gundam links and wins now.
    const GM = "ST01-005";
    const own = { main: [...st1!.main.slice(2), "GD01-126", "GD01-126"], resources: st1!.resources };
    const knowledge = { deck: own, field: [{ deck: st2!, weight: 1 }] };
    for (const shield of ["ST01-010", GM]) {
      for (let seed = 1; seed <= 3; seed++) {
        const s = scenario({
          engine,
          filler: GM,
          turn: 6,
          p0: { hand: ["GD01-126", "ST01-001"], base: "GD01-128", shields: [shield], resources: 6 },
          p1: {
            battle: Array.from({ length: 4 }, () => ({ no: "ST02-001", pilot: "ST02-010" })),
            shields: 0,
            base: null,
          },
        });
        const ai = new SearchPolicy(engine, knowledge, seed);
        let deployedBase = false;
        for (let n = 0; n < 40 && s.pending && s.turn === 6 && !s.result; n++) {
          const d = s.pending;
          const a =
            d.player === 0
              ? ai.choose(viewFor(s, 0), d)
              : (d.options.find((o) => o.type === "noBlock" || o.type === "pass") ?? d.options[0]!);
          if (a.type === "deployBase") deployedBase = true;
          engine.apply(s, a);
        }
        // It doesn't know the Shield, so it takes the chance either way; it wins only with Amuro.
        expect(deployedBase, `${shield}, seed ${seed}`).toBe(true);
        expect(s.result?.winner === 0, `${shield}, seed ${seed}`).toBe(shield === "ST01-010");
      }
    }
  }, 60_000);

  it("spends fewer rollouts with successive halving: 8 options, 16 samples = 64 instead of 128", () => {
    // Many options (attacks, Units to deploy, end), and a position that is not lost.
    const s = scenario({
      engine,
      filler: "ST01-005",
      turn: 5,
      p0: { hand: ["ST01-005", "ST01-003", "ST01-004"], battle: ["ST01-005", "ST01-003"], resources: 6 },
      p1: {
        battle: [
          { no: "ST02-005", rested: true },
          { no: "ST02-007", rested: true },
        ],
      },
    });
    expect(s.pending!.options.length).toBeGreaterThanOrEqual(8);
    const knowledge = { deck: st1!, field: [{ deck: st2!, weight: 1 }] };
    const rollouts = (halving: boolean) => {
      const ai = new SearchPolicy(engine, knowledge, 1, { samples: 16, width: 8, halving });
      let n = 0;
      const original = (ai as unknown as { rollout: (...a: unknown[]) => number }).rollout.bind(ai);
      (ai as unknown as { rollout: (...a: unknown[]) => number }).rollout = (...a: unknown[]) => (
        n++,
        original(...a)
      );
      const action = ai.choose(viewFor(s, 0), s.pending!);
      expect(s.pending!.options).toContainEqual(action);
      return n;
    };
    expect(rollouts(false)).toBe(128);
    expect(rollouts(true)).toBe(64);
  });
});
