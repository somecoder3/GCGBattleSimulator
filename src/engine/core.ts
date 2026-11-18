// Shared engine internals: values with effects applied, filters and conditions, moving cards, damage,
// triggers and rules management. Used by engine.ts (turn flow) and interpret.ts (card effects).

import type { Cond, Effect, Filter, FlagName, KeywordName, TriggerKind } from "../effects/dsl";
import type { CompiledEffect } from "../effects/compile";
import { NO_KEYWORDS, satisfiesLink, type CardLib, type EngineCard, type Keywords } from "./cardlib";
import { shuffle } from "./rng";
import type {
  CardId,
  CardInstance,
  EffectRef,
  GameEndReason,
  GameEvent,
  GameState,
  PendingTrigger,
  PlayerId,
  ZoneName,
} from "./types";

export const LIMITS = {
  battle: 6, // 4-5-4
  base: 1, // 4-6-3
  resources: 15, // 4-4-2
  exResources: 5, // 4-4-2-1
  hand: 10, // 4-8-4
  shields: 6, // 6-2-2
  startHand: 5, // 6-2-1-5
} as const;

export const EX_BASE = "EXB-001";
export const EX_RESOURCE = "EXR-001";

export interface Ctx {
  lib: CardLib;
  s: GameState;
  ev: GameEvent[];
  /** Triggers raised since the last flush (10-1-6). */
  fresh: PendingTrigger[];
  /** Guards against static effects whose conditions depend on values that depend on static effects. */
  depth: number;
}

export const newCtx = (lib: CardLib, s: GameState): Ctx => ({ lib, s, ev: [], fresh: [], depth: 0 });
export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
export const inst = (c: Ctx, id: CardId): CardInstance => c.s.cards[id]!;
export const def = (c: Ctx, id: CardId): EngineCard => {
  const card = c.s.cards[id]!;
  return card.asUnit ? c.lib.unitForm(card.no, card.asUnit.ap, card.asUnit.hp) : c.lib.get(card.no);
};

// ---------------------------------------------------------------------------------------------
// Effects of a card

export interface ScriptEntry {
  ref: EffectRef;
  compiled: CompiledEffect;
}

/** All effects a card has where it is: its own, plus the Pilot-granted ones of a paired Unit. */
export function effectsOf(c: Ctx, id: CardId): ScriptEntry[] {
  const card = inst(c, id);
  const d = def(c, id);
  const out: ScriptEntry[] = [];
  d.script.compiled.forEach((compiled, idx) => {
    // Dormant effects only work when gained by another card ("It gains the following effect …").
    const e = compiled.effect;
    if ((e.kind === "trigger" || e.kind === "static") && e.dormant) return;
    out.push({ ref: { no: d.no, idx, granted: false }, compiled });
  });
  if (card.pilot !== null && card.zone === "battle") {
    const p = def(c, card.pilot);
    p.script.compiledGranted.forEach((compiled, idx) =>
      out.push({ ref: { no: p.no, idx, granted: true }, compiled }),
    );
  }
  // Effects gained from another card ("It gains the following effect during this battle", ST12-014).
  for (const m of c.s.modifiers) {
    if (m.target === id && m.effect) out.push({ ref: m.effect, compiled: effectByRef(c, m.effect) });
  }
  return out;
}

export function effectByRef(c: Ctx, ref: EffectRef): CompiledEffect {
  const script = c.lib.get(ref.no).script;
  const compiled = (ref.granted ? script.compiledGranted : script.compiled)[ref.idx];
  if (!compiled) throw new Error(`no effect ${ref.no}#${ref.idx}${ref.granted ? " (granted)" : ""}`);
  return compiled;
}

type StaticEffect = Extract<Effect, { kind: "static" }>;

/** Constant effects of all cards in play whose conditions hold (10-1-5). */
function activeStatics(c: Ctx): { source: CardId; effect: StaticEffect }[] {
  if (c.depth > 1) return [];
  c.depth++;
  try {
    const out: { source: CardId; effect: StaticEffect }[] = [];
    // Cards that gained an effect from another card (rare): their effects are looked up in full.
    let gained: Set<CardId> | null = null;
    for (const m of c.s.modifiers) if (m.effect && m.target >= 0) (gained ??= new Set()).add(m.target);
    for (const p of [0, 1] as const) {
      for (const list of [c.s.players[p].battle, c.s.players[p].base])
        for (const id of list) {
          const card = inst(c, id);
          if (
            !def(c, id).script.hasStatic &&
            !(card.pilot !== null && def(c, card.pilot).script.grantedHasStatic) &&
            !gained?.has(id)
          )
            continue;
          for (const { compiled } of effectsOf(c, id)) {
            const effect = compiled.effect;
            if (effect.kind !== "static") continue;
            if (effect.cond && !evalCond(c, effect.cond, id, inst(c, id).owner)) continue;
            out.push({ source: id, effect });
          }
        }
    }
    return out;
  } finally {
    c.depth--;
  }
}

function staticApplies(c: Ctx, st: { source: CardId; effect: StaticEffect }, id: CardId): boolean {
  const target = st.effect.target;
  if (target === "self") return st.source === id;
  const owner = inst(c, st.source).owner;
  // "rested Units with the lowest Lv.": compared among all matching cards.
  if (target.lowestLv || target.highestLv) return candidates(c, target, owner, st.source).includes(id);
  return matches(c, id, target, owner, st.source);
}

// ---------------------------------------------------------------------------------------------
// Values

function sumModifiers(c: Ctx, id: CardId, field: "ap" | "hp"): number {
  let sum = 0;
  for (const m of c.s.modifiers) if (m.target === id) sum += m[field];
  for (const st of activeStatics(c)) {
    if (st.effect[field] && staticApplies(c, st, id)) sum += st.effect[field]!;
    if (field === "ap" && st.effect.apPer && staticApplies(c, st, id)) {
      const owner = inst(c, st.source).owner;
      const found = candidates(c, st.effect.apPer.count, owner, st.source);
      const n = st.effect.apPer.unique ? new Set(found.map((x) => def(c, x).name)).size : found.length;
      sum += n * st.effect.apPer.per;
    }
    if (field === "ap" && st.effect.apFromDamage && staticApplies(c, st, id)) sum += inst(c, id).damage;
  }
  return sum;
}

export function apOf(c: Ctx, id: CardId): number {
  const card = inst(c, id);
  let ap = def(c, id).ap + sumModifiers(c, id, "ap");
  if (card.pilot !== null) ap += def(c, card.pilot).ap; // 3-3-8-1
  return Math.max(0, ap); // 1-3-6
}

