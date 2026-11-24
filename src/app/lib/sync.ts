// Cloud sync of own decks (PWA only, not in the lab): sign in with Google, then own decks are kept on the
// sync server (tools/sync-server.ts, docs/SYNC.md) and every device; decks of the other signed-in users
// can be seen and copied. The browser keeps working offline: decks are stored locally first and synced
// when possible (on start, after a change, when back online or back in the foreground).
//
// Rules: the last change wins (updatedAt); deleting while offline is remembered and sent later; local decks
// without an owner are uploaded by whoever signs in on this device.

import { GOOGLE_CLIENT_ID, SYNC_ORIGIN } from "../../sync/config";
import type { DeckUpload, SyncDeck, SyncUser } from "../../sync/types";
import { db, type UserDeck } from "./db";
import { setSharedDecks, setUserDecks } from "./decks";

const ACCOUNT_KEY = "gcg-battle-simulator.sync";
const DELETED_KEY = "gcg-battle-simulator.sync-deleted";
const ORIGIN_KEY = "gcg-battle-simulator.sync-origin";

export interface SyncState {
  user: SyncUser | null;
  busy: boolean;
  /** Time of the last successful sync. */
  lastSync: Date | null;
  error: string | null;
  /** Decks of the other users (not deleted). */
  shared: SyncDeck[];
}

export const syncAvailable = !__LAB__;

const state: SyncState = { user: null, busy: false, lastSync: null, error: null, shared: [] };
const listeners = new Set<(s: SyncState) => void>();

/** Calls `fn` now and on every change; returns the unsubscribe function. */
export function onSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

function update(patch: Partial<SyncState>) {
  Object.assign(state, patch);
  for (const fn of listeners) fn({ ...state });
}

// --- Stored values ---------------------------------------------------------------------------------------

function read<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window: works until the page is closed.
  }
}

let account = read<{ token: string; user: SyncUser }>(ACCOUNT_KEY);
if (account) state.user = account.user;

/** Server address (a different one can be set for development: localStorage …sync-origin). */
const origin = () => read<string>(ORIGIN_KEY) ?? SYNC_ORIGIN;

class SyncError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (account) headers.Authorization = `Bearer ${account.token}`;
  if (init.body) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${origin()}/api/${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SyncError(0, "Server nicht erreichbar.");
  }
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok)
    throw new SyncError(
      response.status,
      (body as { error?: string } | null)?.error ?? `HTTP ${response.status}`,
    );
  return body as T;
}

// --- Google sign-in -----------------------------------------------------------------------------------------

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let gis: Promise<GoogleId> | undefined;
function loadGoogle(): Promise<GoogleId> {
  gis ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      const id = window.google?.accounts.id;
      if (!id) return reject(new Error("Google-Anmeldung nicht verfügbar."));
      id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => void signedIn(r.credential) });
      resolve(id);
    };
    script.onerror = () => {
      gis = undefined;
      reject(new Error("Google-Anmeldung konnte nicht geladen werden."));
    };
    document.head.append(script);
  });
  return gis;
}

/** Shows Google's sign-in button in `el`. */
export async function renderSignIn(el: HTMLElement): Promise<void> {
  try {
    const id = await loadGoogle();
    id.renderButton(el, {
      theme: "filled_black",
      size: "large",
      text: "signin_with",
      shape: "pill",
      locale: "de",
    });
  } catch (e) {
    update({ error: e instanceof Error ? e.message : String(e) });
  }
}

