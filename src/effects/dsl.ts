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
  /** Not the attacking Unit or its target ("non-battling"). */
  notBattling?: boolean;
  /** AP/Lv. at most that of a card: "self" (the effect's card) or a variable of the running effect. */
  apMaxOf?: Ref;
  lvMaxOf?: Ref;
  /** Only the matching cards with the lowest Lv. */
  lowestLv?: boolean;
  /** Card name contains none of these ("without "X" in its card name"). */
  notNames?: string[];
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
  /** A friendly Pilot in play (paired with a Unit) matches the filter. */
  | { pilotInPlay: Filter }
  /** The effect's card matches the filter (for Pilot texts: the Unit, "if this is a (Trait) Unit"). */
  | { selfIs: Filter }
  /** The effect's card is attacking the enemy player. */
  | { attackingPlayer: true }
  /** The controller activated the 【Main】/【Action】 of a matching Command card this turn. */
  | { played: Filter }
  /** One of the controller's Units was destroyed this turn by the effect of a matching own card. */
  | { ownDestroyedBy: Filter }
  /** The effect's card was deployed from this location ("if you deploy this Unit from your trash"). */
  | { selfFrom: "trash" | "hand" }
  /** A friendly Unit with a paired Pilot destroyed an enemy Unit with battle damage this turn. */
  | { pairedKill: true }
  /** A card chosen earlier in this effect has left the battle area (e.g. "when this effect destroys …"). */
  | { varGone: string }
  /** A card stored in a variable of this effect matches (e.g. the discarded card). */
  | { varMatches: string; filter: Filter }
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
  | "protectShieldArea"
  /** May attack in the turn it was deployed. */
  | "attackOnDeploy"
  /** While rested: enemy Units that are not Link Units must attack it if they can. */
  | "taunt"
  /** When it destroys an enemy card with battle damage during this turn, its owner draws 1. */
  | "drawOnBattleDestroy"
  /** Can't receive enemy effect damage. */
  | "noEnemyEffectDamage"
  /** Enemy effect damage is reduced by `amount`. */
  | "reduceEnemyEffectDamage"
  /** Enemy effect damage of `amount` or less is prevented. */
  | "ignoreEnemyEffectDamageUpTo"
  /** All enemy damage is reduced by `amount`. */
  | "reduceEnemyDamage"
  /** (Static) Damage dealt to enemy Units by friendly cards matching the flag filter is increased by `amount`. */
  | "boostDamage"
  /** Enemy Units can't choose it as their attack target. */
  | "cantBeAttacked"
  /** In the turn it was deployed it may attack rested enemy Units (not the player). */
  | "attackUnitOnDeploy"
  /** The next damage it receives this turn is reduced by `amount` (then the flag is gone). */
  | "reduceNextDamage"
  /** Battle damage from enemy Units is reduced by `amount`. */
  | "reduceEnemyBattleDamage"
  /** (Static) Battle damage it deals to an enemy Unit matching the flag filter destroys that Unit. */
  | "destroyOnBattleDamage"
  /** (On a player) Friendly Units can't be destroyed by enemy "destroy" effects. */
  | "noEffectDestroy"
  /** (On a player) Enemy effect damage to friendly shield area cards is reduced by `amount`. */
  | "reduceShieldAreaEffectDamage";

