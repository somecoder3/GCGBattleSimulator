// Who goes first (Rules Q&A Q8): "rock paper scissors or a similar method"; the winner chooses who goes
// first, before looking at the starting hand. Here: both players roll a die, ties are rolled again.

import { nextInt, seedRng } from "../engine/rng";
import type { PlayerId } from "../engine/types";

export interface StartRoll {
  /** The rolls by seat, ties included (the last one decides). */
  rolls: [number, number][];
  /** The seat that chooses who goes first. */
  winner: PlayerId;
}

export interface StartChoice extends StartRoll {
  /** The choice of the winner. */
  first: PlayerId;
}

/** A die roll for the seed of a game (the same seed rolls the same; independent of the game's own random). */
export function rollForStart(seed: number): StartRoll {
  const rng = seedRng((seed ^ 0x5eed_d1ce) >>> 0);
  const rolls: [number, number][] = [];
  for (;;) {
    const roll: [number, number] = [1 + nextInt(rng, 6), 1 + nextInt(rng, 6)];
    rolls.push(roll);
    if (roll[0] !== roll[1]) return { rolls, winner: roll[0] > roll[1] ? 0 : 1 };
  }
}
