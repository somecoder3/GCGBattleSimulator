// The rules engine. A game is a GameState that advances on its own until a player has to decide
// something; the state then holds a pending Decision with all legal Actions, and `apply` continues.
//
// M1 scope: the complete turn structure and battle rules, Units, Pilots (stats and links), Bases,
// unconditional keyword effects, rules management. Card effects (triggers, Commands, Bursts) follow
// in M2 and hook into the marked places.

import { CardLib, satisfiesLink, type EngineCard, type Keywords } from "./cardlib";
import { seedRng, shuffle } from "./rng";
import type {
  Action,
  CardId,
  CardInstance,
  Decision,
  DeckList,
  GameEndReason,
  GameEvent,
  GameOptions,
  GameState,
  PlayerId,
  PlayerState,
  Step,
  ZoneName,
} from "./types";

export const LIMITS = {
  battle: 6, // 4-5-4
  base: 1, // 4-6-3
  resources: 15, // 4-4-2
  hand: 10, // 4-8-4
  shields: 6, // 6-2-2
  startHand: 5, // 6-2-1-5
} as const;

export const EX_BASE = "EXB-001";
export const EX_RESOURCE = "EXR-001";
const DEFAULT_MAX_TURNS = 100;

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function actionKey(action: Action): string {
  return JSON.stringify(action);
}

