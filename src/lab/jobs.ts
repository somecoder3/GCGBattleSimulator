// Simulation jobs of the lab server: one job at a time on worker threads; progress goes to every listener
// (Server-Sent Events), the finished (or stopped) run is saved in the store. The page can be closed and
// opened again while a job runs. Node only.

import { runPool, type ChunkWorker } from "../sim/pool";
import type { GameSummary, SimJob } from "../sim/runner";
import type { LabStore } from "./store";

export interface JobWorker extends ChunkWorker {
  close(): Promise<unknown>;
}

export interface JobStart {
  job: SimJob;
  /** Deck names by id (for the saved run). */
  names: Record<string, string>;
  /** Number of worker threads (default: all cores but one). */
  workers?: number;
  /** Name of the saved run (default: built from the job). */
  name?: string;
}

export type JobEvent =
  | { type: "progress"; done: number; total: number; games: GameSummary[]; elapsed: number }
  | { type: "done"; runId: number | null; done: number; total: number; elapsed: number; error?: string };

export interface JobState {
  id: number;
  job: SimJob;
  names: Record<string, string>;
  total: number;
  games: GameSummary[];
  startedAt: number;
  running: boolean;
  runId?: number | null;
  error?: string;
}

export function runName(job: SimJob, games: number): string {
  const label = !job.decks.length
    ? "Zufallsdecks"
    : `${job.decks.length} Decks${job.mode === "gauntlet" ? ` · Gauntlet ${job.focus}` : ""}`;
  return `${label} · ${job.ai.join(" / ")} · ${games} Spiele`;
}

export class JobManager {
  private current: JobState | undefined;
  private abort: AbortController | undefined;
  private listeners = new Set<(e: JobEvent) => void>();
  private nextId = 1;

  constructor(
    private readonly store: LabStore,
    private readonly makeWorker: () => JobWorker,
    private readonly version: () => string,
    private readonly defaultWorkers: number,
  ) {}

  /** The running job, or the last one (until the next starts). */
  get state(): JobState | undefined {
    return this.current;
  }

  subscribe(listener: (e: JobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: JobEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Starts a job; throws if one is running. Resolves when it has finished and was saved. */
  start(req: JobStart): { id: number; done: Promise<void> } {
    if (this.current?.running) throw new Error("Es läuft schon eine Simulation.");
    const { job } = req;
    const state: JobState = {
      id: this.nextId++,
      job,
      names: req.names,
      total: job.games,
      games: [],
      startedAt: Date.now(),
      running: true,
    };
    this.current = state;
    this.abort = new AbortController();
    const count = Math.max(1, Math.min(req.workers ?? this.defaultWorkers, job.games));
    const workers = Array.from({ length: count }, () => this.makeWorker());
    const version = this.version();
    const elapsed = () => (Date.now() - state.startedAt) / 1000;
    const done = (async () => {
      try {
        await runPool(job, workers, {
          signal: this.abort!.signal,
          onProgress: (n, total, latest) => {
            state.games.push(...latest);
            this.emit({ type: "progress", done: n, total, games: latest, elapsed: elapsed() });
          },
        });
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e);
      } finally {
        await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
      }
      state.games.sort((a, b) => a.index - b.index);
      state.runId = null;
      if (state.games.length) {
        try {
          state.runId = this.store.addRun({
            name: req.name ?? runName(job, state.games.length),
            createdAt: new Date().toISOString(),
            job,
            games: state.games,
            deckNames: req.names,
            codeVersion: version,
          });
        } catch (e) {
          state.error ??= `Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      state.running = false;
      this.emit({
        type: "done",
        runId: state.runId,
        done: state.games.length,
        total: state.total,
        elapsed: elapsed(),
        ...(state.error ? { error: state.error } : {}),
      });
    })();
    return { id: state.id, done };
  }

  /** Stops handing out chunks; the games played so far are saved. */
  stop(): boolean {
    if (!this.current?.running) return false;
    this.abort?.abort();
    return true;
  }
}
