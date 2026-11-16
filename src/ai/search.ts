// Search AI (M7): determinized Monte Carlo. For each decision it samples several complete states that
// fit its view (opponent.ts: own list, estimated opponent deck), plays every option in each of them with
// the v0 rules for both players up to its own next main phase (so the opponent's whole turn, with the
// cards the opponent may really have, is part of the result), and picks the option with the best
// average evaluation. With many options, v1 first narrows them down.
//
// This is "perfect information Monte Carlo" over determinizations rather than a full ISMCTS tree: the
// engine's decisions are fine-grained (every target, every pass), so a tree would spend most of its budget
// on trivial branches. See docs/AI.md.

import type { Engine } from "../engine/engine";
import { cloneState } from "../engine/clone";
import { seedRng, type RngState } from "../engine/rng";
import type { Action, Decision, GameState, PlayerId } from "../engine/types";
import { DEFAULT_WEIGHTS, Evaluator, type Weights } from "./evaluate";
import { HeuristicPolicy } from "./heuristic";
import { LookaheadPolicy } from "./lookahead";
import { sampleState, type Knowledge } from "./opponent";
import type { Policy } from "./types";

export interface SearchOptions {
  /** Sampled states per decision. */
  samples: number;
  /** At most this many options are searched (the best by v1). */
  width: number;
  /** "round": up to the own next main phase (through the opponent's turn); "turn": to the end of this turn. */
  horizon?: "round" | "turn";
}

const SEARCHED = new Set<Decision["kind"]>(["main", "block", "action", "effect"]);
const MAX_ROLLOUT = 400;

export class SearchPolicy implements Policy {
  readonly name: string;
  private readonly rules: HeuristicPolicy;
  private readonly lookahead: LookaheadPolicy;
  private readonly evaluator: Evaluator;
  private readonly rng: RngState;

  constructor(
    private readonly engine: Engine,
    private readonly knowledge: Knowledge = {},
    seed = 1,
    private readonly options: SearchOptions = { samples: 6, width: 6 },
    weights: Weights = DEFAULT_WEIGHTS,
  ) {
    this.name = `search-${options.samples}`;
    this.rules = new HeuristicPolicy(engine);
    this.lookahead = new LookaheadPolicy(engine, weights);
    this.evaluator = new Evaluator(engine, weights);
    this.rng = seedRng(seed ^ 0x5ea7c4);
  }

  choose(view: GameState, decision: Decision): Action {
    const options = decision.options;
    if (options.length === 1) return options[0]!;
    if (!SEARCHED.has(decision.kind)) return this.rules.choose(view, decision);
    const me = decision.player;

    // v1's ranking picks the candidates; its first choice comes first (it wins ties).
    const candidates = this.lookahead.rank(view, decision).slice(0, this.options.width);

    const totals = candidates.map(() => 0);
    const counts = candidates.map(() => 0);
    for (let k = 0; k < this.options.samples; k++) {
      const base = sampleState(view, me, this.engine.lib, this.knowledge, this.rng);
      candidates.forEach((option, i) => {
        const score = this.rollout(base, option, me);
        if (Number.isFinite(score)) {
          totals[i]! += score;
          counts[i]!++;
        }
      });
    }
    let best = 0;
    let bestScore = -Infinity;
    candidates.forEach((_, i) => {
      const avg = counts[i] ? totals[i]! / counts[i]! : -Infinity;
      if (avg > bestScore) {
        bestScore = avg;
        best = i;
      }
    });
    return candidates[best]!;
  }

  /** Plays `option` and then v0 for both players until the own next main phase (or the end). */
  private rollout(base: GameState, option: Action, me: PlayerId): number {
    const s = cloneState(base);
    const start = base.turn;
    try {
      this.engine.apply(s, option);
      for (let n = 0; s.pending && n < MAX_ROLLOUT; n++) {
        const p = s.pending;
        if (p.kind === "main" && s.turn > start && (p.player === me || this.options.horizon === "turn"))
          break;
        this.engine.apply(s, this.rules.choose(s, p));
      }
      return this.evaluator.evaluate(s, me);
    } catch {
      return -Infinity;
    }
  }
}
