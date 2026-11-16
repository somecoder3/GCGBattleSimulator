// Web Workers for the simulator page (src/sim/worker.ts), wrapped as ChunkWorkers for runPool.

import cardsUrl from "../../../gcgdb/data/cards.json?url";
import type { ChunkWorker, WorkerRequest, WorkerResponse } from "../../sim/pool";
import type { GameSummary } from "../../sim/runner";

export interface BrowserWorker extends ChunkWorker {
  terminate(): void;
}

export function defaultWorkerCount(): number {
  return Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
}

export function createWorkers(count: number): BrowserWorker[] {
  const url = new URL(cardsUrl, location.href).href;
  return Array.from({ length: count }, () => {
    const worker = new Worker(new URL("../../sim/worker.ts", import.meta.url), { type: "module" });
    const ready = new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === "ready") resolve();
        else if (event.data.type === "error" && event.data.id === -1) reject(new Error(event.data.message));
        else return;
        worker.removeEventListener("message", onMessage);
      };
      worker.addEventListener("message", onMessage);
    });
    worker.postMessage({ type: "init", cardsUrl: url } satisfies WorkerRequest);
    let nextId = 0;
    return {
      async run(job, from, to) {
        await ready;
        const id = nextId++;
        return new Promise<GameSummary[]>((resolve, reject) => {
          const onMessage = (event: MessageEvent<WorkerResponse>) => {
            const msg = event.data;
            if (msg.type === "ready" || msg.id !== id) return;
            worker.removeEventListener("message", onMessage);
            if (msg.type === "result") resolve(msg.games);
            else reject(new Error(msg.message));
          };
          worker.addEventListener("message", onMessage);
          // Svelte state proxies can't be cloned; the job is sent as plain data.
          worker.postMessage({
            type: "run",
            id,
            job: JSON.parse(JSON.stringify(job)),
            from,
            to,
          } satisfies WorkerRequest);
        });
      },
      terminate: () => worker.terminate(),
    };
  });
}
