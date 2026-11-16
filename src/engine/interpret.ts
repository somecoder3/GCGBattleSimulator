// Runs compiled card effects (effects/compile.ts). An effect is a Frame on c.s.frames; it runs until it
// needs a player's choice (then c.s.pending is set and `answer` continues it) or until it ends.

import type { Ref } from "../effects/dsl";
import type { Instr } from "../effects/compile";
import {
  LIMITS,
  candidates,
  dealDamage,
  def,
  deployBase,
  destroy,
  draw,
  effectByRef,
  enterBattle,
  evalCond,
  inst,
  matches,
  moveTo,
  onceKey,
  other,
  placeExResource,
  ready,
  rest,
  rulesManagement,
  shuffleIntoBottom,
  toHand,
  toTrash,
  createCard,
  type Ctx,
} from "./core";
import type { Action, CardId, Decision, Frame, PendingTrigger } from "./types";

const OVERFLOW = "__overflow";
const DEPLOY = "__deploy";
const DISCARD = "__discard";
const LOOK = "__look";
const ARRANGE = "__arrange";

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
}

function ask(c: Ctx, frame: Frame, decision: Omit<Decision, "player" | "kind" | "source">): void {
  c.s.pending = { player: frame.controller, kind: "effect", source: frame.source, ...decision };
}

const YES_NO: Action[] = [{ type: "yes" }, { type: "no" }];

const IN_PLAY = ["battle", "base", "resources"];

