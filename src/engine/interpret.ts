// Runs compiled card effects (effects/compile.ts). An effect is a Frame on c.s.frames; it runs until it
// needs a player's choice (then c.s.pending is set and `answer` continues it) or until it ends.

import type { Cond, Filter, KeywordName, Ref } from "../effects/dsl";
import type { Instr, Program } from "../effects/compile";
import {
  EX_BASE,
  LIMITS,
  activeResources,
  apOf,
  battlingWith,
  breakShields,
  costOf,
  pay,
  playerHasFlag,
  candidates,
  damageShieldArea,
  dealDamage,
  def,
  deployBase,
  destroy,
  draw,
  effectByRef,
  enterBattle,
  evalCond,
  hpOf,
  flagFilters,
  hasFlag,
  inst,
  keywordsOf,
  mark,
  raiseForPlayer,
  matches,
  moveTo,
  onceKey,
  other,
  pairPilot,
  placeExResource,
  raise,
  ready,
  rest,
  rulesManagement,
  shuffleIntoBottom,
  toHand,
  toTrash,
  createCard,
  type Ctx,
} from "./core";
import { shuffle } from "./rng";
import type { Action, CardId, Decision, Frame, PendingTrigger, PlayerId } from "./types";

const OVERFLOW = "__overflow";
const DEPLOY = "__deploy";
const DISCARD = "__discard";
const LOOK = "__look";
const ARRANGE = "__arrange";

/** Draws with an effect and raises "When you draw with an effect" (ST08-011). */
export function effectDraw(c: Ctx, p: PlayerId, n: number): void {
  const before = c.s.players[p].hand.length;
  draw(c, p, n);
  if (c.s.players[p].hand.length === before) return;
  c.s.marks[`effectDraw:${p}`] = c.s.turn;
  const me = c.s.players[p];
  for (const id of [...me.battle, ...me.base]) raise(c, "effectDraw", id);
}

/**
 * "When you rest your Base with one of your Units' effects, you may rest this Unit instead" (GD03-079) and
 * "when you would rest a Unit with a friendly (League Militaire) Unit's effect, you may rest this Base
 * instead" (GD05-124): used automatically when the replacement is active.
 */
function restReplacement(c: Ctx, frame: Frame, id: CardId): CardId {
  const me = frame.controller;
  const card = inst(c, id);
  if (card.owner !== me || def(c, frame.source).type.startsWith("UNIT") === false) return id;
  const mine = [...c.s.players[me].battle, ...c.s.players[me].base].filter(
    (x) => x !== id && !inst(c, x).rested,
  );
  if (card.zone === "base") {
    const unit = mine.find((x) => hasFlag(c, x, "restInsteadOfBase"));
    if (unit !== undefined) return unit;
  }
  if (card.zone === "battle" && c.s.active === me) {
    for (const x of mine) {
      const filters = flagFilters(c, x, "baseRestsInstead");
      if (filters?.some((f) => matches(c, frame.source, f, me, x, true))) return x;
    }
  }
  return id;
}

/** Paying ① or more inside a friendly Unit's effect ("Pay its cost to deploy it", FAQ Q286). */
function paidForEffect(c: Ctx, frame: Frame, amount: number): void {
  const me = frame.controller;
  if (amount <= 0 || !def(c, frame.source).type.startsWith("UNIT") || inst(c, frame.source).owner !== me)
    return;
  const key = `paidFx:${me}:${c.s.turn}`;
  c.s.marks[key] = (c.s.marks[key] ?? 0) + amount;
  c.s.marks[`lastPaid:${me}`] = amount;
  mark(c, "paidFxNo", me, def(c, frame.source).no);
  raiseForPlayer(c, "effectPaid", me, frame.source);
}

function enemyBlocksReady(c: Ctx, p: PlayerId): boolean {
  const enemy = c.s.players[other(p)];
  return [...enemy.battle, ...enemy.base].some((id) => hasFlag(c, id, "noEnemyReady"));
}

/**
 * Can an effect program start here (10-1-8-1-1, FAQ Q104)? Its first choices need targets — all of them when
 * several are chosen together ("Choose 1 of your Units and 1 enemy Unit", FAQ Q153); a condition at the
 * start that fails means it does nothing (FAQ Q245); of "choose 1 of the following effects" at least one
 * must be possible (FAQ Q401).
 */
export function canStart(c: Ctx, program: Program, start: number, p: PlayerId, source: CardId): boolean {
  let pc = start;
  let skipped = false;
  for (let guard = 0; guard < 64; guard++) {
    const instr = program[pc];
    if (!instr) return !skipped;
    if (instr.op === "jumpUnless") {
      // Conditions about the effect's own variables can't be known before it starts.
      if (
        !("varGone" in instr.cond || "varMatches" in instr.cond || "varCount" in instr.cond) &&
        !evalCond(c, instr.cond, source, p)
      ) {
        pc = instr.to;
        skipped = true;
        continue;
      }
      pc++;
      continue;
    }
    if (instr.op === "jump") {
      pc = instr.to;
      continue;
    }
    if (instr.op === "pick") return instr.options.some((o) => canStart(c, program, o.to, p, source));
    if (instr.op !== "choose") return true;
    if (instr.may) return true;
    // A cost that chooses several cards ("Exile 4 cards in your trash") needs all of them.
    const needed = instr.exact ? (instr.count ?? 1) : 1;
    const pool = candidates(c, instr.filter, p, source);
    if (pool.length < needed) return false;
    const following = program[pc + 1];
    if (following?.op !== "choose" || following.may) return true;
    pc++;
  }
  return true;
}

