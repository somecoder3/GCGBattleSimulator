// Encrypted card images (src/data/imagecrypt.ts, tools/imagepack.ts).

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decryptImage, encryptImage, encryptedPath } from "../../src/data/imagecrypt";

describe("encrypted card images", () => {
  it("round-trips, gives the same bytes for the same image and fails for tampered files", async () => {
    const image = new TextEncoder().encode("RIFF....WEBPVP8 some image bytes");
    const a = await encryptImage(image);
    expect(await encryptImage(image)).toEqual(a);
    expect(new Uint8Array(await decryptImage(a.buffer))).toEqual(image);
    const tampered = a.slice();
    tampered[20]! ^= 1;
    await expect(decryptImage(tampered.buffer)).rejects.toThrow();
    expect(encryptedPath("cards/small/GD01-001_p1.webp")).toBe("cards/GD01-001_p1.bin");
    expect(encryptedPath("cards/full/GD01-001_p1.webp")).toBe("cards/GD01-001_p1.bin");
    expect(encryptedPath("GD01-001.webp")).toBe("GD01-001.bin");
  });

  it("decrypts the packed images to WebP files", async () => {
    const file = new URL("../../public/cards/ST01-001.bin", import.meta.url);
    if (!existsSync(file)) return; // packed with `npm run images:pack`
    const bytes = new Uint8Array(await decryptImage(new Uint8Array(readFileSync(file)).buffer));
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WEBP");
  });
});
