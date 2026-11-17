// Search AI (M7): determinized Monte Carlo. For each decision it samples several complete states that
// fit its view (opponent.ts: own list, estimated opponent deck), plays every option in each of them with
// the v0 rules for both players up to its own next main phase (so the opponent's whole turn, with the
// cards the opponent may really have, is part of the result), and picks the option with the best
// average evaluation. With many options, v1 first narrows them down, and successive halving spends the
// samples on the options that are still in the race (see SearchOptions.halving).
//
// This is "perfect information Monte Carlo" over determinizations rather than a full ISMCTS tree: the
// engine's decisions are fine-grained (every target, every pass), so a tree would spend most of its budget
// on trivial branches. See docs/AI.md.
//
// Last chance: if even the best option loses on average (most samples end in a loss), the AI looks
// harder before giving up. It then considers all options (v1's ranking means little when everything
// loses) and draws more samples, up to 64, until an option is better than a likely loss, so rare outs
// are found and compared fairly. Example: the opponent wins next turn for sure, but deploying a Base
// takes the last Shield into the hand, and if that is the right Pilot, a linked Unit wins this turn.
// With 6 samples the AI found that only about every second time. In this mode the rollouts also go one
// round further: "survives one more turn" (e.g. through a Burst) would otherwise count like an open
// position, although the opponent still wins a turn later (measured: Base 9.5 % wins, ending the main
// phase 14 % survives but almost never wins). If no sample shows any way out after 24 samples, the AI
// gives up looking; lost positions at the end of games would otherwise cost the full 64 samples. Only
// main-phase decisions get this.

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
  /**
   * Successive halving (default true): all options start with a few samples, the worse half drops out
   * after each round and the rest get twice as many, so the last two are compared with `samples` each.
   * false: every option gets `samples` (the M7 behaviour).
   */
  halving?: boolean;
}

const SEARCHED = new Set<Decision["kind"]>(["main", "block", "action", "effect"]);
const MAX_ROLLOUT = 400;
/** Samples per decision at most when every option loses in every sample so far. */
const LAST_CHANCE_SAMPLES = 64;
/** Options considered at most in that case. */
const LAST_CHANCE_WIDTH = 16;
/** Without any surviving sample after this many, the position counts as lost (saves time at game ends). */
const LAST_CHANCE_GIVE_UP = 24;

export class SearchPolicy implements Policy {
  readonly name: string;
  private readonly rules: HeuristicPolicy;
  private readonly lookahead: LookaheadPolicy;
  private readonly evaluator: Evaluator;
  private readonly rng: RngState;
  /** Scores at or below this are lost games (the evaluation gives -win + turn). */
  private readonly lossBelow: number;

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
    this.lossBelow = -weights.win / 2;
  }

  choose(view: GameState, decision: Decision): Action {
    const options = decision.options;
    if (options.length === 1) return options[0]!;
    if (!SEARCHED.has(decision.kind)) return this.rules.choose(view, decision);
    const me = decision.player;

    // v1's ranking picks the candidates; its first choice comes first (it wins ties).
    const ranked = this.lookahead.rank(view, decision);
    let candidates = ranked.slice(0, this.options.width);
    let totals = candidates.map(() => 0);
    let counts = candidates.map(() => 0);
    let alive = candidates.map((_, i) => i);
    let rounds = 1;
    let anyOut: boolean; // some option did not lose in some sample (read in the last-chance phase)

    // All options are compared on the same sampled states (fair comparison, fewer samples needed).
    const bases: GameState[] = [];
    const base = (k: number) => {
      while (bases.length <= k) bases.push(sampleState(view, me, this.engine.lib, this.knowledge, this.rng));
      return bases[k]!;
    };
    const run = (i: number, from: number, to: number) => {
      for (let k = from; k < to; k++) {
        const score = this.rollout(base(k), candidates[i]!, me, rounds);
        if (Number.isFinite(score)) {
          totals[i]! += score;
          counts[i]!++;
          if (score > this.lossBelow) anyOut = true;
        }
      }
    };
    const average = (i: number) => (counts[i] ? totals[i]! / counts[i]! : -Infinity);
    const bestAverage = () => Math.max(...alive.map(average));
    const samples = this.options.samples;

    if (this.options.halving === false) {
      for (const i of alive) run(i, 0, samples);
    } else {
      // Successive halving: samples per remaining option so far (`done`) double each round; the last
      // two options end with `samples` each. 8 options, 16 samples: 4 / 8 / 16 = 64 rollouts instead of 128.
      let done = 0;
      for (;;) {
        const halvings = Math.ceil(Math.log2(alive.length));
        const target = Math.min(samples, Math.max(2, samples >> Math.max(0, halvings - 1)));
        for (const i of alive) run(i, done, target);
        done = target;
        if (alive.length <= 2 && done >= samples) break;
        // The better half stays; ties keep v1's order.
        alive = [...alive]
          .sort((x, y) => average(y) - average(x) || x - y)
          .slice(0, Math.ceil(alive.length / 2));
      }
    }

    // Only in the main phase, where a plan like the one above starts; targets, blocks and passes in a
    // lost position follow from it and would only cost time.
    if (decision.kind === "main" && bestAverage() <= this.lossBelow) {
      // Last chance (see top): all options, more samples, while even the best one still loses.
      candidates = ranked.slice(0, LAST_CHANCE_WIDTH);
      alive = candidates.map((_, i) => i);
      rounds = 2;
      totals = candidates.map(() => 0);
      counts = candidates.map(() => 0);
      anyOut = false;
      for (let k = 0; k < LAST_CHANCE_SAMPLES; k++) {
        if (k >= samples && bestAverage() > this.lossBelow) break;
        if (k >= LAST_CHANCE_GIVE_UP && !anyOut) break; // no way out found at all
        for (const i of alive) run(i, k, k + 1);
      }
    }

    let best = alive[0]!;
    for (const i of alive) if (average(i) > average(best)) best = i;
    return candidates[best]!;
  }

  /**
   * Plays `option` and then v0 for both players until the own next main phase (or the end); with
   * `rounds` 2 until the own main phase after that.
   */
  private rollout(base: GameState, option: Action, me: PlayerId, rounds = 1): number {
    const s = cloneState(base);
    const start = base.turn;
    const until = this.options.horizon === "turn" ? start + 1 : start + 2 * rounds;
    try {
      this.engine.apply(s, option);
      for (let n = 0; s.pending && n < MAX_ROLLOUT * rounds; n++) {
        const p = s.pending;
        if (p.kind === "main" && s.turn >= until && (p.player === me || this.options.horizon === "turn"))
          break;
        this.engine.apply(s, this.rules.choose(s, p));
      }
      return this.evaluator.evaluate(s, me);
    } catch {
      return -Infinity;
    }
  }
}