/**
 * When the next waiting effects belong to the same player, that player chooses which one resolves first
 * (10-1-6-5, FAQ Q107). Returns true when a decision is pending.
 */
export function chooseOrder(c: Ctx): boolean {
  const queue = c.s.queue;
  const first = queue[0]!;
  if (c.s.orderChoice === false || first.ordered || first.origin !== "trigger") return false;
  let n = 1;
  while (n < queue.length && queue[n]!.controller === first.controller && queue[n]!.origin === "trigger") n++;
  if (n < 2) return false;
  const group = queue.slice(0, n);
  const key = (t: PendingTrigger) => `${t.source}:${t.ref.no}:${t.ref.idx}:${t.ref.granted}`;
  if (group.every((t) => key(t) === key(first))) return false;
  const names = group.map((t) => def(c, t.source).name);
  c.s.pending = {
    player: first.controller,
    kind: "effect",
    prompt: "order",
    source: first.source,
    options: group.map((t, index): Action => {
      const same = names.filter((x, i) => x === names[index] && i < index).length;
      return { type: "option", index, label: same ? `${names[index]} (${same + 1})` : names[index]! };
    }),
  };
  return true;
}

export function startEffect(c: Ctx, t: PendingTrigger): void {
  const compiled = effectByRef(c, t.ref);
  if (compiled.effect.kind === "trigger" || compiled.effect.kind === "activated") {
    if (compiled.effect.once) c.s.oncePerTurn[onceKey(t.source, t.ref)] = c.s.turn;
  }
  c.s.frames.push({
    ref: t.ref,
    origin: t.origin,
    source: t.source,
    controller: t.controller,
    event: t.event,
    pc: t.origin === "burst" ? -1 : 0, // a Burst first asks whether to use it (13-2-5-2)
    vars: {},
  });
  c.ev.push({ t: "effect", source: t.source, origin: t.origin, controller: t.controller });
}

function finish(c: Ctx): void {
  const frame = c.s.frames.pop()!;
  const card = inst(c, frame.source);
  // Commands and revealed Shields go to the trash when their effect ends (3-4-4, 13-2-5-3).
  if (card.zone === "limbo") toTrash(c, frame.source, frame.origin === "burst" ? "shield" : "resolved");
  // "During this battle" outside a battle (e.g. an 【Activate･Action】 in the end phase's action step) ends
  // at once; otherwise it would last into the next battle (found 18 Nov 2026, ST12-006 Suppression).
  if (!c.s.battle) c.s.modifiers = c.s.modifiers.filter((m) => m.until !== "battle");
}

function ask(
  c: Ctx,
  frame: Frame,
  decision: Omit<Decision, "player" | "kind" | "source">,
  player: PlayerId = frame.controller,
): void {
  c.s.pending = { player, kind: "effect", source: frame.source, ...decision };
}

const YES_NO: Action[] = [{ type: "yes" }, { type: "no" }];

// "pilot": Pilots chosen as targets ("Choose 1 Pilot paired with an enemy Unit", GD03-110).
const IN_PLAY = ["battle", "base", "resources", "pilot"];

/** Cards a reference stands for that are still where the effect can reach them (in play by default). */
function targets(c: Ctx, frame: Frame, ref: Ref, zones: string[] = IN_PLAY): CardId[] {
  if (ref.includes("+")) return ref.split("+").flatMap((r) => targets(c, frame, r, zones));
  const ids =
    ref === "self"
      ? [frame.source]
      : ref === "event"
        ? frame.event === null
          ? []
          : [frame.event]
        : ref === "eventOpponent"
          ? frame.event === null || battlingWith(c, frame.event) === null
            ? []
            : [battlingWith(c, frame.event)!]
          : ref === "eventSource"
            ? frame.event !== null && inst(c, frame.event).lastSource !== undefined
              ? [inst(c, frame.event).lastSource!]
              : []
            : (frame.vars[ref] ?? []);
  return ids.filter((id) => zones.includes(inst(c, id).zone));
}

/** Asks for a card to trash when the battle area is full (11-4-2); false if the player must answer first. */
function ensureRoom(c: Ctx, frame: Frame): boolean {
  const battle = c.s.players[frame.controller].battle;
  if (battle.length < LIMITS.battle) return true;
  frame.choosing = { as: OVERFLOW, left: 1, optional: false, candidates: [...battle] };
  ask(c, frame, { prompt: "overflow", options: battle.map((card): Action => ({ type: "target", card })) });
  return false;
}

function uniqueByNo(c: Ctx, ids: CardId[]): CardId[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const no = inst(c, id).no;
    if (seen.has(no)) return false;
    seen.add(no);
    return true;
  });
}

/** Offers the current choice of `frame.choosing` to the controller (or to `player`). */
/** The controller looks at the top n cards of their deck (the log and the board show them to that player). */
function look(c: Ctx, frame: Frame, me: PlayerId, n: number): CardId[] {
  const cards = (frame.looking = c.s.players[me].deck.slice(0, n));
  if (cards.length) c.ev.push({ t: "look", player: me, cards: [...cards] });
  return cards;
}

function offerChoice(c: Ctx, frame: Frame, prompt: Decision["prompt"], player?: PlayerId): void {
  const ch = frame.choosing!;
  const options: Action[] = (prompt === "discard" ? uniqueByNo(c, ch.candidates) : ch.candidates).map(
    (card): Action => ({ type: "target", card }),
  );
  if (ch.optional) options.push({ type: "done" });
  ask(c, frame, { prompt, options }, player);
}

