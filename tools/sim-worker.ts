// Worker thread for `npm run sim`: plays the games of the chunks it receives.

import { parentPort } from "node:worker_threads";
import { Engine } from "../src/engine/engine";
import type { WorkerRequest, WorkerResponse } from "../src/sim/pool";
import { runRange } from "../src/sim/runner";
import { loadLib } from "./lib";

const engine = new Engine(loadLib());

parentPort!.on("message", (msg: WorkerRequest) => {
  if (msg.type !== "run") return;
  let response: WorkerResponse;
  try {
    response = { type: "result", id: msg.id, games: runRange(engine, msg.job, msg.from, msg.to) };
  } catch (error) {
    response = { type: "error", id: msg.id, message: error instanceof Error ? error.message : String(error) };
  }
  parentPort!.postMessage(response);
});
parentPort!.postMessage({ type: "ready" } satisfies WorkerResponse);
