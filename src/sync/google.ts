// Checks a Google ID token ("Sign in with Google", Google Identity Services) on the sync server: RS256
// signature against Google's public keys, issuer, audience (our OAuth client id), expiry and a verified
// e-mail address. No library: node:crypto reads the keys as JWK. Node only.

import { createPublicKey, verify, type webcrypto } from "node:crypto";

export const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
/** Clock difference we accept between Google and this server. */
const SKEW_S = 60;

export interface GoogleIdentity {
  /** Google's stable account id ("sub"). */
  sub: string;
  email: string;
  name: string;
}

type Jwk = webcrypto.JsonWebKey & { kid?: string };
export type KeySource = (kid: string) => Promise<Jwk | undefined>;

/** Google's keys, cached as long as Google's Cache-Control allows (at least 5 minutes). */
export function googleKeys(fetchFn: typeof fetch = fetch): KeySource {
  let keys: Jwk[] = [];
  let until = 0;
  return async (kid) => {
    const fresh = () => keys.find((k) => k.kid === kid);
    if (Date.now() < until && fresh()) return fresh();
    const response = await fetchFn(GOOGLE_CERTS);
    if (!response.ok) throw new Error(`Google-Schlüssel: HTTP ${response.status}`);
    keys = ((await response.json()) as { keys: Jwk[] }).keys;
    const maxAge = /max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1];
    until = Date.now() + Math.max(300, Number(maxAge ?? 0)) * 1000;
    return fresh();
  };
}

const b64 = (s: string) => Buffer.from(s, "base64url");

export class TokenError extends Error {}

/** The identity in a valid token; throws TokenError otherwise. */
export async function verifyGoogleToken(
  token: string,
  clientId: string,
  keys: KeySource,
  now = Date.now(),
): Promise<GoogleIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new TokenError("Kein gültiges Token.");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(b64(h).toString("utf8")) as typeof header;
    claims = JSON.parse(b64(p).toString("utf8")) as typeof claims;
  } catch {
    throw new TokenError("Kein gültiges Token.");
  }
  if (header.alg !== "RS256" || !header.kid) throw new TokenError("Unerwartetes Verfahren.");
  const jwk = await keys(header.kid);
  if (!jwk) throw new TokenError("Unbekannter Schlüssel.");
  const ok = verify(
    "RSA-SHA256",
    Buffer.from(`${h}.${p}`),
    createPublicKey({ key: jwk, format: "jwk" } as Parameters<typeof createPublicKey>[0]),
    b64(s),
  );
  if (!ok) throw new TokenError("Signatur ungültig.");

  const seconds = now / 1000;
  if (!ISSUERS.has(String(claims.iss))) throw new TokenError("Falscher Aussteller.");
  if (claims.aud !== clientId) throw new TokenError("Token gehört zu einer anderen App.");
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S < seconds)
    throw new TokenError("Token abgelaufen.");
  if (typeof claims.iat === "number" && claims.iat - SKEW_S > seconds)
    throw new TokenError("Token aus der Zukunft.");
  if (typeof claims.sub !== "string" || !claims.sub) throw new TokenError("Token ohne Konto.");
  if (typeof claims.email !== "string" || claims.email_verified !== true)
    throw new TokenError("E-Mail-Adresse nicht bestätigt.");
  const email = claims.email.toLowerCase();
  const name =
    typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email.split("@")[0]!;
  return { sub: claims.sub, email, name };
}
