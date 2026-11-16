// Test cards with exactly known values and a builder for game situations.

import type { CardDef, CardType, Color, LinkCondition } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { seedRng } from "../../src/engine/rng";
import type {
  Action,
  CardId,
  CardInstance,
  GameState,
  PlayerId,
  PlayerState,
  Step,
  ZoneName,
} from "../../src/engine/types";

interface DefSpec {
  type?: CardType;
  name?: string;
  color?: Color | null;
  level?: number | null;
  cost?: number | null;
  ap?: number | null;
  hp?: number | null;
  traits?: string[];
  link?: LinkCondition[];
  text?: string;
  token?: boolean;
}

function def(no: string, spec: DefSpec): CardDef {
  return {
    no,
    set: no.split("-")[0]!,
    name: spec.name ?? no,
    type: spec.type ?? "UNIT",
    color: spec.color === undefined ? "Blue" : spec.color,
    level: spec.level === undefined ? 1 : spec.level,
    cost: spec.cost === undefined ? 1 : spec.cost,
    ap: spec.ap === undefined ? 2 : spec.ap,
    hp: spec.hp === undefined ? 2 : spec.hp,
    zones: ["Space", "Earth"],
    traits: spec.traits ?? [],
    link: spec.link ?? [],
    sourceTitle: "",
    text: spec.text ?? "",
    printings: [{ id: no, alt: 0, rarity: "C", image: `${no}.webp` }],
    token: spec.token ?? false,
  };
}

/** Test card numbers (set "X"): stats are in the comment. */
export const CARDS = [
  def("X-VAN", { ap: 2, hp: 2 }), // filler
  def("X-23", { ap: 2, hp: 3 }),
  def("X-33", { ap: 3, hp: 3 }),
  def("X-55", { ap: 5, hp: 5, level: 5, cost: 4 }),
  def("X-AP0", { ap: 0, hp: 3 }),
  def("X-BLOCK", { ap: 1, hp: 3, text: "<Blocker> (Rest this Unit to change the attack target to it.)" }),
  def("X-FIRST", { ap: 3, hp: 1, text: "<First Strike>" }),
  def("X-HIGH", { ap: 2, hp: 2, text: "<High-Maneuver> (This Unit can't be blocked.)" }),
  def("X-SUPP", { ap: 2, hp: 2, text: "<Suppression>" }),
  def("X-BREACH", { ap: 3, hp: 3, text: "<Breach 2> (When this Unit's attack destroys …)" }),
  def("X-REPAIR", { ap: 1, hp: 4, text: "<Repair 2> (At the end of your turn …)" }),
  def("X-SUPPORT", { ap: 1, hp: 1, text: "【Activate･Main】<Support 2> (Rest this Unit. …)" }),
  def("X-LINKU", { ap: 3, hp: 3, link: [{ pilotName: "Amuro Ray" }] }),
  def("X-TRAITU", { ap: 3, hp: 3, link: [{ trait: "Newtype" }] }),
  def("X-AMURO", { type: "PILOT", name: "Amuro Ray", ap: 2, hp: 1 }),
  def("X-PILOT", { type: "PILOT", name: "Someone Else", ap: 1, hp: 2, traits: ["Newtype"] }),
  def("X-CMDPILOT", {
    type: "COMMAND",
    name: "Tactic",
    ap: 1,
    hp: 0,
    text: "【Main】Draw 1.\n【Pilot】[Amuro Ray]",
  }),
  def("X-BASE", { type: "BASE", ap: null, hp: 4, level: 2, cost: 1 }),
  def("X-HIGHLV", { ap: 4, hp: 4, level: 4, cost: 2 }),
  def("EXB-001", { type: "EX BASE", color: null, level: null, cost: null, ap: 0, hp: 3, token: true }),
  def("EXR-001", {
    type: "EX RESOURCE",
    color: null,
    level: null,
    cost: null,
    ap: null,
    hp: null,
    token: true,
  }),
  def("R-001", { type: "RESOURCE", color: null, level: null, cost: null, ap: null, hp: null, token: true }),
];

export const lib = new CardLib(CARDS);
export const engine = new Engine(lib);

export type UnitSpec =
  string | { no: string; rested?: boolean; damage?: number; pilot?: string; entered?: number };

