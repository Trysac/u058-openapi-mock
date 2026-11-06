import { describe, expect, it, vi } from "vitest";
import { createMockHandler, loadSpec } from "../src/index.js";
import type { MockEvent, MockResponse } from "../src/types.js";
import { request, specText } from "./fixture.js";

const spec = loadSpec(specText);
const handler = createMockHandler(spec);

function expectProblem(response: MockResponse, status: number): void {
  expect(response.status).toBe(status);
  expect(response.headers["content-type"]).toBe("application/problem+json");
  expect(response.body).toMatchObject({ type: "about:blank", status });
}

function detailOf(response: MockResponse): string {
  return (response.body as { detail: string }).detail;
}

describe("response selection", () => {
  it("serves the lowest documented 2xx with the operation example", () => {
    const response = handler(request("GET", "/pets/1"));
    expect(response.status).toBe(200);
    expect(response.headers).toEqual({ "content-type": "application/json" });
    expect(response.body).toEqual({ id: 1, name: "Rex" });
  });

  it("does not let callers mutate the specification", () => {
    const first = handler(request("GET", "/pets/1"));
    (first.body as { id: number }).id = 123;
    expect(handler(request("GET", "/pets/1")).body).toEqual({
      id: 1,
      name: "Rex",
    });
  });

  it("honours Prefer code", () => {
    for (const prefer of ["code=404", 'code="404"', "respond-async, CODE=404"]) {
      const response = handler(request("GET", "/pets/1", { headers: { prefer } }));
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: "not found" });
    }
    const mixed = handler(request("GET", "/pets/1", { headers: { Prefer: "code=404" } }));
    expect(mixed.status).toBe(404);
  });

  it("honours Prefer example", () => {
    const response = handler(request("GET", "/pets/1", { headers: { prefer: "example=cat" } }));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 2, name: "Cat" });
  });

  it("rejects undocumented codes and examples", () => {
    const code = handler(request("GET", "/pets/1", { headers: { prefer: "code=418" } }));
    expectProblem(code, 400);
    expect(detailOf(code)).not.toContain("418");
    const example = handler(request("GET", "/pets/1", { headers: { prefer: "example=dog" } }));
    expectProblem(example, 400);
    expect(detailOf(example)).not.toContain("dog");
  });

  it("ignores malformed codes", () => {
    const response = handler(request("GET", "/pets/1", { headers: { prefer: "code=4044" } }));
    expect(response.status).toBe(200);
  });

  it("rejects oversized Prefer headers", () => {
    const prefer = `code=404, ${"x".repeat(5000)}`;
    expectProblem(handler(request("GET", "/pets/1", { headers: { prefer } })), 400);
  });

  it("generates bodies from schemas", () => {
    const response = handler(request("GET", "/pets", { query: { limit: "1" } }));
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 1, name: "string" }]);
  });

  it("answers without a body when no content is documented", () => {
    const response = handler(request("POST", "/pets", { body: {} }));
    expect(response.status).toBe(201);
    expect(response.headers).toEqual({});
    expect(response.body).toBeUndefined();
  });
});

describe("request validation", () => {
  it("requires declared query parameters", () => {
    const response = handler(request("GET", "/pets"));
    expectProblem(response, 400);
    expect(detailOf(response)).toContain("limit");
  });

  it("requires a declared JSON body", () => {
    expectProblem(handler(request("POST", "/pets")), 400);
  });
});

describe("routing", () => {
  it("prefers concrete paths over templated ones", () => {
    expect(handler(request("GET", "/pets/mine")).body).toEqual({
      id: 99,
      name: "mine",
    });
    expect(handler(request("GET", "/pets/a%2Fb")).status).toBe(200);
    expect(handler(request("GET", "/pets/a%2Fb")).body).toEqual({
      id: 1,
      name: "Rex",
    });
  });

  it("returns 404 for unknown paths and trailing slashes", () => {
    expectProblem(handler(request("GET", "/nope")), 404);
    expectProblem(handler(request("GET", "/pets/1/")), 404);
    expectProblem(handler(request("GET", "/")), 404);
    expectProblem(handler(request("GET", "pets")), 404);
    expectProblem(handler(request("GET", "/pets//")), 404);
  });

  it("returns 405 with an Allow header", () => {
    const response = handler(request("DELETE", "/pets"));
    expectProblem(response, 405);
    expect(response.headers.allow).toBe("GET, POST");
    expect(handler(request("get", "/pets/mine")).status).toBe(200);
  });

  it("rejects long and malformed paths", () => {
    expectProblem(handler(request("GET", `/${"a".repeat(8192)}`)), 414);
    expectProblem(handler(request("GET", "/pets/%E0%A4%A")), 400);
    expect(handler(request("GET", `/${"a".repeat(8191)}`)).status).toBe(404);
  });
});

