// Statistics of a finished (or running) game for the end screen, modelled on ExBurst's match stats:
// advantage per turn (the heuristic AI's own evaluation), shields and base per turn, damage, cards
// played, the most valuable card and the key moments.

import { Evaluator } from "../../ai/evaluate";
import type { Engine } from "../../engine/engine";
import type { CardId, GameState, PlayerId } from "../../engine/types";
import type { LogStep } from "../../sim/session";

export interface TurnPoint {
  turn: number;
  /** Whose turn it was. */
  player: PlayerId;
  /** Evaluation for the human at the end of the turn, in "shields" (positive: the human leads). */
  advantage: number;
  shields: [number, number];
  /** HP left of the base (0 = none). */
  base: [number, number];
}

export interface SideStats {
  /** Enemy shields broken. */
  shields: number;
  /** Damage to the enemy base and the enemy player. */
  toPlayer: number;
  /** Damage dealt to Units. */
  toUnits: number;
  /** Enemy Units destroyed in battle or by effects of this side. */
  destroyed: number;
  /** Units deployed and Commands/Bases played. */
  played: number;
}

export interface CardImpact {
  no: string;
  damage: number;
  breaks: number;
}

export interface Summary {
  winner: PlayerId | null;
  turns: number;
  points: TurnPoint[];
  sides: [SideStats, SideStats];
  /** The human's card with the most impact (damage and broken shields). */
  mvp: CardImpact | null;
  /** The card that dealt the last hit, if the game ended by damage. */
  finalBlow: { no: string; player: PlayerId } | null;
  moments: { turn: number; player: PlayerId; text: string }[];
}

/** The value of about one shield in the evaluation (shieldBase + shieldScale / 3). */
const SHIELD_WORTH = 3.3;

export function summarize(engine: Engine, steps: readonly LogStep[], human: PlayerId): Summary {
  const evaluator = new Evaluator(engine);
  const name = (s: GameState, id: CardId) => {
    const no = s.cards[id]?.no;
    return no && engine.lib.has(no) ? engine.lib.get(no).name : "eine Karte";
  };
  const empty = (): SideStats => ({ shields: 0, toPlayer: 0, toUnits: 0, destroyed: 0, played: 0 });
  const sides: [SideStats, SideStats] = [empty(), empty()];
  const impact = new Map<CardId, { no: string; damage: number; breaks: number }>();
  const credit = (s: GameState, id: CardId | null, damage: number, breaks: number) => {
    if (id === null) return;
    const card = s.cards[id];
    if (!card) return;
    const entry = impact.get(id) ?? { no: card.no, damage: 0, breaks: 0 };
    entry.damage += damage;
    entry.breaks += breaks;
    impact.set(id, entry);
  };

  const points: TurnPoint[] = [];
  const moments: Summary["moments"] = [];
  let attacker: CardId | null = null;
  let defender: CardId | null = null;
  let lastHit: CardId | null = null;
  let finalBlow: Summary["finalBlow"] = null;
  // Per turn: shields broken and by which cards, bases destroyed.
  let breaks: { by: string[]; count: number } = { by: [], count: 0 };
  let basesLost = 0;
  let turnOwner: PlayerId | null = null;
  let turnNo = 0;
  let last: GameState | null = null;

  const closeTurn = () => {
    if (turnOwner === null || !last) return;
    const s = last;
    const side = (p: PlayerId) => s.players[p];
    const baseHp = (p: PlayerId) =>
      side(p).base.reduce((n, id) => n + Math.max(0, engine.hp(s, id) - s.cards[id]!.damage), 0);
    const value = s.result ? (s.result.winner === null ? 0 : s.result.winner === human ? 12 : -12) : null;
    points.push({
      turn: turnNo,
      player: turnOwner,
      advantage: value ?? Math.max(-12, Math.min(12, evaluator.evaluate(s, human) / SHIELD_WORTH)),
      shields: [side(0).shields.length, side(1).shields.length],
      base: [baseHp(0), baseHp(1)],
    });
    const who = turnOwner === human ? "Du" : "Die KI";
    if (breaks.count) {
      const by = [...new Set(breaks.by)];
      moments.push({
        turn: turnNo,
        player: turnOwner,
        text: `${who} ${turnOwner === human ? "zerstörst" : "zerstört"} ${breaks.count === 1 ? "einen Schild" : `${breaks.count} Schilde`}${by.length ? ` mit ${listNames(by)}` : ""}.`,
      });
    }
    if (basesLost) {
      moments.push({
        turn: turnNo,
        player: turnOwner,
        text: `${who} ${turnOwner === human ? "zerstörst" : "zerstört"} die Base.`,
      });
    }
    breaks = { by: [], count: 0 };
    basesLost = 0;
  };

  for (const step of steps) {
    const s = step.after;
    for (const e of step.events) {
      switch (e.t) {
        case "turnStart":
          closeTurn();
          turnOwner = e.player;
          turnNo = e.turn;
          break;
        case "attack":
          attacker = e.attacker;
          defender = e.target === "player" ? null : e.target;
          break;
        case "block":
          defender = e.blocker;
          break;
        case "deploy":
        case "play":
          sides[e.player].played++;
          break;
        case "damage": {
          const victim = s.cards[e.card]!;
          const dealer =
            e.kind === "battle"
              ? victim.owner === s.cards[attacker ?? -1]?.owner
                ? defender
                : attacker
              : null;
          const side = 1 - victim.owner;
          if (
            victim.zone === "base" ||
            engine.card(s, e.card).type === "BASE" ||
            engine.card(s, e.card).type === "EX BASE"
          ) {
            sides[side]!.toPlayer += e.amount;
            if (dealer !== null) credit(s, dealer, e.amount, 0);
          } else {
            sides[side]!.toUnits += e.amount;
            if (dealer !== null) credit(s, dealer, e.amount, 0);
          }
          lastHit = dealer;
          break;
        }
        case "playerDamage":
          sides[1 - e.player]!.toPlayer += e.amount;
          credit(s, attacker, e.amount, 0);
          lastHit = attacker;
          break;
        case "shieldBreak":
          sides[1 - e.player]!.shields++;
          credit(s, attacker, 0, 1);
          breaks.count++;
          if (attacker !== null) breaks.by.push(name(s, attacker));
          lastHit = attacker;
          break;
        case "destroyed": {
          const card = s.cards[e.card]!;
          const type = engine.card(s, e.card).type;
          if (type === "BASE" || type === "EX BASE") basesLost++;
          else if (type === "UNIT" || type === "UNIT TOKEN") sides[1 - card.owner]!.destroyed++;
          break;
        }
        case "gameOver":
          if (e.result.reason === "damage" && lastHit !== null && s.cards[lastHit]) {
            finalBlow = { no: s.cards[lastHit]!.no, player: s.cards[lastHit]!.owner };
          }
          break;
        default:
          break;
      }
      if (e.t === "step" && (e.step === "battleEnd" || e.step === "endAction")) {
        attacker = null;
        defender = null;
      }
    }
    last = s;
  }
  closeTurn();

  const mvp =
    [...impact.entries()]
      .filter(([id]) => last?.cards[id]?.owner === human)
      .map(([, v]) => v)
      .sort((a, b) => b.damage + 3 * b.breaks - (a.damage + 3 * a.breaks))[0] ?? null;
  return {
    winner: last?.result?.winner ?? null,
    turns: last?.result?.turn ?? turnNo,
    points,
    sides,
    mvp,
    finalBlow,
    moments,
  };
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} und ${names.at(-1)}`;
}
