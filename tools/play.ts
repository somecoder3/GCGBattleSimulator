// Play a game turn by turn from the command line against an AI (for analysing the AI by hand).
// The game is kept in a JSON file (seed, decks, actions), every call replays it.
//
//   npm run play -- new <file> <myDeck> <aiDeck> <seed> [first: me|ai] [ai]   start a game
//   npm run play -- show <file>                                              state and options
//   npm run play -- <file> <option> [option …]                               decide (several in a row)
//   npm run play -- undo <file> [n]                                          take back n own decisions
//   npm run play -- cards <deck …>                                           card texts of decks

import { readFileSync, writeFileSync } from "node:fs";
import { makePolicy, parseAiName, type AiName } from "../src/ai/registry";
import { actionLabel, decisionText, primaryCard, secondary } from "../src/app/lib/actions";
import { cardName, describeSteps } from "../src/app/lib/gamelog";
import { STARTER_DECKS, TEST_DECKS } from "../src/data/decks";
import { Engine } from "../src/engine/engine";
import type { CardId, GameState, PlayerId } from "../src/engine/types";
import { metaDecks } from "../src/meta/decks";
import { GameSession, type SavedSession } from "../src/sim/session";
import { loadLib, loadPool, loadSnapshot } from "./lib";

const pool = loadPool();
const lib = loadLib();
const engine = new Engine(lib);
const meta = metaDecks(loadSnapshot(), lib);
const all = [...meta, ...STARTER_DECKS, ...TEST_DECKS];
const find = (id: string) => {
  const d = all.find((x) => x.id === id.toUpperCase());
  if (!d) throw new Error(`unknown deck ${id}`);
  return d;
};
const field = all.map((d) => ({ deck: d.deck, weight: "share" in d ? (d.share as number) : 0.01 }));

const [cmd, ...args] = process.argv.slice(2);

function cardsOf(ids: string[]) {
  for (const id of ids) {
    const d = find(id);
    const counts: Record<string, number> = {};
    for (const no of d.deck.main) counts[no] = (counts[no] ?? 0) + 1;
    console.log(`== ${d.id} ${d.name}`);
    for (const [no, n] of Object.entries(counts)) {
      const c = pool.get(no)!;
      const stats = c.type === "UNIT" ? ` ${c.ap}/${c.hp}` : "";
      console.log(
        `${n}x ${no} ${c.name} [${c.type} ${c.color ?? ""} Lv${c.level ?? "-"} C${c.cost ?? "-"}${stats}] ${c.traits.join(",")}${c.link ? ` link:${JSON.stringify(c.link)}` : ""}`,
      );
      if (c.text) console.log(`     ${c.text.replace(/\n/g, " / ")}`);
    }
  }
}

function load(file: string): GameSession {
  return GameSession.restore(engine, JSON.parse(readFileSync(file, "utf8")) as SavedSession);
}
function save(file: string, s: GameSession) {
  writeFileSync(file, JSON.stringify(s.save()));
}

function policyFor(s: GameSession) {
  return makePolicy(s.setup.ai ?? "search-strong", engine, s.setup.options.seed, undefined, {
    deck: s.setup.decks[s.human === 0 ? 1 : 0],
    field,
  });
}

/** Lets the AI play until the human has to decide; passes are not automatic (every choice is shown). */
function runAI(s: GameSession) {
  const ai = policyFor(s);
  while (s.aiToAct) s.stepAI(ai);
}

