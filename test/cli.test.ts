import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import { createMockHandler, loadSpec, startServer } from "../src/index.js";
import { specText } from "./fixture.js";

let dir = "";
let specFile = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "openapi-mock-"));
  specFile = join(dir, "spec.json");
  await writeFile(specFile, specText);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeIo(): {
  out: string[];
  err: string[];
  io: { stdout(s: string): void; stderr(s: string): void };
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s: string) => {
        out.push(s);
      },
      stderr: (s: string) => {
        err.push(s);
      },
    },
  };
}

const EXPECTED = "GET /pets\nGET /pets/mine\nGET /pets/{id}\nPOST /pets\n";

describe("cli --dry-run", () => {
  it("prints one sorted METHOD path line per operation", async () => {
    const { out, err, io } = makeIo();
    expect(await run([specFile, "--dry-run"], io)).toBe(0);
    expect(out.join("")).toBe(EXPECTED);
    expect(err).toEqual([]);
  });

  it("accepts every option, also in --name=value form", async () => {
    const { out, io } = makeIo();
    const argv = [
      "--port=0",
      "--host=127.0.0.1",
      "--seed=2",
      "--error-rate=0.5",
      specFile,
      "--dry-run",
    ];
    expect(await run(argv, io)).toBe(0);
    expect(out.join("")).toBe(EXPECTED);
    const spaced = makeIo();
    const longform = [
      specFile,
      "--port",
      "0",
      "--host",
      "localhost",
      "--seed",
      "-3",
      "--error-rate",
      "1",
      "--dry-run",
    ];
    expect(await run(longform, spaced.io)).toBe(0);
  });

  it("prints help", async () => {
    const { out, io } = makeIo();
    expect(await run(["--help"], io)).toBe(0);
    expect(out.join("")).toContain("Usage: openapi-mock");
    expect(await run(["-h"], makeIo().io)).toBe(0);
  });
});

describe("cli errors", () => {
  it("returns 2 for an unknown flag and bad arguments", async () => {
    const cases: string[][] = [
      [],
      [specFile, "--bogus"],
      [specFile, "-x"],
      [specFile, "--port"],
      [specFile, "--port", "abc"],
      [specFile, "--port", "70000"],
      [specFile, "--port", "-1"],
      [specFile, "--seed", "1.5"],
      [specFile, "--error-rate", "2"],
      [specFile, "--error-rate", ""],
      [specFile, "--error-rate", "abc"],
      [specFile, "--host="],
      [specFile, "--dry-run=1"],
      [specFile, "extra"],
      [join(dir, "missing.json"), "--dry-run"],
    ];
    for (const argv of cases) {
      const { err, io } = makeIo();
      expect(await run(argv, io)).toBe(2);
      expect(err.join("")).not.toBe("");
    }
  });

  it("returns 2 for an invalid spec", async () => {
    const samples: Array<[string, string, string]> = [
      ["broken.yaml", "openapi: [unclosed", "parse_error"],
      ["v2.json", '{"swagger":"2.0"}', "unsupported_version"],
      ["ref.json", '{"openapi":"3.0.0","x":{"$ref":"#/nope"}}', "unresolved_ref"],
    ];
    for (const [name, content, code] of samples) {
      const file = join(dir, name);
      await writeFile(file, content);
      const { err, io } = makeIo();
      expect(await run([file], io)).toBe(2);
      expect(err.join("")).toContain(code);
    }
  });

  it("returns 2 for an oversized spec file", async () => {
    const file = join(dir, "huge.json");
    await writeFile(file, Buffer.alloc(10_485_761, 0x20));
    const { err, io } = makeIo();
    expect(await run([file], io)).toBe(2);
    expect(err.join("")).toContain("too_large");
  });
});

describe("cli serve", () => {
  it("serves until SIGINT and returns 0", async () => {
    const before = process.rawListeners("SIGINT");
    const { out, io } = makeIo();
    const running = run([specFile, "--port", "0"], io);
    await vi.waitFor(() => {
      expect(out.join("")).toContain("Listening on http://127.0.0.1:");
    });
    const line = out.find((entry) => entry.startsWith("Listening on ")) ?? "";
    const url = line.slice("Listening on ".length).trim();
    const reply = await fetch(`${url}/pets/1`);
    expect(reply.status).toBe(200);
    await reply.text();
    expect(out.join("")).toContain("GET /pets/{id} 200\n");
    const fresh = process.rawListeners("SIGINT").find((l) => !before.includes(l));
    expect(fresh).toBeDefined();
    (fresh as () => void)();
    expect(await running).toBe(0);
  });

  it("returns 1 when the server cannot start", async () => {
    const blocker = await startServer(createMockHandler(loadSpec(specText)), {
      port: 0,
    });
    try {
      const port = new URL(blocker.url).port;
      const { err, io } = makeIo();
      expect(await run([specFile, "--port", port], io)).toBe(1);
      expect(err.join("")).toContain("cannot start");
    } finally {
      await blocker.close();
    }
  });
});
