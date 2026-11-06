import { describe, expect, it } from "vitest";
import {
  createMockHandler,
  createRng,
  generateFromSchema,
  loadSpec,
  MockError,
  startServer,
} from "../src/index.js";

describe("public API", () => {
  it("exports the five functions", () => {
    for (const fn of [loadSpec, createMockHandler, generateFromSchema, createRng, startServer]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("MockError carries a stable code and a short message", () => {
    const error = new MockError("parse_error", "x".repeat(500));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MockError");
    expect(error.code).toBe("parse_error");
    expect(error.message.length).toBeLessThanOrEqual(200);
  });
});
