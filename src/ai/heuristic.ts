// Heuristic AI v0: fixed rules and a simple card value, no lookahead. Plays on its own view only
// (engine/view.ts), so it never knows hidden cards. Opponent for the first playable version (M3);
// M4 replaces it with an evaluation function and search within the turn.

import type { Instr } from "../effects/compile";
import { satisfiesLink } from "../engine/cardlib";
import type { Engine } from "../engine/engine";
import type { Action, CardId, Decision, DeckList, GameState, PlayerId } from "../engine/types";
import { HIDDEN } from "../engine/view";
import { DEFAULT_MULLIGAN, keepHand } from "./mulligan";
import { planFor, type DeckPlan } from "./synergy";
import type { Policy } from "./types";

/** Score of "do nothing more" in the main phase; options below it are never chosen. */
const END_MAIN = 10;
/** A Base is only deployed if that gains at least this much (see Ctx.baseSwapGain). */
const MIN_BASE_GAIN = 0.5;

/** Resting an enemy Unit is worth a Command or an activated effect from this rest value on. */
const REST_WORTH = 2;
/** A battle Command (The Final Victor) is played when its worst case gains at least this (unit values). */
const FIGHT_WORTH = 2;
const HARMFUL = new Set(["rest", "damage", "destroy", "bounce", "toDeck", "exile"]);
const BENEFICIAL = new Set(["ready", "recover", "grant", "toHand"]);
const HARMFUL_FLAGS = new Set(["cantAttack", "cantAttackPlayer", "cantBePaired", "stayRested"]);

type Intent = "harm" | "help" | "neutral";

/** Switches for the rules of v0 (also used by v1 and the search for their continuations). */
export interface RuleOptions {
  /** Play every Action Command at once (the rule before 18 Nov 2026), instead of `commandMatters`. */
  eagerCommands?: boolean;
  /** Play every Command in the main phase as soon as possible (the rule before 18 Nov 2026). */
  eagerMainCommands?: boolean;
  /** Draw only at the end of the main phase, also with few cards or no Units (before 18 Nov 2026). */
  lateDraw?: boolean;
  /** Choose AP-/AP+ targets by value only, not by the fights they change (before 18 Nov 2026). */
  plainApTargets?: boolean;
  /**
   * v1 and the search also consider Action Commands in an action step that can't change anything (before
   * 18 Nov 2026; the search sometimes played one by chance, e.g. AP-3 at the end of the opponent's turn).
   */
  searchIdleCommands?: boolean;
  /**
   * The rules before 19 Nov 2026 for battles started by effects (The Final Victor, ST12-013) and for
   * activated keywords: never play such a Command in the main phase, the opponent answers with its most
   * valuable Unit, First Strike/Suppression are activated whenever possible.
   */
  plainFights?: boolean;
  /** When the EX Resource may be used up (docs/AI.md "EX Resource"); default DEFAULT_EX. */
  ex?: ExRule;
  /** Exception to `ex`: a Pilot that links may always use it (part of the default; with `ex` set, only if given). */
  exLink?: boolean;
  /** Rest enemy Units without checking what it changes (the rule before 18 Nov 2026). */
  plainRest?: boolean;
  /** Exception to `ex`: a Command may use it from this level on (Resources incl. the EX Resource). */
  exCommandLevel?: number;
  /** Exception to `ex`: may always use it while no own Unit is in play. */
  exEmergency?: boolean;
  /** For `ex: "level"`: the level that must remain after using it. */
  exLevel?: number;
  /** The AI's own deck list (for `ex: "deck"` and the combos; set by makePolicy). */
  ownDeck?: DeckList;
  /**
   * Experiment (docs/AI.md "Kombos", not better): cards the own deck wants in the trash are cheaper to
   * discard (v0) and worth something there (v1/search evaluation).
   */
  comboFuel?: boolean;
  /** Experiment (not better): v1/search value linked Units in the evaluation. */
  linkValue?: boolean;
  /** v1/search preselection: how far it simulates (src/ai/lookahead.ts Horizon; v1 default "round"). */
  horizon?: "battle" | "turn" | "round" | "through";
  /** Pair a Pilot with any Unit, even if a Unit it links is in the hand (before 18 Nov 2026). */
  pairAnyPilot?: boolean;
  /**
   * Before 22 Nov 2026: own cards in the trash that an effect exiles (or otherwise "harms") were avoided like
   * own Units in play, so "You may choose 2 (MF) Unit cards from your trash. Exile them. If you do, …"
   * (Shining Gundam, Master Gundam) was never used. Now such trash cards count as a cheap cost.
   */
  plainTrashCost?: boolean;
  /** Before 22 Nov 2026: discarding ignored that a Pilot links a Unit in the hand (and vice versa). */
  plainLinkKeep?: boolean;
  /**
   * v1/search simulations as before 20 Nov 2026: an end-of-main-phase Command that v0 plays in the
   * simulation counts even when the turn is better without it (see optionalPlay, docs/AI.md "Vorausschau").
   */
  forcedFiller?: boolean;
}

