// Plays one game between two policies and records everything needed to replay it.

import type { Policy } from "../ai/types";
import type { Engine } from "../engine/engine";
import { viewFor } from "../engine/view";
import type { Action, DeckList, GameEvent, GameOptions, GameResult, GameState } from "../engine/types";

export interface MatchRecord {
  options: GameOptions;
  decks: [DeckList, DeckList];
  /** Every action in order; with the seed and decks this replays the game exactly. */
  actions: Action[];
  result: GameResult;
  state: GameState;
}

export interface MatchHooks {
  /** Called after every engine step (setup and each action), e.g. for invariant checks. */
  onStep?: (state: GameState, events: GameEvent[]) => void;
  /** Hand the policy the full state instead of the player's view (only for tests). */
  fullInformation?: boolean;
}

export function playMatch(
  engine: Engine,
  decks: [DeckList, DeckList],
  options: GameOptions,
  policies: [Policy, Policy],
  hooks: MatchHooks = {},
): MatchRecord {
  const { state, events } = engine.newGame(decks, options);
  hooks.onStep?.(state, events);
  const actions: Action[] = [];
  while (state.pending) {
    const decision = state.pending;
    const policy = policies[decision.player];
    const view = hooks.fullInformation || policy.usesView === false ? state : viewFor(state, decision.player);
    const action = policy.choose(view, decision);
    actions.push(action);
    const stepEvents = engine.apply(state, action);
    hooks.onStep?.(state, stepEvents);
  }
  return { options, decks, actions, result: state.result!, state };
}

/** Rebuilds a game from its record (or a prefix of its actions, e.g. for rollback). */
export function replay(
  engine: Engine,
  decks: [DeckList, DeckList],
  options: GameOptions,
  actions: readonly Action[],
): GameState {
  const { state } = engine.newGame(decks, options);
  for (const action of actions) engine.apply(state, action);
  return state;
}
