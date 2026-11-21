// Game state, decisions and events of the rules engine. Everything here is plain data (no classes,
// closures or Maps), so a state can be cloned, hashed, stored and sent to a worker.
// Rule numbers refer to the Comprehensive Rules Ver. 1.10.0.

import type { Filter, FlagName, KeywordName } from "../effects/dsl";
import type { RngState } from "./rng";

export type PlayerId = 0 | 1;
export type CardId = number;

export type ZoneName =
  | "deck" // index 0 = top
  | "resourceDeck" // index 0 = top
  | "resources"
  | "battle" // Units; their Pilots are referenced by CardInstance.pilot
  | "shields" // index 0 = top (the first Shield to receive damage)
  | "base" // at most one (4-6-3)
  | "hand"
  | "trash"
  | "removal";

/**
 * Where a card is. "pilot": paired under a Unit; "gone": token removed from the game (5-17-2-5);
 * "limbo": a Command whose effect is active or a revealed Shield whose Burst is pending (4-1-2).
 */
export type Location = ZoneName | "pilot" | "gone" | "limbo";

export interface CardInstance {
  id: CardId;
  /** Card number (GCGDB), e.g. GD01-001. */
  no: string;
  owner: PlayerId;
  zone: Location;
  rested: boolean;
  /** Damage counters (5-5-1). */
  damage: number;
  /** Paired Pilot of a Unit. */
  pilot: CardId | null;
  /** Unit a Pilot is paired with. */
  pairedTo: CardId | null;
  /** Turn number in which the card last entered the battle area (3-2-4). */
  enteredTurn: number;
  token: boolean;
  /** A Pilot deployed as a Unit with these values (Master Asia's 【Burst】); gone when it moves. */
  asUnit?: { ap: number; hp: number };
  /** Kind of the last damage it received (for "destroyed with effect damage"). */
  lastDamage?: "battle" | "effect";
  /** The card that dealt the last damage (for "this Unit destroys an enemy Unit with damage"). */
  lastSource?: CardId;
  /** An EX Resource was used to pay for this card ("if you use an EX Resource to play this card"). */
  paidEx?: boolean;
  /** How it was last destroyed (kept in the trash for 【Destroyed】 conditions). */
  /** "effect": a "destroy" effect; "effectDamage": damage from an effect (FAQ Q368). */
  destroyedBy?: { kind: "battle" | "effect" | "effectDamage"; by?: string };
  /** Where it was deployed from ("if you deploy this Unit from your trash"). */
  from?: "hand" | "trash" | "other";
}

export interface PlayerState {
  id: PlayerId;
  deck: CardId[];
  resourceDeck: CardId[];
  resources: CardId[];
  battle: CardId[];
  shields: CardId[];
  base: CardId[];
  hand: CardId[];
  trash: CardId[];
  removal: CardId[];
  mulliganDone: boolean;
}

/**
 * A lasting change made by an effect: AP/HP, a keyword or a flag on a card, or (target -1) a flag on a
 * player. "nextStart" ends after the start phase of the target's owner (e.g. "won't be set as active").
 */
export interface Modifier {
  target: CardId;
  player?: PlayerId;
  ap: number;
  hp: number;
  keyword?: KeywordName;
  amount?: number;
  flag?: FlagName;
  filter?: Filter;
  /** A gained effect (an effect of another card's script, e.g. ST12-014). */
  effect?: EffectRef;
  /** The card a flag points to (redirectBattleDamage). */
  link?: CardId;
  until: "turn" | "battle" | "nextStart";
  source: CardId;
}

/** Identifies an effect: the card number holding the script, its index, and whether it is Pilot-granted. */
export interface EffectRef {
  no: string;
  idx: number;
  granted: boolean;
}

export type EffectOrigin = "trigger" | "command" | "burst" | "activated";

/** A triggered effect waiting to be resolved (10-1-6). */
export interface PendingTrigger {
  /** Chosen by its controller to resolve next (FAQ Q107); no new question. */
  ordered?: boolean;
  ref: EffectRef;
  /** The card whose effect it is (for granted effects: the Unit). */
  source: CardId;
  controller: PlayerId;
  /** The card the trigger is about (e.g. the destroyed enemy Unit). */
  event: CardId | null;
  origin: EffectOrigin;
}

/** A running effect: program counter and variables of a compiled script (effects/compile.ts). */
export interface Frame {
  ref: EffectRef;
  origin: EffectOrigin;
  source: CardId;
  controller: PlayerId;
  event: CardId | null;
  pc: number;
  vars: Record<string, CardId[]>;
  /** Choice in progress: variable, cards still to choose, whether the player may stop. */
  choosing?: {
    as: string;
    left: number;
    optional: boolean;
    candidates: CardId[];
    /** The full number or nothing ("You may choose 2 … If you do"). */
    exact?: boolean;
  };
  /** Cards from the deck only the controller has seen (Look at the top …). */
  looking?: CardId[];
  /** Remaining cards to place for "deploy N tokens" etc. when a choice interrupts it. */
  repeat?: number;
}

export type AttackTarget = "player" | CardId;

export interface BattleState {
  attacker: CardId;
  attackerOwner: PlayerId;
  target: AttackTarget;
  blocked: boolean;
}

export type Step =
  | "mulligan"
  | "startTurn"
  | "draw"
  | "resource"
  | "main"
  | "attack"
  | "block"
  | "battleAction"
  | "damage"
  | "battleEnd"
  | "endAction"
  | "endStep"
  | "handStep"
  | "cleanup"
  | "over";

export type GameEndReason = "damage" | "deckOut" | "turnLimit" | "concede";

export interface GameResult {
  /** null = draw (both defeated at once, or turn limit). */
  winner: PlayerId | null;
  reason: GameEndReason;
  turn: number;
}

