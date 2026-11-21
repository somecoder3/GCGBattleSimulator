// Encrypted card images (user's decision, 21 Nov 2026).
//
// The official card images are published with the app only in encrypted form: `cards/<name>.bin`
// = 12-byte IV + AES-GCM-256 ciphertext of the WebP file. The key is fixed and part of the app, so this
// only keeps the images from lying around as plain files; anyone who reads the code can decrypt them.
// The user accepted that for this private project (a passphrase as in GCGScanner was offered).
//
// The IV is derived from the content (SHA-256 of the image), so rebuilding unchanged images gives
// byte-identical files (no churn in git). Works in the browser and in Node (Web Crypto).

const KEY = "rp0A3AoA9+v8kYmmXq3eY/5aOZvg7qoQqTNsr7GBNPg=";

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

let key: Promise<CryptoKey> | undefined;
function imageKey(): Promise<CryptoKey> {
  key ??= crypto.subtle.importKey("raw", fromBase64(KEY), "AES-GCM", false, ["encrypt", "decrypt"]);
  return key;
}

export async function encryptImage(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 12);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await imageKey(), bytes));
  const out = new Uint8Array(12 + data.length);
  out.set(iv);
  out.set(data, 12);
  return out;
}

export async function decryptImage(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(buffer);
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(0, 12) },
    await imageKey(),
    bytes.subarray(12),
  );
}

/**
 * Path of the encrypted file for an image path. There is one size only (the original): both
 * cards/small/GD01-001.webp and cards/full/GD01-001.webp → cards/GD01-001.bin; GD01-001.webp → GD01-001.bin.
 */
export const encryptedPath = (path: string) =>
  path.replace(/^cards\/(small|full)\//, "cards/").replace(/\.webp$/, ".bin");
