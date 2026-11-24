// Shared between the sync server (src/sync/server.ts) and the app (src/app/lib/sync.ts).

import type { DeckList } from "../engine/types";

export interface SyncUser {
  id: string;
  name: string;
  email: string;
}

/** A deck on the sync server. Only its owner may change it; every signed-in user can read it. */
export interface SyncDeck {
  id: string;
  /** User id (Google "sub") of the owner. */
  owner: string;
  ownerName: string;
  name: string;
  deck: DeckList;
  note?: string;
  /** Set by the client when the deck was changed (last change wins). */
  updatedAt: string;
  /** Deleted decks stay as a marker, so other devices delete their copy too. */
  deleted?: boolean;
  /** Id of the deck this one was copied from (another user's deck). */
  copiedFrom?: string;
}

/** What a client sends: owner and owner name come from the session. */
export type DeckUpload = Omit<SyncDeck, "owner" | "ownerName">;

export const LIMITS = {
  /** Cards in the main deck / resource deck (generous: the editor allows unfinished decks). */
  cards: 120,
  nameLength: 120,
  noteLength: 2000,
  decksPerUser: 500,
  idLength: 80,
};

const CARD_NO = /^[A-Z0-9]{1,8}-[A-Z0-9]{1,8}$/;
const DECK_ID = /^[\w:.-]+$/;

/** The upload's problem, or undefined if it is fine. */
export function deckProblem(x: unknown): string | undefined {
  const d = x as Partial<DeckUpload> | null;
  if (!d || typeof d !== "object") return "Kein Deck.";
  if (typeof d.id !== "string" || !DECK_ID.test(d.id) || d.id.length > LIMITS.idLength)
    return "Ungültige Id.";
  if (typeof d.name !== "string" || d.name.length > LIMITS.nameLength) return "Ungültiger Name.";
  if (d.note !== undefined && (typeof d.note !== "string" || d.note.length > LIMITS.noteLength))
    return "Ungültige Notiz.";
  if (typeof d.updatedAt !== "string" || Number.isNaN(Date.parse(d.updatedAt))) return "Ungültige Zeit.";
  if (
    d.copiedFrom !== undefined &&
    (typeof d.copiedFrom !== "string" || d.copiedFrom.length > LIMITS.idLength)
  )
    return "Ungültige Herkunft.";
  const list = d.deck;
  if (!list || !Array.isArray(list.main) || !Array.isArray(list.resources)) return "Keine Deckliste.";
  for (const cards of [list.main, list.resources]) {
    if (cards.length > LIMITS.cards) return "Zu viele Karten.";
    if (!cards.every((no) => typeof no === "string" && CARD_NO.test(no))) return "Unbekannte Kartennummer.";
  }
  return undefined;
}
