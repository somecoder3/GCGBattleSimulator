// HTTP API of the lab server (plain node:http, no framework). Everything under /api; the rest of the
// requests go to Vite (the app). Node only.
//
// Security: the server listens on 127.0.0.1 only. Requests must name the lab itself as host (protects
// against DNS rebinding), and other pages may only call the API from known origins (CORS allow list):
// local development servers and the app on GitHub Pages. The app there reads the lab's decks.

import type { IncomingMessage, ServerResponse } from "node:http";
import { availableParallelism } from "node:os";
import type { JobEvent, JobManager, JobStart } from "./jobs";
import type { LabDeck, LabRun, LabStore } from "./store";

export const LAB_PORT = 5180;

/** Origins of other pages that may use the API (besides the lab itself). */
export function allowedOrigin(origin: string): boolean {
  if (origin === "https://somecoder3.github.io") return true;
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

function allowedHost(host: string | undefined): boolean {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

export interface ApiContext {
  store: LabStore;
  jobs: JobManager;
  version: () => string;
}

const MAX_BODY = 512 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "Zu groß."));
        req.destroy();
      } else parts.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString("utf8")) : undefined);
      } catch {
        reject(new HttpError(400, "Kein gültiges JSON."));
      }
    });
    req.on("error", reject);
  });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function isRun(x: unknown): x is LabRun {
  const r = x as Partial<LabRun>;
  return (
    !!r && typeof r.name === "string" && typeof r.createdAt === "string" && !!r.job && Array.isArray(r.games)
  );
}

function isDeck(x: unknown): x is LabDeck {
  const d = x as Partial<LabDeck>;
  return (
    !!d &&
    typeof d.id === "string" &&
    typeof d.name === "string" &&
    !!d.deck &&
    Array.isArray(d.deck.main) &&
    Array.isArray(d.deck.resources)
  );
}

/** Handles /api requests; returns false for everything else (the app). */
export function handleApi(ctx: ApiContext, req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/")) return false;

  if (!allowedHost(req.headers.host)) {
    send(res, 403, { error: "Unbekannter Host." });
    return true;
  }
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) {
    if (!allowedOrigin(origin)) {
      send(res, 403, { error: "Herkunft nicht erlaubt." });
      return true;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type",
      // Chrome's Private Network Access: public pages (GitHub Pages) asking a local server.
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return true;
  }

  route(ctx, req, res, url).catch((e: unknown) => {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) send(res, e.status, { error: e.message });
    else send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  });
  return true;
}

async function route(ctx: ApiContext, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const { store, jobs } = ctx;
  const path = url.pathname.slice("/api/".length).split("/");
  const method = req.method ?? "GET";
  const [area, id] = path;

  if (area === "lab" && method === "GET") {
    const cores = availableParallelism();
    return send(res, 200, {
      name: "gcg-battle-simulator-lab",
      version: ctx.version(),
      cores,
      workers: Math.max(1, cores - 1),
    });
  }

  if (area === "runs") {
    if (!id && method === "GET") return send(res, 200, store.runs());
    if (id === "import" && method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body) || !body.every(isRun)) throw new HttpError(400, "Erwartet: Liste von Läufen.");
      let imported = 0;
      for (const run of body) {
        if (store.hasRun(run.name, run.createdAt)) continue;
        store.addRun({ ...run, id: undefined } as LabRun);
        imported++;
      }
      return send(res, 200, { imported, skipped: body.length - imported });
    }
    const runId = Number(id);
    if (!Number.isInteger(runId)) throw new HttpError(404, "Unbekannter Lauf.");
    if (method === "GET") {
      const run = store.run(runId);
      if (!run) throw new HttpError(404, "Unbekannter Lauf.");
      return send(res, 200, run);
    }
    if (method === "DELETE") return send(res, store.deleteRun(runId) ? 200 : 404, {});
  }

  if (area === "games" && id === "find" && method === "GET") {
    const found = store.findGame(url.searchParams.get("hash") ?? "");
    return found ? send(res, 200, found) : send(res, 404, { error: "Kein Spiel mit diesem Hash." });
  }

  if (area === "jobs") {
    if (id === "current" && method === "GET") return send(res, 200, jobs.state ?? null);
    if (id === "stop" && method === "POST") return send(res, 200, { stopped: jobs.stop() });
    if (id === "events" && method === "GET") return events(jobs, req, res);
    if (!id && method === "POST") {
      const body = (await readBody(req)) as Partial<JobStart> | undefined;
      if (!body?.job || !Array.isArray(body.job.decks) || !body.job.games)
        throw new HttpError(400, "Erwartet: { job, names }.");
      try {
        const started = jobs.start({ ...body, job: body.job, names: body.names ?? {} });
        return send(res, 200, { id: started.id });
      } catch (e) {
        throw new HttpError(409, e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (area === "decks") {
    if (!id && method === "GET") return send(res, 200, store.decks());
    if (id && method === "PUT") {
      const body = await readBody(req);
      if (!isDeck(body) || body.id !== decodeURIComponent(id)) throw new HttpError(400, "Kein Deck.");
      store.putDeck(body);
      return send(res, 200, {});
    }
    if (id && method === "DELETE") return send(res, store.deleteDeck(decodeURIComponent(id)) ? 200 : 404, {});
  }

  if (area === "meta" && !id) {
    if (method === "GET") return send(res, 200, store.get("meta") ?? null);
    if (method === "PUT") {
      store.set("meta", await readBody(req));
      return send(res, 200, {});
    }
    if (method === "DELETE") {
      store.delete("meta");
      return send(res, 200, {});
    }
  }

  throw new HttpError(404, "Unbekannter Pfad.");
}

/** Server-Sent Events: first the current state, then progress and the end of jobs. */
function events(jobs: JobManager, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  const write = (e: JobEvent | { type: "state"; state: unknown }) =>
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  write({ type: "state", state: jobs.state ?? null });
  const off = jobs.subscribe(write);
  // A comment every 20 s keeps proxies and the browser from closing an idle stream.
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    off();
    clearInterval(ping);
  });
}
