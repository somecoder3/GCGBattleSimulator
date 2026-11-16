// What a player is allowed to know (4-1-4, 4-2-2, 4-6-4-1, 4-8-3). AIs only ever see this view.

import type { CardId, GameState, PlayerId } from "./types";

export const HIDDEN = "?";

/** Is the card's identity hidden from `viewer`? */
export function isHiddenFrom(state: GameState, id: CardId, viewer: PlayerId): boolean {
  const card = state.cards[id]!;
  // Cards the viewer is looking at through an effect ("Look at the top …").
  if (state.frames.some((f) => f.controller === viewer && f.looking?.includes(id))) return false;
  switch (card.zone) {
    case "deck":
    case "resourceDeck":
    case "shields":
      return true; // private for both players
    case "hand":
      return card.owner !== viewer;
    default:
      return false;
  }
}

/**
 * A copy of the state without hidden information: hidden cards get the card number "?", and the random
 * generator is cleared (it would reveal the order of the decks). Card ids carry no information, since
 * decks are shuffled after the ids are assigned.
 */
export function viewFor(state: GameState, viewer: PlayerId): GameState {
  const view = structuredClone(state);
  view.rng = [0, 0, 0, 0];
  for (const card of view.cards) if (isHiddenFrom(state, card.id, viewer)) card.no = HIDDEN;
  return view;
}
