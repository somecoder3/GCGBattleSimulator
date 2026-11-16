// The AIs by name, for the simulator (CLI and browser) and the game.

import type { Engine } from "../engine/engine";
import { DEFAULT_WEIGHTS, type Weights } from "./evaluate";
import { HeuristicPolicy } from "./heuristic";
import { LookaheadPolicy } from "./lookahead";
import { RandomPolicy } from "./random";
import type { Policy } from "./types";

export const AI_NAMES = ["random", "heuristic-v0", "heuristic-v1"] as const;
export type AiName = (typeof AI_NAMES)[number];

export const AI_LABELS: Record<AiName, string> = {
  random: "Zufall",
  "heuristic-v0": "Heuristik v0 (Regeln)",
  "heuristic-v1": "Heuristik v1 (Bewertung + Vorausschau)",
};

/** Accepts the full names and the short forms random, v0, v1 and heuristic (= the best heuristic). */
export function parseAiName(name: string): AiName {
  const short: Record<string, AiName> = { v0: "heuristic-v0", v1: "heuristic-v1", heuristic: "heuristic-v1" };
  const full = short[name] ?? name;
  if (!(AI_NAMES as readonly string[]).includes(full)) throw new Error(`unknown AI ${name}`);
  return full as AiName;
}

/**
 * `seed` only matters for the random AI; the heuristics are deterministic. `weights` changes the
 * evaluation of heuristic-v1 (for tuning).
 */
export function makePolicy(name: AiName, engine: Engine, seed: number, weights?: Partial<Weights>): Policy {
  switch (name) {
    case "random":
      return new RandomPolicy(seed);
    case "heuristic-v0":
      return new HeuristicPolicy(engine);
    case "heuristic-v1":
      return new LookaheadPolicy(engine, weights ? { ...DEFAULT_WEIGHTS, ...weights } : DEFAULT_WEIGHTS);
  }
}
