import type { Action, Decision, GameState } from "../engine/types";

/**
 * A player: picks one of the decision's options. `view` is the state as the player sees it
 * (engine/view.ts), never the full state.
 */
export interface Policy {
  readonly name: string;
  /** False if the policy never looks at the state (random play); saves building a view per decision. */
  readonly usesView?: boolean;
  choose(view: GameState, decision: Decision): Action;
}
