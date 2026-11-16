// Card effects as data. Scripts are written in this form (by hand or by the text compiler in
// parse.ts), compiled to flat programs (compile.ts) and run by the engine (engine/interpret.ts).
// Everything is plain data so that a running effect can be part of the serializable game state.

import type { CardType, Color } from "../data/types";

export type KeywordName =
  "blocker" | "firstStrike" | "highManeuver" | "suppression" | "breach" | "repair" | "support";

/** How long a change made by an effect lasts. */
export type Duration = "turn" | "battle";

/** Card selection. Sides are relative to the effect's controller. Default zone: battle area (Units). */
export interface Filter {
  side?: "friendly" | "enemy";
  zone?: "battle" | "hand" | "trash" | "resources" | "base" | "shieldArea";
  types?: CardType[];
  lvMin?: number;
  lvMax?: number;
  hpMin?: number;
  hpMax?: number;
  apMin?: number;
  apMax?: number;
  rested?: boolean;
  damaged?: boolean;
  /** Any of these traits. */
  traits?: string[];
  colors?: Color[];
  /** Card name contains any of these (2-2-3). */
  names?: string[];
  linked?: boolean;
  paired?: boolean;
  token?: boolean;
  keyword?: KeywordName;
  /** Not the source card ("other"). */
  other?: boolean;
}

/** "self": the card with the effect (the Unit for Pilot-granted effects); "event": the card the trigger is about. */
export type Ref = "self" | "event" | (string & {});

export type Cond =
  | { yourTurn: boolean }
  | { count: Filter; min?: number; max?: number }
  | { selfAp: { min?: number; max?: number } }
  | { selfLinked: boolean }
  | { selfPaired: boolean }
  | { nameInTrash: string }
  | { hand: { min?: number; max?: number }; side: "friendly" | "enemy" }
  | { shields: { min?: number; max?: number }; side: "friendly" | "enemy" | "any" }
  | { and: Cond[] }
  | { or: Cond[] }
  | { not: Cond };

export type FlagName =
  /** Can't choose the enemy player as its attack target. */
  | "cantAttackPlayer"
  | "cantAttack"
  | "cantBePaired"
  /** May attack active enemy Units matching the flag's filter. */
  | "attackActive"
  /** Won't be set as active during its owner's next start phase. */
  | "stayRested"
  /** Can't receive battle damage from enemy Units matching the filter. */
  | "noBattleDamageFrom"
  /** (On a player) Shield area cards can't receive damage from enemy Units matching the filter. */
  | "protectShieldArea";

/** Primitive steps; identical to the instructions of compiled programs. */
export type Prim =
  /** Choose cards in a public location (10-2-2-1); fails (skips the rest of the segment) without candidates. */
  | { op: "choose"; filter: Filter; count?: number; upTo?: boolean; may?: boolean; as?: string }
  /** Every matching card ("all enemy Units that ..."). */
  | { op: "all"; filter: Filter; as?: string }
  | { op: "rest"; t: Ref }
  | { op: "ready"; t: Ref }
  | { op: "damage"; t: Ref; amount: number }
  | { op: "destroy"; t: Ref }
  | { op: "bounce"; t: Ref }
  /** To its owner's hand from anywhere (e.g. a card chosen in the trash). */
  | { op: "toHand"; t: Ref }
  /** Into the removal area ("exile from the game", 5-12). */
  | { op: "exile"; t: Ref }
  | { op: "toDeck"; t: Ref; pos: "top" | "bottom" }
  | { op: "recover"; t: Ref; amount: number }
  | { op: "mod"; t: Ref; ap?: number; hp?: number; until: Duration }
  | { op: "grant"; t: Ref; keyword: KeywordName; amount?: number; until: Duration }
  | {
      op: "flag";
      t: Ref | "you" | "opponent";
      flag: FlagName;
      filter?: Filter;
      until: Duration | "nextStart";
    }
  | { op: "draw"; n: number }
  | { op: "discard"; n: number }
  | { op: "shieldToHand"; n: number }
  | { op: "exResource"; n: number }
  | { op: "token"; no: string; count?: number; rested?: boolean }
  | { op: "mill"; n: number }
  /** Look at the top n cards, optionally take matching ones to the hand, the rest to the bottom in random order. */
  | { op: "lookTop"; n: number; pick?: Filter; pickCount?: number; may?: boolean }
  /** Look at the top n cards and return one to the top and the rest to the bottom (ST02-015). */
  | { op: "lookTopArrange"; n: number }
  /** Deploy a card from the hand matching the filter without paying its cost. */
  | { op: "deployFromHand"; filter: Filter; may?: boolean; payCost?: boolean }
  /** Choose own Resources and set them active. */
  | { op: "readyResource"; n: number }
  /** Burst helpers: add this card to the hand / deploy this card / run this Command's 【Main】. */
  | { op: "selfToHand" }
  | { op: "deploySelf" }
  | { op: "runMain" };

/** Authoring steps: primitives plus control flow, flattened by compile.ts. */
export type Step =
  | Prim
  | { op: "if"; cond: Cond; then: Step[]; else?: Step[] }
  /** "You may …" — asks the controller; the steps run only on yes ("If you do"). */
  | { op: "may"; do: Step[] }
  /** The controller picks one of several alternatives (e.g. which token to deploy). */
  | { op: "choice"; options: { label: string; do: Step[] }[] };

export type TriggerKind =
  | "deploy"
  | "attack"
  | "destroyed"
  | "whenPaired"
  | "whenLinked"
  /** "When this Unit destroys an enemy Unit with battle damage" */
  | "destroysUnit"
  /** "When this Unit destroys an enemy shield area card with battle damage" */
  | "destroysShieldAreaCard"
  | "turnStart"
  | "turnEnd";

export interface Cost {
  restSelf?: boolean;
  resources?: number;
  destroySelf?: boolean;
}

/**
 * Effects. Steps are grouped into segments: a failed choice ends only its own segment, so a part after
 * "Then," still happens (5-20-2) while a part after "If you do" does not (5-20-1).
 */
export type Effect =
  | {
      kind: "trigger";
      on: TriggerKind;
      /** Pilot qualification of 【When Paired･…】 (13-2-9-2). */
      pilot?: Filter;
      cond?: Cond;
      once?: boolean;
      segments: Step[][];
    }
  | {
      kind: "activated";
      timing: "main" | "action";
      cost: Cost;
      cond?: Cond;
      once?: boolean;
      segments: Step[][];
    }
  | { kind: "command"; timing: ("main" | "action")[]; segments: Step[][] }
  | { kind: "burst"; segments: Step[][] }
  | {
      kind: "static";
      cond?: Cond;
      /** "self" or every card matching the filter (e.g. "all your Units"). */
      target: "self" | Filter;
      ap?: number;
      hp?: number;
      keyword?: KeywordName;
      amount?: number;
      flag?: FlagName;
      flagFilter?: Filter;
    };

export type CardStatus = "vanilla" | "auto" | "manual" | "partial";

export interface CardScript {
  /** Effects of the card itself. For Pilots only the ones that stay with the Pilot (【Burst】). */
  effects: Effect[];
  /** Effects a Pilot gives the Unit it is paired with (3-3-9-2). */
  granted: Effect[];
  status: CardStatus;
  /** Text lines the compiler did not understand (status "partial"); they have no effect in the game. */
  unsupported: string[];
}
