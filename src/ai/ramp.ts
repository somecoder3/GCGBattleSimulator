// Resources and EX Resources in the card effects (docs/AI.md "Ressourcen und EX Resources").
//
// Three roles, read from the compiled effects (own lines and the lines a Pilot gives its Unit):
// - makers: "Place 1 EX Resource" (Wing Gundam Bird Mode ST02-002, Re-GZ BWS, Nu Gundam GD05-020, G-Self,
//   Calibarn …) and "Place 1 (rested) Resource" (First Contact GD01-107, Gundam Deathscythe GD01-025,
//   Mutual Attraction GD05-106). Both raise the level (= number of Resources, EX Resources included), so
//   higher cards come earlier; a Resource stays, an EX Resource is gone once used to pay.
// - EX users: effects on placing an EX Resource (G-Exes, G-Bouncer, 9th Tactical Testing Sector), on using
//   one (Calibarn, Lfrith Ur/Thorn, Suletta GD04-085) or on paying a card with one (GD04-106, GD04-108,
//   GD05-118);
// - level goals: "while you are Lv.7 or higher" (Gundam AGE-1 Titus GD02-031, Spallow, Diva, AGE-1 Normal).

import type { Instr, Program } from "../effects/compile";
import type { Cond } from "../effects/dsl";
import type { EngineCard } from "../engine/cardlib";

/** When a maker's effect happens. */
export type RampWhen = "deploy" | "main" | "paired" | "linked" | "burst" | "other";

export interface RampSource {
  when: RampWhen;
  /** EX Resources and Resources one use places (for the controller). */
  ex: number;
  res: number;
  /** The program has conditions or questions before the placing (may not happen). */
  conditional: boolean;
  /** Index of the effect in compiled (or compiledGranted with `granted`). */
  idx: number;
  granted: boolean;
}

export type ExUse = "placed" | "spent" | "selfPaid";

export interface RampRole {
  sources: RampSource[];
  /** How the card's effects use EX Resources. */
  exUses: ExUse[];
  /** The lowest "Lv.N or higher" condition of the card's effects (undefined: none). */
  levelGoal?: number;
}

const roles = new WeakMap<EngineCard, RampRole>();

/** What a program places: EX Resources, Resources, and whether a condition or question comes first. */
export function rampIn(program: Program): {
  ex: number;
  res: number;
  /** EX Resources placed active (usable to pay this turn). */
  exActive: number;
  conditional: boolean;
} {
  let ex = 0;
  let exActive = 0;
  let res = 0;
  let gate = false;
  let conditional = false;
  for (const instr of program) {
    if (instr.op === "jumpUnless" || instr.op === "ask" || instr.op === "pick") gate = true;
    else if (instr.op === "exResource") {
      ex += instr.n;
      if (!instr.rested) exActive += instr.n;
      conditional ||= gate;
    } else if (instr.op === "placeResource") {
      res++;
      conditional ||= gate;
    }
  }
  return { ex, res, exActive, conditional };
}

/** The conditions (jumpUnless) before the first placing instruction. */
export function rampConds(program: Program): Cond[] {
  const out: Cond[] = [];
  for (const instr of program as Instr[]) {
    if (instr.op === "exResource" || instr.op === "placeResource") break;
    if (instr.op === "jumpUnless") out.push(instr.cond);
  }
  return out;
}

function levelMins(node: unknown, out: number[]): void {
  if (Array.isArray(node)) {
    for (const x of node) levelMins(x, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const level = o.level as { min?: unknown } | undefined;
  if (level && typeof level === "object" && typeof level.min === "number") out.push(level.min);
  for (const v of Object.values(o)) levelMins(v, out);
}

/** The roles of a card (cached per card). */
export function rampRole(card: EngineCard): RampRole {
  let role = roles.get(card);
  if (role) return role;
  const sources: RampSource[] = [];
  const uses = new Set<ExUse>();
  const goals: number[] = [];
  const lists = [
    { list: card.script.compiled, granted: false },
    { list: card.script.compiledGranted, granted: true },
  ];
  for (const { list, granted } of lists) {
    list.forEach(({ effect, program }, idx) => {
      if (effect.kind === "trigger" && effect.dormant) return;
      const found = rampIn(program);
      if (found.ex || found.res) {
        const when: RampWhen =
          effect.kind === "burst"
            ? "burst"
            : effect.kind === "command" && effect.timing.includes("main")
              ? "main"
              : effect.kind === "trigger" && effect.on === "deploy"
                ? "deploy"
                : effect.kind === "trigger" && effect.on === "whenPaired"
                  ? "paired"
                  : effect.kind === "trigger" && effect.on === "whenLinked"
                    ? "linked"
                    : "other";
        const conditional = found.conditional || ("cond" in effect && !!effect.cond);
        sources.push({ when, ex: found.ex, res: found.res, conditional, idx, granted });
      }
      if (effect.kind === "trigger" && effect.on === "exResourcePlaced") uses.add("placed");
      if (effect.kind === "trigger" && effect.on === "exResourceExiled") uses.add("spent");
      const json = JSON.stringify(effect);
      if (json.includes('"paidEx":true')) uses.add("spent");
      if (!granted && json.includes('"selfPaidEx"')) uses.add("selfPaid");
      levelMins(effect, goals);
    });
  }
  role = {
    sources,
    exUses: [...uses],
    ...(goals.length ? { levelGoal: Math.min(...goals) } : {}),
  };
  roles.set(card, role);
  return role;
}

/** Places EX Resources or Resources at all (any source, Burst included). */
export function makesEx(card: EngineCard): boolean {
  return rampRole(card).sources.some((s) => s.ex > 0);
}
export function makesResource(card: EngineCard): boolean {
  return rampRole(card).sources.some((s) => s.res > 0);
}