export function hpOf(c: Ctx, id: CardId): number {
  const card = inst(c, id);
  let hp = def(c, id).hp + sumModifiers(c, id, "hp");
  if (card.pilot !== null) hp += def(c, card.pilot).hp;
  return Math.max(0, hp);
}

function addKeyword(k: Keywords, name: KeywordName, amount = 0): void {
  if (name === "breach" || name === "repair" || name === "support") k[name] += amount;
  else k[name] = true;
}

export function keywordsOf(c: Ctx, id: CardId): Keywords {
  const k: Keywords = { ...(def(c, id).keywords ?? NO_KEYWORDS) };
  for (const m of c.s.modifiers) if (m.target === id && m.keyword) addKeyword(k, m.keyword, m.amount);
  for (const st of activeStatics(c)) {
    if (!st.effect.keyword || !staticApplies(c, st, id)) continue;
    if (st.effect.keywordPer) {
      const n = candidates(c, st.effect.keywordPer, inst(c, st.source).owner, st.source).length;
      if (n > 0) addKeyword(k, st.effect.keyword, (st.effect.amount ?? 0) * n);
    } else addKeyword(k, st.effect.keyword, st.effect.amount);
  }
  return k;
}

/** Filters of a flag on a card (empty array = flag present without filter; null = absent). */
export function flagFilters(c: Ctx, id: CardId, flag: FlagName): Filter[] | null {
  let found = false;
  const filters: Filter[] = [];
  for (const m of c.s.modifiers) {
    if (m.target === id && m.flag === flag) {
      found = true;
      if (m.filter) filters.push(m.filter);
    }
  }
  for (const st of activeStatics(c)) {
    if (st.effect.flag === flag && staticApplies(c, st, id)) {
      found = true;
      const f = st.effect.flagFilter;
      if (f) filters.push(st.source === id ? f : resolveSelf(c, f, st.source));
    }
  }
  return found ? filters : null;
}

/** "… whose Lv. is equal to or lower than this Unit" in a filter applied to another card: as numbers. */
function resolveSelf(c: Ctx, f: Filter, self: CardId): Filter {
  if (f.lvMaxOf !== "self" && f.apMaxOf !== "self") return f;
  const out: Filter = { ...f };
  if (f.lvMaxOf === "self") {
    out.lvMax = def(c, self).level;
    delete out.lvMaxOf;
  }
  if (f.apMaxOf === "self") {
    out.apMax = apOf(c, self);
    delete out.apMaxOf;
  }
  return out;
}

export const hasFlag = (c: Ctx, id: CardId, flag: FlagName) => flagFilters(c, id, flag) !== null;

/** Amounts of a flag on a card (from effects and constant effects). */
export function flagAmounts(c: Ctx, id: CardId, flag: FlagName): number[] {
  const out: number[] = [];
  for (const m of c.s.modifiers) if (m.target === id && m.flag === flag) out.push(m.amount ?? 0);
  for (const st of activeStatics(c)) {
    if (st.effect.flag === flag && staticApplies(c, st, id)) out.push(st.effect.amount ?? 0);
  }
  return out;
}

/** Printed traits plus traits gained from constant effects ("All your Units gain (Neo Zeon)"). */
export function traitsOf(c: Ctx, id: CardId): string[] {
  const own = def(c, id).traits;
  const zone = inst(c, id).zone;
  if (zone !== "battle" && zone !== "base") return own;
  let out = own;
  for (const st of activeStatics(c)) {
    if (st.effect.traits && staticApplies(c, st, id)) out = [...out, ...st.effect.traits];
  }
  return out;
}

export function playerFlagFilters(c: Ctx, p: PlayerId, flag: FlagName): Filter[] {
  return c.s.modifiers
    .filter((m) => m.target === -1 && m.player === p && m.flag === flag)
    .map((m) => m.filter ?? {});
}

export function isLinked(c: Ctx, id: CardId): boolean {
  const card = inst(c, id);
  return card.pilot !== null && satisfiesLink(def(c, id), def(c, card.pilot));
}

// ---------------------------------------------------------------------------------------------
// Filters and conditions

const ZONE_OF: Record<Exclude<NonNullable<Filter["zone"]>, "pilots">, ZoneName[]> = {
  battle: ["battle"],
  hand: ["hand"],
  trash: ["trash"],
  resources: ["resources"],
  base: ["base"],
  shieldArea: ["shields", "base"],
  field: ["battle", "base"],
};

