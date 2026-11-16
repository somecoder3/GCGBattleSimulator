// Small IndexedDB store for the app (no library): saved simulation runs, own decks and a cached meta
// snapshot. Everything stays in the browser.

import type { DeckList } from "../../engine/types";
import type { MetaSnapshot } from "../../meta/types";
import type { GameSummary, SimJob } from "../../sim/runner";

export interface SavedRun {
  id?: number;
  name: string;
  createdAt: string;
  job: SimJob;
  games: GameSummary[];
  /** Deck names by id at the time of the run. */
  deckNames: Record<string, string>;
}

export interface UserDeck {
  id: string;
  name: string;
  deck: DeckList;
  updatedAt: string;
  note?: string;
}

const DB_NAME = "gcg-battle-simulator";
const VERSION = 1;
type Store = "runs" | "decks" | "meta";

let opening: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("runs"))
        db.createObjectStore("runs", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("decks")) db.createObjectStore("decks", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB not available"));
  });
  return opening;
}

function run<T>(
  store: Store,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

// Svelte state proxies can't be stored (structured clone); everything goes in as plain JSON data.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const db = {
  runs: {
    all: () => run<SavedRun[]>("runs", "readonly", (s) => s.getAll() as IDBRequest<SavedRun[]>),
    put: (r: SavedRun) => run<IDBValidKey>("runs", "readwrite", (s) => s.put(plain(r))).then(Number),
    delete: (id: number) => run("runs", "readwrite", (s) => s.delete(id)),
  },
  decks: {
    all: () => run<UserDeck[]>("decks", "readonly", (s) => s.getAll() as IDBRequest<UserDeck[]>),
    put: (d: UserDeck) => run("decks", "readwrite", (s) => s.put(plain(d))),
    delete: (id: string) => run("decks", "readwrite", (s) => s.delete(id)),
  },
  meta: {
    get: () =>
      run<MetaSnapshot | undefined>(
        "meta",
        "readonly",
        (s) => s.get("snapshot") as IDBRequest<MetaSnapshot | undefined>,
      ),
    put: (snapshot: MetaSnapshot) => run("meta", "readwrite", (s) => s.put(plain(snapshot), "snapshot")),
    clear: () => run("meta", "readwrite", (s) => s.delete("snapshot")),
  },
};

/** Offers a file to the user (JSON, CSV, deck lists). */
export function download(name: string, text: string, type = "application/json"): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
