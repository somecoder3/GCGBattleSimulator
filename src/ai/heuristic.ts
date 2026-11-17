// Heuristic AI v0: fixed rules and a simple card value, no lookahead. Plays on its own view only
// (engine/view.ts), so it never knows hidden cards. Opponent for the first playable version (M3);
// M4 replaces it with an evaluation function and search within the turn.

import type { Instr } from "../effects/compile";
import type { Engine } from "../engine/engine";
import type { Action, CardId, Decision, GameState, PlayerId } from "../engine/types";
import { HIDDEN } from "../engine/view";
import { DEFAULT_MULLIGAN, keepHand } from "./mulligan";
import type { Policy } from "./types";

/** Score of "do nothing more" in the main phase; options below it are never chosen. */
const END_MAIN = 10;
/** A Base is only deployed if that gains at least this much (see Ctx.baseSwapGain). */
const MIN_BASE_GAIN = 0.5;

const HARMFUL = new Set(["rest", "damage", "destroy", "bounce", "toDeck", "exile"]);
const BENEFICIAL = new Set(["ready", "recover", "grant", "toHand"]);
const HARMFUL_FLAGS = new Set(["cantAttack", "cantAttackPlayer", "cantBePaired", "stayRested"]);

type Intent = "harm" | "help" | "neutral";

export class HeuristicPolicy implements Policy {
  readonly name = "heuristic-v0";

  constructor(private readonly engine: Engine) {}

  choose(view: GameState, decision: Decision): Action {
    const options = decision.options;
    if (options.length === 1) return options[0]!;
    const ctx = new Ctx(this.engine, view, decision.player);
    switch (decision.kind) {
      case "mulligan":
        return ctx.mulligan(options);
      case "main":
        return best(options, (o) => ctx.mainScore(o)) ?? options.find((o) => o.type === "endMain")!;
      case "block":
        return best(options, (o) => ctx.blockScore(o)) ?? options[0]!;
      case "action":
        return best(options, (o) => ctx.actionScore(o)) ?? options[0]!;
      case "discard":
        // The card least worth keeping; scores must be positive for best().
        return best(options, (o) => (o.type === "discard" ? 1000 - ctx.keepValue(o.card) : 0)) ?? options[0]!;
      case "effect":
        return ctx.effect(decision);
    }
  }
}

/** The option with the highest score, if that score is positive. */
function best(options: Action[], score: (o: Action) => number): Action | undefined {
  let top: Action | undefined;
  let topScore = 0;
  for (const o of options) {
    const s = score(o);
    if (s > topScore) {
      top = o;
      topScore = s;
    }
  }
  return top;
}

class Ctx {
  constructor(
    readonly engine: Engine,
    readonly s: GameState,
    readonly me: PlayerId,
  ) {}

  get enemy(): PlayerId {
    return this.me === 0 ? 1 : 0;
  }

  known(id: CardId): boolean {
    return this.s.cards[id]!.no !== HIDDEN;
  }

  card(id: CardId) {
    return this.engine.card(this.s, id);
  }

  // Values come from the view. An effect that looks at hidden cards (e.g. counting shield area
  // cards by type) can't be evaluated there; the printed value is the fallback.
  ap(id: CardId): number {
    return safe(
      () => this.engine.ap(this.s, id),
      () => this.card(id).ap,
    );
  }

  /** HP left after damage. */
  hpLeft(id: CardId): number {
    return (
      safe(
        () => this.engine.hp(this.s, id),
        () => this.card(id).hp,
      ) - this.s.cards[id]!.damage
    );
  }

  keywords(id: CardId) {
    return safe(
      () => this.engine.keywords(this.s, id),
      () => this.card(id).keywords,
    );
  }

  /** Rough worth of a Unit in play: stats, keywords and Pilot. */
  unitValue(id: CardId): number {
    if (!this.known(id)) return 0;
    const k = this.keywords(id);
    let v = this.ap(id) + this.hpLeft(id) + this.card(id).level * 0.5;
    if (k.blocker) v += 1;
    if (k.firstStrike) v += 1;
    if (k.highManeuver) v += 1;
    if (k.suppression) v += 1;
    v += k.breach * 0.5 + k.repair + k.support * 0.3;
    if (this.s.cards[id]!.pilot !== null) v += 1;
    return v;
  }

  /** How much a card in the hand is worth keeping. */
  keepValue(id: CardId): number {
    if (!this.known(id)) return 0;
    const card = this.card(id);
    const level = this.s.players[this.me].resources.length;
    let v = card.type === "UNIT" ? 6 : card.type === "PILOT" ? 4 : 3;
    v += Math.min(card.level, level + 2);
    if (card.level > level + 3) v -= 4; // far away from being playable
    return v;
  }

  mulligan(options: Action[]): Action {
    const keep = keepHand(this.engine, this.s, this.me, DEFAULT_MULLIGAN); // src/ai/mulligan.ts
    return options.find((o) => o.type === (keep ? "keepHand" : "redraw"))!;
  }

