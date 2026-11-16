// Opponent model and determinization for the search AI (plan section 6, "Gegnermodell").
//
// The AI knows its own deck list, but not the opponent's. It knows a field of possible decks (the meta
// archetypes with their shares, or the decks of a simulation). From the opponent's cards it has seen it
// estimates which deck the opponent plays: each candidate's prior share times a likelihood that drops
// sharply for every seen card the candidate doesn't contain. For one simulation it draws a candidate by
// that weight and fills the hidden cards (hand, deck, Shields) with the candidate's cards it hasn't seen
// yet, in random order. Its own hidden cards (deck, Shields) are the rest of its own list.

import { DEFAULT_RESOURCE } from "../engine/deck";
import { cloneState } from "../engine/clone";
import type { CardLib } from "../engine/cardlib";
import { nextU32, shuffle, type RngState } from "../engine/rng";
import type { CardId, DeckList, GameState, PlayerId } from "../engine/types";
import { HIDDEN } from "../engine/view";

export interface FieldDeck {
  deck: DeckList;
  /** Prior weight (meta share); any positive scale. */
  weight: number;
}

export interface Knowledge {
  /** The AI's own deck list. */
  deck?: DeckList;
  /** Decks the opponent may play. */
  field?: FieldDeck[];
}

/** Likelihood factor for a seen card the candidate doesn't have (another list, a tech card …). */
const MISMATCH = 0.02;
const MAIN_TYPES = new Set(["UNIT", "PILOT", "COMMAND", "BASE"]);

type Counts = Map<string, number>;

const countOf = (nos: readonly string[]): Counts => {
  const m: Counts = new Map();
  for (const no of nos) m.set(no, (m.get(no) ?? 0) + 1);
  return m;
};

/** Cards of player `p` from the main deck that the viewer can see (anywhere but deck, Shields, hand). */
function seenCards(s: GameState, lib: CardLib, p: PlayerId): string[] {
  const out: string[] = [];
  for (const card of s.cards) {
    if (card.owner !== p || card.no === HIDDEN || card.token) continue;
    if (card.zone === "deck" || card.zone === "shields" || card.zone === "resourceDeck") continue;
    if (!lib.has(card.no) || !MAIN_TYPES.has(lib.get(card.no).type)) continue;
    out.push(card.no);
  }
  return out;
}

/** Posterior weights of the field decks given the opponent's seen cards. */
export function fieldPosterior(field: readonly FieldDeck[], seen: readonly string[]): number[] {
  const seenCounts = countOf(seen);
  return field.map((f) => {
    const list = countOf(f.deck.main);
    let w = f.weight;
    for (const [no, n] of seenCounts) {
      const have = list.get(no) ?? 0;
      if (have < n) w *= MISMATCH ** (n - have);
    }
    return w;
  });
}

function drawIndex(rng: RngState, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.floor((nextU32(rng) / 0x1_0000_0000) * weights.length);
  let r = (nextU32(rng) / 0x1_0000_0000) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** The deck cards not seen yet, as a shuffled list (missing ones filled with a card without effects). */
function unseen(rng: RngState, list: readonly string[], seen: readonly string[], slots: number): string[] {
  const rest = countOf(list);
  for (const no of seen) {
    const n = rest.get(no);
    if (n) rest.set(no, n - 1);
  }
  const pool: string[] = [];
  for (const [no, n] of rest) for (let i = 0; i < n; i++) pool.push(no);
  shuffle(rng, pool);
  while (pool.length < slots) pool.push(DEFAULT_RESOURCE);
  return pool.slice(0, slots);
}

/**
 * A complete state consistent with the view: hidden cards get identities from the own list and a
 * candidate deck of the opponent; the random generator gets a fresh seed for the simulation.
 */
export function sampleState(
  view: GameState,
  me: PlayerId,
  lib: CardLib,
  knowledge: Knowledge,
  rng: RngState,
): GameState {
  const s = cloneState(view);
  s.rng = [nextU32(rng) | 1, nextU32(rng), nextU32(rng), nextU32(rng)];
  const enemy: PlayerId = me === 0 ? 1 : 0;
  const hidden = (p: PlayerId): CardId[] =>
    s.cards.filter((c) => c.owner === p && c.no === HIDDEN && c.zone !== "resourceDeck").map((c) => c.id);
  const fill = (ids: CardId[], nos: string[]) =>
    ids.forEach((id, i) => (s.cards[id]!.no = nos[i] ?? DEFAULT_RESOURCE));

  const mine = hidden(me);
  fill(mine, knowledge.deck ? unseen(rng, knowledge.deck.main, seenCards(s, lib, me), mine.length) : []);

  const theirs = hidden(enemy);
  const field = knowledge.field ?? [];
  if (field.length && theirs.length) {
    const seen = seenCards(s, lib, enemy);
    const pick = field[drawIndex(rng, fieldPosterior(field, seen))]!;
    fill(theirs, unseen(rng, pick.deck.main, seen, theirs.length));
  } else fill(theirs, []);

  for (const card of s.cards) if (card.no === HIDDEN) card.no = DEFAULT_RESOURCE; // resource decks
  return s;
}