/** Does a card match a filter? Sides are relative to `controller`; `other` excludes `source`. */
export function matches(
  c: Ctx,
  id: CardId,
  f: Filter,
  controller: PlayerId,
  source: CardId | null,
  ignoreZone = false,
): boolean {
  const card = inst(c, id);
  const d = def(c, id);
  if (!ignoreZone) {
    if (f.zone === "pilots") {
      if (card.zone !== "pilot") return false;
    } else if (!ZONE_OF[f.zone ?? "battle"].includes(card.zone as ZoneName)) return false;
  }
  if (f.anyOf && !f.anyOf.some((g) => matches(c, id, g, controller, source, true))) return false;
  if (f.notKeyword && keywordsOf(c, id)[f.notKeyword]) return false;
  if (f.paidEx !== undefined && !!card.paidEx !== f.paidEx) return false;
  if (f.linkPilot && !d.link.some((l) => "pilotName" in l && l.pilotName.includes(f.linkPilot!)))
    return false;
  if (f.lvMaxPlus && d.level > candidates(c, f.lvMaxPlus.count, controller, source).length + f.lvMaxPlus.plus)
    return false;
  if (f.side === "friendly" && card.owner !== controller) return false;
  if (f.side === "enemy" && card.owner === controller) return false;
  if (f.types && !f.types.includes(d.type)) return false;
  if (f.other && id === source) return false;
  if (f.notBattling && c.s.battle && (id === c.s.battle.attacker || id === c.s.battle.target)) return false;
  if (f.battlingSelf) {
    const b = c.s.battle;
    if (!b || source === null) return false;
    if (!((b.attacker === source && b.target === id) || (b.target === source && b.attacker === id)))
      return false;
  }
  if (f.battling) {
    const opp = battlingWith(c, id);
    if (opp === null || !matches(c, opp, f.battling, controller, source)) return false;
  }
  if (f.attacked && c.s.battle?.target !== id) return false;
  if (f.notColors && d.color && f.notColors.includes(d.color)) return false;
  if (f.anyKeyword) {
    const k = keywordsOf(c, id);
    if (!(k.blocker || k.firstStrike || k.highManeuver || k.suppression || k.breach || k.repair || k.support))
      return false;
  }
  if (
    f.hasDestroyed &&
    !effectsOf(c, id).some(({ compiled: { effect: e } }) => {
      // "【During Pair】【Destroyed】" of an unpaired Unit doesn't count (FAQ Q222).
      return e.kind === "trigger" && e.on === "destroyed" && (!e.cond || evalCond(c, e.cond, id, card.owner));
    })
  )
    return false;
  if (f.pairedWith) {
    const pilot = card.pilot;
    if (pilot === null || !matches(c, pilot, f.pairedWith, controller, source, true)) return false;
  }
  if (f.pilotOf) {
    if (card.zone !== "pilot" || card.pairedTo === null) return false;
    if (!matches(c, card.pairedTo, f.pilotOf, controller, source)) return false;
  }
  if (f.lvMaxOf === "self" && source !== null && d.level > def(c, source).level) return false;
  if (f.apMaxOf === "self" && source !== null) {
    const ap = card.zone === "battle" ? apOf(c, id) : d.ap;
    if (ap > apOf(c, source)) return false;
  }
  if (f.lvMin !== undefined && d.level < f.lvMin) return false;
  if (f.lvMax !== undefined && d.level > f.lvMax) return false;
  const inPlay = card.zone === "battle" || card.zone === "base";
  if (f.hpMin !== undefined || f.hpMax !== undefined) {
    // HP is the card's value; damage counters don't lower it (5-5-2).
    // The current HP: a damaged card counts with its HP minus the damage (FAQ Q96).
    const hp = inPlay ? hpOf(c, id) - card.damage : d.hp;
    if (f.hpMin !== undefined && hp < f.hpMin) return false;
    if (f.hpMax !== undefined && hp > f.hpMax) return false;
  }
  if (f.apMin !== undefined || f.apMax !== undefined) {
    const ap = inPlay ? apOf(c, id) : d.ap;
    if (f.apMin !== undefined && ap < f.apMin) return false;
    if (f.apMax !== undefined && ap > f.apMax) return false;
  }
  if (f.rested !== undefined && card.rested !== f.rested) return false;
  if (f.damaged !== undefined && card.damage > 0 !== f.damaged) return false;
  if (f.traits) {
    const traits = traitsOf(c, id);
    if (!f.traits.some((t) => traits.includes(t))) return false;
  }
  if (f.colors && (!d.color || !f.colors.includes(d.color))) return false;
  if (f.names && !f.names.some((n) => d.name.includes(n) || d.aliases.some((a) => a.includes(n))))
    return false;
  if (f.notNames && f.notNames.some((n) => d.name.includes(n))) return false;
  if (f.linked !== undefined && isLinked(c, id) !== f.linked) return false;
  if (f.paired !== undefined && (card.pilot !== null) !== f.paired) return false;
  if (f.token !== undefined && card.token !== f.token) return false;
  if (f.keyword) {
    const k = keywordsOf(c, id)[f.keyword];
    if (!k) return false;
  }
  return true;
}

/** Matching cards in the filter's zone (default: battle areas), Units in play by default. */
export function candidates(c: Ctx, f: Filter, controller: PlayerId, source: CardId | null): CardId[] {
  const filter: Filter = f.types || f.zone ? f : { ...f, types: ["UNIT", "UNIT TOKEN"] };
  if (filter.zone === "pilots") {
    const pilots: CardId[] = [];
    for (const p of [0, 1] as const) {
      for (const unit of c.s.players[p].battle) {
        const pilot = inst(c, unit).pilot;
        if (pilot !== null && matches(c, pilot, filter, controller, source)) pilots.push(pilot);
      }
    }
    return pilots;
  }
  const zones = ZONE_OF[filter.zone ?? "battle"];
  const out: CardId[] = [];
  for (const p of [0, 1] as const) {
    if (filter.side === "friendly" && p !== controller) continue;
    if (filter.side === "enemy" && p === controller) continue;
    for (const zone of zones) {
      if (zone === "hand" && p !== controller) continue; // the opponent's hand is private
      for (const id of c.s.players[p][zone]) if (matches(c, id, filter, controller, source)) out.push(id);
    }
  }
  if (filter.lowestLv && out.length) {
    const min = Math.min(...out.map((id) => def(c, id).level));
    return out.filter((id) => def(c, id).level === min);
  }
  if (filter.lowestHp && out.length) {
    const left = (id: CardId) => hpOf(c, id) - inst(c, id).damage; // current HP (FAQ Q224)
    const min = Math.min(...out.map(left));
    return out.filter((id) => left(id) === min);
  }
  if (filter.highestLv && out.length) {
    const max = Math.max(...out.map((id) => def(c, id).level));
    return out.filter((id) => def(c, id).level === max);
  }
  return out;
}

/** Does a card definition (no instance, e.g. a Command played this turn) match the card parts of a filter? */
function defMatches(d: EngineCard, f: Filter): boolean {
  if (f.types && !f.types.includes(d.type)) return false;
  if (f.traits && !f.traits.some((t) => d.traits.includes(t))) return false;
  if (f.colors && (!d.color || !f.colors.includes(d.color))) return false;
  if (f.names && !f.names.some((n) => d.name.includes(n))) return false;
  return true;
}

/** Was a mark "<kind>:<player>:<card no>" set this turn for a card matching the filter? */
export function markedThisTurn(c: Ctx, kind: string, p: PlayerId, f: Filter): boolean {
  const prefix = `${kind}:${p}:`;
  for (const [key, turn] of Object.entries(c.s.marks)) {
    if (turn !== c.s.turn || !key.startsWith(prefix)) continue;
    const no = key.slice(prefix.length);
    if (c.lib.has(no) && defMatches(c.lib.get(no), f)) return true;
  }
  return false;
}

export function mark(c: Ctx, kind: "cmd" | "ownDestroyed" | "paidFxNo", p: PlayerId, no: string): void {
  c.s.marks[`${kind}:${p}:${no}`] = c.s.turn;
}

/** Players' flags from effects ("friendly Units can't be destroyed by enemy effects"). */
export function playerHasFlag(c: Ctx, p: PlayerId, flag: FlagName): boolean {
  return c.s.modifiers.some((m) => m.target === -1 && m.player === p && m.flag === flag);
}

/** The card a Unit is battling (the attacker or its target), or null. */
export function battlingWith(c: Ctx, id: CardId): CardId | null {
  const b = c.s.battle;
  if (!b || b.target === "player") return null;
  if (b.attacker === id) return b.target;
  if (b.target === id) return b.attacker;
  return null;
}