/** Conditions that look at the running effect's variables, then the general ones (core.evalCond). */
function frameCond(c: Ctx, frame: Frame, cond: Cond): boolean {
  if ("and" in cond) return cond.and.every((x) => frameCond(c, frame, x));
  if ("or" in cond) return cond.or.some((x) => frameCond(c, frame, x));
  if ("not" in cond) return !frameCond(c, frame, cond.not);
  if ("varGone" in cond) return (frame.vars[cond.varGone] ?? []).some((id) => inst(c, id).zone !== "battle");
  if ("varCount" in cond) return (frame.vars[cond.varCount.var] ?? []).length >= cond.varCount.min;
  if ("topCard" in cond) {
    const top = c.s.players[frame.controller].deck[0];
    return (
      top !== undefined &&
      matches(c, top, { ...cond.topCard, zone: undefined }, frame.controller, frame.source, true)
    );
  }
  if ("varMatches" in cond) {
    return (frame.vars[cond.varMatches] ?? []).some((id) =>
      matches(c, id, cond.filter, frame.controller, frame.source, true),
    );
  }
  return evalCond(c, cond, frame.source, frame.controller);
}

/** Replaces "Lv./AP equal to or lower than that Unit" (a variable) by numbers. */
function resolveFilter(c: Ctx, frame: Frame, f: Filter): Filter {
  if ((!f.lvMaxOf || f.lvMaxOf === "self") && (!f.apMaxOf || f.apMaxOf === "self")) return f;
  const out: Filter = { ...f };
  if (f.lvMaxOf && f.lvMaxOf !== "self") {
    const ids =
      f.lvMaxOf === "event" ? (frame.event === null ? [] : [frame.event]) : (frame.vars[f.lvMaxOf] ?? []);
    out.lvMax = ids.length ? Math.min(...ids.map((id) => def(c, id).level)) : -1;
    delete out.lvMaxOf;
  }
  if (f.apMaxOf && f.apMaxOf !== "self") {
    const ids = frame.vars[f.apMaxOf] ?? [];
    out.apMax = ids.length ? Math.min(...ids.map((id) => apOf(c, id))) : -1;
    delete out.apMaxOf;
  }
  return out;
}

/** Starts the 【Main】 or 【Action】 command effect of a card as a new effect of `controller`. */
function runCommand(c: Ctx, card: CardId, controller: PlayerId, timing: "main" | "action"): void {
  const d = def(c, card);
  const idx = d.script.compiled.findIndex(
    (e) => e.effect.kind === "command" && e.effect.timing.includes(timing),
  );
  if (idx < 0) return;
  mark(c, "cmd", controller, d.no);
  raiseForPlayer(c, "commandUsed", controller, card);
  startEffect(c, {
    ref: { no: inst(c, card).no, idx, granted: false },
    source: card,
    controller,
    event: null,
    origin: "command",
  });
}

/** Runs the top frame until it needs a decision or ends. */
export function stepFrame(c: Ctx): void {
  const frame = c.s.frames[c.s.frames.length - 1]!;
  if (frame.pc === -1) {
    ask(c, frame, { prompt: "burst", options: YES_NO });
    return;
  }
  const program = effectByRef(c, frame.ref).program;
  while (!c.s.pending && !c.s.result && c.s.frames[c.s.frames.length - 1] === frame) {
    if (frame.pc >= program.length) {
      finish(c);
      return;
    }
    const before = c.s.frames.length;
    exec(c, frame, program[frame.pc]!);
    rulesManagement(c);
    if (c.s.frames.length !== before) return; // a nested effect (【Main】 of a Burst) runs first
  }
}

