// The rules engine. A game is a GameState that advances on its own until a player has to decide
// something; the state then holds a pending Decision with all legal Actions, and `apply` continues.
//
// Turn flow lives here; card effects run through interpret.ts, shared rules in core.ts.

import type { CardLib, EngineCard, Keywords } from "./cardlib";
import {
  EX_BASE,
  EX_RESOURCE,
  LIMITS,
  apOf,
  breakShields,
  canPlay,
  candidates,
  costOf,
  destroy,
  mark,
  activeResources,
  levelOf,
  playerFlagFilters,
  playerHasFlag,
  raiseForPlayer,
  pairPilot,
  createCard,
  damageShieldArea,
  dealDamage,
  def,
  deployBase,
  draw,
  effectsOf,
  endGame,
  enterBattle,
  evalCond,
  flagFilters,
  flushTriggers,
  hasFlag,
  hpOf,
  inst,
  isLinked,
  keywordsOf,
  matches,
  moveTo,
  newCtx,
  onceKey,
  other,
  pay,
  raise,
  rest,
  rulesManagement,
  shieldAreaProtected,
  toTrash,
  type Ctx,
} from "./core";
import { answer, canStart, chooseOrder, effectDraw, startEffect, stepFrame } from "./interpret";
import type { Program } from "../effects/compile";
import { seedRng, shuffle } from "./rng";
import type { Effect } from "../effects/dsl";
import type {
  Action,
  CardId,
  Decision,
  DeckList,
  GameEvent,
  GameOptions,
  GameState,
  PlayerId,
  PlayerState,
  Step,
} from "./types";

export { LIMITS, EX_BASE, EX_RESOURCE, other };

const DEFAULT_MAX_TURNS = 100;

export function actionKey(action: Action): string {
  return JSON.stringify(action);
}

export class Engine {
  constructor(readonly lib: CardLib) {}

  /** Prepares a game (6-2) and runs it to the first decision (Player One's mulligan). */
  newGame(decks: [DeckList, DeckList], options: GameOptions): { state: GameState; events: GameEvent[] } {
    const first = options.firstPlayer ?? 0;
    const s: GameState = {
      version: 1,
      seed: options.seed >>> 0,
      rng: seedRng(options.seed),
      maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
      firstPlayer: first,
      turn: 0,
      active: first,
      step: "mulligan",
      players: [emptyPlayer(0), emptyPlayer(1)],
      cards: [],
      modifiers: [],
      battle: null,
      priority: first,
      passes: 0,
      oncePerTurn: {},
      marks: {},
      frames: [],
      queue: [],
      pending: null,
      result: null,
    };
    const c = newCtx(this.lib, s);
    for (const p of [0, 1] as const) {
      const deck = decks[p];
      for (const no of deck.main) s.players[p].deck.push(createCard(c, no, p, "deck").id);
      for (const no of deck.resources)
        s.players[p].resourceDeck.push(createCard(c, no, p, "resourceDeck").id);
      shuffle(s.rng, s.players[p].deck);
    }
    c.ev.push({ t: "gameStart", firstPlayer: first });
    for (const p of [first, other(first)]) draw(c, p, LIMITS.startHand);
    run(c);
    return { state: s, events: c.ev };
  }

  /**
   * Is the action an option with another copy of the same card from the hand? The options list one copy per
   * card number (2-1-1, `uniqueByNo`); the board lets the human pick any copy (user's wish, 21 Nov 2026),
   * so that very copy is played.
   */
  isCopyOfOption(state: GameState, action: Action): boolean {
    const decision = state.pending;
    if (!decision || !("card" in action) || typeof action.card !== "number") return false;
    const mine = state.cards[action.card];
    if (!mine || mine.zone !== "hand" || mine.owner !== decision.player) return false;
    const key = actionKey(action);
    return decision.options.some((o) => {
      if (o.type !== action.type || !("card" in o) || o.card === action.card) return false;
      const other = state.cards[o.card];
      return (
        !!other &&
        other.zone === "hand" &&
        other.no === mine.no &&
        actionKey({ ...o, card: action.card } as Action) === key
      );
    });
  }

  /** Applies a legal action for the pending decision and runs to the next decision or the end. */
  apply(state: GameState, action: Action): GameEvent[] {
    const decision = state.pending;
    if (!decision) throw new Error("no decision pending");
    const key = actionKey(action);
    if (!decision.options.some((o) => actionKey(o) === key) && !this.isCopyOfOption(state, action)) {
      throw new Error(`illegal action ${key} for ${decision.kind} of player ${decision.player}`);
    }
    const c = newCtx(this.lib, state);
    state.pending = null;
    if (decision.kind === "effect" && decision.prompt === "order") {
      // The chosen effect goes first (10-1-6-5, FAQ Q107).
      if (action.type !== "option") throw new Error("order needs an option");
      const [t] = state.queue.splice(action.index, 1);
      t!.ordered = true;
      state.queue.unshift(t!);
    } else if (decision.kind === "effect") answer(c, action);
    else perform(c, decision, action);
    run(c);
    return c.ev;
  }