export function evalCond(c: Ctx, cond: Cond, source: CardId, controller: PlayerId): boolean {
  if ("and" in cond) return cond.and.every((x) => evalCond(c, x, source, controller));
  if ("or" in cond) return cond.or.some((x) => evalCond(c, x, source, controller));
  if ("not" in cond) return !evalCond(c, cond.not, source, controller);
  if ("yourTurn" in cond) return (c.s.active === controller) === cond.yourTurn;
  if ("count" in cond) {
    const n = candidates(c, cond.count, controller, source).length;
    return n >= (cond.min ?? (cond.max === undefined ? 1 : 0)) && (cond.max === undefined || n <= cond.max);
  }
  if ("selfAp" in cond) {
    const ap = apOf(c, source);
    return (
      (cond.selfAp.min === undefined || ap >= cond.selfAp.min) &&
      (cond.selfAp.max === undefined || ap <= cond.selfAp.max)
    );
  }
  if ("selfLinked" in cond) return isLinked(c, source) === cond.selfLinked;
  if ("pilotInPlay" in cond) {
    return c.s.players[controller].battle.some((id) => {
      const pilot = inst(c, id).pilot;
      return pilot !== null && matches(c, pilot, cond.pilotInPlay, controller, source, true);
    });
  }
  if ("selfIs" in cond) return matches(c, source, cond.selfIs, controller, source, true);
  if ("attackingPlayer" in cond) {
    const b = c.s.battle;
    return b !== null && b.attacker === source && b.target === "player";
  }
  if ("attackingUnit" in cond) {
    const b = c.s.battle;
    return b !== null && b.attacker === source && b.target !== "player";
  }
  if ("selfPilot" in cond) {
    const pilot = inst(c, source).pilot;
    return pilot !== null && matches(c, pilot, cond.selfPilot, controller, source, true);
  }
  if ("readiedResource" in cond) return c.s.marks[`readyRes:${controller}`] === c.s.turn;
  if ("level" in cond) {
    const n = c.s.players[controller].resources.length;
    return (
      (cond.level.min === undefined || n >= cond.level.min) &&
      (cond.level.max === undefined || n <= cond.level.max)
    );
  }
  if ("enemyPlayers" in cond) return 1 >= cond.enemyPlayers.min;
  if ("enemyTrash" in cond) {
    const n = c.s.players[other(controller)].trash.length;
    return (
      (cond.enemyTrash.min === undefined || n >= cond.enemyTrash.min) &&
      (cond.enemyTrash.max === undefined || n <= cond.enemyTrash.max)
    );
  }
  if ("battling" in cond) {
    const opp = battlingWith(c, source);
    return opp !== null && matches(c, opp, cond.battling, controller, source);
  }
  if ("pairedThisTurn" in cond) return c.s.marks[`paired:${source}`] === c.s.turn;
  if ("drewByEffect" in cond) return c.s.marks[`effectDraw:${controller}`] === c.s.turn;
  if ("enemyAttacked" in cond)
    return (c.s.marks[`attacked:${other(controller)}`] === c.s.turn) === cond.enemyAttacked;
  if ("selfPaidEx" in cond) return !!inst(c, source).paidEx;
  if ("paidForEffects" in cond) {
    const paid = c.s.marks[`paidFx:${controller}:${c.s.turn}`] ?? 0;
    return paid >= cond.paidForEffects;
  }
  if ("opponentDiscarded" in cond) return c.s.marks[`oppDiscarded:${controller}`] === c.s.turn;
  if ("battleVsUnit" in cond) return c.s.battle !== null && c.s.battle.target !== "player";
  if ("blockedBy" in cond) {
    const b = c.s.battle;
    return (
      b !== null &&
      b.attacker === source &&
      b.blocked &&
      b.target !== "player" &&
      matches(c, b.target, cond.blockedBy, controller, source)
    );
  }
  if ("hpLeft" in cond) {
    const left = hpOf(c, source) - inst(c, source).damage;
    return (
      (cond.hpLeft.min === undefined || left >= cond.hpLeft.min) &&
      (cond.hpLeft.max === undefined || left <= cond.hpLeft.max)
    );
  }
  if ("deployedThisTurn" in cond) return markedThisTurn(c, "deployed", controller, cond.deployedThisTurn);
  if ("paidForEffectOf" in cond) return markedThisTurn(c, "paidFxNo", controller, cond.paidForEffectOf);
  if ("destroyedBy" in cond) {
    const how = inst(c, source).destroyedBy;
    if (!how) return false;
    if (cond.destroyedBy.kind && how.kind !== cond.destroyedBy.kind) return false;
    if (cond.destroyedBy.traits) {
      if (!how.by || !c.lib.has(how.by)) return false;
      const t = c.lib.get(how.by).traits;
      if (!cond.destroyedBy.traits.some((x) => t.includes(x))) return false;
    }
    return true;
  }
  if ("played" in cond) return markedThisTurn(c, "cmd", controller, cond.played);
  if ("selfFrom" in cond) return inst(c, source).from === cond.selfFrom;
  if ("pairedKill" in cond) return c.s.marks[`pairedKill:${controller}`] === c.s.turn;
  if ("ownDestroyedBy" in cond) return markedThisTurn(c, "ownDestroyed", controller, cond.ownDestroyedBy);
  // Conditions about the running effect's variables are evaluated by the interpreter.
  if ("varGone" in cond || "varMatches" in cond || "varCount" in cond || "topCard" in cond) return false;
  if ("selfPaired" in cond) return (inst(c, source).pilot !== null) === cond.selfPaired;
  if ("nameInTrash" in cond) {
    return c.s.players[controller].trash.some((id) => def(c, id).name.includes(cond.nameInTrash));
  }
  if ("hand" in cond) {
    const p = cond.side === "friendly" ? controller : other(controller);
    const n = c.s.players[p].hand.length;
    return (
      (cond.hand.min === undefined || n >= cond.hand.min) &&
      (cond.hand.max === undefined || n <= cond.hand.max)
    );
  }
  if ("shields" in cond) {
    const players =
      cond.side === "any" ? [0, 1] : [cond.side === "friendly" ? controller : other(controller)];
    return players.some((p) => {
      const n = c.s.players[p as PlayerId].shields.length;
      return (
        (cond.shields.min === undefined || n >= cond.shields.min) &&
        (cond.shields.max === undefined || n <= cond.shields.max)
      );
    });
  }
  throw new Error(`unknown condition ${JSON.stringify(cond)}`);
}

// ---------------------------------------------------------------------------------------------
// Moving cards

