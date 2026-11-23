// How decks climb in level: Resources and EX Resources per own turn, placed by effects, used up or left
// over, and the turn the deck's highest Unit first comes down (docs/AI.md "Ressourcen und EX Resources").
//
//   npm run ramp -- --decks ST02,WINGX,AGEX,LBX,M01 --games 16      every pairing 16 games, v1
//   npm run ramp -- --decks ST02,WINGX --ai v0 --rules ramp,exPay,resourceValue
//   npm run ramp -- --decks ST02,ST02+ST02-009>GD01-107 --field M01,M02,M03,M04 --games 64
//       a deck with swaps (all copies of ST02-009 become GD01-107) against a fixed field; every deck plays
//       the same seeds against each field deck, so the rows compare pairwise
//
// Single thread (the machine may be in use); v1 needs ~0.2 s per game.

import { parseArgs } from "node:util";
import type { RuleOptions } from "../src/ai/heuristic";
import { makePolicy, parseAiName } from "../src/ai/registry";
import { rampPlan } from "../src/ai/synergy";
import { STARTER_DECKS, TEST_DECKS } from "../src/data/decks";
import { Engine } from "../src/engine/engine";
import type { DeckList, GameEvent, GameState, PlayerId, Step } from "../src/engine/types";
import { metaDecks } from "../src/meta/decks";
import { playMatch } from "../src/sim/match";
import { loadLib, loadSnapshot } from "./lib";

const { values: args } = parseArgs({
  options: {
    decks: { type: "string", default: "ST02,WINGX,ST14,AGEX,LBX,ACAX,M03,M01" },
    games: { type: "string", default: "16" },
    ai: { type: "string", default: "v1" },
    rules: { type: "string", default: "" },
    seed: { type: "string", default: "7" },
    turns: { type: "string", default: "7" },
    /** Fixed opponents: the decks above only play against these (both seats), with the same seeds. */
    field: { type: "string" },
  },
});

const lib = loadLib();
const engine = new Engine(lib);
const meta = metaDecks(loadSnapshot(), lib, Infinity, "consensus");
const known = [...meta, ...STARTER_DECKS, ...TEST_DECKS];
/** "ST02" or "ST02+ST02-009>GD01-107+…" (swap every copy). */
function deckOf(spec: string): { id: string; deck: DeckList } {
  const [base, ...swaps] = spec.split("+");
  const d = known.find((x) => x.id === base!.toUpperCase());
  if (!d) throw new Error(`unknown deck ${base}`);
  const map = Object.fromEntries(swaps.map((x) => x.toUpperCase().split(">") as [string, string]));
  for (const no of Object.values(map)) if (!lib.has(no)) throw new Error(`unknown card ${no}`);
  return { id: spec, deck: { ...d.deck, main: d.deck.main.map((no) => map[no] ?? no) } };
}
const decks = args.decks.split(",").map(deckOf);
const fieldDecks = args.field ? args.field.split(",").map(deckOf) : undefined;
const rules: RuleOptions = Object.fromEntries(
  args.rules
    .split(",")
    .filter(Boolean)
    .map((r) => [r, true]),
);
const ai = parseAiName(args.ai);
const TURNS = Number(args.turns);
const field = (fieldDecks ?? decks).map((d) => ({ deck: d.deck, weight: 1 }));

interface Tally {
  games: number;
  wins: number;
  /** Sum of levels at the start of the own main phase, per own turn (and how many games got there). */
  level: number[];
  levelN: number[];
  ex: number[];
  exByEffect: number;
  resByEffect: number;
  exLeft: number;
  exStart: number;
  /** Own turn the highest Unit of the deck first came down (sum, count). */
  top: number;
  topN: number;
}
const tallies = new Map<string, Tally>();
const tally = (id: string): Tally => {
  let t = tallies.get(id);
  if (!t) {
    t = {
      games: 0,
      wins: 0,
      level: Array<number>(TURNS).fill(0),
      levelN: Array<number>(TURNS).fill(0),
      ex: Array<number>(TURNS).fill(0),
      exByEffect: 0,
      resByEffect: 0,
      exLeft: 0,
      exStart: 0,
      top: 0,
      topN: 0,
    };
    tallies.set(id, t);
  }
  return t;
};

