import { describe, expect, it } from "vitest";
import { loadSpec, MockError } from "../src/index.js";
import { specText } from "./fixture.js";

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof MockError) {
      return error.code;
    }
    throw error;
  }
  return "none";
}

describe("loadSpec", () => {
  it("loads JSON", () => {
    const spec = loadSpec(specText);
    expect(spec.openapi).toBe("3.0.3");
    expect(Object.keys(spec.paths ?? {})).toContain("/pets/{id}");
  });

  it("loads YAML", () => {
    const text = [
      "openapi: 3.1.0",
      "paths:",
      "  /a:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: ok",
    ].join("\n");
    expect(loadSpec(text).openapi).toBe("3.1.0");
  });

  it("rejects invalid documents with parse_error", () => {
    expect(codeOf(() => loadSpec("openapi: [unclosed"))).toBe("parse_error");
    expect(codeOf(() => loadSpec(""))).toBe("parse_error");
    expect(codeOf(() => loadSpec("- a\n- b"))).toBe("parse_error");
    expect(codeOf(() => loadSpec("42"))).toBe("parse_error");
    expect(codeOf(() => loadSpec(5 as unknown as string))).toBe("parse_error");
  });

  it("rejects duplicate keys", () => {
    const text = '{"openapi":"3.0.0","openapi":"3.0.1"}';
    expect(codeOf(() => loadSpec(text))).toBe("parse_error");
  });

  it("limits YAML aliases", () => {
    const aliases = Array.from({ length: 150 }, () => "*x").join(", ");
    const text = `openapi: 3.0.0\nx: &x 1\ny: [${aliases}]`;
    expect(codeOf(() => loadSpec(text))).toBe("parse_error");
  });

  it("rejects oversized documents", () => {
    expect(codeOf(() => loadSpec("x".repeat(10_485_761)))).toBe("too_large");
  });

  it("counts bytes, not characters", () => {
    const text = "\u00e9".repeat(5_242_881);
    expect(codeOf(() => loadSpec(text))).toBe("too_large");
  });

  it("rejects other versions", () => {
    expect(codeOf(() => loadSpec('{"swagger":"2.0"}'))).toBe("unsupported_version");
    expect(codeOf(() => loadSpec('{"openapi":"3.2.0"}'))).toBe("unsupported_version");
    expect(codeOf(() => loadSpec('{"openapi":"3.0"}'))).toBe("unsupported_version");
    expect(codeOf(() => loadSpec('{"openapi":3}'))).toBe("unsupported_version");
  });

  it("accepts local references including escapes", () => {
    const doc = {
      openapi: "3.0.0",
      components: { schemas: { "A/B": { type: "string" }, "C D": {} } },
      x: [{ $ref: "#/components/schemas/A~1B" }, { $ref: "#/components/schemas/C%20D" }],
    };
    expect(loadSpec(JSON.stringify(doc)).openapi).toBe("3.0.0");
  });

  it("rejects missing and remote references", () => {
    const missing = '{"openapi":"3.0.0","x":{"$ref":"#/nope"}}';
    const remote = '{"openapi":"3.0.0","x":{"$ref":"http://example.test/a.json#/b"}}';
    expect(codeOf(() => loadSpec(missing))).toBe("unresolved_ref");
    expect(codeOf(() => loadSpec(remote))).toBe("unresolved_ref");
  });

  it("tolerates reference cycles", () => {
    const doc = {
      openapi: "3.0.0",
      components: {
        schemas: {
          A: { properties: { b: { $ref: "#/components/schemas/B" } } },
          B: { properties: { a: { $ref: "#/components/schemas/A" } } },
        },
      },
    };
    expect(loadSpec(JSON.stringify(doc)).openapi).toBe("3.0.0");
  });
});
