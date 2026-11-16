// Evaluation of a game state from one player's point of view (heuristic AI v1). Positive = good for
// `me`. The weights are hand-set for now; M7 tunes them by self-play.

import type { Engine } from "../engine/engine";
import { other } from "../engine/engine";
import type { CardId, GameState, PlayerId } from "../engine/types";

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
};

export class Evaluator {
  constructor(
    private readonly engine: Engine,
    private readonly w: Weights = DEFAULT_WEIGHTS,
  ) {}

  evaluate(s: GameState, me: PlayerId): number {
    if (s.result) {
      if (s.result.winner === null) return 0;
      return s.result.winner === me ? this.w.win - s.turn : -this.w.win + s.turn;
    }
    return this.side(s, me) - this.side(s, other(me));
  }

  private side(s: GameState, p: PlayerId): number {
    const w = this.w;
    const player = s.players[p];
    const enemy = s.players[other(p)];
    let v = 0;

    for (let i = 1; i <= player.shields.length; i++) v += w.shieldBase + w.shieldScale / i;
    for (const id of player.base) v += this.hpLeft(s, id) * w.baseHp;
    v += Math.min(player.hand.length, w.handCap) * w.hand;
    if (player.deck.length <= 3) v -= (4 - player.deck.length) * w.deckLow;

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
