// Seedable PRNG (xoshiro128**) whose state is a plain array, so it lives inside the serializable game
// state and a game replays exactly from its seed and the players' choices.

export type RngState = [number, number, number, number];

const rotl = (x: number, k: number) => (x << k) | (x >>> (32 - k));

/** Expands a 32-bit seed into a generator state with splitmix32. */
export function seedRng(seed: number): RngState {
  let s = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    out.push((z ^ (z >>> 16)) | 0);
  }
  if (!out.some((v) => v !== 0)) out[0] = 1;
  return out as RngState;
}

/** Next unsigned 32-bit value; advances `r` in place. */
export function nextU32(r: RngState): number {
  const result = Math.imul(rotl(Math.imul(r[1], 5), 7), 9) >>> 0;
  const t = r[1] << 9;
  r[2] ^= r[0];
  r[3] ^= r[1];
  r[1] ^= r[2];
  r[0] ^= r[3];
  r[2] ^= t;
  r[3] = rotl(r[3], 11);
  return result;
}

/** Integer in [0, n). */
export function nextInt(r: RngState, n: number): number {
  return Math.floor((nextU32(r) / 0x1_0000_0000) * n);
}

/** Fisher–Yates shuffle in place. */
export function shuffle<T>(r: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(r, i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export function pick<T>(r: RngState, items: readonly T[]): T {
  if (!items.length) throw new Error("pick from empty list");
  return items[nextInt(r, items.length)]!;
}