  // ------------------------------------------------------------------------------------------
  // Main phase

  mainScore(o: Action): number {
    const me = this.s.players[this.me];
    switch (o.type) {
      case "deployUnit": {
        const card = this.card(o.card);
        const value = card.ap + card.hp + card.level * 10;
        if (o.replace === undefined) return 100 + value;
        const gain = card.ap + card.hp - this.unitValue(o.replace);
        return gain > 3 ? 60 + gain : -1;
      }
      case "pair": {
        const pilot = this.card(o.card);
        const link = this.links(o.unit, o.card);
        // A Command with 【Pilot】 is usually better used as a Command unless it links.
        if (pilot.type === "COMMAND" && !link) return 20;
        return 90 + pilot.level * 10 + (link ? 30 : 0) + this.unitValue(o.unit) * 0.5;
      }
      case "deployBase": {
        const gain = this.baseSwapGain(o.card);
        if (gain < MIN_BASE_GAIN) return -1;
        const current = me.base[0];
        const exBase = current === undefined || this.card(current).type === "EX BASE";
        return exBase ? 85 : 15 + gain;
      }
      case "playCommand":
        return 80 + this.card(o.card).level * 5;
      case "activate":
        return 60;
      case "attack":
        return this.attackScore(o.unit, o.target);
      case "support": {
        const target = this.s.cards[o.target]!;
        const canAttack = !target.rested && target.enteredTurn < this.s.turn;
        return canAttack && this.ap(o.unit) <= 1 ? 25 : -1;
      }
      case "endMain":
        return END_MAIN;
      default:
        return 0;
    }
  }

  /** Shields a Base's 【Deploy】 moves to the hand ("Add 1 of your Shields to your hand"). */
  shieldsToHand(card: CardId): number {
    let n = 0;
    for (const { effect, program } of this.card(card).script.compiled) {
      if (effect.kind !== "trigger" || effect.on !== "deploy") continue;
      for (const instr of program) if (instr.op === "shieldToHand") n += instr.n;
    }
    return n;
  }

  /**
   * What deploying this Base is worth, in the units of the v1 evaluation (evaluate.ts): 0.8 per Base HP,
   * the i-th remaining Shield 2 + 4/i, a card in the hand 2. A Shield that 【Deploy】 moves to the hand
   * costs its value but brings a card, so 4/i; the fresh Base gains its HP over what the old one has left.
   * Other effects of the new Base (tokens, activated effects …) add a little.
   */
  baseSwapGain(card: CardId): number {
    const me = this.s.players[this.me];
    const current = me.base[0];
    const oldHp = current === undefined ? 0 : Math.max(0, this.hpLeft(current));
    let gain = 0.8 * (this.card(card).hp - oldHp);
    const shields = me.shields.length;
    const moved = Math.min(this.shieldsToHand(card), shields);
    for (let i = 0; i < moved; i++) gain -= 4 / (shields - i);
    const other = this.card(card).script.compiled.filter(
      ({ effect, program }) =>
        effect.kind !== "burst" &&
        !(
          effect.kind === "trigger" &&
          effect.on === "deploy" &&
          program.every((i) => i.op === "shieldToHand")
        ),
    ).length;
    return gain + other;
  }

  links(unit: CardId, pilot: CardId): boolean {
    const u = this.card(unit);
    const p = this.card(pilot);
    if (!p.pilotName) return false;
    return u.link.some((c) =>
      "pilotName" in c ? p.pilotName!.includes(c.pilotName) : p.traits.includes(c.trait),
    );
  }

  /** Enemy Units that could block an attack of `unit` (active, <Blocker>). */
  blockers(unit: CardId): CardId[] {
    if (this.keywords(unit).highManeuver) return [];
    return this.s.players[this.enemy].battle.filter(
      (id) => this.known(id) && !this.s.cards[id]!.rested && this.keywords(id).blocker,
    );
  }

  /** Would `attacker` destroy `defender` in battle, and would it survive? */
  fight(attacker: CardId, defender: CardId): { kills: boolean; survives: boolean } {
    const kills = this.ap(attacker) >= this.hpLeft(defender);
    const firstStrike = this.keywords(attacker).firstStrike;
    const survives = (firstStrike && kills) || this.ap(defender) < this.hpLeft(attacker);
    return { kills, survives };
  }

  attackScore(unit: CardId, target: "player" | CardId): number {
    const ap = this.ap(unit);
    if (ap <= 0) return -1;
    const enemy = this.s.players[this.enemy];
    if (target === "player") {
      if (!enemy.shields.length && !enemy.base.length) return 10_000; // lethal
      // A blocker that destroys the attacker and survives makes the attack a loss.
      const punished = this.blockers(unit).some((b) => {
        const f = this.fight(b, unit);
        return f.kills && f.survives;
      });
      return punished ? 15 : 50 + ap;
    }
    if (!this.known(target)) return -1;
    const { kills, survives } = this.fight(unit, target);
    if (!kills) return -1;
    if (survives) return 70 + this.unitValue(target);
    const trade = this.unitValue(target) - this.unitValue(unit);
    return trade >= 0 ? 40 + trade : -1;
  }

