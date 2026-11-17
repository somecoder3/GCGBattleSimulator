// Meta data: tournament decks from Limitless and Egman (snapshot) and the archetypes built from them.
// Player names are never stored.

import type { DeckList } from "../engine/types";

export type MetaSource = "limitless" | "egman";

export interface MetaTournament {
  id: string;
  name: string;
  date: string;
  players: number;
  /** Where the results come from; missing in older snapshots = Limitless. */
  source?: MetaSource;
  /** Egman's event type, e.g. "Large Official Event". */
  kind?: string;
}

export interface MetaDeck {
  tournament: string;
  placing: number;
  record: { wins: number; losses: number; ties: number };
  /** Archetype as named on Limitless ("other" for unnamed decks). */
  archetypeId: string;
  archetype: string;
  /**
   * The archetype is only a suggestion (Egman names decks after their lead card): such a deck joins a
   * Limitless archetype of the same name or the most similar one, and forms its own only otherwise.
   */
  soft?: boolean;
  /** Main deck by GCGDB card number (Limitless has no resource deck). */
  cards: Record<string, number>;
  /** Entries that are not in GCGDB ("SET-NUMBER name"). */
  unknown: string[];
}

export interface MetaSnapshot {
  version: 1;
  /** "limitless" in older snapshots; "limitless+egman" since 17 Nov 2026. */
  source: "limitless" | "limitless+egman";
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
  /** Real list with the best result (padded or trimmed to 50 if needed). */
  best: DeckList;
  bestPlacing: { tournament: string; placing: number };
  /** Every real list of the archetype, best result first (players and placing, see
   * `resultScore`, then recency); the first one is `best`. */
  entries: ArchetypeEntry[];
  /** Cards of the consensus list whose text the engine doesn't fully understand. */
  partial: string[];
}

/** One real tournament list of an archetype, as played (not adjusted to the banlist). */
export interface ArchetypeEntry {
  tournament: MetaTournament;
  placing: number;
  record: MetaDeck["record"];
  /** Main deck by card number. */
  cards: Record<string, number>;
  /** Weight in the archetype (recency, tournament size, placing). */
  weight: number;
}
