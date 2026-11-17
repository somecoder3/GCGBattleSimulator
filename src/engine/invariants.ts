// Consistency checks that must hold after every engine step. Used by the fuzz tests and `npm run fuzz`.

import type { Engine } from "./engine";
import { LIMITS } from "./engine";
import type { CardId, GameState, ZoneName } from "./types";

const ZONES: ZoneName[] = [
  "deck",
  "resourceDeck",
  "resources",
  "battle",
  "shields",
  "base",
  "hand",
  "trash",
  "removal",
];

/** Returns a list of violated invariants (empty = consistent). */
export function checkInvariants(engine: Engine, s: GameState, expectedCards?: [number, number]): string[] {
  const errors: string[] = [];
  const seen = new Map<CardId, string>();

  for (const p of [0, 1] as const) {
    const player = s.players[p];
    for (const zone of ZONES) {
      for (const id of player[zone]) {
        const card = s.cards[id];
        if (!card) {
          errors.push(`unknown card ${id} in ${p}.${zone}`);
          continue;
        }
        if (seen.has(id)) errors.push(`card ${id} in ${seen.get(id)} and ${p}.${zone}`);
        seen.set(id, `${p}.${zone}`);
        if (card.zone !== zone) errors.push(`card ${id} listed in ${zone} but says ${card.zone}`);
        if (card.owner !== p) errors.push(`card ${id} of player ${card.owner} in zone of ${p}`);
      }
    }
    if (player.battle.length > LIMITS.battle) errors.push(`${p} has ${player.battle.length} Units`);
    if (player.base.length > LIMITS.base) errors.push(`${p} has ${player.base.length} Bases`);
    if (player.resources.length > LIMITS.resources)
      errors.push(`${p} has ${player.resources.length} Resources`);

    for (const id of player.battle) {
      const unit = s.cards[id]!;
      const type = engine.card(s, id).type;
      if (type !== "UNIT" && type !== "UNIT TOKEN") errors.push(`${type} ${id} in battle area`);
      if (unit.damage > 0 && unit.damage >= engine.hp(s, id) && !s.result) {
        errors.push(`Unit ${id} survives with ${unit.damage} damage and ${engine.hp(s, id)} HP`);
      }
      if (unit.pilot !== null) {
        const pilot = s.cards[unit.pilot]!;
        if (pilot.zone !== "pilot" || pilot.pairedTo !== id)
          errors.push(`Unit ${id} has broken pilot ${unit.pilot}`);
        if (seen.has(pilot.id)) errors.push(`pilot ${pilot.id} also in ${seen.get(pilot.id)}`);
        seen.set(pilot.id, `pilot of ${id}`);
      }
    }
  }

  const resolving = new Set([...s.frames.map((f) => f.source), ...s.queue.map((t) => t.source)]);
  for (const card of s.cards) {
    if (card.zone === "limbo") {
      if (!resolving.has(card.id)) errors.push(`card ${card.id} in limbo without an effect`);
      continue;
    }
    if (card.zone === "pilot" && !seen.has(card.id)) errors.push(`pilot ${card.id} not under a Unit`);
    if (card.zone === "gone" && !card.token) errors.push(`non-token ${card.id} removed from the game`);
    if (card.zone !== "gone" && !seen.has(card.id)) errors.push(`card ${card.id} (${card.zone}) is nowhere`);
  }

  if (expectedCards) {
    for (const p of [0, 1] as const) {
      const n = s.cards.filter((c) => c.owner === p && !c.token).length;
      if (n !== expectedCards[p]) errors.push(`player ${p} owns ${n} cards, expected ${expectedCards[p]}`);
    }
  }

  if (s.result && s.pending) errors.push("game over but a decision is pending");
  if (!s.result && !s.pending) errors.push("game is stuck without a decision");
  if (s.pending && s.frames.length > 0 !== (s.pending.kind === "effect")) {
    if (s.pending.kind === "effect" && s.pending.prompt !== "order")
      errors.push("effect decision without a running effect");
  }
  if (s.pending && s.pending.options.length === 0) errors.push("decision without options");
  return errors;
}
