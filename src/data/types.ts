// Card data model used by the simulator, derived from GCGDB's data/cards.json (schema 2).

export const CARD_TYPES = [
  "UNIT",
  "PILOT",
  "COMMAND",
  "BASE",
  "RESOURCE",
  "UNIT TOKEN",
  "EX BASE",
  "EX RESOURCE",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const COLORS = ["Blue", "Green", "Red", "White", "Purple"] as const;
export type Color = (typeof COLORS)[number];

export const ZONES = ["Space", "Earth"] as const;
export type Zone = (typeof ZONES)[number];

/** One alternative of a link condition: a pilot whose name contains `pilotName`, or a pilot with `trait`. */
export type LinkCondition = { pilotName: string } | { trait: string };

export interface Printing {
  /** ExBurst id, e.g. GD06-002-ALT1 (the key in GCGDB). */
  id: string;
  alt: number;
  rarity: string;
  /** Image file name of the official image, e.g. GD06-002_p1.webp. */
  image: string;
}

export interface CardDef {
  /** Card number, e.g. GD06-002. Cards with the same number are the same card in the game (2-1-1). */
  no: string;
  set: string;
  name: string;
  type: CardType;
  /** null for Resources and tokens (2-4-2). */
  color: Color | null;
  level: number | null;
  cost: number | null;
  ap: number | null;
  hp: number | null;
  zones: Zone[];
  traits: string[];
  /** Alternatives (OR). Empty if the card has no link condition. */
  link: LinkCondition[];
  sourceTitle: string;
  /** Effect text in English as printed, with line breaks. Empty string if none. */
  text: string;
  printings: Printing[];
  /** True for tokens (set T, EX Base/Resource) and Resources: not allowed in the main deck. */
  token: boolean;
}

// Raw shape of data/cards.json, only the fields we use.
export interface RawCardsDoc {
  schema: number;
  meta: Record<string, string>;
  cards: RawCard[];
  variants: RawVariant[];
}

export interface RawCard {
  cardNo: string;
  set: string;
  name: string;
  type: string;
  color?: string | null;
  level?: number | null;
  cost?: number | null;
  ap?: number | null;
  hp?: number | null;
  zone?: string | null;
  trait?: string | null;
  link?: string | null;
  sourceTitle?: string | null;
  effect?: string | null;
}

export interface RawVariant {
  id: string;
  cardNo: string;
  alt: number;
  rarity: string;
  image: string;
}
