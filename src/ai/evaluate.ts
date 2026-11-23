// Evaluation of a game state from one player's point of view (heuristic AI v1). Positive = good for
// `me`. The weights are hand-set for now; M7 tunes them by self-play.

import type { Engine } from "../engine/engine";
import { other } from "../engine/engine";
import type { CardId, GameState, PlayerId } from "../engine/types";
import { trashNeeds, type DeckPlan, type RampPlan } from "./synergy";

export interface Weights {
  win: number;
  /** Value of the i-th remaining Shield (1 = last): shieldBase + shieldScale / i. */
  shieldBase: number;
  shieldScale: number;
  baseHp: number;
  hand: number;
  handCap: number;
  unitBody: number;
  ap: number;
  hp: number;
  level: number;
  blocker: number;
  firstStrike: number;
  highManeuver: number;
  suppression: number;
  breach: number;
  repair: number;
  support: number;
  /** Share of a Unit's value lost if an enemy can destroy it before it is set active again. */
  exposed: number;
  /** Per attacker more than the defender has blockers, when the defender has no Shields and no Base. */
  lethalPressure: number;
  deckLow: number;
  /** Per card in the own trash that the own deck's effects look for there (DeckPlan.trashFuel, at most 1). */
  fuel: number;
  /** Per Unit in play that is linked (its 【During Link】 effects and link bonuses last beyond the horizon). */
  linked: number;
  /**
   * Resources (ComboKnowledge.ramp): per Resource up to the level the deck wants (`RampPlan.goal`), per
   * Resource above it, per EX Resource (on top of counting as a Resource), and per EX Resource while the own
   * deck has cards that use them.
   */
  resource: number;
  resourceOver: number;
  exResource: number;
  exUser: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  win: 1_000_000,
  shieldBase: 2,
  shieldScale: 4,
  baseHp: 0.8,
  hand: 2,
  handCap: 8,
  unitBody: 2,
  ap: 1,
  hp: 0.7,
  level: 0.3,
  blocker: 1.5,
  firstStrike: 1,
  highManeuver: 1.5,
  suppression: 1,
  breach: 0.7,
  repair: 0.8,
  support: 0.3,
  exposed: 0.15,
  lethalPressure: 6,
  deckLow: 3,
  fuel: 1,
  linked: 1.5,
  resource: 1.5,
  resourceOver: 0.3,
  exResource: -0.5,
  exUser: 0.5,
};

/** The level an opponent's deck is assumed to want (its list is unknown to the AI). */
export const ENEMY_GOAL = 7;

/** Combo knowledge of the evaluation (docs/AI.md "Kombos"); experiments, off by default (not better). */
export interface ComboKnowledge {
  /** The own deck's plan: trash fuel. */
  plan?: DeckPlan;
  /** Value trash cards by what the own effects still need there (trashNeeds), instead of trashFuel. */
  trashAware?: boolean;
  /** Value linked Units (both players). */
  links?: boolean;
  /** Value Resources and EX Resources (both players; the own deck's plan, ENEMY_GOAL for the opponent). */
  ramp?: RampPlan;
}

export class Evaluator {
  constructor(
    private readonly engine: Engine,
    private readonly w: Weights = DEFAULT_WEIGHTS,
    private readonly combo: ComboKnowledge = {},
  ) {}

  evaluate(s: GameState, me: PlayerId): number {
    if (s.result) {
      if (s.result.winner === null) return 0;
      return s.result.winner === me ? this.w.win - s.turn : -this.w.win + s.turn;
    }
    return this.side(s, me, true) - this.side(s, other(me), false);
  }

  private side(s: GameState, p: PlayerId, own: boolean): number {
    const w = this.w;
    const player = s.players[p];
    const enemy = s.players[other(p)];
    let v = 0;

    for (let i = 1; i <= player.shields.length; i++) v += w.shieldBase + w.shieldScale / i;
    for (const id of player.base) v += this.hpLeft(s, id) * w.baseHp;
    v += Math.min(player.hand.length, w.handCap) * w.hand;
    if (player.deck.length <= 3) v -= (4 - player.deck.length) * w.deckLow;
    const plan = own ? this.combo.plan : undefined;
    if (plan && this.combo.trashAware) {
      const trash = player.trash.map((id) => s.cards[id]!.no);
      const spent = new Map<string, number>();
      for (const c of s.cards)
        if (c.owner === p && (c.zone === "trash" || c.zone === "gone"))
          spent.set(c.no, (spent.get(c.no) ?? 0) + 1);
      v += trashNeeds(plan, trash, spent).useful * w.fuel;
    } else if (plan) {
      for (const id of player.trash) v += Math.min(1, plan.trashFuel.get(s.cards[id]!.no) ?? 0) * w.fuel;
    }

    if (this.combo.ramp) v += this.resources(s, p, own);

    // Units that will stay rested while the enemy can attack them are worth less: the active player's
    // rested Units face all enemy Units next turn, the other player's rested Units face the active
    // player's Units that are still active now.
    const threats = enemy.battle.filter((id) => p === s.active || !s.cards[id]!.rested);
    for (const id of player.battle) {
      let value = this.unitValue(s, id);
      if (s.cards[id]!.rested) {
        const hp = this.hpLeft(s, id);
        if (threats.some((t) => this.engine.ap(s, t) >= hp)) value *= 1 - w.exposed;
      }
      if (this.combo.links && this.engine.isLinked(s, id)) value += w.linked;
      v += value;
    }

    // The enemy is one unblocked hit away from losing.
    if (!enemy.shields.length && !enemy.base.length) {
      const blockers = enemy.battle.filter((id) => this.engine.keywords(s, id).blocker).length;
      const attackers = player.battle.filter((id) => this.engine.ap(s, id) > 0).length;
      v += Math.max(0, attackers - blockers) * w.lethalPressure;
    }
    return v;
  }

  /**
   * Resources below the deck's goal level are worth more than above it (they let higher cards come sooner);
   * an EX Resource counts as one and is gone once used to pay, so `exResource` is usually negative.
   */
  private resources(s: GameState, p: PlayerId, own: boolean): number {
    const w = this.w;
    const plan = this.combo.ramp!;
    const goal = own ? plan.goal : ENEMY_GOAL;
    const all = s.players[p].resources;
    let ex = 0;
    for (const id of all) if (s.cards[id]!.token) ex++;
    const n = all.length;
    let v = Math.min(n, goal) * w.resource + Math.max(0, n - goal) * w.resourceOver + ex * w.exResource;
    if (own && plan.exUsers.size) v += ex * w.exUser;
    return v;
  }

  unitValue(s: GameState, id: CardId): number {
    const w = this.w;
    const k = this.engine.keywords(s, id);
    return (
      w.unitBody +
      this.engine.ap(s, id) * w.ap +
      this.hpLeft(s, id) * w.hp +
      this.engine.card(s, id).level * w.level +
      (k.blocker ? w.blocker : 0) +
      (k.firstStrike ? w.firstStrike : 0) +
      (k.highManeuver ? w.highManeuver : 0) +
      (k.suppression ? w.suppression : 0) +
      k.breach * w.breach +
      k.repair * w.repair +
      k.support * w.support
    );
  }

  private hpLeft(s: GameState, id: CardId): number {
    return Math.max(0, this.engine.hp(s, id) - s.cards[id]!.damage);
  }
}