const started = performance.now();
let seed = 0;
let done = 0;
// Pairings: every deck against every other (both orders), or each deck against the fixed field.
const pairs: { a: { id: string; deck: DeckList }; b: { id: string; deck: DeckList }; key: number }[] = [];
if (fieldDecks) {
  for (const d of decks)
    fieldDecks.forEach((f, k) => {
      pairs.push({ a: d, b: f, key: 2 * k });
      pairs.push({ a: f, b: d, key: 2 * k + 1 });
    });
} else {
  for (let i = 0; i < decks.length; i++)
    for (let j = 0; j < decks.length; j++)
      if (i !== j) pairs.push({ a: decks[i]!, b: decks[j]!, key: pairs.length });
}
const fieldIds = new Set(fieldDecks?.map((f) => f.id) ?? []);
const total = pairs.length * Number(args.games);
for (const { a, b, key } of pairs) {
  for (let g = 0; g < Number(args.games); g++) {
    seed = Number(args.seed) + key * 10_000 + g;
    const seats = [a, b] as const;
    const policies = seats.map((d, p) =>
      makePolicy(ai, engine, seed * 2 + p, undefined, { deck: d.deck, field }, undefined, rules),
    ) as [ReturnType<typeof makePolicy>, ReturnType<typeof makePolicy>];
    const top = seats.map((d) => rampPlan(lib, d.deck).topUnit);
    const ownTurns: [number, number] = [0, 0];
    const topTurn: [number | null, number | null] = [null, null];
    let step: Step | undefined;
    let begun = false;
    // Field decks are not measured (their rows would mix all variants).
    const t = seats.map((d) => (fieldIds.has(d.id) && fieldDecks ? tally(`field:${d.id}`) : tally(d.id)));
    const onStep = (state: GameState, events: GameEvent[]) => {
      for (const e of events) {
        if (e.t === "turnStart") {
          begun = true;
          ownTurns[e.player]++;
        } else if (e.t === "step") {
          step = e.step;
          if (e.step === "main") {
            const p = state.active;
            const k = ownTurns[p] - 1;
            if (k >= 0 && k < TURNS) {
              const res = state.players[p].resources;
              t[p]!.level[k]! += res.length;
              t[p]!.levelN[k]!++;
              t[p]!.ex[k]! += res.filter((id) => state.cards[id]!.token).length;
            }
          }
        } else if (e.t === "exResource") {
          if (begun) t[e.player]!.exByEffect++;
          else t[e.player]!.exStart++;
        } else if (e.t === "resource" && begun && step !== "resource") {
          t[e.player]!.resByEffect++;
        } else if (e.t === "deploy") {
          const c = engine.card(state, e.card);
          if (c.type === "UNIT" && c.level >= top[e.player]! && topTurn[e.player] === null)
            topTurn[e.player] = ownTurns[e.player];
        }
      }
    };
    const first = (g % 2) as PlayerId;
    const record = playMatch(engine, [seats[0].deck, seats[1].deck], { seed, firstPlayer: first }, policies, {
      onStep,
    });
    for (const p of [0, 1] as const) {
      const x = t[p]!;
      x.games++;
      if (record.result.winner === p) x.wins++;
      else if (record.result.winner === null) x.wins += 0.5;
      x.exLeft += record.state.players[p].resources.filter((id) => record.state.cards[id]!.token).length;
      if (topTurn[p] !== null) {
        x.top += topTurn[p]!;
        x.topN++;
      }
    }
    done++;
    if (done % 20 === 0) process.stderr.write(`\r${done}/${total} Spiele   `);
  }
}
process.stderr.write(`\r${done} Spiele in ${((performance.now() - started) / 1000).toFixed(0)} s\n`);

const f1 = (x: number) => x.toFixed(1);
console.log(
  `KI ${ai}${args.rules ? ` (${args.rules})` : ""}, ${args.games} Spiele je Paarung; Level zu Beginn der eigenen Main Phase (davon EX)`,
);
console.log(
  `Deck   Sieg   ${Array.from({ length: TURNS }, (_, k) => `Zug ${k + 1}`.padStart(11)).join("")}  EX+Eff  Res+Eff  EX übrig  höchste Unit (Lv., Zug, in % der Spiele)`,
);
for (const d of decks) {
  const x = tallies.get(d.id)!;
  const cells = x.level.map((sum, k) => {
    const n = x.levelN[k]!;
    return n ? `${f1(sum / n)} (${f1(x.ex[k]! / n)})`.padStart(11) : "".padStart(11);
  });
  const g = x.games;
  console.log(
    `${d.id.padEnd(6)} ${f1((x.wins / g) * 100).padStart(5)} % ${cells.join("")}  ${f1(x.exByEffect / g).padStart(6)}  ${f1(x.resByEffect / g).padStart(7)}  ${f1(x.exLeft / g).padStart(8)}  Lv.${rampPlan(lib, d.deck).topUnit} Zug ${x.topN ? f1(x.top / x.topN) : "–"} (${f1((x.topN / g) * 100)} %)`,
  );
}
