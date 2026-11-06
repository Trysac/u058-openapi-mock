import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { problem } from "./problem.js";
import type { JsonObject, MockHandler, MockResponse } from "./types.js";
import { isObject, setOwn } from "./util.js";

/** Largest accepted request body in bytes (1 MiB). */
export const MAX_BODY_BYTES = 1_048_576;
const MAX_DRAIN_BYTES = 16 * 1_048_576;

/** Options of `startServer`. */
export interface StartServerOptions {
  /** TCP port; 0 picks a free port. Defaults to 4010. */
  readonly port?: number | undefined;
  /** Interface to bind. Defaults to 127.0.0.1. */
  readonly host?: string | undefined;
  /** Accepted Host header values. Defaults to 127.0.0.1:port and localhost:port. */
  readonly allowedHosts?: readonly string[] | undefined;
}

/** A running mock server. */
export interface RunningServer {
  /** Base URL such as `http://127.0.0.1:4010`. */
  readonly url: string;
  /** Stops the server and closes open connections. Safe to call twice. */
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<{ tooLarge: boolean; data: Buffer }> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks = [];
        if (size > MAX_DRAIN_BYTES) {
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ tooLarge, data: Buffer.concat(chunks) }));
    req.on("close", () => resolve({ tooLarge: true, data: Buffer.alloc(0) }));
    req.on("error", reject);
  });
}

function isJsonContentType(value: string | undefined): boolean {
  const type = (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "application/json" || type.endsWith("+json");
}

function splitUrl(url: string): {
  path: string;
  query: Record<string, string>;
} {
  const hash = url.indexOf("#");
  const clean = hash < 0 ? url : url.slice(0, hash);
  const mark = clean.indexOf("?");
  const path = mark < 0 ? clean : clean.slice(0, mark);
  const query: JsonObject = {};
  if (mark >= 0) {
    for (const [key, value] of new URLSearchParams(clean.slice(mark + 1))) {
      if (!Object.hasOwn(query, key)) {
        setOwn(query, key, value);
      }
    }
  }
  return { path, query: query as Record<string, string> };
}

function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const out: JsonObject = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      setOwn(out, name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  return out as Record<string, string>;
}

async function respond(
  req: IncomingMessage,
  handler: MockHandler,
  allowedHosts: ReadonlySet<string>,
): Promise<MockResponse> {
  const host = req.headers.host;
  if (host === undefined || !allowedHosts.has(host.toLowerCase())) {
    req.resume();
    return problem(403, "The Host header is not allowed.");
  }
  const { tooLarge, data } = await readBody(req);
  if (tooLarge) {
    return problem(413, `The request body exceeds ${MAX_BODY_BYTES} bytes.`);
  }
  let body: unknown;
  if (data.length > 0) {
    if (!isJsonContentType(req.headers["content-type"])) {
      return problem(415, "Only application/json request bodies are accepted.");
    }
    try {
      body = JSON.parse(data.toString("utf8"));
    } catch {
      return problem(400, "The request body is not valid JSON.");
    }
  }
  const target = splitUrl(req.url ?? "/");
  try {
    return handler({
      method: req.method ?? "GET",
      path: target.path,
      query: target.query,
      headers: flattenHeaders(req.headers),
      body,
    });
  } catch {
    return problem(500, "The mock handler failed unexpectedly.");
  }
}

function serialize(body: unknown, contentType: string | undefined): string {
  if (typeof body === "string" && contentType !== undefined && !isJsonContentType(contentType)) {
    return body;
  }
  return JSON.stringify(body) ?? "";
}

function send(res: ServerResponse, response: MockResponse): void {
  const headers: Record<string, string> = { ...response.headers };
  const bodiless = response.status === 204 || response.status === 304 || response.status < 200;
  let payload: Buffer | undefined;
  if (response.body !== undefined && !bodiless) {
    payload = Buffer.from(serialize(response.body, headers["content-type"]), "utf8");
    headers["content-length"] = String(payload.length);
  }
  res.writeHead(response.status, headers);
  res.end(payload);
}

async function serve(
  req: IncomingMessage,
  res: ServerResponse,
  handler: MockHandler,
  allowedHosts: ReadonlySet<string>,
): Promise<void> {
  try {
    send(res, await respond(req, handler, allowedHosts));
  } catch {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    try {
      send(res, problem(500, "The server could not produce a response."));
    } catch {
      res.destroy();
    }
  }
}

/**
 * Serves a mock handler over HTTP using node:http.
 *
 * Bodies over 1 MiB get 413, non-JSON bodies 415 and a Host header outside
 * `allowedHosts` gets 403 (DNS rebinding protection).
 *
 * @throws {RangeError} When `port` is not an integer in 0..65535.
 */
export async function startServer(
  handler: MockHandler,
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4010;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new RangeError("port must be an integer between 0 and 65535");
  }
  const allowed = new Set<string>();
  const server = createServer((req, res) => {
    void serve(req, res, handler, allowed);
  });
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(requestedPort, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  const port = isObject(address) && typeof address.port === "number" ? address.port : requestedPort;
  for (const name of options.allowedHosts ?? [`127.0.0.1:${port}`, `localhost:${port}`]) {
    allowed.add(name.toLowerCase());
  }
  const shownHost = host.includes(":") ? `[${host}]` : host;
  let closing: Promise<void> | undefined;
  return {
    url: `http://${shownHost}:${port}`,
    close: () => {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
