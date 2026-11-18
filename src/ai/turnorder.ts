// The AI's choice when it may choose who goes first (src/sim/start.ts, docs/AI.md "Startspieler").

import type { DeckList } from "../engine/types";

/**
 * Does the AI want to go first with this deck? Always: measured with heuristic-v1 over 30 decks (15 meta
 * archetypes, 15 starter decks, 10 880 games), every deck wins more often as first player, by 9 to 30
 * percentage points, decks without a Lv.1 card and slow decks included (Player One draws in the first turn
 * and attacks first; Player Two's EX Resource does not make up for it). Re-measure with `npm run first`
 * when the AI or the rules change. Re-measured after the EX Resource rule (18 Nov 2026): the best
 * tournament list of every archetype too, +7 to +19 points; first player 56.6 % overall (was 62 %). The deck is a parameter for a rule by deck type, should one ever pay.
 */
export function aiWantsFirst(_deck?: DeckList): boolean {
  return true;
}
