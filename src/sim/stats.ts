// Basic statistics over simulated games: win rates with 95 % intervals per AI, per deck and per
// matchup, first-player advantage, game length, how games end and mulligans.

import type { GameEndReason } from "../engine/types";
import type { GameSummary } from "./runner";

export interface Rate {
  games: number;
  wins: number;
  draws: number;
  /** Wins / games, draws counting as half. */
  rate: number;
  /** 95 % Wilson interval of the rate. */
  low: number;
  high: number;
}

export interface SimStats {
  games: number;
  errors: number;
  turns: number;
  decisions: number;
  msPerGame: number;
  reasons: Partial<Record<GameEndReason, number>>;
  firstPlayer: Rate;
  mulliganRate: number;
  byAi: Record<string, Rate>;
  byDeck: Record<string, Rate>;
  /** matrix[a][b]: results of deck a against deck b (a's point of view). */
  matrix: Record<string, Record<string, Rate>>;
}

/** 95 % Wilson score interval. */
export function wilson(wins: number, games: number, z = 1.96): [number, number] {
  if (!games) return [0, 1];
  const p = wins / games;
  const denom = 1 + (z * z) / games;
  const center = (p + (z * z) / (2 * games)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

class Counter {
  games = 0;
  wins = 0;
  draws = 0;
  add(result: "win" | "loss" | "draw"): void {
    this.games++;
    if (result === "win") this.wins++;
    else if (result === "draw") this.draws++;
  }
  rate(): Rate {
    const score = this.wins + this.draws / 2;
    const [low, high] = wilson(score, this.games);
    return {
      games: this.games,
      wins: this.wins,
      draws: this.draws,
      rate: this.games ? score / this.games : 0,
      low,
      high,
    };
  }
}

function counter<K extends string>(map: Map<K, Counter>, key: K): Counter {
  let c = map.get(key);
  if (!c) map.set(key, (c = new Counter()));
  return c;
}

export function computeStats(games: readonly GameSummary[]): SimStats {
  const ok = games.filter((g) => !g.error);
  const reasons: Partial<Record<GameEndReason, number>> = {};
  const first = new Counter();
  const byAi = new Map<string, Counter>();
  const byDeck = new Map<string, Counter>();
  const matrix = new Map<string, Map<string, Counter>>();
  let turns = 0;
  let decisions = 0;
  let ms = 0;
  let mulligans = 0;

  for (const g of ok) {
    turns += g.turns;
    decisions += g.decisions;
    ms += g.ms;
    mulligans += Number(g.mulligans[0]) + Number(g.mulligans[1]);
    reasons[g.reason] = (reasons[g.reason] ?? 0) + 1;
    const result = (seat: 0 | 1) => (g.winner === null ? "draw" : g.winner === seat ? "win" : "loss");
    first.add(result(g.firstPlayer));
    // Mirror games say nothing about AI or deck strength.
    if (g.ai[0] !== g.ai[1]) for (const seat of [0, 1] as const) counter(byAi, g.ai[seat]).add(result(seat));
    if (g.decks[0] !== g.decks[1]) {
      for (const seat of [0, 1] as const) counter(byDeck, g.decks[seat]).add(result(seat));
    }
    for (const seat of [0, 1] as const) {
      const row = matrix.get(g.decks[seat]) ?? new Map<string, Counter>();
      matrix.set(g.decks[seat], row);
      counter(row, g.decks[seat === 0 ? 1 : 0]).add(result(seat));
      if (g.decks[0] === g.decks[1]) break; // a mirror counts once
    }
  }

  const rates = (m: Map<string, Counter>) => Object.fromEntries([...m].map(([k, c]) => [k, c.rate()]));
  const n = ok.length || 1;
  return {
    games: ok.length,
    errors: games.length - ok.length,
    turns: turns / n,
    decisions: decisions / n,
    msPerGame: ms / n,
    reasons,
    firstPlayer: first.rate(),
    mulliganRate: mulligans / (2 * n),
    byAi: rates(byAi),
    byDeck: rates(byDeck),
    matrix: Object.fromEntries([...matrix].map(([k, row]) => [k, rates(row)])),
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

export function formatRate(r: Rate): string {
  return `${pct(r.rate)} (${pct(r.low)}–${pct(r.high)}, ${r.games} Spiele)`;
}

/** Plain-text report for the command line. */
export function formatStats(s: SimStats, deckNames: Record<string, string> = {}): string {
  const lines: string[] = [];
  lines.push(
    `${s.games} Spiele${s.errors ? `, ${s.errors} FEHLER` : ""}; Ø ${s.turns.toFixed(1)} Züge, ` +
      `${s.decisions.toFixed(0)} Entscheidungen, ${s.msPerGame.toFixed(1)} ms Rechenzeit pro Spiel`,
  );
  lines.push(
    `Ende: ${Object.entries(s.reasons)
      .map(([r, n]) => `${r} ${pct(n / Math.max(1, s.games))}`)
      .join(", ")}; Mulligan ${pct(s.mulliganRate)}`,
  );
  lines.push(`Startspieler gewinnt ${formatRate(s.firstPlayer)}`);
  for (const [ai, r] of Object.entries(s.byAi)) lines.push(`KI ${ai}: ${formatRate(r)}`);
  const decks = Object.keys(s.matrix).sort();
  if (decks.length > 1) {
    for (const [deck, r] of Object.entries(s.byDeck).sort((a, b) => b[1].rate - a[1].rate)) {
      lines.push(`Deck ${deckNames[deck] ?? deck}: ${formatRate(r)}`);
    }
    const width = Math.max(...decks.map((d) => d.length), 6);
    lines.push("");
    lines.push(`${"".padEnd(width)}  ${decks.map((d) => d.padStart(8)).join("")}   (Zeile gegen Spalte)`);
    for (const a of decks) {
      const cells = decks.map((b) => {
        const r = s.matrix[a]?.[b];
        return (r ? pct(r.rate).replace(" ", "") : "–").padStart(8);
      });
      lines.push(`${a.padEnd(width)}  ${cells.join("")}`);
    }
  }
  return lines.join("\n");
}
