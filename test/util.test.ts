import { describe, expect, it } from "vitest";
import { problem } from "../src/problem.js";
import { deref, resolveRef, setOwn, truncate } from "../src/util.js";

describe("resolveRef", () => {
  const root = { a: [10, 20], "b/c": { d: 1 } };

  it("resolves local pointers", () => {
    expect(resolveRef(root, "#")).toBe(root);
    expect(resolveRef(root, "#/a/1")).toBe(20);
    expect(resolveRef(root, "#/b~1c/d")).toBe(1);
  });

  it("returns undefined for anything else", () => {
    expect(resolveRef(root, "x")).toBeUndefined();
    expect(resolveRef(root, "http://example.test/a#/a")).toBeUndefined();
    expect(resolveRef(root, "#/a/01")).toBeUndefined();
    expect(resolveRef(root, "#/a/x")).toBeUndefined();
    expect(resolveRef(root, "#/a/5")).toBeUndefined();
    expect(resolveRef(root, "#/nope")).toBeUndefined();
    expect(resolveRef(root, "#/%E0%A4%A")).toBeUndefined();
    expect(resolveRef({}, "#/__proto__")).toBeUndefined();
    expect(resolveRef({}, "#/constructor")).toBeUndefined();
  });
});

describe("deref", () => {
  it("follows chains and gives up on loops", () => {
    const root = { A: { $ref: "#/B" }, B: { v: 1 }, L: { $ref: "#/L" } };
    expect(deref(root, root.A)).toEqual({ v: 1 });
    expect(deref(root, 5)).toBe(5);
    expect(deref(root, root.L)).toBeUndefined();
    expect(deref(root, { $ref: "#/missing" })).toBeUndefined();
  });
});

describe("helpers", () => {
  it("truncate shortens long text", () => {
    expect(truncate("abc", 5)).toBe("abc");
    const long = truncate("x".repeat(250));
    expect(long.length).toBe(200);
    expect(long.endsWith("...")).toBe(true);
  });

  it("setOwn defines __proto__ as a plain property", () => {
    const target: Record<string, unknown> = {};
    setOwn(target, "__proto__", 1);
    expect(Object.keys(target)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
  });

  it("problem builds RFC 9457 bodies", () => {
    const known = problem(404, "x");
    expect(known.headers["content-type"]).toBe("application/problem+json");
    expect(known.body).toEqual({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "x",
    });
    expect(problem(418, "x").body).toMatchObject({ title: "Error" });
    expect(problem(405, "x", { allow: "GET" }).headers.allow).toBe("GET");
  });
});
