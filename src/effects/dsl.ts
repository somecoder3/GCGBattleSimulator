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
  /** "pilots": Pilots paired with Units in play. */
  zone?: "battle" | "hand" | "trash" | "resources" | "base" | "shieldArea" | "pilots" | "field";
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
  /** Only the matching cards with the lowest/highest Lv. */
  lowestLv?: boolean;
  highestLv?: boolean;
  /** In the current battle with the source card ("battling this Unit"). */
  battlingSelf?: boolean;
  /** In the current battle with a card matching this filter ("battling a friendly (AEUG) Unit"). */
  battling?: Filter;
  /** The target of the current attack ("that is being attacked"). */
  attacked?: boolean;
  /** Color is none of these ("non-blue"). */
  notColors?: Color[];
  /** Has any keyword effect (<Blocker>, <Repair>, …). */
  anyKeyword?: boolean;
  /** Has a 【Destroyed】 effect. */
  hasDestroyed?: boolean;
  /** Only the matching cards with the lowest HP. */
  lowestHp?: boolean;
  /** Paired with a Pilot matching this filter. */
  pairedWith?: Filter;
  /** Paired with (the Pilot of) a Unit matching this filter: for Pilots in play. */
  pilotOf?: Filter;
  /** Matches at least one of these ("that is Lv.1 or lower or has 1 or less AP"). */
  anyOf?: Filter[];
  /** Does not have this keyword ("without <Breach>"). */
  notKeyword?: KeywordName;
  /** Was played using an EX Resource. */
  paidEx?: boolean;
  /** Has a link condition naming this Pilot ("a Unit with the [Mashymre Cello] link condition"). */
  linkPilot?: string;
  /** Lv. at most (number of matching cards + plus) (GD05-026). */
  lvMaxPlus?: { count: Filter; plus: number };
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
  /** The effect's card is attacking the enemy player / an enemy Unit. */
  | { attackingPlayer: true }
  | { attackingUnit: true }
  /** The effect's card has a paired Pilot matching the filter (【During Pair･Lv.5 or Higher Pilot】). */
  | { selfPilot: Filter }
  /** The controller set one of their Resources as active with an effect this turn. */
  | { readiedResource: true }
  /** The controller's Lv. (number of Resources). */
  | { level: { min?: number; max?: number } }
  /** Number of enemy players (always 1 here; "if there are 2 or more enemy players"). */
  | { enemyPlayers: { min: number } }
  /** Cards in the opponent's trash. */
  | { enemyTrash: { min?: number; max?: number } }
  /** The effect's card is battling a card matching the filter. */
  | { battling: Filter }
  /** A Pilot was paired with the effect's card this turn. */
  | { pairedThisTurn: true }
  /** The controller drew with an effect this turn. */
  | { drewByEffect: true }
  /** The controller's opponent attacked this turn. */
  | { enemyAttacked: boolean }
  /** An EX Resource was used to pay for the effect's card. */
  | { selfPaidEx: true }
  /** The controller paid at least this much for their Units' effects this turn. */
  | { paidForEffects: number }
  /** The opponent discarded because of one of the controller's effects this turn. */
  | { opponentDiscarded: true }
  /** How the effect's card was destroyed ("with battle damage", "by one of your (Neo Zeon) card's effects"). */
  | { destroyedBy: { kind?: "battle" | "effect" | "effectDamage"; traits?: string[] } }
  /** The current attack targets a Unit (not a player). */
  | { battleVsUnit: true }
  /** The effect's card is attacking and was blocked by a Unit matching the filter. */
  | { blockedBy: Filter }
  /** HP left (HP minus damage) of the effect's card. */
  | { hpLeft: { min?: number; max?: number } }
  /** The controller deployed a Unit matching the filter this turn. */
  | { deployedThisTurn: Filter }
  /** The controller paid ① or more for the effect of a Unit matching the filter this turn. */
  | { paidForEffectOf: Filter }
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
  /** At least `min` cards are stored in a variable of this effect ("If this effect rested 3 or more Units"). */
  | { varCount: { var: string; min: number } }
  /** The top card of the controller's deck matches. */
  | { topCard: Filter }
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
  /** As noBattleDamageFrom, once per turn (ST14-006). */
  | "noBattleDamageFromOnce"
  /** Can't receive any damage from enemy Units matching the filter (ST07-015). */
  | "noDamageFrom"
  /** Can't receive effect damage from enemy cards matching the filter. */
  | "noEffectDamageFrom"
  /** Can't activate <Blocker> (on a Unit, or on a player with a filter for all matching Units). */
  | "cantBlock"
  /** (Constant, with a target filter) Matching Units are deployed rested. */
  | "deployRested"
  /** When a friendly Unit's effect would rest your Base, this Unit is rested instead (GD03-079). */
  | "restInsteadOfBase"
  /** When a friendly (filter) Unit's effect would rest a friendly Unit, this Base is rested instead (GD05-124). */
  | "baseRestsInstead"
  /** Battle damage it would receive is dealt to the linked card instead. */
  | "redirectBattleDamage"
  /** While rested: all enemy Units (also Link Units) must attack it if they can. */
  | "tauntAll"
  /** Can't be set as active (also not in the start phase). */
  | "cantReady"
  /** (On a card in play) Enemy Units can't be set as active by their controller's effects. */
  | "noEnemyReady"
  /** Its AP can't be reduced by enemy effects. */
  | "noApReduction"
  /** (On a card in play) Friendly Shields can't receive battle damage from enemy Units. */
  | "protectShields"
  /** (On a card in play) Friendly Shields can't receive battle damage from enemy Units matching the filter. */
  | "protectShieldsFrom"
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
      /** Only cards stored in this variable ("1 … card you placed from your deck with this effect"). */
      among?: string;
      /** The count is the number of cards matching this filter ("up to the number of …"). */
      countOf?: Filter;
      /** No two chosen cards with the same name ("with unique card names"). */
      unique?: boolean;
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
  /** `per`: the amount once for each matching card ("the same number of <Breach 1> as …"). */
  | { op: "grant"; t: Ref; keyword: KeywordName; amount?: number; until: Duration; per?: Filter }
  | {
      op: "flag";
      t: Ref | "you" | "opponent";
      flag: FlagName;
      filter?: Filter;
      amount?: number;
      until: Duration | "nextStart";
      /** The card the flag points to (redirectBattleDamage). */
      link?: Ref;
    }
  /** AP change by the number of matching cards (e.g. "reduce its AP by the number of friendly … Units"). */
  | { op: "modByCount"; t: Ref; count: Filter; sign: 1 | -1; until: Duration }
  | { op: "draw"; n: number; both?: boolean; who?: "opponent" }
  /** Damage of 1 for each `per` AP of this Unit ("Deal 1 damage to it for each 4 AP this Unit has"). */
  | { op: "damageByAp"; t: Ref; per: number }
  /** AP+ the amount paid for the effect that triggered this one (GD04-100). */
  | { op: "modByPaid"; t: Ref; until: Duration }
  /** The opponent looks at their top card and takes it if it matches, else leaves it (EB01-023). */
  | { op: "opponentLookTop"; pick: Filter }
  /** The top card of the deck to the hand (revealed); `as` keeps it. */
  | { op: "takeTop"; as?: string }
  /** Damage equal to the number of cards in a variable (matching the filter). */
  | { op: "damageByVar"; t: Ref; var: string; filter?: Filter }
  /** The keywords printed on the chosen card go to `into` (GD04-067; not `to`, which is a jump label). */
  | { op: "copyKeywords"; from: Ref; into: Ref; until: Duration }
  /** The Pilot paired with this Unit goes to its owner's hand or the top of the deck. */
  | { op: "pilotTo"; dest: "hand" | "deckTop"; filter?: Filter }
  /** "Pay ①": rest that many active Resources; fails without them. */
  | { op: "payCost"; n: number }
  /** Damage equal to the number of matching cards. */
  | { op: "damageByCount"; t: Ref; count: Filter }
  /** Deploy a copy of the chosen Unit token. */
  | { op: "tokenCopy"; t: Ref; rested?: boolean }
  /** "Destroy the first 2 cards in that player's shield area" (Base first, then Shields). */
  | { op: "shieldAreaDestroy"; n: number }
  /** Discard n; `as` keeps the discarded cards (for "if you discard a … with this effect"). */
  | { op: "discard"; n: number; as?: string; who?: "opponent" }
  | { op: "shieldToHand"; n: number }
  | { op: "exResource"; n: number; both?: boolean; rested?: boolean }
  /** `forOwnerOf`: the token goes to the owner of the card(s) in that variable ("the destroyed Unit's owner"). */
  | { op: "token"; no: string; count?: number; rested?: boolean; forOwnerOf?: Ref }
  /** `as` keeps the milled cards ("If you place a (CB) card with this effect"). */
  | { op: "mill"; n: number; as?: string }
  /** The battling enemy Unit attacks the chosen card instead (ST07-013). */
  | { op: "redirect"; t: Ref }
  /** The chosen card gains effect `idx` of this card's script until the end of the turn/battle (ST12-014). */
  | { op: "grantEffect"; t: Ref | "you"; idx: number; until: Duration }
  /** Place the top card of the resource deck (ST14-015). */
  | { op: "placeResource"; rested?: boolean }
  /** Look at the top n cards, optionally take matching ones to the hand, the rest to the bottom in random order. */
  | {
      op: "lookTop";
      n: number;
      pick?: Filter;
      pickCount?: number;
      may?: boolean;
      deploy?: boolean;
      /** The picked card goes back on top of the deck instead of into the hand. */
      toTop?: boolean;
      /** The remaining cards go into the trash instead of the bottom of the deck. */
      rest?: "trash";
      /** The picked card is paired with this Unit (GD06-042). */
      pairToSelf?: boolean;
    }
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
  | { op: "deploy"; t: Ref; pay?: boolean; rested?: boolean }
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
  | { op: "runPilotMain"; timing?: "main" | "action" }
  | { op: "runMainOf"; t: Ref }
  | { op: "runAction" }
  /** "Begin a battle between a and b and only perform the damage step." */
  | { op: "fight"; a: Ref; b: Ref }
  /** Burst: deploy this card as a Unit with the given AP/HP (Master Asia). */
  | { op: "deploySelfAsUnit"; ap: number; hp: number }
  /** Choose own Resources and set them active. */
  | { op: "readyResource"; n: number; both?: boolean }
  /** Burst helpers: add this card to the hand / deploy this card / run this Command's 【Main】. */
  | { op: "selfToHand" }
  | { op: "deploySelf" }
  | { op: "runMain" };

