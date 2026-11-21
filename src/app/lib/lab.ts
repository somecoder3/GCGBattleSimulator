// Client of the lab server's API (src/lab/api.ts).
//
// In the lab (`npm run lab`, __LAB__) the app is served by the lab itself and uses the API for runs,
// simulations, decks and the meta snapshot. The PWA only asks a running lab on this computer for its
// decks ("Labor-Decks"); that is switched on by default on local development servers and can be switched
// on elsewhere (GitHub Pages: Chrome then asks once for access to the local network).

import type { MetaSnapshot } from "../../meta/types";
import type { GameSummary, SimJob } from "../../sim/runner";
import type { SavedRun, UserDeck } from "./db";

export const LAB_ORIGIN = "http://localhost:5180";
const base = () => (__LAB__ ? "" : LAB_ORIGIN);

export interface LabInfo {
  name: string;
  version: string;
  cores: number;
  workers: number;
}

export type LabRunInfo = Omit<SavedRun, "games" | "job"> & { id: number; games: number; decks: number };

export interface LabJobState {
  id: number;
  job: SimJob;
  names: Record<string, string>;
  total: number;
  games: GameSummary[];
  startedAt: number;
  running: boolean;
  runId?: number | null;
  error?: string;
}

export type LabEvent =
  | { type: "state"; state: LabJobState | null }
  | { type: "progress"; done: number; total: number; games: GameSummary[]; elapsed: number }
  | { type: "done"; runId: number | null; done: number; total: number; elapsed: number; error?: string };

async function api<T>(path: string, init?: RequestInit & { timeout?: number }): Promise<T> {
  const signal = init?.timeout ? AbortSignal.timeout(init.timeout) : init?.signal;
  const response = await fetch(`${base()}/api/${path}`, {
    ...init,
    ...(signal ? { signal } : {}),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok) {
    throw new Error((body as { error?: string } | null)?.error ?? `Labor: HTTP ${response.status}`);
  }
  return body as T;
}

const json = (value: unknown) => JSON.stringify(value);

export const lab = {
  info: (timeout?: number) => api<LabInfo>("lab", timeout ? { timeout } : undefined),
  runs: {
    list: () => api<LabRunInfo[]>("runs"),
    get: (id: number) => api<SavedRun>(`runs/${id}`),
    delete: (id: number) => api<unknown>(`runs/${id}`, { method: "DELETE" }),
    import: (runs: SavedRun[]) =>
      api<{ imported: number; skipped: number }>("runs/import", { method: "POST", body: json(runs) }),
  },
  findGame: (hash: string) =>
    api<{ runId: number; index: number }>(`games/find?hash=${encodeURIComponent(hash)}`).catch(
      () => undefined,
    ),
  jobs: {
    current: () => api<LabJobState | null>("jobs/current"),
    start: (job: SimJob, names: Record<string, string>, workers: number) =>
      api<{ id: number }>("jobs", { method: "POST", body: json({ job, names, workers }) }),
    stop: () => api<{ stopped: boolean }>("jobs/stop", { method: "POST" }),
    /** Live events (first the current state); returns a function that closes the stream. */
    events(onEvent: (e: LabEvent) => void): () => void {
      const source = new EventSource(`${base()}/api/jobs/events`);
      source.onmessage = (m: MessageEvent<string>) => onEvent(JSON.parse(m.data) as LabEvent);
      return () => source.close();
    },
  },
  decks: {
    all: (timeout?: number) => api<UserDeck[]>("decks", timeout ? { timeout } : undefined),
    put: (d: UserDeck) => api<unknown>(`decks/${encodeURIComponent(d.id)}`, { method: "PUT", body: json(d) }),
    delete: (id: string) => api<unknown>(`decks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
  meta: {
    get: () => api<MetaSnapshot | null>("meta").then((m) => m ?? undefined),
    put: (snapshot: MetaSnapshot) => api<unknown>("meta", { method: "PUT", body: json(snapshot) }),
    clear: () => api<unknown>("meta", { method: "DELETE" }),
  },
};

// --- The PWA and a running lab --------------------------------------------------------------------------

const CONNECT_KEY = "gcg-battle-simulator.lab-connect";

/** Should the PWA look for a lab on this computer? Default: yes on local servers, no elsewhere. */
export function labConnect(): boolean {
  if (__LAB__) return false;
  try {
    const saved = localStorage.getItem(CONNECT_KEY);
    if (saved !== null) return saved === "1";
  } catch {
    // default below
  }
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}

export function setLabConnect(on: boolean): void {
  try {
    localStorage.setItem(CONNECT_KEY, on ? "1" : "0");
  } catch {
    // only a convenience
  }
}

/** The lab's decks, or undefined if no lab answers (quickly). */
export async function fetchLabDecks(): Promise<UserDeck[] | undefined> {
  try {
    return await lab.decks.all(1500);
  } catch {
    return undefined;
  }
}