  // ------------------------------------------------------------------------------------------
  // Opponent's attacks and action steps

  blockScore(o: Action): number {
    if (o.type !== "block") return 0;
    const battle = this.s.battle;
    if (!battle || !this.known(battle.attacker)) return 0;
    const me = this.s.players[this.me];
    const { kills, survives } = this.fight(o.unit, battle.attacker);
    const lethal = battle.target === "player" && !me.shields.length && !me.base.length;
    if (lethal) return 100 + (survives ? 10 : 0);
    if (survives) return 50 + (kills ? 20 : 0);
    if (kills && this.unitValue(battle.attacker) >= this.unitValue(o.unit)) return 30;
    // Protect a more valuable Unit that would be destroyed.
    if (battle.target !== "player" && this.known(battle.target)) {
      const threatened = this.ap(battle.attacker) >= this.hpLeft(battle.target);
      if (threatened && this.unitValue(battle.target) > this.unitValue(o.unit) + 2) return 20;
    }
    return 0;
  }

  /** Uses Commands and activated effects whenever it can; passing is the fallback. */
  actionScore(o: Action): number {
    if (o.type === "playCommand") return 50 + this.card(o.card).level;
    if (o.type === "activate") return 40;
    return 0;
  }

  // ------------------------------------------------------------------------------------------
  // Effect decisions

  effect(decision: Decision): Action {
    const options = decision.options;
    switch (decision.prompt) {
      case "burst":
      case "may":
        return options.find((o) => o.type === "yes") ?? options[0]!;
      case "option":
      case "order":
        return options[0]!;
      case "overflow":
        return best(options, (o) => (o.type === "target" ? 1000 - this.unitValue(o.card) : 0)) ?? options[0]!;
      case "discard":
        return best(options, (o) => (o.type === "target" ? 1000 - this.keepValue(o.card) : 0)) ?? options[0]!;
      case "lookPick":
      case "lookTop":
        return best(options, (o) => (o.type === "target" ? 1 + this.keepValue(o.card) : 0)) ?? options[0]!;
      default:
        return this.target(decision);
    }
  }

  /** Picks a target by what the effect does to it: harm enemies, help friends. */
  target(decision: Decision): Action {
    const intent = this.intent();
    const scored = decision.options.map((o) => ({ o, score: this.targetScore(o, intent) }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.o;
  }

  targetScore(o: Action, intent: { kind: Intent; damage: number }): number {
    if (o.type === "done") return 0; // stop choosing unless a target is worth it
    if (o.type !== "target") return -1;
    const card = this.s.cards[o.card]!;
    const friendly = card.owner === this.me;
    const inPlay = card.zone === "battle";
    const value = inPlay ? this.unitValue(o.card) : this.keepValue(o.card);
    if (intent.kind === "neutral") return friendly ? 1 + value : 0.5;
    const good = intent.kind === "harm" ? !friendly : friendly;
    let score = good ? 1 + value : -100 - value;
    if (good && intent.kind === "harm" && intent.damage > 0 && inPlay && this.known(o.card)) {
      if (intent.damage >= this.hpLeft(o.card)) score += 20; // destroys it
    }
    return score;
  }

  /** What the running effect does to the cards it is choosing (from its compiled program). */
  intent(): { kind: Intent; damage: number } {
    const frame = this.s.frames[this.s.frames.length - 1];
    if (!frame) return { kind: "neutral", damage: 0 };
    const script = this.engine.lib.get(frame.ref.no).script;
    const program = (frame.ref.granted ? script.compiledGranted : script.compiled)[frame.ref.idx]?.program;
    const instr = program?.[frame.pc];
    if (!program || !instr) return { kind: "neutral", damage: 0 };
    if (instr.op === "deployFromHand") return { kind: "help", damage: 0 };
    if (instr.op !== "choose") return { kind: "neutral", damage: 0 };
    const as = instr.as ?? "it";
    for (const next of program.slice(frame.pc + 1)) {
      if (!("t" in next) || typeof next.t !== "string" || !next.t.split("+").includes(as)) continue;
      return classify(next);
    }
    return { kind: "neutral", damage: 0 };
  }
}

function safe<T>(value: () => T, fallback: () => T): T {
  try {
    return value();
  } catch {
    return fallback();
  }
}

function classify(instr: Instr): { kind: Intent; damage: number } {
  if (instr.op === "damage") return { kind: "harm", damage: instr.amount };
  if (HARMFUL.has(instr.op)) return { kind: "harm", damage: 0 };
  if (BENEFICIAL.has(instr.op)) return { kind: "help", damage: 0 };
  if (instr.op === "mod") return { kind: (instr.ap ?? 0) + (instr.hp ?? 0) < 0 ? "harm" : "help", damage: 0 };
  if (instr.op === "flag") return { kind: HARMFUL_FLAGS.has(instr.flag) ? "harm" : "help", damage: 0 };
  return { kind: "neutral", damage: 0 };
}