/** Authoring steps: primitives plus control flow, flattened by compile.ts. */
export type Step =
  | Prim
  | { op: "if"; cond: Cond; then: Step[]; else?: Step[] }
  /** "You may …" — asks the controller (or the opponent); the steps run only on yes ("If you do"). */
  | { op: "may"; do: Step[]; by?: "opponent" }
  /** The controller picks one of several alternatives (e.g. which token to deploy). */
  | { op: "choice"; options: { label: string; do: Step[] }[] }
  /**
   * Parts after "Then," inside a condition ("If …, draw 1. Then, discard 1."): each part is its own
   * segment (a failed choice skips only its part), all under the condition.
   */
  | { op: "segments"; list: Step[][] };

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
  /** A friendly Unit matching the filter links (the event is that Unit). */
  | "allyLinked"
  /** The controller drew cards with an effect. */
  | "effectDraw"
  /** A friendly Unit matching the filter destroyed an enemy card (`victim`) with damage (event: the Unit). */
  | "allyDestroys"
  /** This Unit was chosen as an attack target. */
  | "attacked"
  /** A Unit matching the filter attacks (event: the attacker; any player). */
  | "unitAttacks"
  /** A friendly card matching the filter received damage (`damageKind`, `fromEnemy`; event: the card). */
  | "allyDamaged"
  /** This Unit recovered HP. */
  | "recovered"
  /** A friendly Unit matching the filter was rested by an effect (`fromEnemy`: by the opponent's). */
  | "allyRestedByEffect"
  /** This rested Unit was set as active by an effect. */
  | "readiedByEffect"
  /** The controller placed an EX Resource. */
  | "exResourcePlaced"
  /** One of the controller's EX Resources left the game. */
  | "exResourceExiled"
  /** The controller activated the 【Main】/【Action】 of a Command matching the filter (event: the Command). */
  | "commandUsed"
  /** A friendly Unit matching the filter was destroyed by an effect. */
  | "allyDestroyedByEffect"
  /** This Unit's AP was reduced by an enemy effect. */
  | "apReducedByEnemy"
  /** At the end of every turn (both players'). */
  | "anyTurnEnd"
  /** This Unit activated <Blocker>. */
  | "blocks"
  /** This Unit's <Support> increased the AP of a Unit matching the filter. */
  | "supports"
  /** A friendly Unit matching the filter dealt battle damage to an enemy Unit (event: the friendly Unit). */
  | "allyDealsBattleDamage"
  /** The controller paid ① or more for the effect of a friendly Unit matching the filter. */
  | "effectPaid"
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
      /** destroysUnit: also when this Unit's effect damage destroys the enemy Unit ("with damage"). */
      anyDamage?: boolean;
      /** The card the event is about must match (e.g. the destroyed enemy Unit). */
      eventFilter?: Filter;
      /** allyDestroys: what was destroyed. */
      victim?: "unit" | "shieldArea" | "card";
      /** allyDamaged: battle or effect damage only. */
      damageKind?: "battle" | "effect";
      /** allyDamaged/allyRestedByEffect: only by the opponent. */
      fromEnemy?: boolean;
      /** allyDamaged: the card that dealt the damage must match. */
      sourceFilter?: Filter;
      /** Only used when gained from another effect (grantEffect), never on its own card. */
      dormant?: boolean;
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
      /** 【Once per Turn】 (damage reductions). */
      once?: boolean;
      /** Only used when gained from another effect (grantEffect), never on its own card. */
      dormant?: boolean;
      /** "gets AP+2 for each of your rested (CB) Units" */
      apPer?: { count: Filter; per: number; unique?: boolean };
      /** AP + the damage this Unit has received (GD05-051). */
      apFromDamage?: boolean;
      /** `keyword` (with `amount`) once per card matching the filter ("the same number of <Repair 1> as …"). */
      keywordPer?: Filter;
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
      /** Only the cost is reduced, not the Lv. */
      costOnly?: boolean;
    }
  | AltCost
  | PairCost;

/**
 * "When playing this card from your hand, you may discard 1 (G Generation) Unit card. If you do, play this
 * card as if it has 2 Lv. and cost." (ST10-014)
 */
export interface AltCost {
  kind: "altCost";
  level: number;
  cost: number;
  /** Discard a matching card from the hand (ST10-014). */
  discard?: Filter;
  /** Destroy a matching own Unit (GD01-002). */
  destroy?: Filter;
  /** Only while this holds (EB01-039). */
  when?: Cond;
}

/** "When playing this card from your hand and pairing it with …, it gets cost -1 / as if it has 0 cost." */
export interface PairCost {
  kind: "pairCost";
  unit: Filter;
  /** Cost reduction, or a fixed cost (`set`). */
  minus?: number;
  set?: number;
}

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
