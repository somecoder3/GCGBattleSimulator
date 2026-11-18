// Plays one game between two decks with the v1 AI and prints the log as seen by the first player.
//
//   npm run game -- M01 M02 3      decks (meta ids or ST01 …) and seed
import { makePolicy } from "../src/ai/registry";
import { describeSteps } from "../src/app/lib/gamelog";
import { Engine } from "../src/engine/engine";
import { STARTER_DECKS } from "../src/data/decks";
import { metaDecks } from "../src/meta/decks";
import { GameSession } from "../src/sim/session";
import { loadLib, loadSnapshot } from "./lib";
const lib = loadLib();
const engine = new Engine(lib);
const decks = [...metaDecks(loadSnapshot(), lib, 99, "both"), ...STARTER_DECKS];
const [a, b, seed] = [process.argv[2] ?? "M01", process.argv[3] ?? "M02", Number(process.argv[4] ?? 1)];
const find = (id: string) => {
  const deck = decks.find((d) => d.id === id.toUpperCase());
  if (!deck) throw new Error(`unknown deck ${id}`);
  return deck.deck;
};
const [da, db] = [find(a), find(b)];
const s = new GameSession(engine, { decks: [da, db], options: { seed, firstPlayer: 0 }, human: 0 });
const ai = [makePolicy("heuristic-v1", engine, 1), makePolicy("heuristic-v1", engine, 2)];
while (s.state.pending) {
  const p = s.state.pending.player;
  // Seat 0 is the "human" of the session (for the log's point of view), played by the AI as well.
  if (p === 0) s.apply(ai[0]!.choose(s.view(), s.state.pending));
  else s.stepAI(ai[1]!);
}
for (const l of describeSteps(engine, s.steps, 0)) console.log((l.kind === "turn" ? "\n" : "  ") + l.text);
