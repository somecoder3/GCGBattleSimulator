// Meta data: tournament decks from Limitless (snapshot) and the archetypes built from them.
// Player names are never stored.

import type { DeckList } from "../engine/types";

export interface MetaTournament {
  id: string;
  name: string;
  date: string;
  players: number;
}

export interface MetaDeck {
  tournament: string;
  placing: number;
  record: { wins: number; losses: number; ties: number };
  /** Archetype as named on Limitless ("other" for unnamed decks). */
  archetypeId: string;
  archetype: string;
  /** Main deck by GCGDB card number (Limitless has no resource deck). */
  cards: Record<string, number>;
  /** Entries that are not in GCGDB ("SET-NUMBER name"). */
  unknown: string[];
}

export interface MetaSnapshot {
  version: 1;
  source: "limitless";
  createdAt: string;
  /** Date window of the tournaments (ISO dates, inclusive). */
  from: string;
  to: string;
  minPlayers: number;
  /** Placings taken per tournament. */
  topN: number;
  tournaments: MetaTournament[];
  decks: MetaDeck[];
}

export interface Archetype {
  id: string;
  name: string;
  /** Weighted share of the meta (0–1) and number of lists. */
  share: number;
  lists: number;
  colors: string[];
  /** Consensus list: the most common count of each card, 50 cards, legal. */
  consensus: DeckList;
  /** Best placed real list (padded or trimmed to 50 if needed). */
  best: DeckList;
  bestPlacing: { tournament: string; placing: number };
  /** Cards of the consensus list whose text the engine doesn't fully understand. */
  partial: string[];
}
