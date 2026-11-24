// HTTP API of the sync server (plain node:http). It runs behind Caddy (HTTPS) on 127.0.0.1. Node only.
//
//   POST /api/auth/google  {credential}  → {token, user}   Google ID token from "Sign in with Google"
//   POST /api/auth/logout                                  ends this session
//   GET  /api/me                          → user
//   GET  /api/decks                       → SyncDeck[]     all decks of all users (incl. deleted markers)
//   PUT  /api/decks/:id   DeckUpload      → SyncDeck       own decks only; last change wins
//   GET  /api/health
//
// Signed in with "Authorization: Bearer <token>" (no cookies: the app runs on another site, and browsers
// block such third-party cookies). Only e-mail addresses on the allow list may sign in. CORS only for the
// app on GitHub Pages and local development servers.

import type { IncomingMessage, ServerResponse } from "node:http";
import { TokenError, verifyGoogleToken, type KeySource } from "./google";
import type { SyncStore } from "./store";
import { deckProblem, type DeckUpload, type SyncUser } from "./types";

export interface SyncConfig {
  store: SyncStore;
  clientId: string;
  /** E-mail addresses (lower case) that may sign in. */
  allowed: Set<string>;
  keys: KeySource;
  now?: () => number;
}

export function allowedOrigin(origin: string): boolean {
  if (origin === "https://somecoder3.github.io") return true;
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

/** Sign-in attempts per client address and minute (the only call that does real work without a session). */
const AUTH_PER_MINUTE = 20;

export function createSyncHandler(config: SyncConfig) {
  const now = config.now ?? Date.now;
  const attempts = new Map<string, { n: number; since: number }>();

  function limitAuth(req: IncomingMessage) {
    // Behind Caddy on the same machine: the client address is in X-Forwarded-For.
    const local = /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress ?? "");
    const forwarded = local
      ? String(req.headers["x-forwarded-for"] ?? "")
          .split(",")[0]
          ?.trim()
      : "";
    const ip = forwarded || req.socket.remoteAddress || "?";
    const t = now();
    const a = attempts.get(ip);
    if (!a || t - a.since > 60_000) attempts.set(ip, { n: 1, since: t });
    else if (++a.n > AUTH_PER_MINUTE) throw new HttpError(429, "Zu viele Anmeldeversuche.");
    if (attempts.size > 10_000) attempts.clear();
  }

  function user(req: IncomingMessage): SyncUser {
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
    const u = token ? config.store.session(token, now()) : undefined;
    if (!u) throw new HttpError(401, "Nicht angemeldet.");
    if (!config.allowed.has(u.email)) {
      config.store.signOut(token!);
      throw new HttpError(403, "Dieses Konto ist nicht freigeschaltet.");
    }
    return u;
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const [area, id, extra] = url.pathname.slice("/api/".length).split("/");
    const method = req.method ?? "GET";

    if (area === "health" && method === "GET") return send(res, 200, { ok: true });

    if (area === "auth" && id === "google" && method === "POST") {
      limitAuth(req);
      const body = (await readBody(req)) as { credential?: unknown } | undefined;
      if (typeof body?.credential !== "string" || body.credential.length > 8192)
        throw new HttpError(400, "Kein Token.");
      let identity;
      try {
        identity = await verifyGoogleToken(body.credential, config.clientId, config.keys, now());
      } catch (e) {
        if (e instanceof TokenError) throw new HttpError(401, e.message);
        throw e;
      }
      if (!config.allowed.has(identity.email))
        throw new HttpError(403, `${identity.email} ist nicht freigeschaltet.`);
      const u: SyncUser = { id: identity.sub, email: identity.email, name: identity.name };
      return send(res, 200, { token: config.store.signIn(u, now()), user: u });
    }

    if (area === "auth" && id === "logout" && method === "POST") {
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (token) config.store.signOut(token);
      return send(res, 200, { ok: true });
    }

    if (area === "me" && method === "GET") return send(res, 200, user(req));

    if (area === "decks" && !id && method === "GET") {
      user(req);
      return send(res, 200, config.store.decks());
    }

    if (area === "decks" && id && !extra && method === "PUT") {
      const u = user(req);
      const body = await readBody(req);
      const problem = deckProblem(body);
      if (problem) throw new HttpError(400, problem);
      const upload = body as DeckUpload;
      if (upload.id !== decodeURIComponent(id)) throw new HttpError(400, "Id passt nicht.");
      const result = config.store.put(u, upload);
      if (!result.ok)
        throw result.reason === "owner"
          ? new HttpError(403, "Das Deck gehört jemand anderem.")
          : new HttpError(409, "Zu viele Decks.");
      return send(res, 200, result.deck);
    }

    throw new HttpError(404, "Unbekannt.");
  }

  return function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "Unbekannt." });
    const origin = req.headers.origin;
    if (origin) {
      if (!allowedOrigin(origin)) return send(res, 403, { error: "Herkunft nicht erlaubt." });
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, PUT",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "3600",
      });
      res.end();
      return;
    }
    route(req, res, url).catch((e: unknown) => {
      if (res.headersSent) return void res.end();
      if (e instanceof HttpError) send(res, e.status, { error: e.message });
      else {
        console.error(e);
        send(res, 500, { error: "Serverfehler." });
      }
    });
  };
}