describe("error injection", () => {
  it("is seeded and never uses Math.random", () => {
    const seeded = createMockHandler(spec, { seed: 42, errorRate: 0.5 });
    const stub = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random must not be used");
    });
    try {
      const statuses = Array.from({ length: 10 }, () => seeded(request("GET", "/pets/1")).status);
      expect(statuses).toEqual([200, 500, 200, 200, 500, 200, 500, 200, 200, 500]);
    } finally {
      stub.mockRestore();
    }
  });

  it("honours the extremes", () => {
    const always = createMockHandler(spec, { errorRate: 1 });
    const never = createMockHandler(spec, { errorRate: 0 });
    for (let index = 0; index < 5; index += 1) {
      expectProblem(always(request("GET", "/pets/1")), 500);
      expect(never(request("GET", "/pets/1")).status).toBe(200);
    }
  });

  it("validates the options", () => {
    expect(() => createMockHandler(spec, { errorRate: 1.5 })).toThrow(RangeError);
    expect(() => createMockHandler(spec, { errorRate: -0.1 })).toThrow(RangeError);
    expect(() => createMockHandler(spec, { errorRate: Number.NaN })).toThrow(RangeError);
    expect(() => createMockHandler(spec, { seed: Number.NaN })).toThrow(RangeError);
  });
});

describe("events", () => {
  it("reports every request", () => {
    const events: MockEvent[] = [];
    const watched = createMockHandler(spec, {
      onEvent: (event) => events.push(event),
    });
    watched(request("GET", "/pets/1"));
    watched(request("GET", "/nope"));
    watched(request("GET", `/${"a".repeat(9000)}`));
    expect(events).toEqual([
      { method: "GET", route: "/pets/{id}", status: 200 },
      { method: "GET", route: "/nope", status: 404 },
      { method: "GET", route: "", status: 414 },
    ]);
  });

  it("ignores failing listeners", () => {
    const fragile = createMockHandler(spec, {
      onEvent: () => {
        throw new Error("listener failure");
      },
    });
    expect(fragile(request("GET", "/pets/1")).status).toBe(200);
  });
});