/** keepValue points less for a card the own deck wants in the trash (per DeckPlan.trashFuel, at most 1). */
const FUEL_DISCARD = 2;

/**
 * When the AI may use up its EX Resource (it counts for the level until then):
 * - free: whenever the normal Resources don't cover a cost (the engine pays them first);
 * - never;
 * - hand: not while another Unit in the hand would no longer be reachable (Lv. > level after using it);
 * - deck: not before the highest-level Unit of the own deck stays reachable without it;
 * - level: not before the level after using it is at least `exLevel`.
 */
export type ExRule = "free" | "never" | "hand" | "deck" | "level";

/** The default: hold it until the highest Unit of the deck stays reachable; a linking Pilot may use it. */
export const DEFAULT_EX = { ex: "deck" as ExRule, exLink: true };

export class HeuristicPolicy implements Policy {
  readonly name = "heuristic-v0";

  constructor(
    private readonly engine: Engine,
    private readonly options: RuleOptions = {},
  ) {
    // The default EX Resource rule (measured 18 Nov 2026, docs/AI.md): "deck" with the link exception.
    this.ex = options.ex ?? DEFAULT_EX.ex;
    this.exLink = options.ex ? !!options.exLink : DEFAULT_EX.exLink;
    const units = options.ownDeck?.main.map((no) => engine.lib.get(no)).filter((c) => c.type === "UNIT");
    this.topLevel = units?.length ? Math.max(...units.map((c) => c.level)) : undefined;
  }

  /** The highest level of a Unit in the own deck (for `ex: "deck"`). */
  private readonly topLevel: number | undefined;
  private readonly ex: ExRule;
  private readonly exLink: boolean;

  /**
   * The options worth considering (also for v1 and the search): the EX Resource rule, and in an action
   * step no Command that can't change anything now (`commandMatters`; passing keeps it for later).
   * All options, if the rules allow none.
   */
  allowed(view: GameState, decision: Decision): Action[] {
    if (decision.kind !== "main" && decision.kind !== "action") return decision.options;
    const p = decision.player;
    let kept = decision.options;
    if (this.ex !== "free") {
      kept = kept.filter((o) => !this.engine.spendsEx(view, p, o) || this.mayUseEx(view, p, o));
    }
    if (decision.kind === "action" && !this.options.eagerCommands && !this.options.searchIdleCommands) {
      const ctx = new Ctx(this.engine, view, p, this.options);
      kept = kept.filter((o) =>
        o.type === "playCommand"
          ? ctx.commandMatters(o.card)
          : o.type !== "activate" || !ctx.battleUseless(o),
      );
    }
    return kept.length ? kept : decision.options;
  }

  private mayUseEx(s: GameState, p: PlayerId, o: Action): boolean {
    const me = s.players[p];
    if (this.options.exEmergency && me.battle.length === 0) return true;
    const cmdLevel = this.options.exCommandLevel;
    if (cmdLevel !== undefined && o.type === "playCommand" && me.resources.length >= cmdLevel) return true;
    if (this.exLink && o.type === "pair" && links(this.engine, s, o.unit, o.card)) return true;
    const after = me.resources.length - 1; // the level once it is used up
    // Without the own deck list (tests, hand-built states) "deck" looks at the hand.
    const rule = this.ex === "deck" && this.topLevel === undefined ? "hand" : this.ex;
    switch (rule) {
      case "never":
        return false;
      case "hand": {
        const played = "card" in o ? o.card : undefined;
        return !me.hand.some(
          (h) => h !== played && s.cards[h]!.no !== HIDDEN && this.unitLevel(s, h) > after,
        );
      }
      case "deck":
        return after >= this.topLevel!;
      case "level":
        return after >= (this.options.exLevel ?? 7);
      default:
        return true;
    }
  }

  private unitLevel(s: GameState, id: CardId): number {
    const c = this.engine.card(s, id);
    return c.type === "UNIT" ? c.level : 0;
  }

  /**
   * Is this v0 choice in the main phase optional: a Command that only draws, looks at the top of the
   * deck … (no removal, no boost)? The simulations of v1/search also try the turn without such cards
   * (simulator game of 20 Nov 2026: v0 would play Turning Point of History after an attack, which the
   * evaluation counts as a lost hand card, so v1 didn't attack at all; docs/AI.md "Vorausschau").
   */
  optionalPlay(view: GameState, decision: Decision, action: Action): boolean {
    if (decision.kind !== "main" || action.type !== "playCommand") return false;
    const ctx = new Ctx(this.engine, view, decision.player, this.options);
    ctx.mainOptions = this.allowed(view, decision);
    return ctx.mainScore(action) > 0 && ctx.neutralCommand;
  }

  /** v0's choice without optional Commands (optionalPlay); the main phase goes on as v0 would play it. */
  chooseWithoutOptional(view: GameState, decision: Decision): Action {
    let options = decision.options;
    for (;;) {
      const action = this.choose(view, { ...decision, options });
      if (!this.optionalPlay(view, decision, action)) return action;
      options = options.filter((o) => o !== action);
    }
  }

