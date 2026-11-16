// Game state, decisions and events of the rules engine. Everything here is plain data (no classes,
// closures or Maps), so a state can be cloned, hashed, stored and sent to a worker.
// Rule numbers refer to the Comprehensive Rules Ver. 1.10.0.

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

/** Where a card is. "pilot": paired under a Unit; "gone": token removed from the game (5-17-2-5). */
export type Location = ZoneName | "pilot" | "gone";

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

/** A temporary change of a card's values, e.g. from <Support> ("during this turn"). */
export interface Modifier {
  target: CardId;
  ap: number;
  hp: number;
  until: "turn" | "battle";
  source: CardId;
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
  | { type: "deployUnit"; card: CardId; replace?: CardId }
  | { type: "pair"; card: CardId; unit: CardId }
  | { type: "deployBase"; card: CardId }
  | { type: "attack"; unit: CardId; target: AttackTarget }
  | { type: "support"; unit: CardId; target: CardId }
  | { type: "endMain" }
  | { type: "block"; unit: CardId }
  | { type: "noBlock" }
  | { type: "pass" }
  | { type: "discard"; card: CardId };

export type DecisionKind = "mulligan" | "main" | "block" | "action" | "discard";

export interface Decision {
  player: PlayerId;
  kind: DecisionKind;
  options: Action[];
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
  pending: Decision | null;
  result: GameResult | null;
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
  | { t: "toTrash"; card: CardId; reason: "destroyed" | "overflow" | "discard" | "shield" | "paired" }
  | { t: "removed"; card: CardId }
  | { t: "recover"; card: CardId; amount: number }
  | { t: "modifier"; card: CardId; ap: number; hp: number }
  | { t: "gameOver"; result: GameResult };
