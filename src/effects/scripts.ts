// Builds the effect script of every card: manual script if there is one, else the compiled text.

import type { CardDef } from "../data/types";
import { compileEffect, type CompiledEffect } from "./compile";
import type { CardScript } from "./dsl";
import { MANUAL } from "./manual";
import { cleanLines, parseCard, type ParseContext } from "./parse";

export interface CompiledScript extends CardScript {
  compiled: CompiledEffect[];
  compiledGranted: CompiledEffect[];
  /** Trigger kinds of the card's own (not dormant) effects and of the effects it gives as a Pilot. */
  triggerKinds: ReadonlySet<string>;
  grantedTriggerKinds: ReadonlySet<string>;
  /** Has constant effects of its own / gives some as a Pilot (to skip cards quickly). */
  hasStatic: boolean;
  grantedHasStatic: boolean;
}

function triggerKinds(effects: CardScript["effects"]): ReadonlySet<string> {
  return new Set(effects.flatMap((e) => (e.kind === "trigger" && !e.dormant ? [e.on] : [])));
}

export function parseContext(cards: Iterable<CardDef>): ParseContext {
  const tokens = [...cards]
    .filter((c) => c.type === "UNIT TOKEN" || (c.type === "BASE" && c.token))
    .map((c) => ({ no: c.no, name: c.name, ap: c.ap ?? 0, hp: c.hp ?? 0 }));
  return { tokens };
}

export function buildScript(card: CardDef, ctx: ParseContext): CompiledScript {
  const manual = MANUAL[card.no];
  let script: CardScript;
  if (manual) {
    script = { ...manual, status: "manual", unsupported: [] };
  } else {
    const parsed = parseCard(card, ctx);
    const meaningful = cleanLines(card.text).filter((l) => !/^【Pilot】/.test(l));
    script = {
      effects: parsed.effects,
      granted: parsed.granted,
      unsupported: parsed.unsupported,
      status: parsed.unsupported.length ? "partial" : meaningful.length ? "auto" : "vanilla",
    };
  }
  return {
    ...script,
    compiled: script.effects.map(compileEffect),
    compiledGranted: script.granted.map(compileEffect),
    triggerKinds: triggerKinds(script.effects),
    grantedTriggerKinds: triggerKinds(script.granted),
    hasStatic: script.effects.some((e) => e.kind === "static" && !e.dormant),
    grantedHasStatic: script.granted.some((e) => e.kind === "static"),
  };
}
