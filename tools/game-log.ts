// Plays one game between two decks with the v1 AI and prints the log as seen by the first player.
//
//   npm run game -- M01 M02 3      decks (meta ids or ST01 …) and seed
//   npm run game -- M01 M02 3 --explain 13   also the values of v1's options in turn 13 (first player)
//
// Both AIs know their own deck and the field (the two decks), as in the simulator (runner.ts).
import type { LookaheadPolicy } from "../src/ai/lookahead";
import { makePolicy } from "../src/ai/registry";
import { actionLabel } from "../src/app/lib/actions";
import { cardName } from "../src/app/lib/gamelog";
import { describeSteps } from "../src/app/lib/gamelog";
import { Engine } from "../src/engine/engine";
import { STARTER_DECKS, TEST_DECKS } from "../src/data/decks";
import { metaDecks } from "../src/meta/decks";
import { GameSession } from "../src/sim/session";
import { loadLib, loadSnapshot } from "./lib";
const lib = loadLib();
const engine = new Engine(lib);
const decks = [...metaDecks(loadSnapshot(), lib, 99, "both"), ...STARTER_DECKS, ...TEST_DECKS];
const [a, b, seed] = [process.argv[2] ?? "M01", process.argv[3] ?? "M02", Number(process.argv[4] ?? 1)];
const find = (id: string) => {
  const deck = decks.find((d) => d.id === id.toUpperCase());
  if (!deck) throw new Error(`unknown deck ${id}`);
  return deck.deck;
};
const [da, db] = [find(a), find(b)];
const s = new GameSession(engine, { decks: [da, db], options: { seed, firstPlayer: 0 }, human: 0 });
const field = [
  { deck: da, weight: 1 },
  { deck: db, weight: 1 },
];
const ai = [
  makePolicy("heuristic-v1", engine, 1, undefined, { deck: da, field }),
  makePolicy("heuristic-v1", engine, 2, undefined, { deck: db, field }),
];
const explainAt = process.argv.includes("--explain")
  ? Number(process.argv[process.argv.indexOf("--explain") + 1])
  : -1;
const explained: string[] = [];
while (s.state.pending) {
  const p = s.state.pending.player;
  // Seat 0 is the "human" of the session (for the log's point of view), played by the AI as well.
  if (p === 0) {
    const pending = s.state.pending;
    if (s.state.turn === explainAt && "explain" in ai[0]! && pending.options.length > 1) {
      const name = (id: number) => cardName(engine, s.state, id, 0);
      const rows = (ai[0] as LookaheadPolicy).explain(s.view(), pending);
      explained.push(`Zug ${s.state.turn}, ${pending.kind}${pending.prompt ? `/${pending.prompt}` : ""}:`);
      for (const r of rows)
        explained.push(
          `  ${r.score.toFixed(3).padStart(9)}  ${actionLabel(r.option, name)} ${JSON.stringify(r.option)}`,
        );
    }
    s.apply(ai[0]!.choose(s.view(), pending));
  } else s.stepAI(ai[1]!);
}
for (const l of describeSteps(engine, s.steps, 0)) console.log((l.kind === "turn" ? "\n" : "  ") + l.text);
if (explained.length) console.log("\n" + explained.join("\n"));
