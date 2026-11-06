import { describe, expect, it } from "vitest";
import { createRng } from "../src/index.js";

describe("createRng", () => {
  it("is mulberry32", () => {
    const next = createRng(1);
    expect(next()).toBe(0.6270739405881613);
    expect(next()).toBe(0.002735721180215478);
    expect(next()).toBe(0.5274470399599522);
  });

  it("is deterministic and stays in [0, 1)", () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let index = 0; index < 100; index += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("handles negative and fractional seeds", () => {
    expect(createRng(-1)()).toBe(createRng(4294967295)());
    expect(createRng(1.9)()).toBe(createRng(1)());
  });

  it("rejects non-finite seeds", () => {
    expect(() => createRng(Number.NaN)).toThrow(RangeError);
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