export function createCard(c: Ctx, no: string, owner: PlayerId, zone: CardInstance["zone"]): CardInstance {
  const d = c.lib.get(no);
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
    token: d.token && d.type !== "RESOURCE",
  };
  c.s.cards.push(card);
  return card;
}

function zoneList(c: Ctx, card: CardInstance): CardId[] | null {
  if (card.zone === "pilot" || card.zone === "gone" || card.zone === "limbo") return null;
  return c.s.players[card.owner][card.zone];
}

export function detach(c: Ctx, card: CardInstance): void {
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

const FIELD: ReadonlySet<string> = new Set(["battle", "resources", "base", "shields"]);

/** Moves a card to another zone. It becomes a new card there (4-1-5): state and modifiers reset. */
export function moveTo(
  c: Ctx,
  id: CardId,
  zone: ZoneName | "limbo",
  position: "top" | "bottom" = "top",
): void {
  const card = inst(c, id);
  detach(c, card);
  c.s.modifiers = c.s.modifiers.filter((m) => m.target !== id);
  card.rested = false;
  card.damage = 0;
  delete card.asUnit;
  delete card.lastDamage;
  delete card.lastSource;
  delete card.from;
  delete card.paidEx;
  delete card.destroyedBy;
  if (card.token && !FIELD.has(zone) && zone !== "limbo") {
    card.zone = "gone"; // 5-17-2-5
    c.ev.push({ t: "removed", card: id });
    return;
  }
  card.zone = zone;
  if (zone === "limbo") return;
  const list = c.s.players[card.owner][zone];
  if (position === "top" || zone === "battle" || zone === "hand") list.unshift(id);
  else list.push(id);
  if (zone === "battle") card.enteredTurn = c.s.turn;
}

export type TrashReason = "destroyed" | "overflow" | "discard" | "shield" | "resolved" | "mill";

/** To the trash; a Unit's Pilot goes with it (3-3-6). */
export function toTrash(c: Ctx, id: CardId, reason: TrashReason): void {
  const card = inst(c, id);
  const pilot = card.pilot;
  moveTo(c, id, "trash");
  if (card.zone === "trash") c.ev.push({ t: "toTrash", card: id, reason });
  if (pilot !== null) {
    moveTo(c, pilot, "trash");
    c.ev.push({ t: "toTrash", card: pilot, reason: "paired" });
  }
}

/** Returns a card (and its Pilot) to its owner's hand (3-3-6). */
export function toHand(c: Ctx, id: CardId): void {
  const card = inst(c, id);
  const from = card.zone;
  const pilot = card.pilot;
  moveTo(c, id, "hand");
  if (card.zone === "hand") c.ev.push({ t: "toHand", card: id, from });
  if (pilot !== null) {
    moveTo(c, pilot, "hand");
    c.ev.push({ t: "toHand", card: pilot, from: "pilot" });
  }
}

/** Destroys a Unit or Base by an effect or damage: 【Destroyed】 triggers see it in its last location (13-2-8). */
export function destroy(c: Ctx, id: CardId, by: CardId | null = null): void {
  raise(c, "destroyed", id);
  if (inst(c, id).zone === "battle") raiseForPlayer(c, "allyDestroyedByEffect", inst(c, id).owner, id);
  c.ev.push({ t: "destroyed", card: id });
  toTrash(c, id, "destroyed");
  const card = inst(c, id);
  if (card.zone === "trash")
    card.destroyedBy = { kind: "effect", ...(by !== null ? { by: inst(c, by).no } : {}) };
}

export function draw(c: Ctx, p: PlayerId, n: number): void {
  const player = c.s.players[p];
  for (let i = 0; i < n && player.deck.length; i++) {
    const id = player.deck[0]!;
    moveTo(c, id, "hand");
    c.ev.push({ t: "draw", player: p, card: id });
  }
}

export function rest(c: Ctx, id: CardId): void {
  const card = inst(c, id);
  if (card.rested) return; // 1-3-2-1
  card.rested = true;
  c.ev.push({ t: "rest", card: id });
}

export function ready(c: Ctx, id: CardId): void {
  const card = inst(c, id);
  if (!card.rested || hasFlag(c, id, "cantReady")) return;
  card.rested = false;
  c.ev.push({ t: "ready", card: id });
}

export function activeResources(c: Ctx, p: PlayerId): CardId[] {
  return c.s.players[p].resources.filter((id) => !inst(c, id).rested);
}

/** Reduction of Lv. and cost of a card in the hand or trash (GD05-004 Akatsuki, GD06-050 Legend). */
function handDiscount(c: Ctx, p: PlayerId, id: CardId, forLevel = false): number {
  let discount = 0;
  const zone = inst(c, id).zone;
  for (const effect of def(c, id).script.effects) {
    if (effect.kind !== "handCost" || (effect.zone ?? "hand") !== zone) continue;
    if (forLevel && effect.costOnly) continue;
    if (effect.unless && evalCond(c, effect.unless, id, p)) continue;
    if (effect.when && !evalCond(c, effect.when, id, p)) continue;
    discount +=
      effect.fixed ?? (effect.count ? candidates(c, effect.count, p, id).length * (effect.per ?? 1) : 0);
  }
  return discount;
}

/** Lv. and cost to play a card from the hand. */
export function levelOf(c: Ctx, p: PlayerId, id: CardId): number {
  return Math.max(0, def(c, id).level - handDiscount(c, p, id, true));
}
export function costOf(c: Ctx, p: PlayerId, id: CardId): number {
  return Math.max(0, def(c, id).cost - handDiscount(c, p, id));
}

/** 2-9-1 (Lv. = number of Resources, active or rested) and 2-10-1 (cost = active Resources to rest). */
export function canPlay(c: Ctx, p: PlayerId, id: CardId): boolean {
  return (
    c.s.players[p].resources.length >= levelOf(c, p, id) && activeResources(c, p).length >= costOf(c, p, id)
  );
}

/** Pays a cost by resting active Resources; normal ones first, then EX Resources, which leave the game (5-17-3-2-3). */
export function pay(c: Ctx, p: PlayerId, cost: number): boolean {
  if (cost <= 0) return false;
  const active = activeResources(c, p);
  const used = [
    ...active.filter((id) => !inst(c, id).token),
    ...active.filter((id) => inst(c, id).token),
  ].slice(0, cost);
  if (used.length < cost) throw new Error("cannot pay cost");
  for (const id of used) rest(c, id);
  c.ev.push({ t: "pay", player: p, cards: used });
  const ex = used.filter((id) => inst(c, id).token);
  for (const id of ex) moveTo(c, id, "removal");
  if (ex.length) raiseForPlayer(c, "exResourceExiled", p, ex[0]!); // once per payment (FAQ Q485)
  return ex.length > 0;
}

export function placeExResource(c: Ctx, p: PlayerId, rested = false): void {
  const res = c.s.players[p].resources;
  const ex = res.filter((id) => inst(c, id).token).length;
  if (res.length >= LIMITS.resources || ex >= LIMITS.exResources) return;
  const card = createCard(c, EX_RESOURCE, p, "resources");
  card.rested = rested;
  res.push(card.id);
  c.ev.push({ t: "exResource", player: p, card: card.id });
  raiseForPlayer(c, "exResourcePlaced", p, card.id);
}

/** Puts a card into the battle area (deploy, 5-8) and raises its 【Deploy】 effects. The area must have room. */
export function enterBattle(c: Ctx, id: CardId, rested = false, asUnit?: { ap: number; hp: number }): void {
  const from = inst(c, id).zone;
  moveTo(c, id, "battle");
  const card = inst(c, id);
  card.from = from === "hand" || from === "trash" ? from : "other";
  if (asUnit) card.asUnit = asUnit;
  // "All Units that are Lv.3 or lower other than Unit tokens are deployed rested" (GD04-022).
  card.rested =
    rested || activeStatics(c).some((st) => st.effect.flag === "deployRested" && staticApplies(c, st, id));
  c.s.marks[`deployed:${card.owner}:${card.no}`] = c.s.turn;
  c.ev.push({ t: "deploy", player: card.owner, card: id });
  raise(c, "deploy", id);
  const me = c.s.players[card.owner];
  for (const ally of [...me.battle, ...me.base]) raise(c, "allyDeployed", ally, id);
}

/** Pairs a Pilot (or a Command with 【Pilot】) with a Unit and raises the pairing triggers (3-3, 13-2-9). */
export function pairPilot(c: Ctx, pilot: CardId, unit: CardId): void {
  const card = inst(c, pilot);
  detach(c, card);
  c.s.modifiers = c.s.modifiers.filter((m) => m.target !== pilot);
  card.rested = false;
  card.damage = 0;
  card.zone = "pilot";
  card.pairedTo = unit;
  inst(c, unit).pilot = pilot;
  c.s.marks[`paired:${unit}`] = c.s.turn;
  const link = isLinked(c, unit);
  const owner = inst(c, unit).owner;
  c.ev.push({ t: "pair", player: owner, card: pilot, unit, link });
  raise(c, "whenPaired", unit, null, pilot); // 13-2-9
  if (link) raise(c, "whenLinked", unit); // 13-2-11
  const me = c.s.players[owner];
  for (const ally of [...me.battle, ...me.base]) raise(c, "allyPaired", ally, unit);
  if (link) for (const ally of [...me.battle, ...me.base]) raise(c, "allyLinked", ally, unit);
}

export function deployBase(c: Ctx, id: CardId): void {
  const p = inst(c, id).owner;
  for (const old of [...c.s.players[p].base]) toTrash(c, old, "overflow"); // 11-5-2, not destroyed
  moveTo(c, id, "base");
  c.ev.push({ t: "deploy", player: p, card: id });
  raise(c, "deploy", id);
}

// ---------------------------------------------------------------------------------------------
// Damage, Shields, defeat

/**
 * Deals damage, after effects that change it: "increase the damage dealt" of the source's side, then
 * prevention and reduction of enemy (effect) damage on the target. `source`: the attacking/blocking Unit
 * or the card whose effect deals the damage.
 */
export function dealDamage(
  c: Ctx,
  id: CardId,
  amount: number,
  kind: "battle" | "effect",
  source: CardId | null = null,
): void {
  const target = inst(c, id);
  const fromEnemy = source !== null && inst(c, source).owner !== target.owner;
  // "This Base can't receive damage from enemy Units that are Lv.3 or lower" (ST07-015).
  if (fromEnemy && def(c, source).type.startsWith("UNIT")) {
    const shields = flagFilters(c, id, "noDamageFrom");
    if (shields?.some((f) => matches(c, source, f, target.owner, id))) return;
  }
  if (fromEnemy && amount > 0 && target.zone === "battle") amount += damageBoost(c, source);
  if (fromEnemy && kind === "effect") {
    if (hasFlag(c, id, "noEnemyEffectDamage")) amount = 0;
    if (flagFilters(c, id, "noEffectDamageFrom")?.some((f) => matches(c, source, f, target.owner, id, true)))
      amount = 0;
    amount -= reduction(c, id, "reduceEnemyEffectDamage", source);
    const ignore = flagAmounts(c, id, "ignoreEnemyEffectDamageUpTo");
    if (ignore.length && amount <= Math.max(...ignore)) amount = 0;
  }
  if (fromEnemy) amount -= reduction(c, id, "reduceEnemyDamage", source);
  if (fromEnemy && kind === "battle") amount -= reduction(c, id, "reduceEnemyBattleDamage", source);
  // "Reduce the next damage it receives by 2": used up by the first damage.
  const next = c.s.modifiers.findIndex((m) => m.target === id && m.flag === "reduceNextDamage");
  if (next >= 0 && amount > 0) {
    amount -= c.s.modifiers[next]!.amount ?? 0;
    c.s.modifiers.splice(next, 1);
  }
  if (amount <= 0) return; // 5-5-5
  target.damage += amount;
  target.lastDamage = kind;
  if (source !== null) target.lastSource = source;
  else delete target.lastSource;
  if (target.zone === "battle" || target.zone === "base") {
    raiseForPlayer(c, "allyDamaged", target.owner, id, { damageKind: kind, fromEnemy });
  }
  c.ev.push({ t: "damage", card: id, amount, kind });
}

/**
 * Sum of damage reductions of a kind on a card, from effects and constant effects whose filter (if any)
 * matches the damage source. 【Once per Turn】 constant reductions are used up when they apply.
 */
function reduction(c: Ctx, id: CardId, flag: FlagName, source: CardId): number {
  const owner = inst(c, id).owner;
  let sum = 0;
  for (const m of c.s.modifiers) {
    if (m.target !== id || m.flag !== flag) continue;
    if (m.filter && !matches(c, source, m.filter, owner, id, true)) continue;
    sum += m.amount ?? 0;
  }
  for (const st of activeStatics(c)) {
    if (st.effect.flag !== flag || !staticApplies(c, st, id)) continue;
    const f = st.effect.flagFilter;
    if (f && !matches(c, source, st.source === id ? f : resolveSelf(c, f, st.source), owner, id, true))
      continue;
    if (st.effect.once) {
      const key = `${st.source}:${flag}:once`;
      if (c.s.oncePerTurn[key] === c.s.turn) continue;
      c.s.oncePerTurn[key] = c.s.turn;
    }
    sum += st.effect.amount ?? 0;
  }
  return sum;
}

/** "When your (AEUG) cards deal damage to enemy Units, increase the damage dealt by 1" (GD06-033). */
function damageBoost(c: Ctx, source: CardId): number {
  const owner = inst(c, source).owner;
  let boost = 0;
  for (const st of activeStatics(c)) {
    if (st.effect.flag !== "boostDamage" || inst(c, st.source).owner !== owner) continue;
    if (!st.effect.flagFilter || matches(c, source, st.effect.flagFilter, owner, null, true)) {
      boost += st.effect.amount ?? 0;
    }
  }
  return boost;
}

/** Can `attacker` damage the shield area of `p` (e.g. ST02-013 Peaceful Timbre)? */
export function shieldAreaProtected(c: Ctx, p: PlayerId, attacker: CardId | null): boolean {
  if (attacker === null) return false;
  return playerFlagFilters(c, p, "protectShieldArea").some((f) => matches(c, attacker, f, p, null));
}

/**
 * Destroys the top `n` Shields (8-5-2-3-1, 13-1-7). A Shield with a 【Burst】 waits in limbo until its
 * owner decides (13-2-5); Bursts resolve before other triggered effects (10-1-6-8).
 */
export function breakShields(c: Ctx, p: PlayerId, n: number): void {
  for (const id of c.s.players[p].shields.slice(0, n)) {
    c.ev.push({ t: "shieldBreak", player: p, card: id });
    const burst = def(c, id).script.compiled.findIndex((e) => e.effect.kind === "burst");
    if (burst < 0) {
      toTrash(c, id, "shield");
      continue;
    }
    moveTo(c, id, "limbo");
    c.fresh.push({
      ref: { no: inst(c, id).no, idx: burst, granted: false },
      source: id,
      controller: p,
      event: null,
      origin: "burst",
    });
  }
}

/** Damage to the first card of a shield area: the Base if there is one, else the top Shield (13-1-2-2). */
/** An enemy Unit's effect damage (e.g. <Breach>) destroyed a shield area card of `p` (FAQ Q361, Q497). */
function shieldAreaKilledByEffect(c: Ctx, by: CardId, p: PlayerId): void {
  const unit = inst(c, by);
  if (unit.zone !== "battle" || unit.owner === p) return;
  raise(c, "destroysShieldAreaCard", by, null, undefined, true);
  raiseForPlayer(c, "allyDestroys", unit.owner, by, { victim: "shieldArea", damageKind: "effect" });
}

export function damageShieldArea(
  c: Ctx,
  p: PlayerId,
  amount: number,
  kind: "battle" | "effect",
  source: CardId | null = null,
): void {
  // "Your shield area cards can't receive damage from enemy Units …" also against their effects (FAQ Q151).
  if (
    kind === "effect" &&
    source !== null &&
    def(c, source).type.startsWith("UNIT") &&
    shieldAreaProtected(c, p, source)
  )
    return;
  if (kind === "effect" && source !== null && inst(c, source).owner !== p) {
    for (const f of c.s.modifiers) {
      if (f.target === -1 && f.player === p && f.flag === "reduceShieldAreaEffectDamage")
        amount -= f.amount ?? 0;
    }
  }
  if (amount <= 0) return;
  const player = c.s.players[p];
  if (player.base.length) dealDamage(c, player.base[0]!, amount, kind, source);
  else if (player.shields.length) {
    breakShields(c, p, 1);
    if (kind === "effect" && source !== null) shieldAreaKilledByEffect(c, source, p);
  }
}

export function endGame(c: Ctx, losers: PlayerId[], reason: GameEndReason): void {
  if (c.s.result) return;
  const winner = losers.length === 1 ? other(losers[0]!) : null;
  c.s.result = { winner, reason, turn: c.s.turn };
  c.s.step = "over";
  c.s.pending = null;
  c.ev.push({ t: "gameOver", result: c.s.result });
}

/** Rules management (11): defeat, then destruction, repeated until nothing changes. */
export function rulesManagement(c: Ctx): void {
  if (c.s.result) return;
  const deckOut = ([0, 1] as const).filter((p) => c.s.players[p].deck.length === 0); // 11-2-1-2
  if (deckOut.length) {
    endGame(c, deckOut, "deckOut");
    return;
  }
  for (;;) {
    // Destroyed simultaneously (8-5-3-2-3): collect first, then move.
    const doomed: CardId[] = [];
    for (const p of [0, 1] as const) {
      for (const id of [...c.s.players[p].battle, ...c.s.players[p].base]) {
        const card = inst(c, id);
        if (card.damage > 0 && card.damage >= hpOf(c, id)) doomed.push(id);
      }
    }
    if (!doomed.length) return;
    for (const id of doomed) raise(c, "destroyed", id);
    // "When this Unit destroys an enemy Unit with damage" also counts this Unit's effect damage (ST12-001).
    for (const id of doomed) {
      const card = inst(c, id);
      const by = card.lastSource;
      if (card.lastDamage !== "effect" || by === undefined || card.zone !== "battle") continue;
      if (inst(c, by).zone === "battle" && inst(c, by).owner !== card.owner) {
        raise(c, "destroysUnit", by, id, undefined, true);
        raiseForPlayer(c, "allyDestroys", inst(c, by).owner, by, { victim: "unit", damageKind: "effect" });
      }
    }
    for (const p of [0, 1] as const) {
      const base = c.s.players[p].base[0];
      if (base === undefined || !doomed.includes(base)) continue;
      const card = inst(c, base);
      if (card.lastDamage === "effect" && card.lastSource !== undefined)
        shieldAreaKilledByEffect(c, card.lastSource, p);
    }
    // "When an enemy Unit is destroyed with effect damage while this Unit is attacking" (ST13-012).
    const attacker = c.s.battle?.attacker;
    if (attacker !== undefined && inst(c, attacker).zone === "battle") {
      for (const id of doomed) {
        const card = inst(c, id);
        if (
          card.lastDamage === "effect" &&
          card.owner !== inst(c, attacker).owner &&
          card.zone === "battle"
        ) {
          raise(c, "enemyEffectKillWhileAttacking", attacker, id);
        }
      }
    }
    for (const id of doomed) {
      const card = inst(c, id);
      const how = {
        kind: card.lastDamage === "battle" ? "battle" : "effectDamage",
        by: card.lastSource,
      } as const;
      c.ev.push({ t: "destroyed", card: id });
      toTrash(c, id, "destroyed");
      if (card.zone === "trash") {
        card.destroyedBy = { kind: how.kind, ...(how.by !== undefined ? { by: inst(c, how.by).no } : {}) };
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Triggers

export const onceKey = (source: CardId, ref: EffectRef) =>
  `${source}:${ref.no}:${ref.idx}${ref.granted ? "g" : ""}`;

/** Raises the triggered effects of `kind` on a card (10-1-6). `pilot`: the Pilot for 【When Paired】. */
/** Details of an event for the trigger checks. */
export interface EventInfo {
  victim?: "unit" | "shieldArea";
  damageKind?: "battle" | "effect";
  fromEnemy?: boolean;
}

/** Events about one of a player's cards ("when one of your Units …"): `filter` and `self` select it. */
const ALLY_EVENTS: ReadonlySet<TriggerKind> = new Set([
  "allyDeployed",
  "allyPaired",
  "allyLinked",
  "allyDestroys",
  "allyDamaged",
  "allyRestedByEffect",
  "allyDestroyedByEffect",
  "unitAttacks",
  "effectPaid",
  "allyDealsBattleDamage",
]);

type TriggerEffect = Extract<Effect, { kind: "trigger" }>;

/** Does a trigger of `kind` on card `id` (controlled by `controller`) fire for this event? */
function triggerFits(
  c: Ctx,
  effect: TriggerEffect,
  kind: TriggerKind,
  id: CardId | null,
  controller: PlayerId,
  event: CardId | null,
  pilot: CardId | undefined,
  anyDamage: boolean,
  info: EventInfo,
): boolean {
  if (anyDamage && !effect.anyDamage) return false;
  if (effect.pilot && (pilot === undefined || !matches(c, pilot, effect.pilot, controller, id, true)))
    return false;
  if (ALLY_EVENTS.has(kind)) {
    const isSelf = event === id;
    const fits =
      event !== null &&
      !isSelf &&
      effect.filter !== undefined &&
      matches(c, event, effect.filter, controller, id, true);
    if (!(isSelf && effect.self) && !fits) return false;
  }
  if (effect.eventFilter && (event === null || !matches(c, event, effect.eventFilter, controller, id, true)))
    return false;
  if (effect.victim && effect.victim !== "card" && effect.victim !== info.victim) return false;
  if (effect.damageKind && effect.damageKind !== info.damageKind) return false;
  if (effect.fromEnemy && !info.fromEnemy) return false;
  if (effect.sourceFilter) {
    const by = event === null ? undefined : inst(c, event).lastSource;
    if (by === undefined || !matches(c, by, effect.sourceFilter, controller, id, true)) return false;
  }
  return true;
}

export function raise(
  c: Ctx,
  kind: TriggerKind,
  id: CardId,
  event: CardId | null = null,
  pilot?: CardId,
  /** Only effects that also count effect damage ("destroys an enemy Unit with damage"). */
  anyDamage = false,
  info: EventInfo = {},
): void {
  if (!mayTrigger(c, id, kind)) return;
  const controller = inst(c, id).owner;
  for (const { ref, compiled } of effectsOf(c, id)) {
    const effect = compiled.effect;
    if (effect.kind !== "trigger" || effect.on !== kind) continue;
    if (!triggerFits(c, effect, kind, id, controller, event, pilot, anyDamage, info)) continue;
    if (effect.cond && !evalCond(c, effect.cond, id, controller)) continue;
    if (effect.once && c.s.oncePerTurn[onceKey(id, ref)] === c.s.turn) continue;
    c.fresh.push({ ref, source: id, controller, event, origin: "trigger" });
  }
}

/** Fast check: can the card have a trigger of this kind (own, from its Pilot or gained)? */
function mayTrigger(c: Ctx, id: CardId, kind: TriggerKind): boolean {
  const card = inst(c, id);
  if (def(c, id).script.triggerKinds.has(kind)) return true;
  if (card.pilot !== null && def(c, card.pilot).script.grantedTriggerKinds.has(kind)) return true;
  return c.s.modifiers.some((m) => m.target === id && m.effect !== undefined);
}

/**
 * Raises an event for all cards in play of player `p`, plus effects the player gained for a while ("During
 * this turn, when one of your (Earth Federation) Units destroys …", GD04-002); those run with the event
 * card as their source.
 */
export function raiseForPlayer(
  c: Ctx,
  kind: TriggerKind,
  p: PlayerId,
  event: CardId | null,
  info: EventInfo = {},
  pilot?: CardId,
): void {
  const me = c.s.players[p];
  for (const id of [...me.battle, ...me.base]) raise(c, kind, id, event, pilot, false, info);
  for (const m of c.s.modifiers) {
    if (m.target !== -1 || m.player !== p || !m.effect) continue;
    const effect = effectByRef(c, m.effect).effect;
    if (effect.kind !== "trigger" || effect.on !== kind || event === null) continue;
    if (!triggerFits(c, effect, kind, null, p, event, pilot, false, info)) continue;
    if (effect.cond && !evalCond(c, effect.cond, event, p)) continue;
    const key = `p${p}:${m.effect.no}:${m.effect.idx}`;
    if (effect.once && c.s.oncePerTurn[key] === c.s.turn) continue;
    if (effect.once) c.s.oncePerTurn[key] = c.s.turn;
    c.fresh.push({ ref: m.effect, source: event, controller: p, event, origin: "trigger" });
  }
}

/**
 * Moves newly raised triggers to the front of the queue (10-1-6-7): Bursts first (10-1-6-8), then the
 * active player's, then the standby player's (10-1-6-6), each in the order they occurred.
 */
export function flushTriggers(c: Ctx): void {
  if (!c.fresh.length) return;
  const rank = (t: PendingTrigger) => (t.origin === "burst" ? 0 : t.controller === c.s.active ? 1 : 2);
  const sorted = c.fresh
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .map((x) => x.t);
  c.s.queue = [...sorted, ...c.s.queue];
  c.fresh = [];
}

/** Places cards at the bottom of their owner's deck in random order (5-13). */
export function shuffleIntoBottom(c: Ctx, ids: CardId[], seenBy?: PlayerId): void {
  for (const id of shuffle(c.s.rng, [...ids])) {
    moveTo(c, id, "deck", "bottom");
    c.ev.push({ t: "toDeck", card: id, pos: "bottom", ...(seenBy !== undefined ? { seenBy } : {}) });
  }
}