async function signedIn(credential: string) {
  update({ busy: true, error: null });
  try {
    const result = await api<{ token: string; user: SyncUser }>("auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
    account = result;
    write(ACCOUNT_KEY, account);
    update({ user: account.user, busy: false });
    await sync();
  } catch (e) {
    update({ busy: false, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function signOut(): Promise<void> {
  const token = account?.token;
  account = undefined;
  write(ACCOUNT_KEY, undefined);
  write(DELETED_KEY, undefined);
  window.google?.accounts.id.disableAutoSelect();
  setSharedDecks([]);
  update({ user: null, shared: [], lastSync: null, error: null });
  if (token)
    await fetch(`${origin()}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
}

// --- Syncing --------------------------------------------------------------------------------------------------

/** Remembers a deleted own deck (sent with the next sync). */
export function deckDeleted(d: UserDeck): void {
  if (!account || (d.owner && d.owner !== account.user.id)) return;
  const pending = read<{ id: string; at: string }[]>(DELETED_KEY) ?? [];
  write(DELETED_KEY, [...pending.filter((p) => p.id !== d.id), { id: d.id, at: new Date().toISOString() }]);
  void sync();
}

const upload = (d: UserDeck, extra: Partial<DeckUpload> = {}): DeckUpload => ({
  id: d.id,
  name: d.name,
  deck: { main: [...d.deck.main], resources: [...d.deck.resources] },
  updatedAt: d.updatedAt,
  ...(d.note ? { note: d.note } : {}),
  ...(d.copiedFrom ? { copiedFrom: d.copiedFrom } : {}),
  ...extra,
});

const local = (s: SyncDeck): UserDeck => ({
  id: s.id,
  name: s.name,
  deck: s.deck,
  updatedAt: s.updatedAt,
  owner: s.owner,
  ...(s.note ? { note: s.note } : {}),
  ...(s.copiedFrom ? { copiedFrom: s.copiedFrom } : {}),
});

let running: Promise<void> | undefined;
let again = false;

/** Syncs now (a sync asked for while one runs follows right after it). */
export function sync(): Promise<void> {
  if (!syncAvailable || !account) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again && account);
  })().finally(() => (running = undefined));
  return running;
}

async function syncOnce(): Promise<void> {
  const me = account?.user.id;
  if (!me) return;
  update({ busy: true });
  try {
    const server = new Map((await api<SyncDeck[]>("decks")).map((d) => [d.id, d]));
    const put = async (u: DeckUpload) => {
      const saved = await api<SyncDeck>(`decks/${encodeURIComponent(u.id)}`, {
        method: "PUT",
        body: JSON.stringify(u),
      });
      server.set(saved.id, saved);
      return saved;
    };

    // Deletions made on this device.
    for (const p of read<{ id: string; at: string }[]>(DELETED_KEY) ?? []) {
      const s = server.get(p.id);
      if (s && s.owner === me && !s.deleted && s.updatedAt < p.at)
        await put({ ...upload(local(s)), deleted: true, updatedAt: p.at });
    }
    write(DELETED_KEY, undefined);

    const mine = new Set<string>();
    for (const l of await db.decks.all()) {
      let d = l;
      // Another account's deck from an earlier sign-in on this device: it is on the server (shown there).
      if (d.owner && d.owner !== me) {
        await db.decks.delete(d.id);
        continue;
      }
      let s = server.get(d.id);
      if (s && s.owner !== me) {
        // Same id as someone else's deck (practically never): keep ours under a new id.
        await db.decks.delete(d.id);
        d = { ...d, id: `u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
        s = undefined;
      }
      if (s?.deleted && s.updatedAt >= d.updatedAt) {
        await db.decks.delete(d.id);
        continue;
      }
      if (!s || s.deleted || d.updatedAt > s.updatedAt) s = await put(upload(d));
      const next = local(s);
      if (JSON.stringify(next) !== JSON.stringify(d)) await db.decks.put(next);
      mine.add(d.id);
    }
    for (const s of server.values())
      if (s.owner === me && !s.deleted && !mine.has(s.id)) await db.decks.put(local(s));

    const shared = [...server.values()]
      .filter((s) => s.owner !== me && !s.deleted)
      .sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.name.localeCompare(b.name));
    setUserDecks(await db.decks.all());
    setSharedDecks(shared);
    update({ busy: false, lastSync: new Date(), error: null, shared });
  } catch (e) {
    if (e instanceof SyncError && e.status === 401) {
      // Session ended (or the account was taken off the list): sign in again.
      await signOut();
      update({ busy: false, error: "Bitte neu anmelden." });
      return;
    }
    update({ busy: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Starts syncing on load, when back online and when the app comes back to the foreground. */
export function startSync(): void {
  if (!syncAvailable) return;
  void sync();
  addEventListener("online", () => void sync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void sync();
  });
}
