// Egman Deck Builder (deckbuilder.egmanevents.com): results of large official regionals and other
// events with complete deck lists. The site loads all Gundam tournaments as one JSON file; we fetch it
// once per snapshot (npm run meta, weekly), never from the browser, and keep no player names or links.
//
// Checked on 17 Nov 2026: no terms of service; robots.txt allows normal clients (it only bars AI
// crawlers and AI training). Name the source in the app; ask Egman before publishing the app.

import type { CardPool } from "../data/cards";
import type { MetaDeck, MetaSnapshot, MetaTournament } from "./types";

export const EGMAN_URL = "https://deckbuilder.egmanevents.com/api/tournaments/gundam";
/** Neutral identification of our requests (no personal data). */
export const USER_AGENT = "gcg-battle-simulator (private meta statistics, weekly)";

/** The fields of Egman's tournament JSON we use (player names and social links are ignored). */
export interface EgmanTournament {
  id: string;
  tournament_name: string;
  format: string | null;
  start_date: string;
  /** Original source, e.g. a Limitless standings URL. */
  source: string | null;
  player_count: number | null;
  event_type: string | null;
  tournament_results: EgmanResult[] | null;
}

export interface EgmanResult {
  placement: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  /** Lead card number of the deck, e.g. "GD05-002". */
  deck_type: string | null;
  deck_type_secondary: string[] | null;
  /** Deck builder links: "…/?deck=GD01-008:4,GD05-027:4,…&type=gundam". */
  deck_list_url: string[] | null;
}

export interface EgmanOptions {
  from: string;
  to: string;
  minPlayers: number;
  topN: number;
  /** Limitless tournament ids already in the snapshot (Egman links some of them as source). */
  skipLimitless?: ReadonlySet<string>;
  /** Tournaments already in the snapshot, as sameEvent() keys (Egman doesn't always link the source). */
  skipEvents?: ReadonlySet<string>;
}

/** Key for recognising the same event in two sources: day and name without spaces and punctuation. */
export function sameEvent(date: string, name: string): string {
  return `${date.slice(0, 10)}|${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

function deckParam(url: string): string | null {
  try {
    return new URL(url).searchParams.get("deck");
  } catch {
    return null;
  }
}

/** "GD01-008:4,GD05-027:4" from a deck builder link → card counts by GCGDB number. */
export function parseDeckUrl(
  pool: CardPool,
  url: string,
): { cards: Record<string, number>; unknown: string[] } {
  const cards: Record<string, number> = {};
  const unknown: string[] = [];
  const list = deckParam(url);
  // In events with sideboards the list continues after "|" with the sideboard; only the main deck counts.
  const main = (list ?? "").split("|")[0]!;
  for (const entry of main.split(",").filter(Boolean)) {
    const [id, count] = entry.split(":");
    const n = Number(count);
    const no = id ? pool.get(id)?.no : undefined;
    if (!no || !Number.isFinite(n) || n <= 0) unknown.push(entry);
    else cards[no] = (cards[no] ?? 0) + n;
  }
  return { cards, unknown };
}

/** "Strike Freedom Gundam (Victory Gundam)": lead card and first secondary card, as Egman shows them. */
export function archetypeName(pool: CardPool, lead: string, secondary: string[]): string {
  const name = (no: string) => pool.get(no)?.name ?? no;
  return secondary[0] ? `${name(lead)} (${name(secondary[0])})` : name(lead);
}

/** The Limitless tournament id in a source URL, if any. */
export function limitlessId(source: string | null): string | null {
  return source?.match(/limitlesstcg\.com\/tournament\/([0-9a-f]+)/i)?.[1] ?? null;
}

/** Tournaments and decks of the snapshot window from Egman's JSON. */
export function fromEgman(
  pool: CardPool,
  data: EgmanTournament[],
  options: EgmanOptions,
): { tournaments: MetaTournament[]; decks: MetaDeck[] } {
  const fromTime = Date.parse(options.from);
  const toTime = Date.parse(options.to) + 86_400_000;
  const tournaments: MetaTournament[] = [];
  const decks: MetaDeck[] = [];
  for (const t of data) {
    const time = Date.parse(t.start_date);
    if (!(time >= fromTime && time < toTime)) continue;
    // Events without a player count are kept with the minimum (their size is unknown).
    const players = t.player_count ?? options.minPlayers;
    if (players < options.minPlayers) continue;
    const lim = limitlessId(t.source);
    if (lim && options.skipLimitless?.has(lim)) continue; // already in the snapshot from Limitless
    if (options.skipEvents?.has(sameEvent(t.start_date, t.tournament_name))) continue;
    const id = `egman:${t.id}`;
    const top: MetaDeck[] = [];
    for (const r of t.tournament_results ?? []) {
      if (r.placement === null || r.placement > options.topN || !r.deck_list_url?.[0]) continue;
      const { cards, unknown } = parseDeckUrl(pool, r.deck_list_url[0]);
      if (!Object.keys(cards).length) continue;
      const lead = r.deck_type ?? "";
      const secondary = r.deck_type_secondary ?? [];
      top.push({
        tournament: id,
        placing: r.placement,
        record: { wins: r.wins ?? 0, losses: r.losses ?? 0, ties: r.ties ?? 0 },
        archetypeId: lead ? `egman:${[lead, ...secondary.slice(0, 1)].join("+")}` : "other",
        archetype: lead ? archetypeName(pool, lead, secondary) : "Other",
        soft: true,
        cards,
        unknown,
      });
    }
    if (!top.length) continue;
    tournaments.push({
      id,
      name: t.tournament_name,
      date: t.start_date.slice(0, 10),
      players,
      source: "egman",
      ...(t.event_type ? { kind: t.event_type } : {}),
    });
    decks.push(...top);
  }
  return { tournaments, decks };
}

/** Loads Egman's tournament JSON (one request). */
export async function fetchEgman(f: typeof fetch = fetch): Promise<EgmanTournament[]> {
  const response = await f(EGMAN_URL, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${EGMAN_URL}: HTTP ${response.status}`);
  return (await response.json()) as EgmanTournament[];
}

/** Adds Egman's tournaments and decks to a Limitless snapshot. */
export function withEgman(
  snapshot: MetaSnapshot,
  egman: { tournaments: MetaTournament[]; decks: MetaDeck[] },
): MetaSnapshot {
  if (!egman.tournaments.length) return snapshot;
  return {
    ...snapshot,
    source: "limitless+egman",
    tournaments: [...snapshot.tournaments, ...egman.tournaments].sort((a, b) => a.date.localeCompare(b.date)),
    decks: [...snapshot.decks, ...egman.decks],
  };
}

/**
 * The Egman part of a snapshot within a date window. The browser reloads only Limitless and keeps
 * these (it never asks Egman itself).
 */
export function egmanPart(
  snapshot: MetaSnapshot | undefined,
  from: string,
  to: string,
): { tournaments: MetaTournament[]; decks: MetaDeck[] } {
  const tournaments = (snapshot?.tournaments ?? []).filter(
    (t) => t.source === "egman" && t.date >= from && t.date <= to,
  );
  const ids = new Set(tournaments.map((t) => t.id));
  return { tournaments, decks: (snapshot?.decks ?? []).filter((d) => ids.has(d.tournament)) };
}