/** Primitive steps; identical to the instructions of compiled programs. */
export type Prim =
  /**
   * Choose cards in a public location (10-2-2-1); fails (skips the rest of the segment) without
   * candidates. `by: "opponent"`: the controller's opponent chooses ("all enemy players each choose …").
   */
  | {
      op: "choose";
      filter: Filter;
      count?: number;
      upTo?: boolean;
      may?: boolean;
      as?: string;
      by?: "opponent";
      /** All `count` cards or none (costs like "Exile 4 cards in your trash"). */
      exact?: boolean;
    }
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
      amount?: number;
      until: Duration | "nextStart";
    }
  /** AP change by the number of matching cards (e.g. "reduce its AP by the number of friendly … Units"). */
  | { op: "modByCount"; t: Ref; count: Filter; sign: 1 | -1; until: Duration }
  | { op: "draw"; n: number }
  /** Discard n; `as` keeps the discarded cards (for "if you discard a … with this effect"). */
  | { op: "discard"; n: number; as?: string }
  | { op: "shieldToHand"; n: number }
  | { op: "exResource"; n: number }
  /** `forOwnerOf`: the token goes to the owner of the card(s) in that variable ("the destroyed Unit's owner"). */
  | { op: "token"; no: string; count?: number; rested?: boolean; forOwnerOf?: Ref }
  | { op: "mill"; n: number }
  /** Look at the top n cards, optionally take matching ones to the hand, the rest to the bottom in random order. */
  | { op: "lookTop"; n: number; pick?: Filter; pickCount?: number; may?: boolean }
  /**
   * Look at the top n cards, put one on top (or into the hand) and the rest at the bottom (or into the
   * trash) (ST02-015, ST09-010).
   */
  | { op: "lookTopArrange"; n: number; keep?: "top" | "hand"; rest?: "bottom" | "trash" }
  /** Deploy a card from the hand matching the filter without paying its cost. */
  | { op: "deployFromHand"; filter: Filter; may?: boolean; payCost?: boolean }
  /** Look at the top n cards without moving them (until unpeek/topToBottom). */
  | { op: "peek"; n: number }
  | { op: "unpeek" }
  /** The top n cards of the deck go to the bottom. */
  | { op: "topToBottom"; n: number }
  /** Damage to the first card of the enemy shield area (Base, else the top Shield). */
  | { op: "damageShieldArea"; amount: number }
  /** Deploy the chosen card (from the trash or hand): Units to the battle area, Bases to the base section. */
  | { op: "deploy"; t: Ref; pay?: boolean }
  /** Deploy an EX Base (replacing a Base in play). */
  | { op: "exBase" }
  /** The chosen cards go into their owner's deck, which is then shuffled. */
  | { op: "shuffleIntoDeck"; t: Ref }
  /** This card (in limbo or the trash) becomes the Pilot of the chosen Unit. */
  | { op: "pairSelf"; t: Ref }
  /** The chosen card (e.g. a Pilot card in the trash) becomes the Pilot of `unit` if it has none. */
  | { op: "pairTo"; t: Ref; unit: Ref }
  /** The chosen cards in the hand are discarded (a "Discard 1 … card" cost). */
  | { op: "discardChosen"; t: Ref }
  /** Run the 【Main】 of the card paired with this Unit / of the chosen card / this card's 【Action】. */
  | { op: "runPilotMain" }
  | { op: "runMainOf"; t: Ref }
  | { op: "runAction" }
  /** "Begin a battle between a and b and only perform the damage step." */
  | { op: "fight"; a: Ref; b: Ref }
  /** Burst: deploy this card as a Unit with the given AP/HP (Master Asia). */
  | { op: "deploySelfAsUnit"; ap: number; hp: number }
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
  /** A friendly Unit matching the trigger's filter is deployed (or this one, with `self`). */
  | "allyDeployed"
  /** A Pilot is paired with a friendly Unit matching the filter (or this one, with `self`). */
  | "allyPaired"
  /** At the start of the opponent's turn. */
  | "opponentTurnStart"
  /** "When this Unit destroys an enemy card with battle damage" (Unit or shield area card). */
  | "destroysCard"
  /** An enemy Unit is destroyed with effect damage while this Unit is attacking. */
  | "enemyEffectKillWhileAttacking"
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
  /** "return this Unit to the bottom of its owner's deck" */
  selfToDeckBottom?: boolean;
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
      /** allyDeployed/allyPaired: the Unit the event is about must match (or be this card, if `self`). */
      filter?: Filter;
      self?: boolean;
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
      /** Traits the targets gain ("All your Units gain (Neo Zeon)"). */
      traits?: string[];
      /** "gets AP+2 for each of your rested (CB) Units" */
      apPer?: { count: Filter; per: number };
    }
  /**
   * In the hand: Lv. and cost lower by `per` for each card matching `count`, unless `unless` holds
   * (GD05-004 Akatsuki).
   */
  | {
      kind: "handCost";
      /** Where the reduction applies (default the hand). */
      zone?: "hand" | "trash";
      count?: Filter;
      per?: number;
      /** A fixed reduction instead of one per card. */
      fixed?: number;
      unless?: Cond;
      when?: Cond;
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
