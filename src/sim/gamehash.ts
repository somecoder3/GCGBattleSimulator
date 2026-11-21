// A short, searchable hash per simulated game (user's wish, 20 Nov 2026).
//
// A game follows from its job and its index (runner.ts), so the hash is computed from exactly what decides
// the game: decks (ids and lists), AIs, seed, pairing mode, rules, weights, mulligans, turn limit. Fields
// that don't change a game (number of games, deck names, meta shares, card statistics, checks) are left
// out: the same game in a larger run keeps its hash. Nothing has to be stored; saved runs are searched by
// computing the hashes again.

import type { SimJob } from "./runner";

/** cyrb53 (public domain): a fast 53-bit string hash. */
export function cyrb53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** JSON with sorted keys, so that the order of fields never changes the hash. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The part of a job that decides its games. */
export function jobKey(job: SimJob): string {
  return stable({
    decks: job.decks.map((d) => ({ id: d.id, deck: d.deck })),
    mirrors: job.mirrors ?? true,
    mode: job.mode ?? "pairs",
    focus: job.mode === "gauntlet" ? job.focus : undefined,
    ai: job.ai,
    weights: job.weights,
    mulligans: job.mulligans,
    rules: job.rules,
    seed: job.seed,
    maxTurns: job.maxTurns,
  });
}

const LENGTH = 10;
const SPACE = 36 ** LENGTH;

function format(n: number): string {
  return (n % SPACE).toString(36).padStart(LENGTH, "0");
}

/** Hashes all games of one job (the job is read once). */
export function jobHasher(job: SimJob): (index: number) => string {
  const base = cyrb53(jobKey(job)).toString(36);
  return (index) => format(cyrb53(`${base}#${index}`));
}

/** The hash of game `index` of `job`, 10 characters (0-9, a-z). */
export function gameHash(job: SimJob, index: number): string {
  return jobHasher(job)(index);
}

/** Normalizes what the user typed (spaces, upper case). */
export function normalizeHash(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z]/g, "");
}

/** Finds a game by its hash in a list of jobs (e.g. the saved runs). */
export function findGame<T extends { job: SimJob }>(
  runs: readonly T[],
  hash: string,
): { run: T; index: number } | undefined {
  const wanted = normalizeHash(hash);
  if (wanted.length !== LENGTH) return undefined;
  for (const run of runs) {
    const hashOf = jobHasher(run.job);
    for (let i = 0; i < run.job.games; i++) if (hashOf(i) === wanted) return { run, index: i };
  }
  return undefined;
}
