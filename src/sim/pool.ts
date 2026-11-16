// Distributes the games of a job over workers (Node worker threads or browser Web Workers). Each
// worker pulls the next chunk of game indices as soon as it is free.

import { chunks, type GameSummary, type SimJob } from "./runner";

export interface ChunkWorker {
  run(job: SimJob, from: number, to: number): Promise<GameSummary[]>;
}

export interface PoolOptions {
  /** Called after each finished chunk with all results so far. */
  onProgress?: (done: number, total: number, latest: GameSummary[]) => void;
  /** Stops handing out chunks; results so far are returned. */
  signal?: AbortSignal;
}

export async function runPool(
  job: SimJob,
  workers: ChunkWorker[],
  options: PoolOptions = {},
): Promise<GameSummary[]> {
  if (!workers.length) throw new Error("no workers");
  const queue = chunks(job.games, workers.length);
  const results: GameSummary[] = [];
  let done = 0;
  await Promise.all(
    workers.map(async (worker) => {
      for (;;) {
        if (options.signal?.aborted) return;
        const next = queue.shift();
        if (!next) return;
        const summaries = await worker.run(job, next[0], next[1]);
        results.push(...summaries);
        done += summaries.length;
        options.onProgress?.(done, job.games, summaries);
      }
    }),
  );
  return results.sort((a, b) => a.index - b.index);
}

/** Message protocol of simulation workers. */
export type WorkerRequest =
  { type: "init"; cardsUrl: string } | { type: "run"; id: number; job: SimJob; from: number; to: number };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "result"; id: number; games: GameSummary[] }
  | { type: "error"; id: number; message: string };
