// Heuristic AI v1: tries every option of a decision on a copy of its view, lets the v0 rules play on
// (for both players) up to the next main-phase decision, and keeps the option whose result the
// evaluation function (evaluate.ts) likes best.
//
// The AI only knows its view. Hidden cards (decks, Shields, the opponent's hand) are replaced by a
// card without effects for the simulation, so it can't profit from knowing them.

import { cloneState } from "../engine/clone";
import type { Engine } from "../engine/engine";
import { DEFAULT_RESOURCE } from "../engine/deck";
import type { Action, Decision, GameState } from "../engine/types";
import { HIDDEN } from "../engine/view";
import { DEFAULT_WEIGHTS, Evaluator, type Weights } from "./evaluate";
import { HeuristicPolicy } from "./heuristic";
import type { Policy } from "./types";

/** Stand-in for hidden cards: a Resource card can't be played from the hand and has no Burst. */
const FILLER = DEFAULT_RESOURCE;
/** Safety limit for one simulation (decisions until the next main phase). */
const MAX_ROLLOUT = 200;

const SEARCHED = new Set<Decision["kind"]>(["main", "block", "action", "effect"]);

export class LookaheadPolicy implements Policy {
  readonly name = "heuristic-v1";
  private readonly rules: HeuristicPolicy;
  private readonly evaluator: Evaluator;

  constructor(
    private readonly engine: Engine,
    weights: Weights = DEFAULT_WEIGHTS,
    /** "battle": up to the next main decision; "turn": up to the main phase of the next turn. */
    private readonly horizon: "battle" | "turn" = "turn",
  ) {
    this.rules = new HeuristicPolicy(engine);
    this.evaluator = new Evaluator(engine, weights);
  }

  choose(view: GameState, decision: Decision): Action {
    const options = decision.options;
    if (options.length === 1) return options[0]!;
    if (!SEARCHED.has(decision.kind)) return this.rules.choose(view, decision);

    const base = determinize(view);
    const me = decision.player;
    let best: Action | undefined;
    let bestScore = -Infinity;
    // The v0 choice goes first, so it wins ties.
    const preferred = this.rules.choose(base, decision);
    for (const option of [preferred, ...options.filter((o) => o !== preferred)]) {
      const score = this.score(base, option, me);
      if (score > bestScore) {
        best = option;
        bestScore = score;
      }
    }
    return best ?? this.rules.choose(view, decision);
  }

  /** Value of the position after `option` and the v0 continuation up to the next main decision. */
  private score(base: GameState, option: Action, me: 0 | 1): number {
    const s = cloneState(base);
    const turn = base.turn;
    const done = (st: GameState) =>
      st.pending!.kind === "main" && (this.horizon === "battle" || st.turn > turn);
    try {
      this.engine.apply(s, option);
      for (let n = 0; s.pending && !done(s) && n < MAX_ROLLOUT; n++) {
        this.engine.apply(s, this.rules.choose(s, s.pending));
      }
      return this.evaluator.evaluate(s, me);
    } catch {
      return -Infinity; // the simulation needed something the stand-ins can't provide
    }
  }
}

/** A copy of the view in which hidden cards are stand-ins the engine can play with. */
export function determinize(view: GameState): GameState {
  const s = cloneState(view);
  for (const card of s.cards) if (card.no === HIDDEN) card.no = FILLER;
  return s;
}
