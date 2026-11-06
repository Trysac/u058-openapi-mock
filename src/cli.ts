import { readFile, stat } from "node:fs/promises";
import { MockError } from "./errors.js";
import { createMockHandler, listOperations } from "./handler.js";
import { startServer } from "./server.js";
import { loadSpec, MAX_SPEC_BYTES } from "./spec.js";
import { truncate } from "./util.js";

/** Output sinks used by the CLI. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const USAGE = [
  "Usage: openapi-mock <spec> [options]",
  "",
  "Options:",
  "  --port <n>         TCP port (default 4010, 0 picks a free port)",
  "  --host <host>      interface to bind (default 127.0.0.1)",
  "  --seed <n>         seed of the error generator (default 1)",
  "  --error-rate <r>   probability 0..1 of an injected 500 (default 0)",
  "  --dry-run          list the operations and exit",
  "  -h, --help         show this help",
  "",
].join("\n");

const VALUE_FLAGS = new Set(["--port", "--host", "--seed", "--error-rate"]);

interface CliOptions {
  readonly spec: string;
  readonly port: number;
  readonly host: string;
  readonly seed: number;
  readonly errorRate: number;
  readonly dryRun: boolean;
  readonly help: boolean;
}

function parseInteger(text: string, min: number, max: number): number | undefined {
  if (!/^-?[0-9]+$/.test(text)) {
    return undefined;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

function parseArgs(argv: readonly string[]): CliOptions | string {
  let spec: string | undefined;
  let port = 4010;
  let host = "127.0.0.1";
  let seed = 1;
  let errorRate = 0;
  let dryRun = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      if (spec !== undefined) {
        return "Unexpected extra argument.";
      }
      spec = arg;
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq < 0 ? arg : arg.slice(0, eq);
    const inline = eq < 0 ? undefined : arg.slice(eq + 1);
    if (name === "--dry-run") {
      if (inline !== undefined) {
        return "Option --dry-run does not take a value.";
      }
      dryRun = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      return `Unknown option: ${truncate(name, 50)}`;
    }
    let value = inline;
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (value === undefined) {
      return `Missing value for ${name}`;
    }
    if (name === "--port") {
      const parsed = parseInteger(value, 0, 65535);
      if (parsed === undefined) {
        return "Invalid --port: expected an integer from 0 to 65535.";
      }
      port = parsed;
    } else if (name === "--host") {
      if (value === "") {
        return "Invalid --host: expected a non-empty host.";
      }
      host = value;
    } else if (name === "--seed") {
      const parsed = parseInteger(value, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
      if (parsed === undefined) {
        return "Invalid --seed: expected an integer.";
      }
      seed = parsed;
    } else {
      const parsed = Number(value);
      if (value.trim() === "" || !(parsed >= 0 && parsed <= 1)) {
        return "Invalid --error-rate: expected a number from 0 to 1.";
      }
      errorRate = parsed;
    }
  }
  if (!help && spec === undefined) {
    return "Missing <spec> argument.";
  }
  return { spec: spec ?? "", port, host, seed, errorRate, dryRun, help };
}

function waitForSigint(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", () => resolve());
  });
}

function printable(text: string): string {
  return text.replace(/[^ -~]/g, "?");
}

/**
 * Runs the openapi-mock command line.
 *
 * @param argv - Arguments without the node binary and script name.
 * @param io - Output sinks.
 * @returns The process exit code: 0 on success, 2 for usage or specification
 * errors, 1 when the server cannot start.
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  const options = parseArgs(argv);
  if (typeof options === "string") {
    io.stderr(`error: ${options}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    io.stdout(USAGE);
    return 0;
  }
  let text: string;
  try {
    const info = await stat(options.spec);
    if (info.size > MAX_SPEC_BYTES) {
      io.stderr(`error: too_large: the specification exceeds ${MAX_SPEC_BYTES} bytes.\n`);
      return 2;
    }
    text = await readFile(options.spec, "utf8");
  } catch {
    io.stderr("error: cannot read the specification file.\n");
    return 2;
  }
  let spec: ReturnType<typeof loadSpec>;
  try {
    spec = loadSpec(text);
  } catch (error) {
    const detail =
      error instanceof MockError ? `${error.code}: ${error.message}` : "invalid specification";
    io.stderr(`error: ${detail}\n`);
    return 2;
  }
  if (options.dryRun) {
    for (const line of listOperations(spec)) {
      io.stdout(`${line}\n`);
    }
    return 0;
  }
  const handler = createMockHandler(spec, {
    seed: options.seed,
    errorRate: options.errorRate,
    onEvent: (event) => {
      io.stdout(`${event.method} ${printable(event.route)} ${event.status}\n`);
    },
  });
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer(handler, {
      port: options.port,
      host: options.host,
    });
  } catch {
    io.stderr("error: cannot start the server.\n");
    return 1;
  }
  io.stdout(`Listening on ${server.url}\n`);
  await waitForSigint();
  await server.close();
  return 0;
}