function exec(c: Ctx, frame: Frame, instr: Instr): void {
  const me = frame.controller;
  const next = () => void frame.pc++;
  switch (instr.op) {
    case "jump":
      frame.pc = instr.to;
      return;
    case "jumpUnless":
      frame.pc = frameCond(c, frame, instr.cond) ? frame.pc + 1 : instr.to;
      return;
    case "ask":
      ask(c, frame, { prompt: "may", options: YES_NO }, instr.by === "opponent" ? other(me) : me);
      return;
    case "pick": {
      // Only alternatives whose targets can be chosen (FAQ Q401).
      const program = effectByRef(c, frame.ref).program;
      const possible = instr.options
        .map((o, index): Action => ({ type: "option", index, label: o.label }))
        .filter((_, i) => canStart(c, program, instr.options[i]!.to, me, frame.source));
      if (!possible.length) {
        frame.pc = program.length;
        return;
      }
      ask(c, frame, { prompt: "option", options: possible });
      return;
    }

    case "choose": {
      const as = instr.as ?? "it";
      const chosen = frame.vars[as] ?? [];
      const among = instr.among !== undefined ? (frame.vars[instr.among] ?? []) : null;
      const names = instr.unique ? new Set(chosen.map((id) => def(c, id).name)) : null;
      const pool = candidates(c, resolveFilter(c, frame, instr.filter), me, frame.source).filter(
        (id) =>
          !chosen.includes(id) &&
          (among === null || among.includes(id)) &&
          (names === null || !names.has(def(c, id).name)),
      );
      const count = instr.countOf
        ? candidates(c, instr.countOf, me, frame.source).length
        : (instr.count ?? 1);
      const left = count - chosen.length;
      // "You may choose 2 … from your trash. Exile them. If you do, …": the full number or nothing.
      // Once the first card is chosen, the rest must follow.
      const exact = !!instr.exact || (!!instr.may && !instr.upTo && (instr.count ?? 1) > 1);
      if (exact && !chosen.length && pool.length < left) {
        frame.pc = instr.fail;
        return;
      }
      const optional = !!instr.upTo || (!!instr.may && !(exact && chosen.length));
      if (!pool.length || left <= 0) {
        // 10-2-2: no target, no effect (the rest of the segment is skipped).
        if (!chosen.length) frame.pc = instr.fail;
        else next();
        return;
      }
      if (!optional && pool.length <= left) {
        frame.vars[as] = [...chosen, ...pool];
        next();
        return;
      }
      frame.choosing = { as, left, optional, candidates: pool, ...(exact ? { exact } : {}) };
      offerChoice(c, frame, "target", instr.by === "opponent" ? other(me) : undefined);
      return;
    }
    case "all":
      frame.vars[instr.as ?? "it"] = candidates(c, resolveFilter(c, frame, instr.filter), me, frame.source);
      next();
      return;

    case "rest":
      for (const id of targets(c, frame, instr.t)) {
        const card = inst(c, id);
        if (card.rested) continue;
        const instead = restReplacement(c, frame, id);
        rest(c, instead);
        if (inst(c, instead).zone === "battle") {
          raiseForPlayer(c, "allyRestedByEffect", inst(c, instead).owner, instead, {
            fromEnemy: inst(c, instead).owner !== me,
          });
        }
      }
      return next();
    case "ready":
      for (const id of targets(c, frame, instr.t)) {
        // "Enemy Units can't be set as active by enemy effects" (GD06-037, on the other player's card).
        if (inst(c, id).owner === me && enemyBlocksReady(c, me)) continue;
        if (inst(c, id).zone === "resources" && inst(c, id).rested) c.s.marks[`readyRes:${me}`] = c.s.turn;
        const wasRested = inst(c, id).rested;
        ready(c, id);
        if (wasRested && !inst(c, id).rested && inst(c, id).zone === "battle")
          raise(c, "readiedByEffect", id);
      }
      return next();
    case "damage":
      for (const id of targets(c, frame, instr.t)) dealDamage(c, id, instr.amount, "effect", frame.source);
      return next();
    case "destroy":
      for (const id of targets(c, frame, instr.t)) {
        const owner = inst(c, id).owner;
        if (owner !== me && playerHasFlag(c, owner, "noEffectDestroy")) continue; // GD04-101
        if (owner === me) mark(c, "ownDestroyed", me, def(c, frame.source).no);
        destroy(c, id, frame.source);
      }
      return next();
    case "bounce":
      for (const id of targets(c, frame, instr.t)) toHand(c, id);
      return next();
    case "toHand":
      for (const id of targets(c, frame, instr.t, [...IN_PLAY, "trash", "removal"])) toHand(c, id);
      return next();
    case "exile":
      for (const id of targets(c, frame, instr.t, [...IN_PLAY, "trash", "hand"])) {
        const pilot = inst(c, id).pilot;
        moveTo(c, id, "removal");
        c.ev.push({ t: "removed", card: id });
        if (pilot !== null) {
          moveTo(c, pilot, "removal"); // the Pilot goes along (3-3-6)
          c.ev.push({ t: "removed", card: pilot });
        }
      }
      return next();
    case "toDeck":
      for (const id of targets(c, frame, instr.t, [...IN_PLAY, "hand"])) {
        // The paired Pilot goes along, as when a Unit goes to the trash or hand (3-3-6).
        const pilot = inst(c, id).pilot;
        moveTo(c, id, "deck", instr.pos);
        c.ev.push({ t: "toDeck", card: id, pos: instr.pos });
        if (pilot !== null) {
          moveTo(c, pilot, "deck", instr.pos);
          c.ev.push({ t: "toDeck", card: pilot, pos: instr.pos });
        }
      }
      return next();
    case "recover":
      for (const id of targets(c, frame, instr.t)) {
        const card = inst(c, id);
        const amount = Math.min(instr.amount, card.damage); // 5-6-2, 5-6-3
        if (amount > 0) {
          card.damage -= amount;
          c.ev.push({ t: "recover", card: id, amount });
          raise(c, "recovered", id);
        }
      }
      return next();
    case "mod":
      for (const id of targets(c, frame, instr.t)) {
        const shielded = (instr.ap ?? 0) < 0 && inst(c, id).owner !== me && hasFlag(c, id, "noApReduction");
        c.s.modifiers.push({
          target: id,
          ap: shielded ? 0 : (instr.ap ?? 0),
          hp: instr.hp ?? 0,
          until: instr.until,
          source: frame.source,
        });
        c.ev.push({ t: "modifier", card: id, ap: shielded ? 0 : (instr.ap ?? 0), hp: instr.hp ?? 0 });
        if (!shielded && (instr.ap ?? 0) < 0 && inst(c, id).owner !== me) raise(c, "apReducedByEnemy", id);
      }
      return next();
    case "grant": {
      const times = instr.per ? candidates(c, instr.per, me, frame.source).length : 1;
      if (times <= 0) return next();
      for (const id of targets(c, frame, instr.t)) {
        c.s.modifiers.push({
          target: id,
          ap: 0,
          hp: 0,
          keyword: instr.keyword,
          ...(instr.amount ? { amount: instr.amount * times } : {}),
          until: instr.until,
          source: frame.source,
        });
      }
      return next();
    }
    case "flag": {
      const base = {
        ap: 0,
        hp: 0,
        flag: instr.flag,
        ...(instr.filter ? { filter: instr.filter } : {}),
        ...(instr.amount ? { amount: instr.amount } : {}),
        ...(instr.link !== undefined && targets(c, frame, instr.link)[0] !== undefined
          ? { link: targets(c, frame, instr.link)[0]! }
          : {}),
        until: instr.until,
        source: frame.source,
      };
      if (instr.t === "you" || instr.t === "opponent") {
        c.s.modifiers.push({ target: -1, player: instr.t === "you" ? me : other(me), ...base });
      } else {
        for (const id of targets(c, frame, instr.t)) c.s.modifiers.push({ target: id, ...base });
      }
      return next();
    }

    case "draw":
      effectDraw(c, instr.who === "opponent" ? other(me) : me, instr.n);
      if (instr.both) effectDraw(c, other(me), instr.n);
      return next();
    case "pilotTo": {
      const pilot = inst(c, frame.source).pilot;
      if (pilot !== null && (!instr.filter || matches(c, pilot, instr.filter, me, frame.source, true))) {
        if (instr.dest === "hand") toHand(c, pilot);
        else {
          moveTo(c, pilot, "deck", "top");
          c.ev.push({ t: "toDeck", card: pilot, pos: "top" });
        }
      }
      return next();
    }
    case "payCost":
      if (activeResources(c, me).length < instr.n) {
        frame.pc = instr.fail;
        return;
      }
      pay(c, me, instr.n);
      paidForEffect(c, frame, instr.n);
      return next();
    case "damageByCount": {
      const amount = candidates(c, instr.count, me, frame.source).length;
      for (const id of targets(c, frame, instr.t)) dealDamage(c, id, amount, "effect", frame.source);
      return next();
    }
    case "tokenCopy": {
      const original = targets(c, frame, instr.t)[0];
      if (original === undefined || !inst(c, original).token) return next();
      if (!ensureRoom(c, frame)) return;
      const token = createCard(c, inst(c, original).no, me, "limbo");
      c.ev.push({ t: "token", player: me, card: token.id });
      enterBattle(c, token.id, !!instr.rested);
      return next();
    }
    case "shieldAreaDestroy": {
      const enemy = other(me);
      for (let i = 0; i < instr.n; i++) {
        const base = c.s.players[enemy].base[0];
        if (base !== undefined) destroy(c, base, frame.source);
        else if (c.s.players[enemy].shields.length) breakShields(c, enemy, 1);
      }
      return next();
    }
    case "discard": {
      const who = instr.who === "opponent" ? other(me) : me;
      const left = frame.repeat ?? instr.n;
      const hand = c.s.players[who].hand;
      if (left <= 0 || !hand.length) {
        delete frame.repeat;
        return next();
      }
      if (who !== me) c.s.marks[`oppDiscarded:${me}`] = c.s.turn;
      frame.repeat = left;
      frame.choosing = { as: DISCARD, left: 1, optional: false, candidates: [...hand] };
      offerChoice(c, frame, "discard", who);
      return;
    }
    case "shieldToHand":
      for (const id of c.s.players[me].shields.slice(0, instr.n)) toHand(c, id);
      return next();
    case "exResource":
      for (let i = 0; i < instr.n; i++) placeExResource(c, me, !!instr.rested);
      if (instr.both) for (let i = 0; i < instr.n; i++) placeExResource(c, other(me));
      return next();
    case "mill": {
      const milled = c.s.players[me].deck.slice(0, instr.n);
      for (const id of milled) toTrash(c, id, "mill");
      if (instr.as) frame.vars[instr.as] = milled;
      return next();
    }
    case "redirect": {
      // "Change the attack target of the battling enemy Unit to it."
      const b = c.s.battle;
      const to = targets(c, frame, instr.t)[0];
      if (b && to !== undefined && b.attackerOwner !== me && inst(c, to).owner === me && b.target !== to) {
        b.target = to;
        c.ev.push({ t: "block", blocker: to });
      }
      return next();
    }
    case "grantEffect": {
      // The gained effect is stored in the script of the card whose effect this is (not the Unit of a Pilot).
      const effect = { no: frame.ref.no, idx: instr.idx, granted: false };
      if (instr.t === "you") {
        c.s.modifiers.push({
          target: -1,
          player: me,
          ap: 0,
          hp: 0,
          effect,
          until: instr.until,
          source: frame.source,
        });
        return next();
      }
      for (const id of targets(c, frame, instr.t)) {
        c.s.modifiers.push({ target: id, ap: 0, hp: 0, effect, until: instr.until, source: frame.source });
      }
      return next();
    }
    case "damageByAp":
      for (const id of targets(c, frame, instr.t)) {
        const amount = Math.floor(apOf(c, frame.source) / instr.per);
        if (amount > 0) dealDamage(c, id, amount, "effect", frame.source);
      }
      return next();
    case "modByPaid": {
      const amount = c.s.marks[`lastPaid:${me}`] ?? 0;
      for (const id of targets(c, frame, instr.t)) {
        c.s.modifiers.push({ target: id, ap: amount, hp: 0, until: instr.until, source: frame.source });
        c.ev.push({ t: "modifier", card: id, ap: amount, hp: 0 });
      }
      return next();
    }
    case "takeTop": {
      const top = c.s.players[me].deck[0];
      if (top !== undefined) {
        c.ev.push({ t: "reveal", player: me, cards: [top] });
        toHand(c, top);
        if (instr.as) frame.vars[instr.as] = [top];
      }
      return next();
    }
    case "damageByVar": {
      const counted = (frame.vars[instr.var] ?? []).filter(
        (id) => !instr.filter || matches(c, id, instr.filter, me, frame.source, true),
      ).length;
      if (counted > 0)
        for (const id of targets(c, frame, instr.t)) dealDamage(c, id, counted, "effect", frame.source);
      return next();
    }
    case "copyKeywords": {
      const from = targets(c, frame, instr.from, ["trash", ...IN_PLAY])[0];
      if (from === undefined) return next();
      const k = def(c, from).keywords;
      const list: [KeywordName, number][] = [];
      if (k.blocker) list.push(["blocker", 0]);
      if (k.firstStrike) list.push(["firstStrike", 0]);
      if (k.highManeuver) list.push(["highManeuver", 0]);
      if (k.suppression) list.push(["suppression", 0]);
      if (k.breach) list.push(["breach", k.breach]);
      if (k.repair) list.push(["repair", k.repair]);
      if (k.support) list.push(["support", k.support]);
      for (const id of targets(c, frame, instr.into)) {
        for (const [keyword, amount] of list) {
          c.s.modifiers.push({
            target: id,
            ap: 0,
            hp: 0,
            keyword,
            ...(amount ? { amount } : {}),
            until: instr.until,
            source: frame.source,
          });
        }
      }
      return next();
    }
    case "opponentLookTop": {
      // The opponent takes the card if it matches (always good for them), else it stays on top.
      const enemy = other(me);
      const top = c.s.players[enemy].deck[0];
      if (top !== undefined && matches(c, top, { ...instr.pick, zone: undefined }, enemy, null, true)) {
        c.ev.push({ t: "reveal", player: enemy, cards: [top] });
        toHand(c, top);
      }
      return next();
    }
    case "placeResource": {
      const player = c.s.players[me];
      if (player.resourceDeck.length && player.resources.length < LIMITS.resources) {
        const id = player.resourceDeck[0]!;
        moveTo(c, id, "resources", "bottom");
        if (instr.rested) inst(c, id).rested = true;
        c.ev.push({ t: "resource", player: me, card: id });
      }
      return next();
    }
    case "token": {
      let left = frame.repeat ?? instr.count ?? 1;
      if (instr.forOwnerOf !== undefined) {
        // "The destroyed Unit's owner deploys 1 … token": only with room (no choice for the other player).
        const ids = instr.forOwnerOf === "self" ? [frame.source] : (frame.vars[instr.forOwnerOf] ?? []);
        for (const id of ids) {
          const owner = inst(c, id).owner;
          for (let i = 0; i < left && c.s.players[owner].battle.length < LIMITS.battle; i++) {
            const token = createCard(c, instr.no, owner, "limbo");
            c.ev.push({ t: "token", player: owner, card: token.id });
            enterBattle(c, token.id, !!instr.rested);
          }
        }
        return next();
      }
      while (left > 0) {
        if (!ensureRoom(c, frame)) {
          frame.repeat = left;
          return;
        }
        const token = createCard(c, instr.no, me, "limbo");
        c.ev.push({ t: "token", player: me, card: token.id });
        if (def(c, token.id).type === "BASE") deployBase(c, token.id);
        else enterBattle(c, token.id, !!instr.rested);
        left--;
      }
      delete frame.repeat;
      return next();
    }

    case "lookTop": {
      const looking = frame.looking ?? look(c, frame, me, instr.n);
      const pickable = instr.pick
        ? looking.filter((id) => matches(c, id, { ...instr.pick!, zone: undefined }, me, frame.source, true))
        : [];
      const left = frame.repeat ?? instr.pickCount ?? 0;
      if (pickable.length && left > 0) {
        frame.repeat = left;
        frame.choosing = { as: LOOK, left: 1, optional: instr.may ?? false, candidates: pickable };
        offerChoice(c, frame, "lookPick");
        return;
      }
      if (instr.rest === "trash") for (const id of looking) toTrash(c, id, "mill");
      else shuffleIntoBottom(c, looking, me);
      delete frame.looking;
      delete frame.repeat;
      return next();
    }
    case "lookTopArrange": {
      const looking = frame.looking ?? look(c, frame, me, instr.n);
      if (looking.length > 1) {
        frame.choosing = { as: ARRANGE, left: 1, optional: false, candidates: [...looking] };
        offerChoice(c, frame, "lookTop");
        return;
      }
      delete frame.looking;
      return next();
    }

    case "deployFromHand": {
      const chosen = frame.vars[DEPLOY]?.[0];
      if (chosen === undefined) {
        const pool = candidates(c, { ...instr.filter, zone: "hand", side: "friendly" }, me, frame.source);
        if (!pool.length) {
          frame.pc = instr.fail;
          return;
        }
        frame.choosing = { as: DEPLOY, left: 1, optional: instr.may ?? false, candidates: pool };
        offerChoice(c, frame, "target");
        return;
      }
      if (def(c, chosen).type === "BASE") {
        delete frame.vars[DEPLOY];
        deployBase(c, chosen);
        return next();
      }
      if (!ensureRoom(c, frame)) return;
      delete frame.vars[DEPLOY];
      enterBattle(c, chosen);
      return next();
    }
    case "readyResource": {
      const rested = c.s.players[me].resources.filter((id) => inst(c, id).rested).slice(0, instr.n);
      if (rested.length) c.s.marks[`readyRes:${me}`] = c.s.turn;
      for (const id of rested) ready(c, id);
      if (instr.both) {
        const theirs = c.s.players[other(me)].resources.filter((id) => inst(c, id).rested).slice(0, instr.n);
        for (const id of theirs) ready(c, id);
      }
      return next();
    }

    case "selfToHand":
      if (inst(c, frame.source).zone === "limbo") toHand(c, frame.source);
      return next();
    case "deploySelf": {
      const card = inst(c, frame.source);
      if (card.zone !== "limbo") return next();
      const type = def(c, frame.source).type;
      if (type === "BASE") deployBase(c, frame.source);
      else if (type === "UNIT") {
        if (!ensureRoom(c, frame)) return;
        enterBattle(c, frame.source);
      }
      return next();
    }
    case "modByCount": {
      const amount = candidates(c, instr.count, me, frame.source).length * instr.sign;
      for (const id of targets(c, frame, instr.t)) {
        if (amount < 0 && inst(c, id).owner !== me && hasFlag(c, id, "noApReduction")) continue;
        c.s.modifiers.push({ target: id, ap: amount, hp: 0, until: instr.until, source: frame.source });
        c.ev.push({ t: "modifier", card: id, ap: amount, hp: 0 });
      }
      return next();
    }
    case "peek":
      look(c, frame, me, instr.n);
      return next();
    case "unpeek":
      delete frame.looking;
      return next();
    case "topToBottom": {
      const seen = frame.looking;
      for (const id of c.s.players[me].deck.slice(0, instr.n)) {
        moveTo(c, id, "deck", "bottom");
        c.ev.push({ t: "toDeck", card: id, pos: "bottom", ...(seen?.includes(id) ? { seenBy: me } : {}) });
      }
      delete frame.looking;
      return next();
    }
    case "damageShieldArea":
      damageShieldArea(c, other(me), instr.amount, "effect", frame.source);
      return next();
    case "deploy": {
      const ids = targets(c, frame, instr.t, ["hand", "trash"]);
      const id = ids[0];
      if (id === undefined) return next();
      if (instr.pay && !frame.vars.__paid?.includes(id)) {
        // "Pay its cost to deploy it": only if the cost can be paid.
        const cost = costOf(c, me, id);
        if (activeResources(c, me).length < cost) return next();
        pay(c, me, cost);
        paidForEffect(c, frame, cost);
        frame.vars.__paid = [id];
      }
      if (def(c, id).type === "BASE") deployBase(c, id);
      else {
        if (!ensureRoom(c, frame)) return;
        enterBattle(c, id, !!instr.rested);
      }
      delete frame.vars.__paid;
      return next();
    }
    case "exBase": {
      const base = createCard(c, EX_BASE, me, "limbo");
      deployBase(c, base.id);
      return next();
    }
    case "shuffleIntoDeck": {
      const ids = targets(c, frame, instr.t, ["trash", "removal", ...IN_PLAY]);
      const owners = new Set<PlayerId>();
      for (const id of ids) {
        owners.add(inst(c, id).owner);
        moveTo(c, id, "deck", "bottom");
        c.ev.push({ t: "toDeck", card: id, pos: "bottom" });
      }
      for (const p of owners) shuffle(c.s.rng, c.s.players[p].deck);
      return next();
    }
    case "pairTo": {
      // The chosen card is in the trash or the hand, so it is looked up without the in-play filter.
      const card = (frame.vars[instr.t] ?? []).find((id) => ["trash", "hand"].includes(inst(c, id).zone));
      const unit = targets(c, frame, instr.unit)[0];
      if (card !== undefined && unit !== undefined && inst(c, unit).pilot === null) pairPilot(c, card, unit);
      return next();
    }
    case "discardChosen":
      for (const id of (frame.vars[instr.t] ?? []).filter((x) => inst(c, x).zone === "hand")) {
        moveTo(c, id, "trash");
        c.ev.push({ t: "toTrash", card: id, reason: "discard" });
      }
      return next();
    case "pairSelf": {
      const card = inst(c, frame.source);
      const unit = targets(c, frame, instr.t)[0];
      if (
        (card.zone === "limbo" || card.zone === "trash") &&
        unit !== undefined &&
        inst(c, unit).pilot === null
      ) {
        pairPilot(c, frame.source, unit);
      }
      return next();
    }
    case "runPilotMain": {
      next();
      const pilot = inst(c, frame.source).pilot;
      if (pilot !== null) runCommand(c, pilot, me, instr.timing ?? "main");
      return;
    }
    case "runMainOf": {
      next();
      const card = targets(c, frame, instr.t, ["trash", "hand", "limbo"])[0];
      if (card !== undefined) runCommand(c, card, me, "main");
      return;
    }
    case "runAction":
      next();
      runCommand(c, frame.source, me, "action");
      return;
    case "fight": {
      // A battle with only the damage step (FAQ Q345): the first Unit counts as the attacker, so <First
      // Strike> and "battling" effects work (Q346); kills count as battle kills for both (Q347); then the
      // battle ends (Q446).
      const a = targets(c, frame, instr.a)[0];
      const b = targets(c, frame, instr.b)[0];
      if (a === undefined || b === undefined) return next();
      const outer = c.s.battle;
      c.s.battle = { attacker: a, attackerOwner: inst(c, a).owner, target: b, blocked: false };
      const hit = (from: CardId, to: CardId) => dealDamage(c, to, apOf(c, from), "battle", from);
      const dead = (id: CardId) => inst(c, id).damage > 0 && inst(c, id).damage >= hpOf(c, id);
      if (keywordsOf(c, a).firstStrike) {
        hit(a, b);
        if (dead(b)) raise(c, "destroysUnit", a, b);
        rulesManagement(c);
        if (inst(c, b).zone === "battle" && inst(c, a).zone === "battle") {
          hit(b, a);
          if (dead(a)) raise(c, "destroysUnit", b, a);
        }
      } else {
        const apA = apOf(c, a);
        const apB = apOf(c, b);
        dealDamage(c, b, apA, "battle", a);
        dealDamage(c, a, apB, "battle", b);
        if (dead(b)) raise(c, "destroysUnit", a, b);
        if (dead(a)) raise(c, "destroysUnit", b, a);
      }
      rulesManagement(c);
      c.s.battle = outer;
      if (!outer) c.s.modifiers = c.s.modifiers.filter((m) => m.until !== "battle");
      return next();
    }
    case "deploySelfAsUnit": {
      const card = inst(c, frame.source);
      if (card.zone !== "limbo") return next();
      if (!ensureRoom(c, frame)) return;
      enterBattle(c, frame.source, false, { ap: instr.ap, hp: instr.hp });
      return next();
    }
    case "runMain":
      next();
      runCommand(c, frame.source, me, "main");
      return;
  }
}