  /** Runs a state without a pending decision (e.g. built by hand in a test) to its next decision. */
  advance(state: GameState): GameEvent[] {
    const c = newCtx(this.lib, state);
    run(c);
    return c.ev;
  }

  // Queries for UI, AI and statistics.
  /** Rules data of a card where it is (a Pilot deployed as a Unit counts as that Unit). */
  card(state: GameState, id: CardId): EngineCard {
    return def(newCtx(this.lib, state), id);
  }
  ap(state: GameState, id: CardId): number {
    return apOf(newCtx(this.lib, state), id);
  }
  hp(state: GameState, id: CardId): number {
    return hpOf(newCtx(this.lib, state), id);
  }
  keywords(state: GameState, id: CardId): Keywords {
    return keywordsOf(newCtx(this.lib, state), id);
  }
  isLinked(state: GameState, id: CardId): boolean {
    return isLinked(newCtx(this.lib, state), id);
  }
  level(state: GameState, p: PlayerId): number {
    return state.players[p].resources.length;
  }
  /** Resources a main/action option rests to pay its cost (0 for options without a Resource cost). */
  resourceCost(state: GameState, p: PlayerId, action: Action): number {
    const c = newCtx(this.lib, state);
    switch (action.type) {
      case "deployUnit": {
        const alt = action.alt || action.sacrifice !== undefined ? altCostOf(c, action.card) : null;
        return alt ? alt.cost : costOf(c, p, action.card);
      }
      case "pair":
        return pairCostOf(c, p, action.card, action.unit);
      case "deployBase":
        return costOf(c, p, action.card);
      case "playCommand": {
        const alt = action.discard !== undefined || action.alt ? altCostOf(c, action.card) : null;
        return alt ? alt.cost : costOf(c, p, action.card);
      }
      case "activate": {
        const e = effectsOf(c, action.card)[action.effect]?.compiled.effect;
        return e?.kind === "activated" ? (e.cost.resources ?? 0) : 0;
      }
      default:
        return 0;
    }
  }
  /** The compiled program of an activated effect option (`activate` action), for the AI. */
  activatedProgram(state: GameState, action: Action): Program | undefined {
    if (action.type !== "activate") return undefined;
    return effectsOf(newCtx(this.lib, state), action.card)[action.effect]?.compiled.program;
  }
  /** Would this option use up an EX Resource (normal Resources are paid first, 5-17-3-2-3)? */
  spendsEx(state: GameState, p: PlayerId, action: Action): boolean {
    const cost = this.resourceCost(state, p, action);
    if (cost <= 0) return false;
    const active = state.players[p].resources.filter((id) => !state.cards[id]!.rested);
    return active.filter((id) => !state.cards[id]!.token).length < cost;
  }
}

