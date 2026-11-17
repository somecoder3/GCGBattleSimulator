// Builds the effect script of every card: manual script if there is one, else the compiled text.

import type { CardDef } from "../data/types";
import { compileEffect, type CompiledEffect } from "./compile";
import type { CardScript } from "./dsl";
import { MANUAL } from "./manual";
import { cleanLines, parseCard, type ParseContext } from "./parse";

export interface CompiledScript extends CardScript {
  compiled: CompiledEffect[];
  compiledGranted: CompiledEffect[];
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
  };
}
