// Fast deep copy of a game state. structuredClone is general but slow; the AI copies the state for
// every option it tries, so this copy knows the shape of GameState. Data that is never changed in
// place (filters of modifiers, options of a pending decision) is shared.

import type { Frame, GameState, PlayerState } from "./types";

function clonePlayer(p: PlayerState): PlayerState {
  return {
    id: p.id,
    deck: p.deck.slice(),
    resourceDeck: p.resourceDeck.slice(),
    resources: p.resources.slice(),
    battle: p.battle.slice(),
    shields: p.shields.slice(),
    base: p.base.slice(),
    hand: p.hand.slice(),
    trash: p.trash.slice(),
    removal: p.removal.slice(),
    mulliganDone: p.mulliganDone,
  };
}

function cloneFrame(f: Frame): Frame {
  const vars: Record<string, number[]> = {};
  for (const key in f.vars) vars[key] = f.vars[key]!.slice();
  const out: Frame = { ...f, ref: { ...f.ref }, vars };
  if (f.choosing) out.choosing = { ...f.choosing, candidates: f.choosing.candidates.slice() };
  if (f.looking) out.looking = f.looking.slice();
  return out;
}

export function cloneState(s: GameState): GameState {
  return {
    version: s.version,
    seed: s.seed,
    rng: [s.rng[0], s.rng[1], s.rng[2], s.rng[3]],
    maxTurns: s.maxTurns,
    firstPlayer: s.firstPlayer,
    turn: s.turn,
    active: s.active,
    step: s.step,
    players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])],
    cards: s.cards.map((c) => ({ ...c })),
    modifiers: s.modifiers.map((m) => ({ ...m })),
    battle: s.battle ? { ...s.battle } : null,
    priority: s.priority,
    passes: s.passes,
    oncePerTurn: { ...s.oncePerTurn },
    frames: s.frames.map(cloneFrame),
    queue: s.queue.map((t) => ({ ...t, ref: { ...t.ref } })),
    pending: s.pending ? { ...s.pending, options: s.pending.options.slice() } : null,
    result: s.result ? { ...s.result } : null,
  };
}
