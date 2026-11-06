import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";
import { createMockHandler, loadSpec, startServer } from "../src/index.js";
import type { StartServerOptions } from "../src/server.js";
import type { MockHandler } from "../src/types.js";
import { specText } from "./fixture.js";

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

function call(
  base: string,
  options: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
  },
): Promise<Reply> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: url.hostname,
        port: Number(url.port),
        method: options.method ?? "GET",
        path: options.path,
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

async function withServer(
  action: (url: string) => Promise<void>,
  options: StartServerOptions = {},
  handler: MockHandler = createMockHandler(loadSpec(specText)),
): Promise<void> {
  const server = await startServer(handler, { port: 0, ...options });
  try {
    await action(server.url);
  } finally {
    await server.close();
  }
}

describe("startServer", () => {
  it("listens on loopback and serves JSON", async () => {
    await withServer(async (url) => {
      expect(new URL(url).hostname).toBe("127.0.0.1");
      const reply = await call(url, { path: "/pets/1" });
      expect(reply.status).toBe(200);
      expect(reply.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(reply.text)).toEqual({ id: 1, name: "Rex" });
    });
  });

  it("passes the query string and the first duplicate value", async () => {
    await withServer(async (url) => {
      const ok = await call(url, { path: "/pets?limit=2&limit=3#frag" });
      expect(ok.status).toBe(200);
      const missing = await call(url, { path: "/pets" });
      expect(missing.status).toBe(400);
      expect(missing.headers["content-type"]).toBe("application/problem+json");
    });
  });

  it("answers 413 to a 1_048_577-byte body", async () => {
    await withServer(async (url) => {
      const reply = await call(url, {
        method: "POST",
        path: "/pets",
        headers: { "content-type": "application/json" },
        body: Buffer.alloc(1_048_577, 0x61),
      });
      expect(reply.status).toBe(413);
      expect(reply.headers["content-type"]).toBe("application/problem+json");
    });
  });

  it("accepts a body of exactly 1 MiB", async () => {
    await withServer(async (url) => {
      const body = `"${"a".repeat(1_048_574)}"`;
      expect(Buffer.byteLength(body)).toBe(1_048_576);
      const reply = await call(url, {
        method: "POST",
        path: "/pets",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(reply.status).toBe(201);
    });
  });

  it("answers 415 and 400 for bad bodies", async () => {
    await withServer(async (url) => {
      const text = await call(url, {
        method: "POST",
        path: "/pets",
        headers: { "content-type": "text/plain" },
        body: "hello",
      });
      expect(text.status).toBe(415);
      const broken = await call(url, {
        method: "POST",
        path: "/pets",
        headers: { "content-type": "application/vnd.api+json" },
        body: "{oops",
      });
      expect(broken.status).toBe(400);
      const none = await call(url, { method: "POST", path: "/pets" });
      expect(none.status).toBe(400);
      const good = await call(url, {
        method: "POST",
        path: "/pets",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: '{"a":1}',
      });
      expect(good.status).toBe(201);
    });
  });

  it("answers 403 to a foreign Host header", async () => {
    await withServer(async (url) => {
      const reply = await call(url, {
        path: "/pets/1",
        headers: { Host: "evil.example" },
      });
      expect(reply.status).toBe(403);
      expect(reply.headers["content-type"]).toBe("application/problem+json");
      const port = new URL(url).port;
      const local = await call(url, {
        path: "/pets/1",
        headers: { Host: `localhost:${port}` },
      });
      expect(local.status).toBe(200);
    });
  });

  it("supports custom allowed hosts", async () => {
    await withServer(
      async (url) => {
        const allowed = await call(url, {
          path: "/pets/1",
          headers: { Host: "mock.test" },
        });
        expect(allowed.status).toBe(200);
        const denied = await call(url, { path: "/pets/1" });
        expect(denied.status).toBe(403);
      },
      { allowedHosts: ["Mock.Test"] },
    );
  });

  it("relays 405 headers", async () => {
    await withServer(async (url) => {
      const reply = await call(url, { method: "DELETE", path: "/pets" });
      expect(reply.status).toBe(405);
      expect(reply.headers.allow).toBe("GET, POST");
    });
  });

  it("writes non-JSON strings raw and omits bodies for 204", async () => {
    const custom: MockHandler = (req) => {
      if (req.path === "/text") {
        return {
          status: 200,
          headers: { "content-type": "text/plain" },
          body: "hi",
        };
      }
      if (req.path === "/none") {
        return { status: 204, headers: {}, body: { ignored: true } };
      }
      if (req.path === "/bad") {
        return {
          status: 200,
          headers: { "content-type": "bad\u0001type" },
          body: {},
        };
      }
      throw new Error("boom");
    };
    await withServer(
      async (url) => {
        const text = await call(url, { path: "/text" });
        expect(text.text).toBe("hi");
        const none = await call(url, { path: "/none" });
        expect(none.status).toBe(204);
        expect(none.text).toBe("");
        const bad = await call(url, { path: "/bad" });
        expect(bad.status).toBe(500);
        const failed = await call(url, { path: "/other" });
        expect(failed.status).toBe(500);
        expect(JSON.parse(failed.text)).toMatchObject({ status: 500 });
      },
      {},
      custom,
    );
  });

  it("close resolves and is idempotent", async () => {
    const server = await startServer(createMockHandler(loadSpec(specText)), {
      port: 0,
    });
    await server.close();
    await server.close();
  });

  it("validates the port and reports bind failures", async () => {
    const handler = createMockHandler(loadSpec(specText));
    await expect(startServer(handler, { port: -1 })).rejects.toThrow(RangeError);
    await expect(startServer(handler, { port: 70000 })).rejects.toThrow(RangeError);
    await expect(startServer(handler, { port: 1.5 })).rejects.toThrow(RangeError);
    const first = await startServer(handler, { port: 0 });
    try {
      const port = Number(new URL(first.url).port);
      await expect(startServer(handler, { port })).rejects.toThrow();
    } finally {
      await first.close();
    }
  });
});
