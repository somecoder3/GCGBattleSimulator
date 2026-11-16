// Worker threads for simulations in Node (tools/sim-worker.ts, TypeScript through tsx).

import { Worker } from "node:worker_threads";
import type { ChunkWorker, WorkerResponse } from "../src/sim/pool";
import type { GameSummary } from "../src/sim/runner";

/** A worker thread running tools/sim-worker.ts. */
export function threadWorker(): ChunkWorker & { close(): Promise<number> } {
  const thread = new Worker(new URL("./sim-worker.ts", import.meta.url), { execArgv: ["--import", "tsx"] });
  const ready = new Promise<void>((resolve) => {
    const onReady = (msg: WorkerResponse) => {
      if (msg.type === "ready") {
        thread.off("message", onReady);
        resolve();
      }
    };
    thread.on("message", onReady);
  });
  let nextId = 0;
  return {
    async run(job, from, to) {
      await ready;
      const id = nextId++;
      return new Promise<GameSummary[]>((resolve, reject) => {
        const onMessage = (msg: WorkerResponse) => {
          if (msg.type === "ready" || msg.id !== id) return;
          thread.off("message", onMessage);
          if (msg.type === "result") resolve(msg.games);
          else reject(new Error(msg.message));
        };
        thread.on("message", onMessage);
        thread.postMessage({ type: "run", id, job, from, to });
      });
    },
    close: () => thread.terminate(),
  };
}
