// Cloud sync server (src/sync/): Google token checks, allow list, sessions, deck ownership, last change wins.

import { generateKeyPairSync, sign, type webcrypto } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSyncHandler } from "../../src/sync/api";
import { verifyGoogleToken, type KeySource } from "../../src/sync/google";
import { SyncStore } from "../../src/sync/store";
import type { DeckUpload, SyncDeck } from "../../src/sync/types";

const CLIENT = "test-client.apps.googleusercontent.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as webcrypto.JsonWebKey), kid: "k1" };
const keys: KeySource = (kid) => Promise.resolve(kid === "k1" ? jwk : undefined);
const NOW = Date.UTC(2026, 10, 24, 12);

function token(claims: Record<string, unknown>, key = privateKey, kid = "k1"): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "RS256", kid, typ: "JWT" });
  const body = enc({
    iss: "https://accounts.google.com",
    aud: CLIENT,
    iat: NOW / 1000,
    exp: NOW / 1000 + 3600,
    email_verified: true,
    ...claims,
  });
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
}
const dad = { sub: "111", email: "Dad@Example.com", name: "Papa" };
const son = { sub: "222", email: "son@example.com", name: "Sohn" };

describe("Google ID token", () => {
  const check = (t: string) => verifyGoogleToken(t, CLIENT, keys, NOW);
  it("accepts a valid token", async () => {
    await expect(check(token(dad))).resolves.toEqual({ sub: "111", email: "dad@example.com", name: "Papa" });
  });
  it("rejects wrong signature, audience, issuer, expiry and unverified addresses", async () => {
    await expect(check(token(dad, other.privateKey))).rejects.toThrow("Signatur");
    await expect(check(token({ ...dad, aud: "x" }))).rejects.toThrow("anderen App");
    await expect(check(token({ ...dad, iss: "evil.com" }))).rejects.toThrow("Aussteller");
    await expect(check(token({ ...dad, exp: NOW / 1000 - 120 }))).rejects.toThrow("abgelaufen");
    await expect(check(token({ ...dad, email_verified: false }))).rejects.toThrow("bestätigt");
    await expect(check(token(dad, privateKey, "k2"))).rejects.toThrow("Unbekannter Schlüssel");
    await expect(check("a.b")).rejects.toThrow("Kein gültiges");
  });
});

describe("sync API", () => {
  let server: Server;
  let base: string;
  const store = new SyncStore(":memory:");

  beforeAll(async () => {
    const handle = createSyncHandler({
      store,
      clientId: CLIENT,
      allowed: new Set(["dad@example.com", "son@example.com"]),
      keys,
      now: () => NOW,
    });
    server = createServer(handle);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => {
    server.close();
    store.close();
  });

  async function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
    const headers: Record<string, string> = {};
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${base}/${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & unknown[] };
  }
  async function signIn(who: typeof dad) {
    const r = await call("auth/google", { method: "POST", json: { credential: token(who) } });
    expect(r.status).toBe(200);
    return r.body.token as string;
  }
  const deck = (id: string, updatedAt: string, extra: Partial<DeckUpload> = {}): DeckUpload => ({
    id,
    name: `Deck ${id}`,
    deck: { main: ["ST01-001", "ST01-001"], resources: ["R-001"] },
    updatedAt,
    ...extra,
  });

  it("signs in allowed accounts only", async () => {
    const t = await signIn(dad);
    expect((await call("me", { token: t })).body).toMatchObject({ id: "111", name: "Papa" });
    const stranger = await call("auth/google", {
      method: "POST",
      json: { credential: token({ sub: "9", email: "x@example.com" }) },
    });
    expect(stranger.status).toBe(403);
    expect((await call("me")).status).toBe(401);
    expect((await call("me", { token: "nonsense" })).status).toBe(401);
  });

  it("lets everybody read, but only the owner change a deck", async () => {
    const tDad = await signIn(dad);
    const tSon = await signIn(son);
    const put = (t: string, d: DeckUpload) => call(`decks/${d.id}`, { method: "PUT", token: t, json: d });
    expect((await put(tDad, deck("u-a", "2026-11-24T10:00:00Z"))).status).toBe(200);
    expect((await put(tSon, deck("u-b", "2026-11-24T10:00:00Z", { copiedFrom: "u-a" }))).status).toBe(200);
    const all = (await call("decks", { token: tSon })).body as unknown as SyncDeck[];
    expect(all.map((d) => [d.id, d.ownerName])).toEqual([
      ["u-a", "Papa"],
      ["u-b", "Sohn"],
    ]);
    // The son may not change or delete his father's deck.
    expect((await put(tSon, deck("u-a", "2026-11-24T11:00:00Z", { name: "Meins" }))).status).toBe(403);
    // Older changes lose, newer ones win; deleting leaves a marker.
    const old = await put(tDad, deck("u-a", "2026-11-24T09:00:00Z", { name: "Alt" }));
    expect(old.body).toMatchObject({ name: "Deck u-a" });
    await put(tDad, deck("u-a", "2026-11-24T12:00:00Z", { deleted: true }));
    const after = (await call("decks", { token: tDad })).body as unknown as SyncDeck[];
    expect(after.find((d) => d.id === "u-a")).toMatchObject({ deleted: true });
    // Bad input.
    expect((await put(tDad, { ...deck("u-c", "x") })).status).toBe(400);
    expect(
      (await put(tDad, deck("u-c", "2026-11-24T12:00:00Z", { deck: { main: ["<b>"], resources: [] } })))
        .status,
    ).toBe(400);
    expect((await call("decks/u-x", { method: "PUT", token: tDad, json: deck("u-y", NOW_ISO) })).status).toBe(
      400,
    );
  });

  it("ends sessions on logout and for accounts taken off the allow list", async () => {
    const t = await signIn(dad);
    await call("auth/logout", { method: "POST", token: t });
    expect((await call("me", { token: t })).status).toBe(401);
    const t2 = await signIn(son);
    expect(store.dropSessionsExcept(new Set(["dad@example.com"]))).toBeGreaterThan(0);
    expect((await call("me", { token: t2 })).status).toBe(401);
  });

  it("answers only known origins (CORS)", async () => {
    const ok = await fetch(`${base}/health`, { headers: { Origin: "https://somecoder3.github.io" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://somecoder3.github.io");
    const bad = await fetch(`${base}/health`, { headers: { Origin: "https://evil.example" } });
    expect(bad.status).toBe(403);
  });
});

const NOW_ISO = new Date(NOW).toISOString();
