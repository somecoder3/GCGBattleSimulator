import {
  CARD_TYPES,
  COLORS,
  ZONES,
  type CardDef,
  type CardType,
  type Color,
  type LinkCondition,
  type RawCard,
  type RawCardsDoc,
  type Zone,
} from "./types";

export const SUPPORTED_SCHEMA = 2;

const EMPTY = "-";

function blank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "" || value.trim() === EMPTY;
}

/** "(Earth Federation) (White Base Team)" -> ["Earth Federation", "White Base Team"] */
export function parseTraits(raw: string | null | undefined): string[] {
  if (blank(raw)) return [];
  return [...raw!.matchAll(/\(([^()]+)\)/g)].map((m) => m[1]!.trim());
}

/** "Space Earth" -> ["Space", "Earth"] */
export function parseZones(raw: string | null | undefined): Zone[] {
  if (blank(raw)) return [];
  return raw!.split(/\s+/).filter((z): z is Zone => (ZONES as readonly string[]).includes(z));
}

/**
 * Link conditions as printed: "[Amuro Ray]", "(Newtype) Trait", "(Orb) Trait / [Kira Yamato]",
 * "(Teiwaz) / (Tekkadan) Trait". Pilot names may contain parentheses: "[Amate Yuzuriha (Machu)]".
 */
export function parseLink(raw: string | null | undefined): LinkCondition[] {
  if (blank(raw)) return [];
  const result: LinkCondition[] = [];
  for (const part of raw!.split(/\s+\/\s+/)) {
    const name = part.match(/^\s*\[(.+)\]\s*$/);
    if (name) {
      result.push({ pilotName: name[1]!.trim() });
      continue;
    }
    const trait = part.match(/^\s*\(([^()]+)\)(?:\s+Trait)?\s*$/);
    if (trait) {
      result.push({ trait: trait[1]!.trim() });
      continue;
    }
    throw new Error(`unrecognized link condition part ${JSON.stringify(part)} in ${JSON.stringify(raw)}`);
  }
  return result;
}

function parseType(raw: string, cardNo: string): CardType {
  if ((CARD_TYPES as readonly string[]).includes(raw)) return raw as CardType;
  throw new Error(`${cardNo}: unknown card type ${JSON.stringify(raw)}`);
}

function parseColor(raw: string | null | undefined): Color | null {
  if (blank(raw)) return null;
  if ((COLORS as readonly string[]).includes(raw!)) return raw as Color;
  throw new Error(`unknown color ${JSON.stringify(raw)}`);
}

function num(value: number | null | undefined): number | null {
  return typeof value === "number" ? value : null;
}

// gundam-gcg.com prints "-" as the AP of some Units whose card shows AP 0 (e.g. GD01-048), and GCGDB
// stores that as null. Units always have AP and HP in the game (3-2-5), so missing values become 0.
const HAS_STATS = new Set<CardType>(["UNIT", "UNIT TOKEN"]);

function toCardDef(raw: RawCard): CardDef {
  const type = parseType(raw.type, raw.cardNo);
  const stat = (value: number | null | undefined) => num(value) ?? (HAS_STATS.has(type) ? 0 : null);
  return {
    no: raw.cardNo,
    set: raw.set,
    name: raw.name,
    type,
    color: parseColor(raw.color),
    level: num(raw.level),
    cost: num(raw.cost),
    ap: stat(raw.ap),
    hp: stat(raw.hp),
    zones: parseZones(raw.zone),
    traits: parseTraits(raw.trait),
    link: parseLink(raw.link),
    sourceTitle: blank(raw.sourceTitle) ? "" : raw.sourceTitle!,
    text: blank(raw.effect) ? "" : raw.effect!,
    printings: [],
    // Set "T" also holds Base tokens typed BASE (T-037).
    token:
      raw.set === "T" ||
      type === "UNIT TOKEN" ||
      type === "EX BASE" ||
      type === "EX RESOURCE" ||
      type === "RESOURCE",
  };
}

export class CardPool {
  readonly cards: readonly CardDef[];
  readonly builtAt: string;
  private readonly byNo: Map<string, CardDef>;

  constructor(doc: RawCardsDoc) {
    if (!doc || typeof doc.schema !== "number" || doc.schema > SUPPORTED_SCHEMA) {
      throw new Error(`unsupported cards.json schema ${doc?.schema}`);
    }
    this.builtAt = doc.meta?.built_at ?? "";
    this.byNo = new Map(doc.cards.map((raw) => [raw.cardNo, toCardDef(raw)]));
    for (const v of doc.variants) {
      this.byNo.get(v.cardNo)?.printings.push({ id: v.id, alt: v.alt, rarity: v.rarity, image: v.image });
    }
    for (const card of this.byNo.values()) card.printings.sort((a, b) => a.alt - b.alt);
    this.cards = [...this.byNo.values()];
  }

  /** Card by card number (GD06-002). Alt-art ids (GD06-002-ALT1, GD06-002_p1) resolve to the card. */
  get(id: string): CardDef | undefined {
    const no = id
      .trim()
      .toUpperCase()
      .replace(/(-ALT\d+|_P\d+)$/, "");
    return this.byNo.get(no);
  }

  sets(): string[] {
    return [...new Set(this.cards.map((c) => c.set))].sort();
  }
}

/** Image URL relative to the app (served from build/images by the dev server). */
export function cardImageUrl(card: CardDef, size: "small" | "full" = "small", alt = 0): string {
  const printing = card.printings.find((p) => p.alt === alt) ?? card.printings[0];
  return printing ? `cards/${size}/${printing.image}` : "";
}
