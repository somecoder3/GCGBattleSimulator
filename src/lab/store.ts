// The lab's storage on disk (SQLite, built into Node): simulation runs with a hash index of their games,
// the lab's decks and small values such as a reloaded meta snapshot. Node only (the lab server).

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import type { DeckList } from "../engine/types";
import { jobHasher, normalizeHash } from "../sim/gamehash";
import type { GameSummary, SimJob } from "../sim/runner";

/** A saved run as the app knows it (same shape as the former IndexedDB store). */
export interface LabRun {
  id?: number;
  name: string;
  createdAt: string;
  job: SimJob;
  games: GameSummary[];
  /** Deck names by id at the time of the run. */
  deckNames: Record<string, string>;
  /** Version of engine and AI code the run was played with (see version.ts). */
  codeVersion?: string;
}

/** A run in the list: without its games. */
export type LabRunInfo = Omit<LabRun, "games" | "job"> & { id: number; games: number; decks: number };

export interface LabDeck {
  id: string;
  name: string;
  deck: DeckList;
  updatedAt: string;
  note?: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    code_version TEXT,
    game_count INTEGER NOT NULL,
    deck_count INTEGER NOT NULL,
    deck_names TEXT NOT NULL,
    job TEXT NOT NULL,
    games BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_hashes (
    hash TEXT NOT NULL,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS game_hashes_hash ON game_hashes(hash);
  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

interface RunRow {
  id: number;
  name: string;
  created_at: string;
  code_version: string | null;
  game_count: number;
  deck_count: number;
  deck_names: string;
  job: string;
  games: Uint8Array;
}

export class LabStore {
  readonly db: DatabaseSync;

  /** `file` = path of the database, ":memory:" for tests. */
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // --- runs -------------------------------------------------------------------------------------------

  /** Saves a run and indexes the hashes of its games; returns its id. */
  addRun(run: LabRun): number {
    const games = gzipSync(JSON.stringify(run.games));
    const insert = this.db.prepare(
      `INSERT INTO runs (name, created_at, code_version, game_count, deck_count, deck_names, job, games)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const hashes = this.db.prepare("INSERT INTO game_hashes (hash, run_id, idx) VALUES (?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      const { lastInsertRowid } = insert.run(
        run.name,
        run.createdAt,
        run.codeVersion ?? null,
        run.games.length,
        run.job.decks.length,
        JSON.stringify(run.deckNames),
        JSON.stringify(run.job),
        games,
      );
      const id = Number(lastInsertRowid);
      const hashOf = jobHasher(run.job);
      for (const g of run.games) hashes.run(hashOf(g.index), id, g.index);
      this.db.exec("COMMIT");
      return id;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** All runs, newest first, without games. */
  runs(): LabRunInfo[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, created_at, code_version, game_count, deck_count, deck_names FROM runs
         ORDER BY created_at DESC, id DESC`,
      )
      .all() as unknown as Omit<RunRow, "job" | "games">[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      ...(r.code_version ? { codeVersion: r.code_version } : {}),
      games: r.game_count,
      decks: r.deck_count,
      deckNames: JSON.parse(r.deck_names) as Record<string, string>,
    }));
  }

  run(id: number): LabRun | undefined {
    const r = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as unknown as RunRow | undefined;
    if (!r) return undefined;
    return {
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      ...(r.code_version ? { codeVersion: r.code_version } : {}),
      deckNames: JSON.parse(r.deck_names) as Record<string, string>,
      job: JSON.parse(r.job) as SimJob,
      games: JSON.parse(gunzipSync(r.games).toString("utf8")) as GameSummary[],
    };
  }

  deleteRun(id: number): boolean {
    return this.db.prepare("DELETE FROM runs WHERE id = ?").run(id).changes > 0;
  }

  /** Is a run with this name and creation time already stored? (Import of old browser runs.) */
  hasRun(name: string, createdAt: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM runs WHERE name = ? AND created_at = ?").get(name, createdAt);
  }

  /** The newest run holding the game with this hash. */
  findGame(hash: string): { runId: number; index: number } | undefined {
    const row = this.db
      .prepare(
        `SELECT run_id, idx FROM game_hashes JOIN runs ON runs.id = run_id WHERE hash = ?
         ORDER BY runs.created_at DESC LIMIT 1`,
      )
      .get(normalizeHash(hash)) as { run_id: number; idx: number } | undefined;
    return row ? { runId: row.run_id, index: row.idx } : undefined;
  }

  // --- decks ------------------------------------------------------------------------------------------

  decks(): LabDeck[] {
    const rows = this.db.prepare("SELECT data FROM decks ORDER BY name").all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as LabDeck);
  }

  putDeck(deck: LabDeck): void {
    this.db
      .prepare(
        `INSERT INTO decks (id, name, updated_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, data = excluded.data`,
      )
      .run(deck.id, deck.name, deck.updatedAt, JSON.stringify(deck));
  }

  deleteDeck(id: string): boolean {
    return this.db.prepare("DELETE FROM decks WHERE id = ?").run(id).changes > 0;
  }

  // --- small values -----------------------------------------------------------------------------------

  get<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, JSON.stringify(value));
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }
}
