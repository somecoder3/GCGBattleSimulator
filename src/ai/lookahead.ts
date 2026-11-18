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
import { HeuristicPolicy, type RuleOptions } from "./heuristic";
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
    rules: RuleOptions = {},
  ) {
    this.rules = new HeuristicPolicy(engine, rules);
    this.evaluator = new Evaluator(engine, weights);
  }

  choose(view: GameState, decision: Decision): Action {
    const options = decision.options;
    if (options.length === 1) return options[0]!;
    if (!SEARCHED.has(decision.kind)) return this.rules.choose(view, decision);

    return this.rank(view, decision)[0] ?? this.rules.choose(view, decision);
  }

  /** All options, best first (stable: the v0 choice wins ties). */
  rank(view: GameState, decision: Decision): Action[] {
    const base = determinize(view);
    const me = decision.player;
    const preferred = this.rules.choose(base, decision);
    const ordered = [preferred, ...decision.options.filter((o) => o !== preferred)];
    const scored = ordered.map((option, i) => ({ option, i, score: this.score(base, option, me) }));
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.map((x) => x.option);
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
