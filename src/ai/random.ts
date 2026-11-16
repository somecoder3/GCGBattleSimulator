// Random legal play, used for fuzzing and as the weakest opponent. Prefers doing something over
// ending the main phase, so games finish by damage instead of running out of cards.

import { nextU32, seedRng, type RngState } from "../engine/rng";
import type { Action } from "../engine/types";
import type { Policy } from "./types";

const WEIGHTS: Record<Action["type"], number> = {
  keepHand: 4,
  redraw: 1,
  deployUnit: 6,
  pair: 5,
  deployBase: 3,
  attack: 6,
  support: 2,
  endMain: 1,
  block: 3,
  noBlock: 2,
  pass: 1,
  discard: 1,
};

export class RandomPolicy implements Policy {
  readonly name = "random";
  readonly usesView = false;
  private readonly rng: RngState;

  /** The policy has its own generator, so its choices never change the game's random numbers. */
  constructor(seed: number) {
    this.rng = seedRng(seed ^ 0x5eed);
  }

  choose(_view: unknown, decision: { options: Action[] }): Action {
    const options = decision.options;
    let total = 0;
    for (const o of options) total += WEIGHTS[o.type];
    let r = (nextU32(this.rng) / 0x1_0000_0000) * total;
    for (const o of options) {
      r -= WEIGHTS[o.type];
      if (r < 0) return o;
    }
    return options[options.length - 1]!;
  }
}