/** Cards a reference stands for that are still where the effect can reach them (in play by default). */
function targets(c: Ctx, frame: Frame, ref: Ref, zones: string[] = IN_PLAY): CardId[] {
  const ids =
    ref === "self"
      ? [frame.source]
      : ref === "event"
        ? frame.event === null
          ? []
          : [frame.event]
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

/** Offers the current choice of `frame.choosing` to the controller. */
function offerChoice(c: Ctx, frame: Frame, prompt: Decision["prompt"]): void {
  const ch = frame.choosing!;
  const options: Action[] = (prompt === "discard" ? uniqueByNo(c, ch.candidates) : ch.candidates).map(
    (card): Action => ({ type: "target", card }),
  );
  if (ch.optional) options.push({ type: "done" });
  ask(c, frame, { prompt, options });
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
      frame.pc = evalCond(c, instr.cond, frame.source, me) ? frame.pc + 1 : instr.to;
      return;
    case "ask":
      ask(c, frame, { prompt: "may", options: YES_NO });
      return;
    case "pick":
      ask(c, frame, {
        prompt: "option",
        options: instr.options.map((o, index): Action => ({ type: "option", index, label: o.label })),
      });
      return;

    case "choose": {
      const as = instr.as ?? "it";
      const chosen = frame.vars[as] ?? [];
      const pool = candidates(c, instr.filter, me, frame.source).filter((id) => !chosen.includes(id));
      const left = (instr.count ?? 1) - chosen.length;
      const optional = !!(instr.may || instr.upTo);
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
      frame.choosing = { as, left, optional, candidates: pool };
      offerChoice(c, frame, "target");
      return;
    }
    case "all":
      frame.vars[instr.as ?? "it"] = candidates(c, instr.filter, me, frame.source);
      next();
      return;

    case "rest":
      for (const id of targets(c, frame, instr.t)) rest(c, id);
      return next();
    case "ready":
      for (const id of targets(c, frame, instr.t)) ready(c, id);
      return next();
    case "damage":
      for (const id of targets(c, frame, instr.t)) dealDamage(c, id, instr.amount, "effect");
      return next();
    case "destroy":
      for (const id of targets(c, frame, instr.t)) destroy(c, id);
      return next();
    case "bounce":
      for (const id of targets(c, frame, instr.t)) toHand(c, id);
      return next();
    case "toHand":
      for (const id of targets(c, frame, instr.t, [...IN_PLAY, "trash", "removal"])) toHand(c, id);
      return next();
    case "exile":
      for (const id of targets(c, frame, instr.t, [...IN_PLAY, "trash", "hand"])) {
        moveTo(c, id, "removal");
        c.ev.push({ t: "removed", card: id });
      }
      return next();
    case "toDeck":
      for (const id of targets(c, frame, instr.t)) {
        moveTo(c, id, "deck", instr.pos);
        c.ev.push({ t: "toDeck", card: id, pos: instr.pos });
      }
      return next();
    case "recover":
      for (const id of targets(c, frame, instr.t)) {
        const card = inst(c, id);
        const amount = Math.min(instr.amount, card.damage); // 5-6-2, 5-6-3
        if (amount > 0) {
          card.damage -= amount;
          c.ev.push({ t: "recover", card: id, amount });
        }
      }
      return next();
    case "mod":
      for (const id of targets(c, frame, instr.t)) {
        c.s.modifiers.push({
          target: id,
          ap: instr.ap ?? 0,
          hp: instr.hp ?? 0,
          until: instr.until,
          source: frame.source,
        });
        c.ev.push({ t: "modifier", card: id, ap: instr.ap ?? 0, hp: instr.hp ?? 0 });
      }
      return next();
    case "grant":
      for (const id of targets(c, frame, instr.t)) {
        c.s.modifiers.push({
          target: id,
          ap: 0,
          hp: 0,
          keyword: instr.keyword,
          ...(instr.amount ? { amount: instr.amount } : {}),
          until: instr.until,
          source: frame.source,
        });
      }
      return next();
    case "flag": {
      const base = {
        ap: 0,
        hp: 0,
        flag: instr.flag,
        ...(instr.filter ? { filter: instr.filter } : {}),
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
      draw(c, me, instr.n);
      return next();
    case "discard": {
      const left = frame.repeat ?? instr.n;
      const hand = c.s.players[me].hand;
      if (left <= 0 || !hand.length) {
        delete frame.repeat;
        return next();
      }
      frame.repeat = left;
      frame.choosing = { as: DISCARD, left: 1, optional: false, candidates: [...hand] };
      offerChoice(c, frame, "discard");
      return;
    }
    case "shieldToHand":
      for (const id of c.s.players[me].shields.slice(0, instr.n)) toHand(c, id);
      return next();
    case "exResource":
      for (let i = 0; i < instr.n; i++) placeExResource(c, me);
      return next();
    case "mill":
      for (const id of c.s.players[me].deck.slice(0, instr.n)) toTrash(c, id, "mill");
      return next();
    case "token": {
      let left = frame.repeat ?? instr.count ?? 1;
      while (left > 0) {
        if (!ensureRoom(c, frame)) {
          frame.repeat = left;
          return;
        }
        const token = createCard(c, instr.no, me, "limbo");
        c.ev.push({ t: "token", player: me, card: token.id });
        enterBattle(c, token.id, !!instr.rested);
        left--;
      }
      delete frame.repeat;
      return next();
    }

    case "lookTop": {
      frame.looking ??= c.s.players[me].deck.slice(0, instr.n);
      const pickable = instr.pick
        ? frame.looking.filter((id) =>
            matches(c, id, { ...instr.pick!, zone: undefined }, me, frame.source, true),
          )
        : [];
      const left = frame.repeat ?? instr.pickCount ?? 0;
      if (pickable.length && left > 0) {
        frame.repeat = left;
        frame.choosing = { as: LOOK, left: 1, optional: instr.may ?? false, candidates: pickable };
        offerChoice(c, frame, "lookPick");
        return;
      }
      shuffleIntoBottom(c, frame.looking);
      delete frame.looking;
      delete frame.repeat;
      return next();
    }
    case "lookTopArrange": {
      frame.looking ??= c.s.players[me].deck.slice(0, instr.n);
      if (frame.looking.length > 1) {
        frame.choosing = { as: ARRANGE, left: 1, optional: false, candidates: [...frame.looking] };
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
      if (!ensureRoom(c, frame)) return;
      delete frame.vars[DEPLOY];
      enterBattle(c, chosen);
      return next();
    }
    case "readyResource": {
      const rested = c.s.players[me].resources.filter((id) => inst(c, id).rested).slice(0, instr.n);
      for (const id of rested) ready(c, id);
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
    case "runMain": {
      next();
      const idx = def(c, frame.source).script.compiled.findIndex(
        (e) => e.effect.kind === "command" && e.effect.timing.includes("main"),
      );
      if (idx >= 0) {
        startEffect(c, {
          ref: { no: inst(c, frame.source).no, idx, granted: false },
          source: frame.source,
          controller: me,
          event: null,
          origin: "command",
        });
      }
      return;
    }
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
        moveTo(c, card!, "trash");
        c.ev.push({ t: "toTrash", card: card!, reason: "discard" });
        frame.repeat = (frame.repeat ?? 1) - 1;
        return;
      case LOOK:
        if (card === null) {
          frame.repeat = 0;
        } else {
          frame.looking = frame.looking!.filter((id) => id !== card);
          c.ev.push({ t: "reveal", player: frame.controller, cards: [card] });
          toHand(c, card);
          frame.repeat = (frame.repeat ?? 1) - 1;
        }
        return;
      case ARRANGE: {
        const rest = frame.looking!.filter((id) => id !== card);
        for (const id of rest) {
          moveTo(c, id, "deck", "bottom");
          c.ev.push({ t: "toDeck", card: id, pos: "bottom" });
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