interface Ctx {
  lib: CardLib;
  s: GameState;
  ev: GameEvent[];
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
      pending: null,
      result: null,
    };
    const c: Ctx = { lib: this.lib, s, ev: [] };
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

  /** Applies a legal action for the pending decision and runs to the next decision or the end. */
  apply(state: GameState, action: Action): GameEvent[] {
    const decision = state.pending;
    if (!decision) throw new Error("no decision pending");
    const key = actionKey(action);
    if (!decision.options.some((o) => actionKey(o) === key)) {
      throw new Error(`illegal action ${key} for ${decision.kind} of player ${decision.player}`);
    }
    const c: Ctx = { lib: this.lib, s: state, ev: [] };
    state.pending = null;
    perform(c, decision, action);
    run(c);
    return c.ev;
  }

  /** Runs a state without a pending decision (e.g. built by hand in a test) to its next decision. */
  advance(state: GameState): GameEvent[] {
    const c: Ctx = { lib: this.lib, s: state, ev: [] };
    run(c);
    return c.ev;
  }

  // Queries for UI, AI and statistics.
  card(state: GameState, id: CardId): EngineCard {
    return this.lib.get(state.cards[id]!.no);
  }
  ap(state: GameState, id: CardId): number {
    return apOf({ lib: this.lib, s: state, ev: [] }, id);
  }
  hp(state: GameState, id: CardId): number {
    return hpOf({ lib: this.lib, s: state, ev: [] }, id);
  }
  keywords(state: GameState, id: CardId): Keywords {
    return keywordsOf({ lib: this.lib, s: state, ev: [] }, id);
  }
  isLinked(state: GameState, id: CardId): boolean {
    return isLinked({ lib: this.lib, s: state, ev: [] }, id);
  }
  level(state: GameState, p: PlayerId): number {
    return state.players[p].resources.length;
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

function createCard(c: Ctx, no: string, owner: PlayerId, zone: ZoneName): CardInstance {
  const def = c.lib.get(no);
  const card: CardInstance = {
    id: c.s.cards.length,
    no,
    owner,
    zone,
    rested: false,
    damage: 0,
    pilot: null,
    pairedTo: null,
    enteredTurn: 0,
    token: def.token && def.type !== "RESOURCE",
  };
  c.s.cards.push(card);
  return card;
}

const inst = (c: Ctx, id: CardId) => c.s.cards[id]!;
const def = (c: Ctx, id: CardId) => c.lib.get(c.s.cards[id]!.no);

// ---------------------------------------------------------------------------------------------
// Values

function modifierSum(c: Ctx, id: CardId, field: "ap" | "hp"): number {
  let sum = 0;
  for (const m of c.s.modifiers) if (m.target === id) sum += m[field];
  return sum;
}

function apOf(c: Ctx, id: CardId): number {
  const card = inst(c, id);
  let ap = def(c, id).ap + modifierSum(c, id, "ap");
  if (card.pilot !== null) ap += def(c, card.pilot).ap; // 3-3-8-1
  return Math.max(0, ap); // 1-3-6
}

function hpOf(c: Ctx, id: CardId): number {
  const card = inst(c, id);
  let hp = def(c, id).hp + modifierSum(c, id, "hp");
  if (card.pilot !== null) hp += def(c, card.pilot).hp;
  return Math.max(0, hp);
}

function keywordsOf(c: Ctx, id: CardId): Keywords {
  return def(c, id).keywords;
}

function isLinked(c: Ctx, id: CardId): boolean {
  const card = inst(c, id);
  return card.pilot !== null && satisfiesLink(def(c, id), def(c, card.pilot));
}

/** 3-2-4, 3-2-6-3: a Unit can attack unless it entered the battle area this turn and is not linked. */
function canAttack(c: Ctx, id: CardId): boolean {
  const card = inst(c, id);
  return !card.rested && (card.enteredTurn < c.s.turn || isLinked(c, id));
}

function activeResources(c: Ctx, p: PlayerId): CardId[] {
  return c.s.players[p].resources.filter((id) => !inst(c, id).rested);
}

/** 2-9-1 (Lv. = number of Resources, active or rested) and 2-10-1 (cost = active Resources to rest). */
function canPlay(c: Ctx, p: PlayerId, card: EngineCard): boolean {
  return c.s.players[p].resources.length >= card.level && activeResources(c, p).length >= card.cost;
}

// ---------------------------------------------------------------------------------------------
// Moving cards

function zoneList(c: Ctx, card: CardInstance): CardId[] | null {
  if (card.zone === "pilot" || card.zone === "gone") return null;
  return c.s.players[card.owner][card.zone];
}

function detach(c: Ctx, card: CardInstance): void {
  const list = zoneList(c, card);
  if (list) {
    const i = list.indexOf(card.id);
    if (i < 0) throw new Error(`card ${card.id} not in its zone ${card.zone}`);
    list.splice(i, 1);
  } else if (card.zone === "pilot" && card.pairedTo !== null) {
    inst(c, card.pairedTo).pilot = null;
  }
  card.pairedTo = null;
}

/** Moves a card to another zone. It becomes a new card there (4-1-5): state and modifiers reset. */
function moveTo(c: Ctx, id: CardId, zone: ZoneName, position: "top" | "bottom" = "top"): void {
  const card = inst(c, id);
  detach(c, card);
  c.s.modifiers = c.s.modifiers.filter((m) => m.target !== id);
  card.rested = false;
  card.damage = 0;
  if (card.token && zone !== "battle" && zone !== "resources" && zone !== "base" && zone !== "shields") {
    card.zone = "gone"; // 5-17-2-5
    c.ev.push({ t: "removed", card: id });
    return;
  }
  card.zone = zone;
  const list = c.s.players[card.owner][zone];
  if (position === "top" || zone === "battle" || zone === "hand") list.unshift(id);
  else list.push(id);
  if (zone === "battle") card.enteredTurn = c.s.turn;
}

type TrashReason = "destroyed" | "overflow" | "discard" | "shield";

/** To the trash; a Unit's Pilot goes with it (3-3-6). */
function toTrash(c: Ctx, id: CardId, reason: TrashReason): void {
  const card = inst(c, id);
  const pilot = card.pilot;
  if (reason === "destroyed") c.ev.push({ t: "destroyed", card: id });
  moveTo(c, id, "trash");
  if (card.zone === "trash") c.ev.push({ t: "toTrash", card: id, reason });
  if (pilot !== null) {
    moveTo(c, pilot, "trash"); // detaching the Pilot clears card.pilot
    c.ev.push({ t: "toTrash", card: pilot, reason: "paired" });
  }
}

function draw(c: Ctx, p: PlayerId, n: number): void {
  const player = c.s.players[p];
  for (let i = 0; i < n && player.deck.length; i++) {
    const id = player.deck[0]!;
    moveTo(c, id, "hand");
    c.ev.push({ t: "draw", player: p, card: id });
  }
}

function rest(c: Ctx, id: CardId): void {
  const card = inst(c, id);
  if (card.rested) return; // 1-3-2-1
  card.rested = true;
  c.ev.push({ t: "rest", card: id });
}

/** Pays a cost by resting active Resources; normal ones first, then EX Resources, which leave the game (5-17-3-2-3). */
function pay(c: Ctx, p: PlayerId, cost: number): void {
  if (cost <= 0) return;
  const active = activeResources(c, p);
  const normal = active.filter((id) => !inst(c, id).token);
  const ex = active.filter((id) => inst(c, id).token);
  const used = [...normal, ...ex].slice(0, cost);
  if (used.length < cost) throw new Error("cannot pay cost");
  for (const id of used) rest(c, id);
  c.ev.push({ t: "pay", player: p, cards: used });
  for (const id of used) if (inst(c, id).token) moveTo(c, id, "removal");
}

// ---------------------------------------------------------------------------------------------
// Damage, destruction, defeat

function dealDamage(c: Ctx, id: CardId, amount: number, kind: "battle" | "effect"): void {
  if (amount <= 0) return; // 5-5-5
  inst(c, id).damage += amount;
  c.ev.push({ t: "damage", card: id, amount, kind });
}

/** Destroys the top `n` Shields (8-5-2-3-1, 13-1-7). */
function breakShields(c: Ctx, p: PlayerId, n: number): void {
  const shields = c.s.players[p].shields.slice(0, n);
  for (const id of shields) {
    c.ev.push({ t: "shieldBreak", player: p, card: id });
    // M2: reveal and offer the Burst effect here (13-2-5), Burst effects resolve first (10-1-6-8).
    toTrash(c, id, "shield");
  }
}

/** Damage to the first card of a shield area: the Base if there is one, else the top Shield (13-1-2-2). */
function damageShieldArea(c: Ctx, p: PlayerId, amount: number, kind: "battle" | "effect"): void {
  if (amount <= 0) return;
  const player = c.s.players[p];
  if (player.base.length) dealDamage(c, player.base[0]!, amount, kind);
  else if (player.shields.length) breakShields(c, p, 1);
}

function endGame(c: Ctx, losers: PlayerId[], reason: GameEndReason): void {
  if (c.s.result) return;
  const winner = losers.length === 1 ? other(losers[0]!) : null;
  c.s.result = { winner, reason, turn: c.s.turn };
  c.s.step = "over";
  c.s.pending = null;
  c.ev.push({ t: "gameOver", result: c.s.result });
}

/** Rules management (11): defeat, then destruction, repeated until nothing changes. */
function rulesManagement(c: Ctx): void {
  if (c.s.result) return;
  const deckOut = ([0, 1] as const).filter((p) => c.s.players[p].deck.length === 0); // 11-2-1-2
  if (deckOut.length) {
    endGame(c, deckOut, "deckOut");
    return;
  }
  let changed = true;
  while (changed) {
    changed = false;
    // Destroyed simultaneously (8-5-3-2-3): collect first, then move.
    const doomed: CardId[] = [];
    for (const p of [0, 1] as const) {
      for (const id of [...c.s.players[p].battle, ...c.s.players[p].base]) {
        const card = inst(c, id);
        if (card.damage > 0 && card.damage >= hpOf(c, id)) doomed.push(id);
      }
    }
    for (const id of doomed) {
      toTrash(c, id, "destroyed"); // M2: 【Destroyed】 triggers
      changed = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Turn flow

function run(c: Ctx): void {
  let guard = 0;
  while (!c.s.result && !c.s.pending) {
    if (++guard > 10_000) throw new Error(`engine loop in step ${c.s.step}`);
    STEPS[c.s.step](c);
    rulesManagement(c);
  }
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

function actionStepOptions(_c: Ctx, _p: PlayerId): Action[] {
  // M2: 【Action】 Command cards and 【Activate･Action】 effects.
  return [{ type: "pass" }];
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
  return c.s.players[defender].battle.filter(
    (id) => id !== b.target && !inst(c, id).rested && keywordsOf(c, id).blocker, // 8-3-3, 13-1-4
  );
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
      const exBase = createCard(c, EX_BASE, p, "base");
      player.base.push(exBase.id);
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
    for (const id of [...player.battle, ...player.resources, ...player.base]) inst(c, id).rested = false; // 7-2-3
    c.ev.push({ t: "setActive", player: s.active });
    // M2: "at the start of the turn" effects (7-2-4).
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
    // M2: 【Attack】 effects (8-2-2).
    setStep(c, battleValid(c) ? "block" : "battleEnd"); // 8-2-4
  },

  block(c) {
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
    runActionStep(c, "damage");
  },

  damage(c) {
    if (!battleValid(c)) {
      setStep(c, "battleEnd"); // 8-3-5, 8-4-2
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
      }
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

function mainOptions(c: Ctx): Action[] {
  const s = c.s;
  const p = s.active;
  const me = s.players[p];
  const enemy = s.players[other(p)];
  const options: Action[] = [];

  for (const id of uniqueByNo(c, me.hand)) {
    const card = def(c, id);
    if (!canPlay(c, p, card)) continue;
    if (card.type === "UNIT") {
      if (me.battle.length < LIMITS.battle) options.push({ type: "deployUnit", card: id });
      else for (const replace of me.battle) options.push({ type: "deployUnit", card: id, replace }); // 11-4-2
    } else if (card.pairable) {
      for (const unit of me.battle)
        if (inst(c, unit).pilot === null) options.push({ type: "pair", card: id, unit });
      // M2: Commands with 【Main】 effects.
    } else if (card.type === "BASE") {
      options.push({ type: "deployBase", card: id });
    }
  }

  for (const unit of me.battle) {
    if (!canAttack(c, unit)) continue;
    options.push({ type: "attack", unit, target: "player" });
    for (const target of enemy.battle)
      if (inst(c, target).rested) options.push({ type: "attack", unit, target });
  }

  for (const unit of me.battle) {
    if (inst(c, unit).rested || keywordsOf(c, unit).support <= 0) continue;
    for (const target of me.battle) if (target !== unit) options.push({ type: "support", unit, target });
  }

  options.push({ type: "endMain" });
  return options;
}

function perform(c: Ctx, decision: Decision, action: Action): void {
  const s = c.s;
  const p = decision.player;
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
      pay(c, p, def(c, action.card).cost);
      if (action.replace !== undefined) toTrash(c, action.replace, "overflow"); // not destroyed (11-4-2-1)
      moveTo(c, action.card, "battle");
      c.ev.push({ t: "deploy", player: p, card: action.card });
      // M2: 【Deploy】 effects.
      return;
    }
    case "pair": {
      pay(c, p, def(c, action.card).cost);
      const card = inst(c, action.card);
      detach(c, card);
      card.zone = "pilot";
      card.pairedTo = action.unit;
      inst(c, action.unit).pilot = action.card;
      c.ev.push({
        t: "pair",
        player: p,
        card: action.card,
        unit: action.unit,
        link: isLinked(c, action.unit),
      });
      // M2: 【When Paired】 / 【When Linked】 effects.
      return;
    }
    case "deployBase": {
      pay(c, p, def(c, action.card).cost);
      for (const old of [...s.players[p].base]) toTrash(c, old, "overflow"); // 11-5-2
      moveTo(c, action.card, "base");
      c.ev.push({ t: "deploy", player: p, card: action.card });
      return;
    }
    case "attack": {
      rest(c, action.unit); // 8-2-1
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
      return;
    }
    case "endMain":
      enterActionStep(c, "endAction"); // 7-5-5-2
      return;
    case "block": {
      rest(c, action.unit);
      s.battle!.target = action.unit;
      s.battle!.blocked = true;
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
  }
}

function resolveBattleDamage(c: Ctx): void {
  const b = c.s.battle!;
  const attacker = b.attacker;
  const defender = other(b.attackerOwner);
  const atkAp = apOf(c, attacker);
  const kw = keywordsOf(c, attacker);

  if (b.target === "player") {
    const enemy = c.s.players[defender];
    if (enemy.base.length) {
      dealDamage(c, enemy.base[0]!, atkAp, "battle"); // 8-5-2-4
    } else if (enemy.shields.length) {
      if (atkAp > 0) breakShields(c, defender, kw.suppression ? 2 : 1); // 8-5-2-3, 13-1-7
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
    dealDamage(c, target, atkAp, "battle");
    rulesManagement(c);
    if (inst(c, target).zone === "battle") dealDamage(c, attacker, targetAp, "battle");
  } else {
    dealDamage(c, target, atkAp, "battle"); // 8-5-3-2
    dealDamage(c, attacker, targetAp, "battle");
  }
  rulesManagement(c);
  // <Breach> also when both Units are destroyed (13-1-2-3).
  if (kw.breach > 0 && inst(c, target).zone !== "battle") {
    damageShieldArea(c, defender, kw.breach, "effect");
  }
}