function show(s: GameSession, since: number) {
  const me = s.human;
  const view = s.view();
  const lines = describeSteps(engine, s.steps.slice(since), me);
  for (const l of lines) console.log((l.kind === "turn" ? "\n" : "  ") + l.text);
  console.log("");
  if (s.state.result) {
    const r = s.state.result;
    console.log(
      `=== GAME OVER: ${r.winner === me ? "I WIN" : r.winner === null ? "DRAW" : "AI WINS"} (${r.reason}), turn ${s.state.turn}`,
    );
    return;
  }
  board(view, me);
  const pending = s.state.pending!;
  const name = (id: CardId) => cardName(engine, s.state, id, me);
  console.log(`\n>> ${decisionText(pending, name)}`);
  pending.options.forEach((a, i) => {
    const card = primaryCard(a);
    const target = secondary(a);
    const extra = [
      card !== null ? `#${card} ${name(card)}` : "",
      target !== null ? `→ ${target === "player" ? "player" : `#${target} ${name(target)}`}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(`  [${i}] ${actionLabel(a, name)}${extra ? `  (${extra})` : ""}`);
  });
}

function board(v: GameState, me: PlayerId) {
  const desc = (id: CardId) => {
    const c = v.cards[id]!;
    const def = pool.get(c.no);
    let t = `${def?.name ?? c.no}`;
    if (def?.type === "UNIT" || c.asUnit) {
      const hp = engine.hp(v, id);
      t += ` ${engine.ap(v, id)}/${hp - c.damage}${c.damage ? `(${hp})` : ""}`;
      const k = engine.keywords(v, id);
      const kw = Object.entries(k)
        .filter(([, x]) => x)
        .map(([n, x]) => (typeof x === "number" ? `${n} ${x}` : n));
      if (kw.length) t += ` {${kw.join(",")}}`;
      if (c.pilot !== null)
        t += ` +${pool.get(v.cards[c.pilot]!.no)?.name}${engine.isLinked(v, id) ? " LINK" : ""}`;
      if (c.enteredTurn === v.turn) t += " (new)";
    } else if (def?.type === "BASE") {
      t += ` HP ${engine.hp(v, id) - c.damage}`;
    }
    if (c.rested) t += " [rested]";
    return `#${id} ${t}`;
  };
  for (const p of [me === 0 ? 1 : 0, me] as PlayerId[]) {
    const ps = v.players[p];
    const res = ps.resources.map((id) => v.cards[id]!);
    const active = res.filter((c) => !c.rested).length;
    const ex = res.filter((c) => c.no !== "R-001").length;
    console.log(
      `${p === me ? "ME " : "AI "} Lv${engine.level(v, p)} res ${active}/${res.length}${ex ? ` (EX ${ex})` : ""} | shields ${ps.shields.length} | deck ${ps.deck.length} | hand ${ps.hand.length} | trash ${ps.trash.length}`,
    );
    if (ps.base.length) console.log(`     base: ${ps.base.map(desc).join("; ")}`);
    if (ps.battle.length) console.log(`     units: ${ps.battle.map(desc).join("; ")}`);
    if (p === me) {
      console.log(
        `     hand: ${ps.hand
          .map((id) => {
            const d = pool.get(v.cards[id]!.no)!;
            return `#${id} ${d.name} (Lv${d.level ?? "-"} C${d.cost ?? "-"}${d.type === "UNIT" ? ` ${d.ap}/${d.hp}` : ` ${d.type}`})`;
          })
          .join("; ")}`,
      );
    }
  }
  console.log(`turn ${v.turn}, ${v.active === me ? "my" : "AI's"} turn, step ${JSON.stringify(v.step)}`);
}

if (cmd === "cards") {
  cardsOf(args);
} else if (cmd === "new") {
  const [file, mine, theirs, seed, first, ai] = args;
  const s = new GameSession(engine, {
    decks: [find(mine!).deck, find(theirs!).deck],
    options: { seed: Number(seed ?? 1), firstPlayer: first === "ai" ? 1 : 0 },
    human: 0,
    ai: parseAiName(ai ?? "search-strong") as AiName,
    deckNames: [mine!, theirs!],
  });
  runAI(s);
  save(file!, s);
  show(s, 0);
} else if (cmd === "show") {
  const s = load(args[0]!);
  board(s.view(), s.human);
  show(s, Math.max(0, s.steps.length - 1));
} else if (cmd === "history") {
  // My decisions with their action index (for `back`), turn and choice.
  const s = load(args[0]!);
  const name = (id: CardId) => cardName(engine, s.state, id, s.human);
  for (const step of s.steps) {
    if (step.player !== s.human || !step.action) continue;
    const card = primaryCard(step.action);
    const target = secondary(step.action);
    const what = [
      card !== null ? name(card) : "",
      target !== null ? `→ ${target === "player" ? "player" : name(target)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `${String(step.index).padStart(4)}  T${step.turn}  ${actionLabel(step.action, name)}${what ? ` (${what})` : ""}`,
    );
  }
} else if (cmd === "back") {
  // Back to the moment before my decision with this action index (same cards come again).
  const s = load(args[0]!);
  s.rollbackTo(Number(args[1]));
  runAI(s);
  save(args[0]!, s);
  board(s.view(), s.human);
  show(s, Math.max(0, s.steps.length - 1));
} else if (cmd === "undo") {
  const s = load(args[0]!);
  for (let i = 0; i < Number(args[1] ?? 1); i++) s.undo();
  runAI(s);
  save(args[0]!, s);
  show(s, Math.max(0, s.steps.length - 1));
} else {
  const file = cmd!;
  const s = load(file);
  const since = s.steps.length;
  for (const a of args) {
    if (!s.humanToAct) break;
    const i = Number(a);
    const options = s.state.pending!.options;
    if (!(i >= 0 && i < options.length)) {
      console.log(`(option ${a} not available, stopped)`);
      break;
    }
    s.apply(options[i]!);
    runAI(s);
  }
  save(file, s);
  show(s, since);
}
