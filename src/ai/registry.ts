// The AIs by name, for the simulator (CLI and browser) and the game.

import type { Engine } from "../engine/engine";
import { DEFAULT_WEIGHTS, type Weights } from "./evaluate";
import { HeuristicPolicy } from "./heuristic";
import { LookaheadPolicy } from "./lookahead";
import type { Knowledge } from "./opponent";
import { RandomPolicy } from "./random";
import { SearchPolicy } from "./search";
import type { Policy } from "./types";

export const AI_NAMES = ["random", "heuristic-v0", "heuristic-v1", "search", "search-strong"] as const;
export type AiName = (typeof AI_NAMES)[number];

export const AI_LABELS: Record<AiName, string> = {
  random: "Zufall",
  "heuristic-v0": "Heuristik v0 (Regeln)",
  "heuristic-v1": "Heuristik v1 (Bewertung + Vorausschau)",
  search: "Suche (6 Stichproben)",
  "search-strong": "Suche stark (16 Stichproben)",
};

/** Difficulty levels for the game (plan section 6). */
export const DIFFICULTIES: { ai: AiName; label: string }[] = [
  { ai: "heuristic-v0", label: "Leicht" },
  { ai: "heuristic-v1", label: "Normal" },
  { ai: "search", label: "Schwer" },
  { ai: "search-strong", label: "Sehr schwer" },
];

/** Accepts the full names and the short forms random, v0, v1 and heuristic (= the best heuristic). */
export function parseAiName(name: string): AiName {
  const short: Record<string, AiName> = {
    v0: "heuristic-v0",
    v1: "heuristic-v1",
    heuristic: "heuristic-v1",
    strong: "search-strong",
  };
  const full = short[name] ?? name;
  if (!(AI_NAMES as readonly string[]).includes(full)) throw new Error(`unknown AI ${name}`);
  return full as AiName;
}

/**
 * `seed` only matters for the random AI; the heuristics are deterministic. `weights` changes the
 * evaluation of heuristic-v1 (for tuning).
 */
export function makePolicy(
  name: AiName,
  engine: Engine,
  seed: number,
  weights?: Partial<Weights>,
  /** What the search AI knows: its own list and the decks the opponent may play. */
  knowledge: Knowledge = {},
): Policy {
  const w = weights ? { ...DEFAULT_WEIGHTS, ...weights } : DEFAULT_WEIGHTS;
  switch (name) {
    case "random":
      return new RandomPolicy(seed);
    case "heuristic-v0":
      return new HeuristicPolicy(engine);
    case "heuristic-v1":
      return new LookaheadPolicy(engine, w);
    case "search":
      return new SearchPolicy(engine, knowledge, seed, { samples: 6, width: 6 }, w);
    case "search-strong":
      return new SearchPolicy(engine, knowledge, seed, { samples: 16, width: 8 }, w);
  }
}
