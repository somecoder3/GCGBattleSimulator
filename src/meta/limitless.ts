// Limitless TCG API (play.limitlesstcg.com, game GUNDAM; sends Access-Control-Allow-Origin: *, so it
// works from the browser too). Builds a meta snapshot: the top placings of recent tournaments.

import type { CardPool } from "../data/cards";
import type { MetaDeck, MetaPairing, MetaSnapshot, MetaTournament } from "./types";

export const LIMITLESS_API = "https://play.limitlesstcg.com/api";

interface ApiTournament {
  id: string;
  name: string;
  date: string;
  players: number;
}

interface ApiCard {
  count: number;
  name: string;
  set: string;
  number: string;
}

interface ApiStanding {
  /** Player handle: only used to connect the pairings with the decks, never stored. */
  player?: string;
  placing: number | null;
  record: { wins: number; losses: number; ties: number } | null;
  deck: { id: string; name: string } | null;
  decklist: Record<string, ApiCard[]> | null;
  drop: number | null;
}

interface ApiPairing {
  round: number;
  player1: string | null;
  player2: string | null;
  /** The winner's handle, "0" (or anything else) for a draw. */
  winner: string | number | null;
}

/**
 * The games of one tournament's pairings between kept placings (both players with a deck list in the
 * snapshot), by placing: the player handles are only used here and never stored.
 */
export function toPairings(
  tournament: string,
  standings: ApiStanding[],
  pairings: ApiPairing[],
  kept: (placing: number) => boolean,
): MetaPairing[] {
  const placingOf = new Map<string, number>();
  for (const s of standings)
    if (s.player && s.placing !== null && kept(s.placing)) placingOf.set(s.player, s.placing);
  const out: MetaPairing[] = [];
  for (const p of pairings) {
    if (!p.player1 || !p.player2) continue; // bye
    const a = placingOf.get(p.player1);
    const b = placingOf.get(p.player2);
    if (a === undefined || b === undefined) continue;
    const result = p.winner === p.player1 ? 1 : p.winner === p.player2 ? 2 : 0;
    out.push({ tournament, a, b, result });
  }
  return out;
}

export interface SnapshotOptions {
  /** Tournaments from this day on (inclusive), ISO date. */
  from: string;
  to: string;
  minPlayers: number;
  topN: number;
  /** Pause between requests (be polite to the API). */
  delayMs?: number;
  fetch?: typeof fetch;
  onProgress?: (text: string) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson<T>(f: typeof fetch, url: string): Promise<T> {
  const response = await f(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** "GD05" + "069" → "GD05-069" if GCGDB has it. */
export function cardNo(pool: CardPool, card: ApiCard): string | undefined {
  const no = `${card.set}-${card.number}`.toUpperCase();
  return pool.get(no)?.no;
}

export function toMetaDeck(pool: CardPool, tournament: string, s: ApiStanding): MetaDeck | null {
  if (!s.decklist || s.placing === null) return null;
  const cards: Record<string, number> = {};
  const unknown: string[] = [];
  for (const entries of Object.values(s.decklist)) {
    for (const entry of entries) {
      const no = cardNo(pool, entry);
      if (!no) unknown.push(`${entry.set}-${entry.number} ${entry.name.replace(/\u200b/g, "")}`);
      else cards[no] = (cards[no] ?? 0) + entry.count;
    }
  }
  return {
    tournament,
    placing: s.placing,
    record: s.record ?? { wins: 0, losses: 0, ties: 0 },
    archetypeId: s.deck?.id ?? "other",
    archetype: s.deck?.name ?? "Other",
    cards,
    unknown,
  };
}

export async function fetchSnapshot(pool: CardPool, options: SnapshotOptions): Promise<MetaSnapshot> {
  const f = options.fetch ?? fetch;
  const delay = options.delayMs ?? 400;
  const log = options.onProgress ?? (() => {});
  const fromTime = Date.parse(options.from);
  const toTime = Date.parse(options.to) + 24 * 3600 * 1000;

  const listed = await getJson<ApiTournament[]>(f, `${LIMITLESS_API}/tournaments?game=GUNDAM&limit=500`);
  const tournaments: MetaTournament[] = listed
    .filter((t) => {
      const time = Date.parse(t.date);
      return time >= fromTime && time < toTime && t.players >= options.minPlayers;
    })
    .map((t) => ({ id: t.id, name: t.name, date: t.date.slice(0, 10), players: t.players }))
    .sort((a, b) => a.date.localeCompare(b.date));
  log(`${tournaments.length} Turniere ab ${options.minPlayers} Spielern`);

  const decks: MetaDeck[] = [];
  const pairings: MetaPairing[] = [];
  for (const [i, t] of tournaments.entries()) {
    await sleep(delay);
    const standings = await getJson<ApiStanding[]>(f, `${LIMITLESS_API}/tournaments/${t.id}/standings`);
    const top = standings
      .filter((s) => s.placing !== null && s.placing <= options.topN)
      .map((s) => toMetaDeck(pool, t.id, s))
      .filter((d): d is MetaDeck => d !== null);
    decks.push(...top);
    // Real matchups of all players (deck lists or not), for the calibration of the AI (docs/DECKSEARCH.md).
    let games = 0;
    try {
      await sleep(delay);
      const raw = await getJson<ApiPairing[]>(f, `${LIMITLESS_API}/tournaments/${t.id}/pairings`);
      const kept = new Set(top.map((d) => d.placing));
      const found = toPairings(t.id, standings, raw, (p) => kept.has(p));
      pairings.push(...found);
      games = found.length;
    } catch {
      // no pairings: the matchups of this tournament are missing
    }
    log(`${i + 1}/${tournaments.length} ${t.date} ${t.name}: ${top.length} Decks, ${games} Paarungen`);
  }

  return {
    version: 1,
    source: "limitless",
    createdAt: new Date().toISOString(),
    from: options.from,
    to: options.to,
    minPlayers: options.minPlayers,
    topN: options.topN,
    tournaments,
    decks,
    pairings,
  };
}