describe("edge cases", () => {
  const media = (example: unknown): object => ({
    "application/json": { example },
  });
  const ok = (example: unknown): object => ({
    get: { responses: { "200": { description: "ok", content: media(example) } } },
  });
  const edge = createMockHandler(
    loadSpec(
      JSON.stringify({
        openapi: "3.1.0",
        paths: {
          "/default": {
            get: {
              responses: {
                default: {
                  description: "d",
                  content: { "text/plain": { example: "hello" } },
                },
              },
            },
          },
          "/ranges": {
            get: {
              responses: {
                "2XX": { description: "ok" },
                "4XX": { description: "bad", content: media({ e: 1 }) },
              },
            },
          },
          "/failonly": { get: { responses: { "404": { description: "nf" } } } },
          "/noresponses": { get: {} },
          "/viaref": {
            get: {
              responses: { "200": { $ref: "#/components/responses/Ok" } },
            },
          },
          "/pathitem": { $ref: "#/components/pathItems/Item" },
          "/g/x/{b}": ok("first"),
          "/g/{a}/y": ok("second"),
          "/file/{name}.json": ok("pattern"),
          "/multi": {
            get: {
              responses: {
                "200": {
                  description: "m",
                  content: {
                    "application/json": {
                      examples: { a: { $ref: "#/components/examples/A" } },
                    },
                  },
                },
              },
            },
          },
          "/schemaref": {
            get: {
              responses: {
                "200": {
                  description: "s",
                  content: {
                    "application/json": {
                      schema: { $ref: "#/components/schemas/Node" },
                    },
                  },
                },
              },
            },
          },
          "/needkey": {
            get: {
              parameters: [
                { name: "X-Key", in: "header", required: true },
                { $ref: "#/components/parameters/Trace" },
              ],
              responses: { "200": { description: "ok" } },
            },
          },
          "/nocontent": {
            get: { responses: { "204": { description: "none" } } },
          },
          "/bodyref": {
            post: {
              requestBody: { $ref: "#/components/requestBodies/B" },
              responses: { "200": { description: "ok" } },
            },
          },
          "/empty": { summary: "no operations" },
          "no-slash": ok("ignored"),
        },
        components: {
          responses: {
            Ok: { description: "ok", content: media({ ok: true }) },
          },
          pathItems: {
            Item: {
              get: {
                responses: {
                  "200": { description: "i", content: media({ item: true }) },
                },
              },
            },
          },
          examples: { A: { value: { n: 1 } } },
          schemas: {
            Node: {
              type: "object",
              properties: { next: { $ref: "#/components/schemas/Node" } },
            },
          },
          parameters: { Trace: { name: "trace", in: "query", required: true } },
          requestBodies: {
            B: {
              required: true,
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      }),
    ),
  );
  const prefer = (value: string): { headers: Record<string, string> } => ({
    headers: { prefer: value },
  });

  it("serves default responses and non-JSON media", () => {
    const response = edge(request("GET", "/default"));
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/plain");
    expect(response.body).toBe("hello");
    expect(edge(request("GET", "/default", prefer("code=418"))).status).toBe(418);
  });

  it("supports response ranges", () => {
    const success = edge(request("GET", "/ranges"));
    expect(success.status).toBe(200);
    expect(success.body).toBeUndefined();
    const failure = edge(request("GET", "/ranges", prefer("code=404")));
    expect(failure.status).toBe(404);
    expect(failure.body).toEqual({ e: 1 });
    expectProblem(edge(request("GET", "/ranges", prefer("code=500"))), 400);
  });

  it("answers 501 when no success response exists", () => {
    expectProblem(edge(request("GET", "/failonly")), 501);
    expectProblem(edge(request("GET", "/noresponses")), 501);
    const coded = edge(request("GET", "/failonly", prefer("code=404")));
    expect(coded.status).toBe(404);
    expect(coded.body).toBeUndefined();
  });

  it("follows references", () => {
    expect(edge(request("GET", "/viaref")).body).toEqual({ ok: true });
    expect(edge(request("GET", "/pathitem")).body).toEqual({ item: true });
    expect(edge(request("GET", "/multi")).body).toEqual({ n: 1 });
    expect(edge(request("GET", "/schemaref")).body).toEqual({ next: null });
  });

  it("compares templated paths segment by segment", () => {
    expect(edge(request("GET", "/g/x/y")).body).toBe("first");
    expect(edge(request("GET", "/g/q/y")).body).toBe("second");
    expect(edge(request("GET", "/g/x/z")).body).toBe("first");
  });

  it("matches templates inside a segment", () => {
    expect(edge(request("GET", "/file/data.json")).body).toBe("pattern");
    expectProblem(edge(request("GET", "/file/.json")), 404);
    expectProblem(edge(request("GET", "/file/data.txt")), 404);
  });

  it("checks required headers, merged parameters and body references", () => {
    const missingHeader = edge(request("GET", "/needkey"));
    expectProblem(missingHeader, 400);
    expect(detailOf(missingHeader)).toContain("X-Key");
    const missingQuery = edge(request("GET", "/needkey", { headers: { "x-key": "1" } }));
    expect(detailOf(missingQuery)).toContain("trace");
    expect(
      edge(
        request("GET", "/needkey", {
          headers: { "x-key": "1" },
          query: { trace: "t" },
        }),
      ).status,
    ).toBe(200);
    expectProblem(edge(request("POST", "/bodyref")), 400);
    expect(edge(request("POST", "/bodyref", { body: [] })).status).toBe(200);
  });

  it("handles responses without content", () => {
    const response = edge(request("GET", "/nocontent"));
    expect(response.status).toBe(204);
    expect(response.headers).toEqual({});
    expectProblem(edge(request("GET", "/nocontent", prefer("example=a"))), 400);
  });

  it("skips unusable path items", () => {
    expectProblem(edge(request("GET", "/empty")), 404);
    expectProblem(edge(request("GET", "no-slash")), 404);
  });

  it("handles documents without paths", () => {
    const empty = createMockHandler(loadSpec('{"openapi":"3.0.0"}'));
    expectProblem(empty(request("GET", "/")), 404);
  });
});