export type Action =
  | { type: "keepHand" }
  | { type: "redraw" }
  /** `alt`/`sacrifice`: for the alternative cost, destroying that own Unit (GD01-002, EB01-039). */
  | { type: "deployUnit"; card: CardId; replace?: CardId; alt?: boolean; sacrifice?: CardId }
  | { type: "pair"; card: CardId; unit: CardId }
  | { type: "deployBase"; card: CardId }
  | { type: "attack"; unit: CardId; target: AttackTarget }
  | { type: "support"; unit: CardId; target: CardId }
  | { type: "endMain" }
  | { type: "block"; unit: CardId }
  | { type: "noBlock" }
  | { type: "pass" }
  | { type: "discard"; card: CardId }
  /** `discard`: played for its alternative cost by discarding that card (ST10-014); `alt` without one. */
  | { type: "playCommand"; card: CardId; discard?: CardId; alt?: boolean }
  | { type: "activate"; card: CardId; effect: number }
  | { type: "target"; card: CardId }
  | { type: "done" }
  | { type: "yes" }
  | { type: "no" }
  | { type: "option"; index: number; label: string };

export type DecisionKind = "mulligan" | "main" | "block" | "action" | "discard" | "effect";

export interface Decision {
  player: PlayerId;
  kind: DecisionKind;
  options: Action[];
  /** For effect decisions: the card whose effect asks, and what is asked. */
  source?: CardId;
  prompt?: "target" | "may" | "option" | "discard" | "lookPick" | "lookTop" | "burst" | "overflow" | "order";
}

export interface GameOptions {
  seed: number;
  /** Which player is Player One (6-2-1-4). Default 0. */
  firstPlayer?: PlayerId;
  /** Ends the game as a draw after this many turns (guard against endless games). Default 100. */
  maxTurns?: number;
}

export interface DeckList {
  /** 50 card numbers (6-1-1). */
  main: string[];
  /** 10 Resource card numbers. */
  resources: string[];
}

export interface GameState {
  version: 1;
  seed: number;
  rng: RngState;
  maxTurns: number;
  firstPlayer: PlayerId;
  /** 1-based; 0 during preparation. */
  turn: number;
  active: PlayerId;
  step: Step;
  players: [PlayerState, PlayerState];
  /** Indexed by CardId. */
  cards: CardInstance[];
  modifiers: Modifier[];
  battle: BattleState | null;
  /** Player who may act next in an action step, and consecutive passes so far (9-4). */
  priority: PlayerId;
  passes: number;
  /** Turn in which each "Once per Turn" effect was last used, by "<cardId>:<effect>". */
  oncePerTurn: Record<string, number>;
  /**
   * Things that happened, with the turn they last happened in, for conditions like "if you have
   * activated a … Command card's 【Main】 during this turn": "cmd:<player>:<card no>",
   * "ownDestroyed:<player>:<source card no>".
   */
  marks: Record<string, number>;
  /** Running effects; the last one is executing (10-1-6-7: new triggers resolve first). */
  frames: Frame[];
  /** Triggered effects waiting to be resolved, in order. */
  queue: PendingTrigger[];
  pending: Decision | null;
  result: GameResult | null;
  /** false: simultaneous own effects resolve in the order they occurred, without asking (scenario tests). */
  orderChoice?: boolean;
}

export type GameEvent =
  | { t: "gameStart"; firstPlayer: PlayerId }
  | { t: "mulligan"; player: PlayerId; redraw: boolean }
  | { t: "turnStart"; turn: number; player: PlayerId }
  | { t: "step"; step: Step }
  | { t: "draw"; player: PlayerId; card: CardId }
  | { t: "resource"; player: PlayerId; card: CardId }
  | { t: "pay"; player: PlayerId; cards: CardId[] }
  | { t: "deploy"; player: PlayerId; card: CardId }
  | { t: "pair"; player: PlayerId; card: CardId; unit: CardId; link: boolean }
  | { t: "rest"; card: CardId }
  | { t: "setActive"; player: PlayerId }
  | { t: "attack"; attacker: CardId; target: AttackTarget }
  | { t: "block"; blocker: CardId }
  | { t: "damage"; card: CardId; amount: number; kind: "battle" | "effect" }
  | { t: "playerDamage"; player: PlayerId; amount: number }
  | { t: "shieldBreak"; player: PlayerId; card: CardId }
  | { t: "destroyed"; card: CardId }
  | {
      t: "toTrash";
      card: CardId;
      reason: "destroyed" | "overflow" | "discard" | "shield" | "paired" | "resolved" | "mill";
    }
  | { t: "removed"; card: CardId }
  | { t: "recover"; card: CardId; amount: number }
  | { t: "modifier"; card: CardId; ap: number; hp: number }
  | { t: "play"; player: PlayerId; card: CardId }
  | { t: "effect"; source: CardId; origin: EffectOrigin; controller: PlayerId }
  | { t: "burst"; player: PlayerId; card: CardId; used: boolean }
  | { t: "ready"; card: CardId }
  | { t: "toHand"; card: CardId; from: Location }
  /** `seenBy`: the player who looked at the card before (a look effect), so it may be named for them. */
  | { t: "toDeck"; card: CardId; pos: "top" | "bottom"; seenBy?: PlayerId }
  | { t: "token"; player: PlayerId; card: CardId }
  | { t: "exResource"; player: PlayerId; card: CardId }
  | { t: "reveal"; player: PlayerId; cards: CardId[] }
  /** The player looks at the top cards of their deck (private: only they learn the cards). */
  | { t: "look"; player: PlayerId; cards: CardId[] }
  | { t: "gameOver"; result: GameResult };
