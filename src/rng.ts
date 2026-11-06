/**
 * Creates a mulberry32 pseudo random generator.
 *
 * @param seed - Finite number; its integer part is used modulo 2^32.
 * @returns A function returning the next number in [0, 1).
 * @throws {RangeError} When `seed` is not finite.
 */
export function createRng(seed: number): () => number {
  if (!Number.isFinite(seed)) {
    throw new RangeError("seed must be a finite number");
  }
  let state = Math.trunc(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