  choose(view: GameState, decision: Decision): Action {
    decision = { ...decision, options: this.allowed(view, decision) };
    const options = decision.options;
    if (options.length === 1) return options[0]!;
    const ctx = new Ctx(this.engine, view, decision.player, this.options);
    switch (decision.kind) {
      case "mulligan":
        return ctx.mulligan(options);
      case "main":
        ctx.mainOptions = options;
        return best(options, (o) => ctx.mainScore(o)) ?? options.find((o) => o.type === "endMain")!;
      case "block":
        return best(options, (o) => ctx.blockScore(o)) ?? options[0]!;
      case "action":
        return best(options, (o) => ctx.actionScore(o)) ?? options[0]!;
      case "discard":
        // The card least worth keeping; scores must be positive for best().
        return (
          best(options, (o) => (o.type === "discard" ? 1000 - ctx.discardKeep(o.card) : 0)) ?? options[0]!
        );
      case "effect":
        return ctx.effect(decision);
    }
  }
}

/** Would this Pilot link with this Unit (its link condition)? */
function links(engine: Engine, s: GameState, unit: CardId, pilot: CardId): boolean {
  const u = engine.card(s, unit);
  const p = engine.card(s, pilot);
  if (!p.pilotName) return false;
  return u.link.some((c) =>
    "pilotName" in c ? p.pilotName!.includes(c.pilotName) : p.traits.includes(c.trait),
  );
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
    readonly options: RuleOptions = {},
  ) {}

  /** The options of the current main decision (to see which Units can still attack this turn). */
  mainOptions: Action[] = [];
  /** Set by mainCommandScore: the Command only draws, looks at the deck … (no removal, no boost). */
  neutralCommand = false;

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
    if (!this.options.plainLinkKeep && card.type !== "COMMAND") v += this.linkPartnerInHand(id) ? 7 : 0;
    return v;
  }

  /**
   * A Pilot with a Unit in the own hand it links (or a Unit with such a Pilot): both are worth keeping
   * together (found 22 Nov 2026: Overflowing Affection discarded Master Asia next to Master Gundam).
   */
  linkPartnerInHand(id: CardId): boolean {
    const me = this.card(id);
    return this.s.players[this.me].hand.some((h) => {
      if (h === id || !this.known(h)) return false;
      const other = this.card(h);
      if (me.type === "PILOT" && other.type === "UNIT") return satisfiesLink(other, me);
      if (me.type === "UNIT" && other.pairable) return satisfiesLink(me, other);
      return false;
    });
  }

  /** The own deck's combo plan (src/ai/synergy.ts), if known. */
  get plan(): DeckPlan | undefined {
    if (!this.options.comboFuel || !this.options.ownDeck) return undefined;
    return planFor(this.engine.lib, this.options.ownDeck);
  }

  /**
   * A Pilot that should wait for a Unit it links: one in the own hand that is playable now or next turn
   * (Lv. at most the level + 1). Pairing it with another Unit would waste the link (docs/AI.md "Kombos").
   */
  waitsForLink(pilot: CardId): boolean {
    const level = this.s.players[this.me].resources.length;
    const p = this.card(pilot);
    return this.s.players[this.me].hand.some((h) => {
      if (!this.known(h)) return false;
      const unit = this.card(h);
      return unit.type === "UNIT" && unit.level <= level + 1 && satisfiesLink(unit, p);
    });
  }

  /** keepValue for discarding: a card the own deck wants in the trash is cheaper to discard. */
  discardKeep(id: CardId): number {
    const fuel = this.known(id) ? (this.plan?.trashFuel.get(this.s.cards[id]!.no) ?? 0) : 0;
    return this.keepValue(id) - Math.min(1, fuel) * FUEL_DISCARD;
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
        if (!link && !this.options.pairAnyPilot && this.waitsForLink(o.card)) return -1;
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
        if (this.options.eagerMainCommands) return 80 + this.card(o.card).level * 5;
        return this.mainCommandScore(o.card);
      case "activate": {
        if (this.restUseless(o)) return -1;
        const grant = this.options.plainFights ? undefined : this.grantedKeyword(o);
        if (grant === "firstStrike") return this.firstStrikeGain(o.card) > 0 ? 115 : -1;
        if (grant === "suppression") return -1; // only in its own attack (action step)
        if (!this.options.plainFights) {
          // A battle started by an activated effect (Qubeley ST13-001: a token against an enemy Unit).
          const program = this.engine.activatedProgram(this.s, o);
          if (program?.some((i) => i.op === "fight")) {
            return this.fightCommandValue(program, undefined, o.card) > 0 ? 60 : -1;
          }
        }
        return 60;
      }
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
    return links(this.engine, this.s, unit, pilot);
  }

  /** Enemy Units that could block an attack of `unit` (active, <Blocker>). */
  blockers(unit: CardId): CardId[] {
    if (this.keywords(unit).highManeuver) return [];
    return this.s.players[this.enemy].battle.filter(
      (id) => this.known(id) && !this.s.cards[id]!.rested && this.keywords(id).blocker,
    );
  }

  /**
   * A Command in the main phase, by what its effects do and how long they last (docs/AI.md):
   * - removal (destroy, return, exile, or damage that destroys an enemy Unit): early, as before;
   * - "during this battle" only: never (it waits for a battle, see commandMatters);
   * - "during this turn" for own Units: before attacking, only if it helps an attack this turn;
   * - "during this turn" against enemy Units (AP-, rest): only if Units can attack this turn;
   * - drawing and other effects: at the end of the main phase, and only if enough Resources stay
   *   active for an Action Command in the hand (for the opponent's turn).
   */
  mainCommandScore(id: CardId): number {
    const card = this.card(id);
    const program = card.script.compiled.find(
      (e) => e.effect.kind === "command" && e.effect.timing.includes("main"),
    )?.program;
    if (!program) return -1;
    if (!this.options.plainFights && program.some((i) => i.op === "fight")) {
      // A battle between two chosen Units (The Final Victor): worth it when the worst answer still pays.
      const value = this.fightCommandValue(program);
      return value >= FIGHT_WORTH ? 80 + card.level * 5 : -1;
    }
    const attackers = new Set(this.mainOptions.flatMap((o) => (o.type === "attack" ? [o.unit] : [])));
    const enemies = this.s.players[this.enemy].battle.filter((u) => this.known(u));
    // The side a choice is made from (by its variable).
    const sides = new Map<string, "friendly" | "enemy" | undefined>();
    for (const instr of program) {
      if ((instr.op === "choose" || instr.op === "all") && instr.as) sides.set(instr.as, instr.filter.side);
    }
    let best = -1;
    let neutral = false;
    for (const instr of program) {
      if (!("t" in instr) || typeof instr.t !== "string") {
        if (
          ["draw", "exResource", "token", "placeResource", "lookTop", "lookTopArrange", "deploy"].includes(
            instr.op,
          )
        )
          neutral = true;
        continue;
      }
      const side = instr.t === "self" ? "friendly" : sides.get(instr.t.split("+")[0]!);
      const effect = classify(instr);
      const until = "until" in instr ? instr.until : undefined;
      if (effect.kind === "harm" && side === "enemy") {
        if (["destroy", "bounce", "exile", "toDeck"].includes(instr.op) && enemies.length) {
          best = Math.max(best, 80 + card.level * 5);
        } else if (effect.damage > 0) {
          if (enemies.some((u) => this.hpLeft(u) <= effect.damage))
            best = Math.max(best, 80 + card.level * 5);
          else neutral = true; // chip damage: like other small effects
        } else if (until === "battle") {
          // waits for a battle
        } else if (instr.op === "rest" && !this.options.plainRest) {
          // Rest: only if it lets an attack pay off, takes a Blocker out of the way (restValue).
          if (enemies.some((u) => this.restValue(u) >= REST_WORTH)) best = Math.max(best, 110);
        } else if (instr.op === "rest" || instr.op === "mod") {
          // AP- or rest during this turn: worth it when this turn's attacks can use it.
          const useful =
            attackers.size > 0 &&
            enemies.some((u) => (instr.op === "rest" ? !this.s.cards[u]!.rested : true));
          if (useful) best = Math.max(best, 110);
        } else if (instr.op === "flag" && instr.flag === "stayRested") {
          best = Math.max(best, 60);
        }
      } else if (effect.kind === "help" && side === "friendly") {
        if (until === "battle") continue;
        if (until === "turn") {
          if (attackers.size > 0 && this.buffHelps(instr, attackers)) best = Math.max(best, 120);
          continue;
        }
        // Lasting help (recover, back to the hand, set active …): like other small effects.
        if (instr.op !== "recover" || this.s.players[this.me].battle.some((u) => this.s.cards[u]!.damage > 0))
          neutral = true;
      } else if (effect.kind === "neutral" || instr.op === "toHand") {
        neutral = true;
      }
    }
    this.neutralCommand = false;
    if (best > 0) return best;
    if (!neutral) return -1;
    this.neutralCommand = true;
    // Drawing is urgent with a small hand (first, for more choices this turn), or with no Unit in play
    // and none to deploy (to find one to defend with).
    const draws = program.some((i) => i.op === "draw");
    const me = this.s.players[this.me];
    if (draws && !this.options.lateDraw) {
      if (me.hand.length - 1 <= 3) return 150;
      const canDeploy = this.mainOptions.some((o) => o.type === "deployUnit" || o.type === "deployBase");
      if (me.battle.length === 0 && !canDeploy) return 150;
    }
    return this.resourcesLeftForAction(id) ? END_MAIN + 1 : -1;
  }

  /** Does a "during this turn" boost help an attack this turn? */
  buffHelps(instr: Instr, attackers: Set<CardId>): boolean {
    if (instr.op === "mod") {
      const plus = instr.ap ?? 0;
      if (plus <= 0) return false;
      const enemyBase = this.s.players[this.enemy].base.length > 0;
      const rested = this.s.players[this.enemy].battle.filter(
        (u) => this.known(u) && this.s.cards[u]!.rested,
      );
      // A kill that needs the extra AP, or more damage to the enemy Base.
      return [...attackers].some(
        (a) =>
          enemyBase || rested.some((t) => this.ap(a) < this.hpLeft(t) && this.ap(a) + plus >= this.hpLeft(t)),
      );
    }
    // Keywords and attack options (<High-Maneuver>, <Breach>, "may attack active Units" …).
    return instr.op === "grant" || instr.op === "flag";
  }

  /** After paying for `id`, can an Action Command in the hand still be paid in the opponent's turn? */
  resourcesLeftForAction(id: CardId): boolean {
    const me = this.s.players[this.me];
    const active = me.resources.filter((r) => !this.s.cards[r]!.rested).length - this.card(id).cost;
    const keep = me.hand
      .filter((h) => h !== id && this.known(h) && this.card(h).no !== this.card(id).no)
      .map((h) => this.card(h))
      .filter(
        (c) =>
          c.type === "COMMAND" &&
          c.level <= me.resources.length &&
          c.script.compiled.some((e) => e.effect.kind === "command" && e.effect.timing.includes("action")),
      );
    return keep.every((c) => active >= c.cost);
  }

  /**
   * What resting this enemy Unit changes now (0: nothing). In the own turn: the best attack on it that
   * pays (it can only be attacked while rested), more if the attacker has <Breach> and the Breach damage
   * reaches a Shield or the Base, and a <Blocker> out of the way of the attackers. In the opponent's
   * turn: an active Unit that could still attack can't any more.
   */
  restValue(unit: CardId): number {
    const card = this.s.cards[unit]!;
    if (card.rested || !this.known(unit)) return 0;
    const enemy = this.s.players[this.enemy];
    if (this.s.active === this.enemy) {
      if (card.enteredTurn >= this.s.turn || this.ap(unit) <= 0) return 0;
      const shields = this.s.players[this.me].shields.length;
      return 1 + this.ap(unit) * 0.5 + (shields <= 1 ? 3 : 0);
    }
    const attackers = this.s.players[this.me].battle.filter((a) => this.canAttackNow(a));
    let best = 0;
    for (const a of attackers) {
      const { kills, survives } = this.fight(a, unit);
      if (!kills) continue;
      let gain = survives ? 2 + this.unitValue(unit) : this.unitValue(unit) - this.unitValue(a);
      const breach = this.keywords(a).breach;
      if (breach > 0 && (enemy.shields.length || enemy.base.length)) {
        gain += 2 + breach + (enemy.shields.length <= 2 ? 2 : 0);
      }
      best = Math.max(best, gain);
    }
    if (this.keywords(unit).blocker && attackers.length) best += 2;
    return best;
  }

  /** A friendly Unit that can still attack this turn. */
  canAttackNow(unit: CardId): boolean {
    const card = this.s.cards[unit]!;
    return this.known(unit) && !card.rested && card.enteredTurn < this.s.turn && this.ap(unit) > 0;
  }

  /** An activated effect that only rests enemy Units, none of them worth resting now. */
  restUseless(o: Action): boolean {
    if (this.options.plainRest) return false;
    const program = this.engine.activatedProgram(this.s, o);
    if (!program?.some((i) => i.op === "rest")) return false;
    const effects = program.filter((i) => "t" in i && typeof i.t === "string");
    const sides = new Map<string, string | undefined>();
    for (const i of program)
      if ((i.op === "choose" || i.op === "all") && i.as) sides.set(i.as, i.filter.side);
    const onlyRestEnemy = effects.every(
      (i) => i.op === "rest" && "t" in i && sides.get(String(i.t).split("+")[0] ?? "") === "enemy",
    );
    if (!onlyRestEnemy) return false;
    return !this.s.players[this.enemy].battle.some((u) => this.restValue(u) >= REST_WORTH);
  }

  /**
   * An activated effect that only lasts "during this battle" and can't change one: no battle now, or it
   * only helps its own Unit, which isn't battling (ST12-006 <Suppression> in the end phase).
   */
  battleUseless(o: Action): boolean {
    const program = this.engine.activatedProgram(this.s, o);
    const lasting = (program ?? []).filter((i) => "until" in i);
    if (!lasting.length || lasting.some((i) => "until" in i && i.until !== "battle")) return false;
    const b = this.s.battle;
    if (!b) return true;
    const card = "card" in o ? o.card : -1;
    const self = lasting.every((i) => "t" in i && i.t === "self");
    return self && b.attacker !== card && b.target !== card;
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
    if (o.type === "playCommand") {
      const play = this.options.eagerCommands || this.commandMatters(o.card);
      return play ? 50 + this.card(o.card).level : 0;
    }
    if (o.type === "activate") {
      if (this.restUseless(o) || this.battleUseless(o)) return 0;
      const grant = this.options.plainFights ? undefined : this.grantedKeyword(o);
      if (grant === "suppression") return this.suppressionHelps(o.card) ? 40 : 0;
      if (grant === "firstStrike") return this.firstStrikeSavesBattle(o.card) ? 40 : 0;
      return 40;
    }
    return 0;
  }

  // ------------------------------------------------------------------------------------------
  // Battles started by effects (The Final Victor) and activated First Strike / Suppression

  /** Damage `id` takes from `amount` enemy battle damage (Destiny Gundam GD05-055 reduces it by 2). */
  battleDamageTo(id: CardId, amount: number): number {
    let reduce = 0;
    for (const { effect } of this.card(id).script.compiled) {
      if (effect.kind === "static" && "flag" in effect && effect.flag === "reduceEnemyBattleDamage")
        reduce += effect.amount ?? 0;
    }
    return Math.max(0, amount - reduce);
  }

  /**
   * A battle with only the damage step, `a` as the attacker (FAQ Q345/Q346): its <First Strike> counts
   * (`firstStrike` overrides it for "what if it gained First Strike").
   */
  fightResult(
    a: CardId,
    b: CardId,
    firstStrike = this.keywords(a).firstStrike,
  ): { aDies: boolean; bDies: boolean } {
    const bDies = this.battleDamageTo(b, this.ap(a)) >= this.hpLeft(b);
    const aDies = !(firstStrike && bDies) && this.battleDamageTo(a, this.ap(b)) >= this.hpLeft(a);
    return { aDies, bDies };
  }

  /** Worth of a battle for the side of `a`: the enemy Unit's value if it falls, minus its own. */
  fightGain(a: CardId, b: CardId, firstStrike?: CardId): number {
    const r = this.fightResult(a, b, firstStrike === a ? true : undefined);
    return (r.bDies ? this.unitValue(b) : 0) - (r.aDies ? this.unitValue(a) : 0);
  }

  /** The fight instruction of a program and who chooses its sides. */
  fightSides(program: readonly Instr[]): { a: string; b: string; bByOpponent: boolean } | undefined {
    const fight = program.find((i) => i.op === "fight");
    if (!fight || fight.op !== "fight") return undefined;
    const choice = program.find((i) => i.op === "choose" && i.as === fight.b);
    const bByOpponent = !!choice && choice.op === "choose" && choice.by === "opponent";
    return { a: String(fight.a), b: String(fight.b), bByOpponent };
  }

  /**
   * What a Command starting a battle is worth: the best own Unit against the opponent's best answer (when
   * the opponent chooses), or the best pair (when the own side chooses both). `firstStrike`: a Unit that
   * would have <First Strike> (activated before).
   */
  fightCommandValue(program: readonly Instr[], firstStrike?: CardId, self?: CardId): number {
    const sides = this.fightSides(program);
    if (!sides) return -Infinity;
    const choice = program.find((i) => i.op === "choose" && i.as === sides.a);
    const mine =
      sides.a === "self"
        ? self === undefined
          ? []
          : [self]
        : this.s.players[this.me].battle.filter(
            (u) =>
              this.known(u) && (choice?.op !== "choose" || !choice.filter.token || this.s.cards[u]!.token),
          );
    const theirs = this.s.players[this.enemy].battle.filter((u) => this.known(u));
    if (!mine.length || !theirs.length) return -Infinity;
    let top = -Infinity;
    for (const a of mine) {
      const gains = theirs.map((b) => this.fightGain(a, b, firstStrike));
      top = Math.max(top, sides.bByOpponent ? Math.min(...gains) : Math.max(...gains));
    }
    return top;
  }

  /** The keyword an activated effect gives its own Unit (First Strike, Suppression …), if that is all it does. */
  grantedKeyword(o: Action): string | undefined {
    if (o.type !== "activate") return undefined;
    const program = this.engine.activatedProgram(this.s, o);
    if (!program) return undefined;
    const grants = program.filter((i) => i.op === "grant" && i.t === "self");
    const other = program.some((i) => "t" in i && i.op !== "grant" && i.op !== "exile");
    const g = grants[0];
    return grants.length === 1 && !other && g?.op === "grant" ? g.keyword : undefined;
  }

  /**
   * What activating <First Strike> on `unit` would bring this turn: an attack on a rested enemy Unit it
   * then survives, or a battle Command in the hand (The Final Victor) that only pays with it.
   */
  firstStrikeGain(unit: CardId): number {
    if (this.keywords(unit).firstStrike) return 0;
    let gain = 0;
    for (const o of this.mainOptions) {
      if (o.type === "attack" && o.unit === unit && o.target !== "player" && this.known(o.target)) {
        const without = Math.max(0, this.fightGain(unit, o.target));
        const withIt = this.fightGain(unit, o.target, unit);
        if (withIt > without) gain = Math.max(gain, withIt - without);
      }
      if (o.type === "playCommand") {
        const program = this.card(o.card).script.compiled.find(
          (e) => e.effect.kind === "command" && e.effect.timing.includes("main"),
        )?.program;
        if (!program?.some((i) => i.op === "fight")) continue;
        const without = Math.max(0, this.fightCommandValue(program));
        const withIt = this.fightCommandValue(program, unit);
        if (withIt >= FIGHT_WORTH && withIt > without) gain = Math.max(gain, withIt - without);
      }
    }
    return gain;
  }

  /** <Suppression> pays in an attack of this Unit on the player, with no Base and at least 2 Shields. */
  suppressionHelps(unit: CardId): boolean {
    const b = this.s.battle;
    const enemy = this.s.players[this.enemy];
    return (
      !!b && b.attacker === unit && b.target === "player" && !enemy.base.length && enemy.shields.length >= 2
    );
  }

  /** <First Strike> during the own Unit's attack on a Unit: it then survives a fight it wins. */
  firstStrikeSavesBattle(unit: CardId): boolean {
    const b = this.s.battle;
    if (!b || b.attacker !== unit || b.target === "player" || !this.known(b.target)) return false;
    if (this.keywords(unit).firstStrike) return false;
    const r = this.fightResult(unit, b.target, true);
    return r.bDies && !r.aDies && this.fightResult(unit, b.target).aDies;
  }

  /**
   * Is an Action Command worth playing now (rather than kept for later)? It must change something: remove
   * or kill an enemy Unit, change the current battle (AP, keywords, protection, a new attack target), or
   * heal a damaged friendly Unit. Other effects (draw …) wait for the opponent's end of turn.
   */
  commandMatters(id: CardId): boolean {
    const script = this.card(id).script;
    const program = script.compiled.find(
      (e) => e.effect.kind === "command" && e.effect.timing.includes("action"),
    )?.program;
    if (!program) return false;
    const b = this.s.battle;
    const battling = b && b.target !== "player" ? [b.attacker, b.target] : b ? [b.attacker] : [];
    const myBattler = battling.some((u) => this.s.cards[u]!.owner === this.me);
    const enemyBattler = battling.some((u) => this.s.cards[u]!.owner === this.enemy);
    const enemies = this.s.players[this.enemy].battle.filter((u) => this.known(u));
    const damagedFriend = this.s.players[this.me].battle.some((u) => this.s.cards[u]!.damage > 0);
    let neutral = false;
    for (const instr of program) {
      if (instr.op === "redirect") {
        if (enemyBattler && b?.attackerOwner === this.enemy) return true;
        continue;
      }
      if (!("t" in instr) || typeof instr.t !== "string") {
        if (instr.op === "draw" || instr.op === "exResource" || instr.op === "token") neutral = true;
        continue;
      }
      const effect = classify(instr);
      if (effect.kind === "harm") {
        if (["destroy", "bounce", "exile", "toDeck"].includes(instr.op) && enemies.length) return true;
        if (effect.damage > 0 && enemies.some((u) => this.hpLeft(u) <= effect.damage)) return true;
        if (instr.op === "mod" && enemyBattler) return true;
        if (
          instr.op === "rest" &&
          !this.options.plainRest &&
          enemies.some((u) => this.restValue(u) >= REST_WORTH)
        )
          return true;
      } else if (effect.kind === "help") {
        if (instr.op === "recover" && damagedFriend) return true;
        if ((instr.op === "mod" || instr.op === "grant" || instr.op === "flag") && myBattler) return true;
      } else neutral = true;
    }
    // Effects without a fight to change: at the end of the opponent's turn, before they are wasted.
    return neutral && this.s.active === this.enemy && this.s.step === "endAction";
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
        return (
          best(options, (o) => (o.type === "target" ? 1000 - this.discardKeep(o.card) : 0)) ?? options[0]!
        );
      case "lookPick":
      case "lookTop":
        return best(options, (o) => (o.type === "target" ? 1 + this.keepValue(o.card) : 0)) ?? options[0]!;
      default:
        return this.target(decision);
    }
  }

  /** Picks a target by what the effect does to it: harm enemies, help friends. */
  target(decision: Decision): Action {
    const fight = this.options.plainFights ? undefined : this.fightChoice();
    if (fight) {
      const pick = best(decision.options, (o) => (o.type === "target" ? 1000 + fight(o.card) : 0));
      return pick ?? decision.options[0]!;
    }
    const intent = this.intent();
    const scored = decision.options.map((o) => ({ o, score: this.targetScore(o, intent) }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.o;
  }

  targetScore(o: Action, intent: { kind: Intent; damage: number; ap?: number; rest?: boolean }): number {
    if (o.type === "done") return 0; // stop choosing unless a target is worth it
    if (o.type !== "target") return -1;
    const card = this.s.cards[o.card]!;
    const friendly = card.owner === this.me;
    const inPlay = card.zone === "battle";
    const value = inPlay ? this.unitValue(o.card) : this.keepValue(o.card);
    if (intent.kind === "neutral") return friendly ? 1 + value : 0.5;
    // Own trash cards an effect exiles are its cost ("… from your trash. Exile them. If you do, …"):
    // cheap, the least valuable first.
    if (friendly && card.zone === "trash" && intent.kind === "harm" && !this.options.plainTrashCost) {
      return 1 + Math.max(0, 20 - value) * 0.05;
    }
    const good = intent.kind === "harm" ? !friendly : friendly;
    if (good && inPlay && intent.rest && !friendly && !this.options.plainRest && this.known(o.card)) {
      return 1 + this.restValue(o.card) + value * 0.1;
    }
    if (good && inPlay && intent.ap && !this.options.plainApTargets && this.known(o.card)) {
      return 1 + this.apChangeValue(o.card, intent.ap) + value * 0.1;
    }
    let score = good ? 1 + value : -100 - value;
    if (good && intent.kind === "harm" && intent.damage > 0 && inPlay && this.known(o.card)) {
      if (intent.damage >= this.hpLeft(o.card)) score += 20; // destroys it
    }
    return score;
  }

  /**
   * How much an AP change on a Unit changes the fights of this turn and the next. It starts from the
   * current AP, which already includes earlier changes, so several AP-2 go to the same Unit while that
   * still matters and to another one once it doesn't ("stacking").
   * - AP- on an enemy Unit: friendly Units it would no longer destroy in a fight (protection), and a
   *   friendly attacker that survives fighting it.
   * - AP+ on a friendly Unit: enemy Units it can now destroy (rested ones it can attack, blockers), and
   *   more damage to an enemy Base.
   */
  apChangeValue(unit: CardId, delta: number): number {
    const before = this.ap(unit);
    const after = Math.max(0, before + delta);
    if (after === before) return 0; // AP is already 0: nothing left to reduce
    const friendly = this.s.cards[unit]!.owner === this.me;
    const others = this.s.players[friendly ? this.enemy : this.me].battle.filter((u) => this.known(u));
    let v = 0;
    for (const x of others) {
      const hp = this.hpLeft(x);
      const killsBefore = before >= hp;
      const killsAfter = after >= hp;
      if (killsBefore !== killsAfter) v += 2 + this.unitValue(x);
    }
    if (friendly && this.s.players[this.enemy].base.length) v += (after - before) * 0.5;
    return v + Math.abs(after - before) * 0.2;
  }

  /** What the running effect does to the cards it is choosing (from its compiled program). */
  /**
   * For a choice of a Unit for a battle started by an effect: how good each candidate is for the chooser.
   * The own fighter of The Final Victor is the one whose worst answer is best; the opponent answers with a
   * Unit that destroys it and survives, else the cheapest that destroys it, else one that survives, else
   * the cheapest.
   */
  fightChoice(): ((id: CardId) => number) | undefined {
    const frame = this.s.frames[this.s.frames.length - 1];
    if (!frame) return undefined;
    const script = this.engine.lib.get(frame.ref.no).script;
    const program = (frame.ref.granted ? script.compiledGranted : script.compiled)[frame.ref.idx]?.program;
    const instr = program?.[frame.pc];
    if (!program || !instr || instr.op !== "choose" || !instr.as) return undefined;
    const sides = this.fightSides(program);
    if (!sides) return undefined;
    const theirs = this.s.players[this.enemy].battle.filter((u) => this.known(u));
    if (instr.as !== sides.a && instr.as !== sides.b) {
      // A cost before the battle (Nu Gundam GD05-017: exile 3 cards from the trash): pay it when the battle
      // pays, cheapest cards first; otherwise stop ("done").
      if (instr.filter.side !== "friendly" || instr.filter.zone !== "trash") return undefined;
      const worth = this.fightCommandValue(program, undefined, frame.source) >= FIGHT_WORTH;
      return (id) => (worth ? 100 - this.keepValue(id) : -2000);
    }
    if (instr.as === sides.a) {
      return (a) => {
        if (!this.known(a)) return 0;
        const gains = theirs.map((b) => this.fightGain(a, b));
        if (!gains.length) return this.unitValue(a);
        return sides.bByOpponent ? Math.min(...gains) : Math.max(...gains);
      };
    }
    if (instr.as === sides.b) {
      const a = sides.a === "self" ? frame.source : frame.vars[sides.a]?.[0];
      if (a === undefined || !this.known(a)) return undefined;
      if (this.s.cards[a]!.owner === this.me) return (b) => (this.known(b) ? this.fightGain(a, b) : 0);
      // The opponent's battle: `a` attacks one of my Units.
      return (b) => {
        if (!this.known(b)) return 0;
        const r = this.fightResult(a, b);
        return (r.aDies ? 100 : 0) + (r.bDies ? -this.unitValue(b) : 50);
      };
    }
    return undefined;
  }

  intent(): { kind: Intent; damage: number; ap?: number; rest?: boolean } {
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

function classify(instr: Instr): { kind: Intent; damage: number; ap?: number; rest?: boolean } {
  if (instr.op === "damage") return { kind: "harm", damage: instr.amount };
  if (instr.op === "rest") return { kind: "harm", damage: 0, rest: true };
  if (HARMFUL.has(instr.op)) return { kind: "harm", damage: 0 };
  if (BENEFICIAL.has(instr.op)) return { kind: "help", damage: 0 };
  if (instr.op === "mod") {
    const kind = (instr.ap ?? 0) + (instr.hp ?? 0) < 0 ? "harm" : "help";
    return { kind, damage: 0, ...(instr.ap ? { ap: instr.ap } : {}) };
  }
  if (instr.op === "flag") return { kind: HARMFUL_FLAGS.has(instr.flag) ? "harm" : "help", damage: 0 };
  return { kind: "neutral", damage: 0 };
}