function emptyPlayer(id: PlayerId): PlayerState {
  return {
    id,
    deck: [],
    resourceDeck: [],
    resources: [],
    battle: [],
    shields: [],
    base: [],
    hand: [],
    trash: [],
    removal: [],
    mulliganDone: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Main loop: running effects first, then waiting triggers, then the next step (7-1-3, 7-2-2).

function run(c: Ctx): void {
  let guard = 0;
  while (!c.s.result && !c.s.pending) {
    if (++guard > 100_000) throw new Error(`engine loop in step ${c.s.step}`);
    flushTriggers(c);
    if (c.s.frames.length) stepFrame(c);
    else if (c.s.queue.length) {
      if (!chooseOrder(c)) startEffect(c, c.s.queue.shift()!);
    } else STEPS[c.s.step](c);
    rulesManagement(c);
  }
  flushTriggers(c);
}

function setStep(c: Ctx, step: Step): void {
  c.s.step = step;
  c.ev.push({ t: "step", step });
}

/** Starts an action step: the standby player acts first (9-2). */
function enterActionStep(c: Ctx, step: "battleAction" | "endAction"): void {
  c.s.priority = other(c.s.active);
  c.s.passes = 0;
  setStep(c, step);
}

/** Runs an action step until both players pass in a row (9-4, 9-5); players without options pass automatically. */
function runActionStep(c: Ctx, done: Step): void {
  for (;;) {
    const options = actionStepOptions(c, c.s.priority);
    if (options.length > 1) {
      c.s.pending = { player: c.s.priority, kind: "action", options };
      return;
    }
    if (passAction(c)) {
      setStep(c, done);
      return;
    }
  }
}

/** Returns true when the action step ends. */
function passAction(c: Ctx): boolean {
  c.s.passes++;
  c.s.priority = other(c.s.priority);
  return c.s.passes >= 2;
}

function battleValid(c: Ctx): boolean {
  const b = c.s.battle;
  if (!b) return false;
  if (inst(c, b.attacker).zone !== "battle") return false;
  return b.target === "player" || inst(c, b.target).zone === "battle";
}

function blockers(c: Ctx): CardId[] {
  const b = c.s.battle!;
  if (keywordsOf(c, b.attacker).highManeuver) return []; // 13-1-6
  const defender = other(b.attackerOwner);
  const banned = [...playerFlagFilters(c, 0, "cantBlock"), ...playerFlagFilters(c, 1, "cantBlock")];
  return c.s.players[defender].battle.filter(
    (id) =>
      id !== b.target &&
      !inst(c, id).rested &&
      keywordsOf(c, id).blocker && // 8-3-3, 13-1-4
      !hasFlag(c, id, "cantBlock") &&
      !banned.some((f) => matches(c, id, f, defender, null)),
  );
}

/** Raises "at the start/end of your turn" effects of the active player's cards. */
function raiseTurnTriggers(c: Ctx, kind: "turnStart" | "turnEnd"): void {
  const player = c.s.players[c.s.active];
  for (const id of [...player.battle, ...player.base]) raise(c, kind, id);
}

const STEPS: Record<Step, (c: Ctx) => void> = {
  mulligan(c) {
    const s = c.s;
    const order = [s.firstPlayer, other(s.firstPlayer)];
    const next = order.find((p) => !s.players[p].mulliganDone);
    if (next !== undefined) {
      s.pending = { player: next, kind: "mulligan", options: [{ type: "keepHand" }, { type: "redraw" }] };
      return;
    }
    for (const p of order) {
      const player = s.players[p];
      // 6-2-2: each new Shield overlaps the previous one, so the last one placed is the top Shield.
      for (let i = 0; i < LIMITS.shields && player.deck.length; i++) moveTo(c, player.deck[0]!, "shields");
      player.base.push(createCard(c, EX_BASE, p, "base").id);
    }
    const second = other(s.firstPlayer);
    s.players[second].resources.push(createCard(c, EX_RESOURCE, second, "resources").id);
    s.turn = 1;
    s.active = s.firstPlayer;
    setStep(c, "startTurn");
  },

  startTurn(c) {
    const s = c.s;
    c.ev.push({ t: "turnStart", turn: s.turn, player: s.active });
    const player = s.players[s.active];
    // Decided before anything is set active: "rested Units with the lowest Lv." (ST14-001) would change.
    const all = [...player.battle, ...player.resources, ...player.base];
    const stay = new Set(all.filter((id) => hasFlag(c, id, "stayRested") || hasFlag(c, id, "cantReady")));
    for (const id of all) if (!stay.has(id)) inst(c, id).rested = false; // 7-2-3
    // "Won't be set as active during the start phase of … next turn" ends now.
    s.modifiers = s.modifiers.filter(
      (m) => !(m.until === "nextStart" && m.target >= 0 && inst(c, m.target).owner === s.active),
    );
    c.ev.push({ t: "setActive", player: s.active });
    raiseTurnTriggers(c, "turnStart"); // 7-2-4
    const standby = c.s.players[other(s.active)];
    for (const id of [...standby.battle, ...standby.base]) raise(c, "opponentTurnStart", id);
    setStep(c, "draw");
  },

  draw(c) {
    draw(c, c.s.active, 1); // 7-3; losing on an empty deck is rules management (7-3-1-1, 11-2-1-2)
    setStep(c, "resource");
  },

  resource(c) {
    const player = c.s.players[c.s.active];
    if (player.resourceDeck.length && player.resources.length < LIMITS.resources) {
      const id = player.resourceDeck[0]!;
      moveTo(c, id, "resources", "bottom");
      c.ev.push({ t: "resource", player: c.s.active, card: id });
    }
    setStep(c, "main");
  },

  main(c) {
    c.s.pending = { player: c.s.active, kind: "main", options: mainOptions(c) };
  },

  attack(c) {
    // 【Attack】 effects resolve before the block step (8-2-2); they are queued here.
    if (battleValid(c)) {
      const b = c.s.battle!;
      raise(c, "attack", b.attacker);
      if (b.target !== "player") raise(c, "attacked", b.target, b.attacker);
      for (const p of [0, 1] as const) raiseForPlayer(c, "unitAttacks", p, b.attacker);
    }
    setStep(c, "block");
  },

  block(c) {
    if (!battleValid(c)) {
      setStep(c, "battleEnd"); // 8-2-4
      return;
    }
    const options = blockers(c);
    if (!options.length) {
      enterActionStep(c, "battleAction");
      return;
    }
    c.s.pending = {
      player: other(c.s.battle!.attackerOwner),
      kind: "block",
      options: [{ type: "noBlock" }, ...options.map((unit): Action => ({ type: "block", unit }))],
    };
  },

  battleAction(c) {
    if (!battleValid(c)) {
      setStep(c, "battleEnd"); // 8-3-5
      return;
    }
    runActionStep(c, "damage");
  },

  damage(c) {
    if (!battleValid(c)) {
      setStep(c, "battleEnd"); // 8-4-2
      return;
    }
    resolveBattleDamage(c);
    setStep(c, "battleEnd");
  },

  battleEnd(c) {
    c.s.modifiers = c.s.modifiers.filter((m) => m.until !== "battle"); // 8-6-1
    c.s.battle = null;
    setStep(c, "main");
  },

  endAction(c) {
    runActionStep(c, "endStep");
  },

  endStep(c) {
    // <Repair> (13-1-1) and other "at the end of the turn" effects (7-6-4).
    for (const id of c.s.players[c.s.active].battle) {
      const repair = keywordsOf(c, id).repair;
      const card = inst(c, id);
      if (repair > 0 && card.damage > 0) {
        const amount = Math.min(repair, card.damage); // 5-6-2
        card.damage -= amount;
        c.ev.push({ t: "recover", card: id, amount });
        raise(c, "recovered", id);
      }
    }
    raiseTurnTriggers(c, "turnEnd");
    for (const p of [0, 1] as const) {
      for (const id of [...c.s.players[p].battle, ...c.s.players[p].base]) raise(c, "anyTurnEnd", id);
    }
    setStep(c, "handStep");
  },

  handStep(c) {
    const player = c.s.players[c.s.active];
    if (player.hand.length > LIMITS.hand) {
      c.s.pending = {
        player: c.s.active,
        kind: "discard",
        options: uniqueByNo(c, player.hand).map((card): Action => ({ type: "discard", card })),
      };
      return;
    }
    setStep(c, "cleanup");
  },

  cleanup(c) {
    c.s.modifiers = c.s.modifiers.filter((m) => m.until !== "turn"); // 7-6-6
    if (c.s.turn >= c.s.maxTurns) {
      c.s.result = { winner: null, reason: "turnLimit", turn: c.s.turn };
      c.s.step = "over";
      c.ev.push({ t: "gameOver", result: c.s.result });
      return;
    }
    c.s.turn++;
    c.s.active = other(c.s.active);
    setStep(c, "startTurn");
  },

  over() {
    throw new Error("game is over");
  },
};

/** One representative per card number: copies of a card are interchangeable (2-1-1). */
function uniqueByNo(c: Ctx, ids: CardId[]): CardId[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const no = inst(c, id).no;
    if (seen.has(no)) return false;
    seen.add(no);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Options

type CommandEffect = Extract<Effect, { kind: "command" }>;

/** Index of the Command effect usable at this timing, or -1. */
function commandIndex(card: EngineCard, timing: "main" | "action"): number {
  return card.script.compiled.findIndex(
    (e) => e.effect.kind === "command" && (e.effect as CommandEffect).timing.includes(timing),
  );
}

/** 10-1-8-1-1: a Command (or activated effect) that must choose a target can't be used without one. */
function firstTargetAvailable(c: Ctx, program: Program, p: PlayerId, source: CardId): boolean {
  return canStart(c, program, 0, p, source);
}

function commandOptions(c: Ctx, p: PlayerId, timing: "main" | "action"): Action[] {
  const options: Action[] = [];
  for (const id of uniqueByNo(c, c.s.players[p].hand)) {
    const card = def(c, id);
    if (card.type !== "COMMAND") continue;
    const idx = commandIndex(card, timing);
    if (idx < 0) continue;
    if (!firstTargetAvailable(c, card.script.compiled[idx]!.program, p, id)) continue;
    if (canPlay(c, p, id)) options.push({ type: "playCommand", card: id });
    for (const alt of altCostChoices(c, p, id)) {
      if (alt === "plain") {
        if (!canPlay(c, p, id)) options.push({ type: "playCommand", card: id, alt: true });
      } else options.push({ type: "playCommand", card: id, discard: alt });
    }
  }
  return options;
}

type AltCostEffect = Extract<Effect, { kind: "altCost" }>;

function altCostOf(c: Ctx, id: CardId): AltCostEffect | null {
  const alt = def(c, id).script.effects.find((e) => e.kind === "altCost");
  return alt?.kind === "altCost" ? alt : null;
}

/**
 * "Play this card as if it has 2 Lv. and cost": the cards to discard (ST10-014) or destroy (GD01-002) for
 * it, or "plain" when it only needs a condition (EB01-039).
 */
function altCostChoices(c: Ctx, p: PlayerId, id: CardId): (CardId | "plain")[] {
  const alt = altCostOf(c, id);
  if (!alt) return [];
  const me = c.s.players[p];
  if (me.resources.length < alt.level || me.resources.filter((r) => !inst(c, r).rested).length < alt.cost)
    return [];
  if (alt.when && !evalCond(c, alt.when, id, p)) return [];
  if (alt.discard) {
    const discard = alt.discard;
    return uniqueByNo(
      c,
      me.hand.filter((h) => h !== id && matches(c, h, discard, p, id, true)),
    );
  }
  if (alt.destroy) return candidates(c, { ...alt.destroy, side: "friendly" }, p, id);
  return ["plain"];
}

/** Cost to pair a Pilot (or Command with 【Pilot】) with a Unit, after "when pairing it with …" reductions. */
function pairCostOf(c: Ctx, p: PlayerId, card: CardId, unit: CardId): number {
  let cost = costOf(c, p, card);
  for (const e of def(c, card).script.effects) {
    if (e.kind !== "pairCost" || !matches(c, unit, e.unit, p, card)) continue;
    if (e.set !== undefined) cost = Math.min(cost, e.set);
    if (e.minus) cost = Math.max(0, cost - e.minus);
  }
  return cost;
}

function activateOptions(c: Ctx, p: PlayerId, timing: "main" | "action"): Action[] {
  const options: Action[] = [];
  const me = c.s.players[p];
  for (const id of [...me.battle, ...me.base]) {
    effectsOf(c, id).forEach(({ ref, compiled }, effect) => {
      const e = compiled.effect;
      if (e.kind !== "activated" || e.timing !== timing) return;
      if (e.once && c.s.oncePerTurn[onceKey(id, ref)] === c.s.turn) return;
      if (e.cost.restSelf && inst(c, id).rested) return;
      if (
        (e.cost.resources ?? 0) > 0 &&
        me.resources.filter((r) => !inst(c, r).rested).length < e.cost.resources!
      )
        return;
      if (e.cond && !evalCond(c, e.cond, id, p)) return;
      if (!firstTargetAvailable(c, compiled.program, p, id)) return;
      options.push({ type: "activate", card: id, effect });
    });
  }
  return options;
}

function actionStepOptions(c: Ctx, p: PlayerId): Action[] {
  return [{ type: "pass" }, ...commandOptions(c, p, "action"), ...activateOptions(c, p, "action")];
}

/** 3-2-4, 3-2-6-3: a Unit can attack unless it entered the battle area this turn and is not linked. */
function canAttack(c: Ctx, id: CardId): boolean {
  const card = inst(c, id);
  if (card.rested || hasFlag(c, id, "cantAttack")) return false;
  return (
    card.enteredTurn < c.s.turn ||
    isLinked(c, id) ||
    hasFlag(c, id, "attackOnDeploy") ||
    hasFlag(c, id, "attackUnitOnDeploy")
  );
}

/** Attacking only thanks to "on the turn this Unit is deployed, it may … attack a rested enemy Unit". */
function onlyUnitsOnDeploy(c: Ctx, id: CardId): boolean {
  return inst(c, id).enteredTurn >= c.s.turn && !isLinked(c, id) && !hasFlag(c, id, "attackOnDeploy");
}

function attackTargets(c: Ctx, unit: CardId, p: PlayerId): Action[] {
  // A Unit that may attack only thanks to "on the turn it is deployed, it may attack a rested enemy Unit"
  // can't use "may choose an active enemy Unit" (FAQ Q355).
  const deployOnly = onlyUnitsOnDeploy(c, unit);
  const active = deployOnly ? [] : (flagFilters(c, unit, "attackActive") ?? []);
  const attackable = c.s.players[other(p)].battle.filter(
    (target) =>
      !hasFlag(c, target, "cantBeAttacked") &&
      // 8-2-1: rested enemy Units; some effects allow active ones (e.g. ST02-001).
      (inst(c, target).rested || active.some((f) => matches(c, target, f, p, unit))),
  );
  // "Enemy Units (other than Link Units) choose this rested Unit as their attack target if possible"
  // (taunt, tauntAll). One chosen by an effect ("during this turn …", GD04-107) comes first (FAQ Q289).
  const taunts = (id: CardId) =>
    hasFlag(c, id, "tauntAll") || (!isLinked(c, unit) && hasFlag(c, id, "taunt"));
  const taunting = attackable.filter(taunts);
  if (taunting.length) {
    const byEffect = taunting.filter((id) =>
      c.s.modifiers.some((m) => m.target === id && m.flag === "tauntAll"),
    );
    return (byEffect.length ? byEffect : taunting).map((target): Action => ({
      type: "attack",
      unit,
      target,
    }));
  }
  const options: Action[] = [];
  if (!hasFlag(c, unit, "cantAttackPlayer") && !deployOnly) {
    options.push({ type: "attack", unit, target: "player" });
  }
  for (const target of attackable) options.push({ type: "attack", unit, target });
  return options;
}

function mainOptions(c: Ctx): Action[] {
  const p = c.s.active;
  const me = c.s.players[p];
  const options: Action[] = [];

  for (const id of uniqueByNo(c, me.hand)) {
    const card = def(c, id);
    if (!canPlay(c, p, id)) continue;
    if (card.type === "UNIT") {
      if (me.battle.length < LIMITS.battle) options.push({ type: "deployUnit", card: id });
      else for (const replace of me.battle) options.push({ type: "deployUnit", card: id, replace }); // 11-4-2
    } else if (card.type === "BASE") {
      options.push({ type: "deployBase", card: id });
    }
  }
  // Pairing: checked per Unit, because some cards cost less with certain Units (GD03-085).
  for (const id of uniqueByNo(c, me.hand)) {
    const card = def(c, id);
    if (!card.pairable || me.resources.length < levelOf(c, p, id)) continue;
    for (const unit of me.battle) {
      if (inst(c, unit).pilot !== null || hasFlag(c, unit, "cantBePaired")) continue;
      if (activeResources(c, p).length < pairCostOf(c, p, id, unit)) continue;
      options.push({ type: "pair", card: id, unit });
    }
  }
  // Units for their alternative cost (GD01-002, EB01-039).
  if (me.battle.length < LIMITS.battle) {
    for (const id of uniqueByNo(c, me.hand)) {
      if (def(c, id).type !== "UNIT") continue;
      for (const alt of altCostChoices(c, p, id)) {
        if (alt === "plain") {
          if (!canPlay(c, p, id)) options.push({ type: "deployUnit", card: id, alt: true });
        } else options.push({ type: "deployUnit", card: id, sacrifice: alt });
      }
    }
  }
  options.push(...commandOptions(c, p, "main"), ...activateOptions(c, p, "main"));

  for (const unit of me.battle) if (canAttack(c, unit)) options.push(...attackTargets(c, unit, p));

  for (const unit of me.battle) {
    if (inst(c, unit).rested || keywordsOf(c, unit).support <= 0) continue;
    for (const target of me.battle) if (target !== unit) options.push({ type: "support", unit, target });
  }

  options.push({ type: "endMain" });
  return options;
}

// ---------------------------------------------------------------------------------------------
// Actions

function perform(c: Ctx, decision: Decision, action: Action): void {
  const s = c.s;
  const p = decision.player;
  if (decision.kind === "action" && action.type !== "pass") {
    // 9-4-1: after an action the other player may act; passes start counting again.
    s.passes = 0;
    s.priority = other(p);
  }
  switch (action.type) {
    case "keepHand":
    case "redraw": {
      const player = s.players[p];
      if (action.type === "redraw") {
        // 6-2-1-6-1: hand to the bottom of the deck, draw five, then shuffle.
        for (const id of [...player.hand]) moveTo(c, id, "deck", "bottom");
        draw(c, p, LIMITS.startHand);
        shuffle(s.rng, player.deck);
      }
      player.mulliganDone = true;
      c.ev.push({ t: "mulligan", player: p, redraw: action.type === "redraw" });
      return;
    }
    case "deployUnit": {
      const alt = action.alt || action.sacrifice !== undefined ? altCostOf(c, action.card) : null;
      const ex = pay(c, p, alt ? alt.cost : costOf(c, p, action.card));
      if (action.sacrifice !== undefined) destroy(c, action.sacrifice, action.card);
      if (action.replace !== undefined) toTrash(c, action.replace, "overflow"); // not destroyed (11-4-2-1)
      enterBattle(c, action.card);
      if (ex) inst(c, action.card).paidEx = true;
      return;
    }
    case "pair": {
      const ex = pay(c, p, pairCostOf(c, p, action.card, action.unit));
      pairPilot(c, action.card, action.unit);
      if (ex) inst(c, action.card).paidEx = true;
      return;
    }
    case "deployBase": {
      const ex = pay(c, p, costOf(c, p, action.card));
      deployBase(c, action.card);
      if (ex) inst(c, action.card).paidEx = true;
      return;
    }
    case "playCommand": {
      const card = def(c, action.card);
      let ex: boolean;
      if (action.discard !== undefined || action.alt) {
        const alt = altCostOf(c, action.card);
        ex = pay(c, p, alt ? alt.cost : costOf(c, p, action.card));
        if (action.discard !== undefined) {
          moveTo(c, action.discard, "trash");
          c.ev.push({ t: "toTrash", card: action.discard, reason: "discard" });
        }
      } else ex = pay(c, p, costOf(c, p, action.card));
      moveTo(c, action.card, "limbo"); // 3-4-3
      if (ex) inst(c, action.card).paidEx = true;
      c.ev.push({ t: "play", player: p, card: action.card });
      mark(c, "cmd", p, card.no);
      raiseForPlayer(c, "commandUsed", p, action.card);
      const timing = decision.kind === "main" ? "main" : "action";
      startEffect(c, {
        ref: { no: card.no, idx: commandIndex(card, timing), granted: false },
        source: action.card,
        controller: p,
        event: null,
        origin: "command",
      });
      return;
    }
    case "activate": {
      const { ref, compiled } = effectsOf(c, action.card)[action.effect]!;
      const e = compiled.effect;
      if (e.kind !== "activated") throw new Error("not an activated effect");
      if (e.cost.resources) {
        pay(c, p, e.cost.resources);
        const key = `paidFx:${p}:${s.turn}`;
        if (def(c, action.card).type !== "BASE") {
          s.marks[key] = (s.marks[key] ?? 0) + e.cost.resources;
          s.marks[`lastPaid:${p}`] = e.cost.resources;
          mark(c, "paidFxNo", p, def(c, action.card).no);
          raiseForPlayer(c, "effectPaid", p, action.card);
        }
      }
      if (e.cost.restSelf) rest(c, action.card);
      startEffect(c, { ref, source: action.card, controller: p, event: null, origin: "activated" });
      if (e.cost.destroySelf) toTrash(c, action.card, "destroyed");
      if (e.cost.selfToDeckBottom) {
        const pilot = inst(c, action.card).pilot;
        moveTo(c, action.card, "deck", "bottom");
        c.ev.push({ t: "toDeck", card: action.card, pos: "bottom" });
        if (pilot !== null) {
          moveTo(c, pilot, "deck", "bottom");
          c.ev.push({ t: "toDeck", card: pilot, pos: "bottom" });
        }
      }
      return;
    }
    case "attack": {
      rest(c, action.unit); // 8-2-1
      s.marks[`attacked:${p}`] = s.turn;
      s.battle = { attacker: action.unit, attackerOwner: p, target: action.target, blocked: false };
      c.ev.push({ t: "attack", attacker: action.unit, target: action.target });
      setStep(c, "attack");
      return;
    }
    case "support": {
      rest(c, action.unit); // 13-1-3-1
      const amount = keywordsOf(c, action.unit).support;
      s.modifiers.push({ target: action.target, ap: amount, hp: 0, until: "turn", source: action.unit });
      c.ev.push({ t: "modifier", card: action.target, ap: amount, hp: 0 });
      raise(c, "supports", action.unit, action.target);
      return;
    }
    case "endMain":
      enterActionStep(c, "endAction"); // 7-5-5-2
      return;
    case "block": {
      rest(c, action.unit);
      s.battle!.target = action.unit;
      s.battle!.blocked = true;
      raise(c, "blocks", action.unit);
      c.ev.push({ t: "block", blocker: action.unit });
      enterActionStep(c, "battleAction");
      return;
    }
    case "noBlock":
      enterActionStep(c, "battleAction");
      return;
    case "pass":
      if (passAction(c)) setStep(c, s.step === "battleAction" ? "damage" : "endStep");
      return;
    case "discard":
      moveTo(c, action.card, "trash");
      c.ev.push({ t: "toTrash", card: action.card, reason: "discard" });
      return;
    default:
      throw new Error(`action ${action.type} is not valid here`);
  }
}

/** "While this Unit is rested, friendly Shields can't receive battle damage from enemy Units" (GD03-070). */
function shieldsProtected(c: Ctx, p: PlayerId, attacker: CardId): boolean {
  for (const id of [...c.s.players[p].battle, ...c.s.players[p].base]) {
    if (hasFlag(c, id, "protectShields")) return true;
    const filters = flagFilters(c, id, "protectShieldsFrom");
    if (filters?.some((f) => matches(c, attacker, f, p, id))) return true;
  }
  return false;
}

/** Battle damage a Unit receives from an attacker, after "can't receive battle damage" effects. */
function battleDamageTo(c: Ctx, target: CardId, from: CardId, amount: number): number {
  const owner = inst(c, target).owner;
  const filters = flagFilters(c, target, "noBattleDamageFrom");
  if (filters && filters.some((f) => matches(c, from, f, owner, target))) return 0;
  // "【Once per Turn】When this Unit would receive battle damage from …, it doesn't receive that damage."
  const once = flagFilters(c, target, "noBattleDamageFromOnce");
  const key = `${target}:noBattleDamageOnce`;
  if (
    amount > 0 &&
    once &&
    c.s.oncePerTurn[key] !== c.s.turn &&
    once.some((f) => matches(c, from, f, owner, target))
  ) {
    c.s.oncePerTurn[key] = c.s.turn;
    return 0;
  }
  return amount;
}

function resolveBattleDamage(c: Ctx): void {
  const b = c.s.battle!;
  const attacker = b.attacker;
  const defender = other(b.attackerOwner);
  const atkAp = apOf(c, attacker);
  const kw = keywordsOf(c, attacker);

  if (b.target === "player") {
    const enemy = c.s.players[defender];
    if (shieldAreaProtected(c, defender, attacker)) return; // e.g. ST02-013
    if (enemy.base.length) {
      const base = enemy.base[0]!;
      dealDamage(c, base, battleDamageTo(c, base, attacker, atkAp), "battle", attacker); // 8-5-2-4
      rulesManagement(c);
      if (inst(c, base).zone !== "base") destroyedByAttacker(c, attacker, base, "destroysShieldAreaCard");
    } else if (enemy.shields.length) {
      if (atkAp > 0 && !shieldsProtected(c, defender, attacker)) {
        const top = enemy.shields[0]!;
        breakShields(c, defender, kw.suppression ? 2 : 1); // 8-5-2-3, 13-1-7
        destroyedByAttacker(c, attacker, top, "destroysShieldAreaCard");
      }
    } else if (atkAp > 0) {
      c.ev.push({ t: "playerDamage", player: defender, amount: atkAp }); // 8-5-2-2, 11-2-1-1
      endGame(c, [defender], "damage");
    }
    return;
  }

  const target = b.target;
  const targetAp = apOf(c, target);
  if (kw.firstStrike) {
    // 13-1-5-2: the attacker deals damage first; a destroyed target deals none.
    battleHit(c, attacker, target, atkAp);
    rulesManagement(c);
    if (inst(c, target).zone === "battle") battleHit(c, target, attacker, targetAp);
  } else {
    battleHit(c, attacker, target, atkAp); // 8-5-3-2
    battleHit(c, target, attacker, targetAp);
  }
  const attackerInPlay = inst(c, attacker).zone === "battle";
  if (attackerInPlay) raiseIfDestroyed(c, attacker, target);
  rulesManagement(c);
  if (inst(c, target).zone === "battle") return;
  // <Breach> also when both Units are destroyed (13-1-2-3).
  if (kw.breach > 0 && !shieldAreaProtected(c, defender, attacker))
    damageShieldArea(c, defender, kw.breach, "effect", attacker);
}

/**
 * "When this Unit destroys an enemy Unit with battle damage": raised before rules management moves the
 * cards, while the attacker is still in play.
 */
function raiseIfDestroyed(c: Ctx, attacker: CardId, target: CardId): void {
  const t = inst(c, target);
  if (t.damage > 0 && t.damage >= hpOf(c, target)) destroyedByAttacker(c, attacker, target, "destroysUnit");
}

/** The attacker destroyed an enemy card with battle damage: its triggers and "draw 1" effects (GD05-002). */
/**
 * Battle damage from one Unit to another. "When this Unit deals battle damage to an enemy Unit that is
 * Lv.4 or lower that has no paired Pilot, destroy that enemy Unit" (GD05-050) is applied right away.
 */
function battleHit(c: Ctx, from: CardId, target: CardId, ap: number): void {
  // "Battle damage this Unit would receive is dealt to that Unit instead" (GD04-087, GD06-018).
  // Each redirection applies once, so two Units pointing at each other end where it started (FAQ Q494).
  let to = target;
  const used = new Set<object>();
  for (;;) {
    const redirect = c.s.modifiers.find(
      (m) => m.target === to && m.flag === "redirectBattleDamage" && !used.has(m),
    );
    if (redirect?.link === undefined || !["battle", "base"].includes(inst(c, redirect.link).zone)) break;
    used.add(redirect);
    to = redirect.link;
  }
  const before = inst(c, to).damage;
  dealDamage(c, to, battleDamageTo(c, to, from, ap), "battle", from);
  if (inst(c, to).damage <= before || inst(c, to).zone !== "battle") return;
  raiseForPlayer(c, "allyDealsBattleDamage", inst(c, from).owner, from);
  const filters = flagFilters(c, from, "destroyOnBattleDamage");
  const owner = inst(c, from).owner;
  if (
    filters &&
    filters.some((f) => matches(c, to, f, owner, from)) &&
    !playerHasFlag(c, inst(c, to).owner, "noEffectDestroy")
  ) {
    destroy(c, to);
  }
}

export function destroyedByAttacker(
  c: Ctx,
  attacker: CardId,
  victim: CardId,
  kind: "destroysUnit" | "destroysShieldAreaCard",
): void {
  raise(c, kind, attacker, victim);
  raise(c, "destroysCard", attacker, victim);
  raiseForPlayer(c, "allyDestroys", inst(c, attacker).owner, attacker, {
    victim: kind === "destroysUnit" ? "unit" : "shieldArea",
    damageKind: "battle",
  });
  if (kind === "destroysUnit" && inst(c, attacker).pilot !== null) {
    c.s.marks[`pairedKill:${inst(c, attacker).owner}`] = c.s.turn;
  }
  const draws = c.s.modifiers.filter((m) => m.target === attacker && m.flag === "drawOnBattleDestroy").length;
  if (draws) effectDraw(c, inst(c, attacker).owner, draws);
}
