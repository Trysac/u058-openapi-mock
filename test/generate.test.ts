import { describe, expect, it } from "vitest";
import { generateFromSchema } from "../src/index.js";

describe("generateFromSchema", () => {
  it("builds the documented object", () => {
    expect(
      generateFromSchema({
        type: "object",
        properties: {
          id: { type: "integer", minimum: 1 },
          name: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          born: { type: "string", format: "date-time" },
        },
      }),
    ).toEqual({
      id: 1,
      name: "string",
      tags: ["string"],
      born: "2024-01-01T00:00:00Z",
    });
  });

  it("prefers const, then the first enum value", () => {
    expect(generateFromSchema({ const: null, type: "string" })).toBeNull();
    expect(generateFromSchema({ const: { a: 1 } })).toEqual({ a: 1 });
    expect(generateFromSchema({ enum: ["b", "a"], type: "string" })).toBe("b");
    expect(generateFromSchema({ enum: [], type: "integer" })).toBe(0);
  });

  it("handles scalar types", () => {
    expect(generateFromSchema({ type: "integer" })).toBe(0);
    expect(generateFromSchema({ type: "integer", minimum: 1.5 })).toBe(2);
    expect(generateFromSchema({ type: "integer", minimum: -0.5 })).toBe(0);
    expect(generateFromSchema({ type: "number", minimum: -2.5 })).toBe(-2.5);
    expect(generateFromSchema({ type: "number", minimum: "x" })).toBe(0);
    expect(generateFromSchema({ type: "boolean" })).toBe(false);
    expect(generateFromSchema({ type: "null" })).toBeNull();
  });

  it("handles strings and formats", () => {
    expect(generateFromSchema({ type: "string" })).toBe("string");
    expect(generateFromSchema({ type: "string", minLength: 8 })).toBe("stringxx");
    expect(generateFromSchema({ type: "string", minLength: 2 })).toBe("string");
    expect((generateFromSchema({ type: "string", minLength: 10_000_000 }) as string).length).toBe(
      10_000,
    );
    expect(generateFromSchema({ type: "string", format: "date" })).toBe("2024-01-01");
    expect(generateFromSchema({ type: "string", format: "email" })).toBe("user@example.com");
    expect(generateFromSchema({ type: "string", format: "uuid" })).toBe(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(generateFromSchema({ type: "string", format: "custom" })).toBe("string");
  });

  it("handles arrays", () => {
    expect(generateFromSchema({ type: "array", minItems: 3, items: { type: "integer" } })).toEqual([
      0, 0, 0,
    ]);
    expect(generateFromSchema({ type: "array", minItems: 0, items: { type: "boolean" } })).toEqual([
      false,
    ]);
    expect(generateFromSchema({ type: "array" })).toEqual([null]);
    expect(generateFromSchema({ items: { type: "integer" } })).toEqual([0]);
  });

  it("fills required properties only when some are required", () => {
    const schema = {
      type: "object",
      required: ["b"],
      properties: { a: { type: "string" }, b: { type: "integer" } },
    };
    expect(generateFromSchema(schema)).toEqual({ b: 0 });
    expect(generateFromSchema({ properties: { a: { type: "boolean" } } })).toEqual({ a: false });
    expect(generateFromSchema({ type: "object" })).toEqual({});
  });

  it("uses the first non-null type for nullable and type arrays", () => {
    expect(generateFromSchema({ type: "string", nullable: true })).toBe("string");
    expect(generateFromSchema({ type: ["null", "integer"] })).toBe(0);
    expect(generateFromSchema({ type: ["null"] })).toBeNull();
    expect(generateFromSchema({ type: [] })).toBeNull();
  });

  it("uses the first branch of oneOf and anyOf", () => {
    expect(
      generateFromSchema({
        oneOf: [{ type: "string", format: "uuid" }, { type: "integer" }],
      }),
    ).toBe("00000000-0000-4000-8000-000000000000");
    expect(generateFromSchema({ anyOf: [{ type: "integer" }, { type: "string" }] })).toBe(0);
  });

  it("merges allOf objects", () => {
    expect(
      generateFromSchema({
        allOf: [
          { type: "object", properties: { a: { type: "integer" } } },
          { type: "object", properties: { b: { type: "string" } } },
        ],
        properties: { c: { type: "boolean" } },
      }),
    ).toEqual({ a: 0, b: "string", c: false });
    expect(generateFromSchema({ allOf: [{ type: "string" }] })).toBe("string");
    expect(generateFromSchema({ allOf: [{}, { type: "integer" }] })).toBe(0);
  });

  it("returns null for unknown shapes", () => {
    expect(generateFromSchema({})).toBeNull();
    expect(generateFromSchema(undefined)).toBeNull();
    expect(generateFromSchema(true)).toBeNull();
    expect(generateFromSchema({ type: "mystery" })).toBeNull();
  });

  it("stops at depth 5", () => {
    let schema: unknown = { type: "string" };
    for (let level = 0; level < 7; level += 1) {
      schema = { type: "object", properties: { c: schema } };
    }
    let node = generateFromSchema(schema) as Record<string, unknown>;
    for (let level = 0; level < 5; level += 1) {
      node = node.c as Record<string, unknown>;
    }
    expect(node).toEqual({ c: null });
  });

  it("resolves local refs and turns cycles into null", () => {
    const root = {
      components: {
        schemas: {
          Id: { type: "integer", minimum: 7 },
          Node: {
            type: "object",
            properties: {
              id: { $ref: "#/components/schemas/Id" },
              next: { $ref: "#/components/schemas/Node" },
            },
          },
        },
      },
    };
    expect(generateFromSchema({ $ref: "#/components/schemas/Node" }, root)).toEqual({
      id: 7,
      next: null,
    });
    expect(generateFromSchema({ $ref: "#/components/schemas/Id" })).toBeNull();
    expect(generateFromSchema({ $ref: "#/missing" }, root)).toBeNull();
  });

  it("bounds the amount of generated data", () => {
    let schema: unknown = { type: "string" };
    for (let level = 0; level < 5; level += 1) {
      schema = { type: "array", minItems: 100, items: schema };
    }
    expect(Array.isArray(generateFromSchema(schema))).toBe(true);
  });

  it("bounds composition nesting", () => {
    let schema: unknown = { type: "string" };
    for (let level = 0; level < 5000; level += 1) {
      schema = { oneOf: [schema] };
    }
    expect(generateFromSchema(schema)).toBeNull();
  });

  it("keeps __proto__ properties as own data", () => {
    const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}');
    const result = generateFromSchema(schema) as object;
    expect(Object.keys(result)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});