export interface SideSpec {
  hand?: string[];
  battle?: UnitSpec[];
  /** Number of filler Shields, or card numbers from top to bottom. */
  shields?: number | string[];
  /** Base card number; null for no Base. Default: EX Base. */
  base?: string | null;
  baseDamage?: number;
  resources?: number;
  restedResources?: number;
  exResources?: number;
  /** Number of filler cards, or card numbers from top. */
  deck?: number | string[];
  resourceDeck?: number;
  trash?: string[];
}

export interface ScenarioSpec {
  turn?: number;
  active?: PlayerId;
  step?: Step;
  maxTurns?: number;
  p0?: SideSpec;
  p1?: SideSpec;
}

/** Builds a state directly (no setup phase) and runs it to the first decision. */
export function scenario(spec: ScenarioSpec = {}): GameState {
  const turn = spec.turn ?? 3;
  const s: GameState = {
    version: 1,
    seed: 1,
    rng: seedRng(1),
    maxTurns: spec.maxTurns ?? 100,
    firstPlayer: 0,
    turn,
    active: spec.active ?? 0,
    step: spec.step ?? "main",
    players: [player(0), player(1)],
    cards: [],
    modifiers: [],
    battle: null,
    priority: 0,
    passes: 0,
    oncePerTurn: {},
    pending: null,
    result: null,
  };
  const add = (owner: PlayerId, no: string, zone: ZoneName | "pilot", list?: CardId[]) => {
    const card: CardInstance = {
      id: s.cards.length,
      no,
      owner,
      zone,
      rested: false,
      damage: 0,
      pilot: null,
      pairedTo: null,
      enteredTurn: 0,
      token: lib.get(no).token && lib.get(no).type !== "RESOURCE",
    };
    s.cards.push(card);
    list?.push(card.id);
    return card;
  };
  for (const p of [0, 1] as const) {
    const side = (p === 0 ? spec.p0 : spec.p1) ?? {};
    const me = s.players[p];
    const list = (x: number | string[] | undefined, fallback: number) =>
      Array.isArray(x) ? x : Array<string>(x ?? fallback).fill("X-VAN");
    for (const no of list(side.deck, 20)) add(p, no, "deck", me.deck);
    for (let i = 0; i < (side.resourceDeck ?? 5); i++) add(p, "R-001", "resourceDeck", me.resourceDeck);
    for (const no of list(side.shields, 6)) add(p, no, "shields", me.shields);
    for (const no of side.hand ?? []) add(p, no, "hand", me.hand);
    for (const no of side.trash ?? []) add(p, no, "trash", me.trash);
    const resources = side.resources ?? 5;
    for (let i = 0; i < resources; i++) {
      add(p, "R-001", "resources", me.resources).rested = i < (side.restedResources ?? 0);
    }
    for (let i = 0; i < (side.exResources ?? 0); i++) add(p, "EXR-001", "resources", me.resources);
    const base = side.base === undefined ? "EXB-001" : side.base;
    if (base) add(p, base, "base", me.base).damage = side.baseDamage ?? 0;
    for (const u of side.battle ?? []) {
      const us = typeof u === "string" ? { no: u } : u;
      const card = add(p, us.no, "battle", me.battle);
      card.rested = us.rested ?? false;
      card.damage = us.damage ?? 0;
      card.enteredTurn = us.entered ?? turn - 1;
      if (us.pilot) {
        const pilot = add(p, us.pilot, "pilot");
        pilot.pairedTo = card.id;
        card.pilot = pilot.id;
      }
    }
  }
  engine.advance(s);
  return s;
}

function player(id: PlayerId): PlayerState {
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
    mulliganDone: true,
  };
}

/** Id of the n-th card with this number in a zone of a player. */
export function find(s: GameState, p: PlayerId, zone: ZoneName, no: string, n = 0): CardId {
  const ids = s.players[p][zone].filter((id) => s.cards[id]!.no === no);
  if (ids[n] === undefined) throw new Error(`no ${no} #${n} in ${p}.${zone}`);
  return ids[n]!;
}

export function options(s: GameState): Action[] {
  return s.pending?.options ?? [];
}

export function has(s: GameState, action: Action): boolean {
  return options(s).some((o) => JSON.stringify(o) === JSON.stringify(action));
}

/** Applies a legal action to the pending decision. */
export function act(s: GameState, action: Action) {
  return engine.apply(s, action);
}

export function nos(s: GameState, p: PlayerId, zone: ZoneName): string[] {
  return s.players[p][zone].map((id) => s.cards[id]!.no);
}
