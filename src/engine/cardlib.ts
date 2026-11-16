// Static, rules-relevant information per card number, derived once from the card pool.

import type { CardPool } from "../data/cards";
import type { CardDef, CardType, Color, LinkCondition } from "../data/types";

export interface Keywords {
  blocker: boolean;
  firstStrike: boolean;
  highManeuver: boolean;
  suppression: boolean;
  /** Amounts; 0 = keyword absent. Copies add up (13-1-1-2, 13-1-2-5, 13-1-3-2). */
  breach: number;
  repair: number;
  support: number;
}

export const NO_KEYWORDS: Readonly<Keywords> = Object.freeze({
  blocker: false,
  firstStrike: false,
  highManeuver: false,
  suppression: false,
  breach: 0,
  repair: 0,
  support: 0,
});

export interface EngineCard {
  no: string;
  name: string;
  type: CardType;
  color: Color | null;
  level: number;
  cost: number;
  ap: number;
  hp: number;
  traits: string[];
  link: LinkCondition[];
  /** Keywords the card always has (lines starting with the keyword); conditional ones come with effects. */
  keywords: Keywords;
  /** Name used for link conditions when paired: the Pilot's name, or the name after 【Pilot】 on a Command. */
  pilotName: string | null;
  /** Can be paired as a Pilot (Pilot cards and Commands with a Pilot effect, 3-4-6). */
  pairable: boolean;
  token: boolean;
  text: string;
}

const KEYWORD_LINE =
  /^(?:【Activate[･・]Main】)?<(Blocker|First Strike|High-Maneuver|Suppression|Breach|Repair|Support)(?: (\d+))?>/;

/** Keywords on lines that start with the keyword (unconditional). */
export function parseKeywords(text: string): Keywords {
  const k: Keywords = { ...NO_KEYWORDS };
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(KEYWORD_LINE);
    if (!m) continue;
    const amount = Number(m[2] ?? 0);
    switch (m[1]) {
      case "Blocker":
        k.blocker = true;
        break;
      case "First Strike":
        k.firstStrike = true;
        break;
      case "High-Maneuver":
        k.highManeuver = true;
        break;
      case "Suppression":
        k.suppression = true;
        break;
      case "Breach":
        k.breach += amount;
        break;
      case "Repair":
        k.repair += amount;
        break;
      case "Support":
        k.support += amount;
        break;
    }
  }
  return k;
}

/** "【Pilot】[Lowe Guele]" on a Command card -> "Lowe Guele". */
export function commandPilotName(text: string): string | null {
  const m = text.match(/【Pilot】\[([^\]]+)\]/);
  return m ? m[1]!.trim() : null;
}

export function toEngineCard(def: CardDef): EngineCard {
  const commandPilot = def.type === "COMMAND" ? commandPilotName(def.text) : null;
  return {
    no: def.no,
    name: def.name,
    type: def.type,
    color: def.color,
    // Tokens have Lv. and cost 0 (2-9-3, 2-10-3).
    level: def.level ?? 0,
    cost: def.cost ?? 0,
    ap: def.ap ?? 0,
    hp: def.hp ?? 0,
    traits: def.traits,
    link: def.link,
    keywords: def.type === "UNIT" || def.type === "UNIT TOKEN" ? parseKeywords(def.text) : { ...NO_KEYWORDS },
    pilotName: def.type === "PILOT" ? def.name : commandPilot,
    pairable: def.type === "PILOT" || commandPilot !== null,
    token: def.token,
    text: def.text,
  };
}

export class CardLib {
  private readonly byNo = new Map<string, EngineCard>();

  constructor(cards: Iterable<CardDef>) {
    for (const def of cards) this.byNo.set(def.no, toEngineCard(def));
  }

  static fromPool(pool: CardPool): CardLib {
    return new CardLib(pool.cards);
  }

  get(no: string): EngineCard {
    const card = this.byNo.get(no);
    if (!card) throw new Error(`unknown card ${no}`);
    return card;
  }

  has(no: string): boolean {
    return this.byNo.has(no);
  }

  all(): IterableIterator<EngineCard> {
    return this.byNo.values();
  }
}

/** Does `pilot` fulfil one of the Unit's link conditions (3-2-6, 3-2-6-4)? */
export function satisfiesLink(unit: EngineCard, pilot: EngineCard): boolean {
  if (!pilot.pilotName) return false;
  return unit.link.some((c) =>
    "pilotName" in c ? pilot.pilotName!.includes(c.pilotName) : pilot.traits.includes(c.trait),
  );
}
