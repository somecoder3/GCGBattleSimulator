// Storage of the sync server (SQLite built into Node): users, sessions and decks. Node only.
//
// Sessions: the client gets a random token once; only its SHA-256 is stored. Decks: last change wins
// (by the client's updatedAt); deleted decks stay as markers so that other devices delete them too.

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LIMITS, type DeckUpload, type SyncDeck, type SyncUser } from "./types";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    used_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS decks_owner ON decks(owner);
`;

/** Sessions end after this long without use. */
export const SESSION_IDLE_MS = 180 * 24 * 3600 * 1000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

interface DeckRow {
  id: string;
  owner: string;
  updated_at: string;
  deleted: number;
  data: string;
  owner_name: string;
}

export type PutResult = { ok: true; deck: SyncDeck } | { ok: false; reason: "owner" | "limit" };

export class SyncStore {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  /** Creates or updates the user and starts a session; returns the session token. */
  signIn(user: SyncUser, now = Date.now()): string {
    this.db
      .prepare(
        `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
      )
      .run(user.id, user.email, user.name, new Date(now).toISOString());
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO sessions (token_hash, user_id, created_at, used_at) VALUES (?, ?, ?, ?)")
      .run(hash(token), user.id, now, now);
    return token;
  }

  /** The user of a valid session (and marks it as used). */
  session(token: string, now = Date.now()): SyncUser | undefined {
    const row = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, s.used_at FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(hash(token)) as (SyncUser & { used_at: number }) | undefined;
    if (!row) return undefined;
    if (now - row.used_at > SESSION_IDLE_MS) {
      this.signOut(token);
      return undefined;
    }
    // Only write once an hour, not on every request.
    if (now - row.used_at > 3600_000)
      this.db.prepare("UPDATE sessions SET used_at = ? WHERE token_hash = ?").run(now, hash(token));
    return { id: row.id, email: row.email, name: row.name };
  }

  signOut(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
  }

  /** Ends sessions of users that are no longer allowed (allow list changed). */
  dropSessionsExcept(emails: Set<string>): number {
    const users = this.db.prepare("SELECT id, email FROM users").all() as { id: string; email: string }[];
    let n = 0;
    for (const u of users)
      if (!emails.has(u.email))
        n += Number(this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id).changes);
    return n;
  }

  /** All decks of all users, deleted ones as markers. */
  decks(): SyncDeck[] {
    const rows = this.db
      .prepare(
        `SELECT d.id, d.owner, d.updated_at, d.deleted, d.data, u.name AS owner_name
         FROM decks d JOIN users u ON u.id = d.owner ORDER BY d.updated_at`,
      )
      .all() as unknown as DeckRow[];
    return rows.map(toDeck);
  }

  private deck(id: string): SyncDeck | undefined {
    const row = this.db
      .prepare(
        `SELECT d.id, d.owner, d.updated_at, d.deleted, d.data, u.name AS owner_name
         FROM decks d JOIN users u ON u.id = d.owner WHERE d.id = ?`,
      )
      .get(id) as DeckRow | undefined;
    return row && toDeck(row);
  }

  /** Saves a deck of `user` unless the server has a newer version; returns what the server now has. */
  put(user: SyncUser, upload: DeckUpload): PutResult {
    const current = this.deck(upload.id);
    if (current && current.owner !== user.id) return { ok: false, reason: "owner" };
    if (current && current.updatedAt >= upload.updatedAt) return { ok: true, deck: current };
    if (!current && !upload.deleted) {
      const { n } = this.db
        .prepare("SELECT COUNT(*) AS n FROM decks WHERE owner = ? AND deleted = 0")
        .get(user.id) as { n: number };
      if (n >= LIMITS.decksPerUser) return { ok: false, reason: "limit" };
    }
    const data: Omit<SyncDeck, "id" | "owner" | "ownerName" | "updatedAt" | "deleted"> = {
      name: upload.name,
      deck: { main: upload.deck.main, resources: upload.deck.resources },
      ...(upload.note ? { note: upload.note } : {}),
      ...(upload.copiedFrom ? { copiedFrom: upload.copiedFrom } : {}),
    };
    this.db
      .prepare(
        `INSERT INTO decks (id, owner, updated_at, deleted, data) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, deleted = excluded.deleted,
           data = excluded.data`,
      )
      .run(upload.id, user.id, upload.updatedAt, upload.deleted ? 1 : 0, JSON.stringify(data));
    return { ok: true, deck: this.deck(upload.id)! };
  }

  close(): void {
    this.db.close();
  }
}

function toDeck(row: DeckRow): SyncDeck {
  const data = JSON.parse(row.data) as Omit<SyncDeck, "id" | "owner" | "ownerName" | "updatedAt">;
  return {
    ...data,
    id: row.id,
    owner: row.owner,
    ownerName: row.owner_name,
    updatedAt: row.updated_at,
    ...(row.deleted ? { deleted: true } : {}),
  };
}