/** Continues the top frame with the player's answer to its decision. */
export function answer(c: Ctx, action: Action): void {
  const frame = c.s.frames[c.s.frames.length - 1]!;
  if (frame.pc === -1) {
    const used = action.type === "yes";
    c.ev.push({ t: "burst", player: frame.controller, card: frame.source, used });
    if (used) frame.pc = 0;
    else finish(c);
    return;
  }
  const ch = frame.choosing;
  if (ch) {
    delete frame.choosing;
    const instr = effectByRef(c, frame.ref).program[frame.pc]!;
    const card = action.type === "target" ? action.card : null;
    switch (ch.as) {
      case OVERFLOW:
        toTrash(c, card!, "overflow"); // not destroyed (11-4-2-1); the deploy is retried
        return;
      case DEPLOY:
        if (card === null) frame.pc = "fail" in instr ? instr.fail : frame.pc + 1;
        else frame.vars[DEPLOY] = [card];
        return;
      case DISCARD:
        if (instr.op === "discard" && instr.as)
          frame.vars[instr.as] = [...(frame.vars[instr.as] ?? []), card!];
        moveTo(c, card!, "trash");
        c.ev.push({ t: "toTrash", card: card!, reason: "discard" });
        frame.repeat = (frame.repeat ?? 1) - 1;
        return;
      case LOOK:
        if (card === null) {
          frame.repeat = 0;
        } else if (instr.op === "lookTop" && instr.pairToSelf) {
          const unit = frame.source;
          if (inst(c, unit).zone === "battle" && inst(c, unit).pilot === null) {
            frame.looking = frame.looking!.filter((id) => id !== card);
            pairPilot(c, card, unit);
          }
          frame.repeat = 0;
        } else if (instr.op === "lookTop" && instr.toTop) {
          // Stays where it is: the cards above it go to the bottom, so it ends up on top.
          frame.looking = frame.looking!.filter((id) => id !== card);
          c.ev.push({ t: "reveal", player: frame.controller, cards: [card] });
          frame.repeat = 0;
        } else if (instr.op === "lookTop" && instr.deploy) {
          // "You may deploy 1 Unit card … among them": only with room in the battle area.
          if (c.s.players[frame.controller].battle.length < LIMITS.battle) {
            frame.looking = frame.looking!.filter((id) => id !== card);
            enterBattle(c, card);
          }
          frame.repeat = 0;
        } else {
          frame.looking = frame.looking!.filter((id) => id !== card);
          c.ev.push({ t: "reveal", player: frame.controller, cards: [card] });
          toHand(c, card);
          frame.repeat = (frame.repeat ?? 1) - 1;
        }
        return;
      case ARRANGE: {
        const arrange = instr.op === "lookTopArrange" ? instr : null;
        const rest = frame.looking!.filter((id) => id !== card);
        for (const id of rest) {
          if (arrange?.rest === "trash") toTrash(c, id, "mill");
          else {
            moveTo(c, id, "deck", "bottom");
            c.ev.push({ t: "toDeck", card: id, pos: "bottom", seenBy: frame.controller });
          }
        }
        if (card !== null && arrange?.keep === "hand") {
          c.ev.push({ t: "reveal", player: frame.controller, cards: [card] });
          toHand(c, card);
        }
        delete frame.looking;
        frame.pc++;
        return;
      }
      default: {
        // A target of "choose".
        if (card === null) {
          if (!(frame.vars[ch.as] ?? []).length && "fail" in instr) frame.pc = instr.fail;
          else frame.pc++;
          return;
        }
        frame.vars[ch.as] = [...(frame.vars[ch.as] ?? []), card];
        // Stay on the instruction: it offers the next target or moves on.
        if (ch.left <= 1) frame.pc++;
        return;
      }
    }
  }
  const instr = effectByRef(c, frame.ref).program[frame.pc]!;
  if (instr.op === "ask") {
    frame.pc = action.type === "yes" ? frame.pc + 1 : instr.to;
  } else if (instr.op === "pick" && action.type === "option") {
    frame.pc = instr.options[action.index]!.to;
  } else {
    throw new Error(`unexpected answer ${action.type} at ${instr.op}`);
  }
}
