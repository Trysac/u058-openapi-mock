import { generateFromSchema } from "./generate.js";
import { parsePrefer } from "./prefer.js";
import { problem } from "./problem.js";
import { createRng } from "./rng.js";
import type {
  JsonObject,
  MockHandler,
  MockOptions,
  MockRequest,
  MockResponse,
  OpenApiDocument,
} from "./types.js";
import { deref, hasOwn, isObject, truncate } from "./util.js";

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const MAX_PATH_LENGTH = 8192;
const MAX_PREFER_LENGTH = 4096;
const NOT_FOUND_DETAIL = "No path in the specification matches the request.";
const PARAMETER = /[{][^{}]+[}]/;

type Segment =
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "pattern"; readonly pieces: readonly string[] };

interface Route {
  readonly template: string;
  readonly segments: readonly Segment[];
  readonly item: JsonObject;
  readonly operations: ReadonlyMap<string, JsonObject>;
}

interface Outcome {
  readonly response: MockResponse;
  readonly route: string;
}

function buildSegment(text: string): Segment {
  const pieces = text.split(PARAMETER);
  if (pieces.length === 1) {
    return { kind: "literal", text };
  }
  return { kind: "pattern", pieces };
}

function matchPieces(pieces: readonly string[], part: string): boolean {
  const first = pieces[0] ?? "";
  const last = pieces[pieces.length - 1] ?? "";
  if (!part.startsWith(first) || !part.endsWith(last)) {
    return false;
  }
  let position = first.length;
  const end = part.length - last.length;
  for (let index = 1; index < pieces.length - 1; index += 1) {
    const piece = pieces[index] ?? "";
    const found = part.indexOf(piece, position + 1);
    if (found < 0 || found + piece.length > end) {
      return false;
    }
    position = found + piece.length;
  }
  return end >= position + 1;
}

function buildRoutes(spec: OpenApiDocument): Route[] {
  const routes: Route[] = [];
  const paths = spec.paths;
  if (!isObject(paths)) {
    return routes;
  }
  for (const [template, raw] of Object.entries(paths)) {
    const item = deref(spec, raw);
    if (!template.startsWith("/") || !isObject(item)) {
      continue;
    }
    const operations = new Map<string, JsonObject>();
    for (const method of METHODS) {
      const operation = item[method];
      if (isObject(operation)) {
        operations.set(method.toUpperCase(), operation);
      }
    }
    if (operations.size > 0) {
      routes.push({
        template,
        segments: template.split("/").map(buildSegment),
        item,
        operations,
      });
    }
  }
  return routes;
}

/** Lists `METHOD path` lines for every operation, sorted. */
export function listOperations(spec: OpenApiDocument): string[] {
  const lines: string[] = [];
  for (const route of buildRoutes(spec)) {
    for (const method of route.operations.keys()) {
      lines.push(`${method} ${route.template}`);
    }
  }
  return lines.sort();
}

function rankOf(route: Route, parts: readonly string[]): number[] | undefined {
  if (route.segments.length !== parts.length) {
    return undefined;
  }
  const rank: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const segment = route.segments[index];
    const part = parts[index];
    if (segment === undefined || part === undefined) {
      return undefined;
    }
    if (segment.kind === "literal") {
      if (segment.text !== part) {
        return undefined;
      }
      rank.push(0);
    } else {
      if (!matchPieces(segment.pieces, part)) {
        return undefined;
      }
      rank.push(1);
    }
  }
  return rank;
}

function isBetter(candidate: number[], best: number[]): boolean {
  for (let index = 0; index < candidate.length; index += 1) {
    const a = candidate[index] ?? 0;
    const b = best[index] ?? 0;
    if (a !== b) {
      return a < b;
    }
  }
  return false;
}

function findRoute(routes: readonly Route[], parts: readonly string[]): Route | undefined {
  let best: Route | undefined;
  let bestRank: number[] | undefined;
  for (const route of routes) {
    const rank = rankOf(route, parts);
    if (rank === undefined) {
      continue;
    }
    if (bestRank === undefined || isBetter(rank, bestRank)) {
      best = route;
      bestRank = rank;
    }
  }
  return best;
}

function parametersOf(
  spec: OpenApiDocument,
  item: JsonObject,
  operation: JsonObject,
): JsonObject[] {
  const merged = new Map<string, JsonObject>();
  for (const list of [item.parameters, operation.parameters]) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const entry of list) {
      const parameter = deref(spec, entry);
      if (
        isObject(parameter) &&
        typeof parameter.name === "string" &&
        typeof parameter.in === "string"
      ) {
        merged.set(`${parameter.in}:${parameter.name}`, parameter);
      }
    }
  }
  return [...merged.values()];
}

function validateRequest(
  spec: OpenApiDocument,
  route: Route,
  operation: JsonObject,
  req: MockRequest,
  headers: ReadonlyMap<string, string>,
): string | undefined {
  for (const parameter of parametersOf(spec, route.item, operation)) {
    const name = parameter.name;
    if (parameter.required !== true || typeof name !== "string") {
      continue;
    }
    if (parameter.in === "query" && !hasOwn(req.query, name)) {
      return `Missing required query parameter '${name}'.`;
    }
    if (parameter.in === "header" && !headers.has(name.toLowerCase())) {
      return `Missing required header parameter '${name}'.`;
    }
  }
  const body = deref(spec, operation.requestBody);
  if (isObject(body) && body.required === true && req.body === undefined) {
    return "A request body is required by the operation.";
  }
  return undefined;
}

interface Chosen {
  readonly key: string;
  readonly status: number;
}

function codedResponse(responses: JsonObject, code: string): Chosen | undefined {
  const status = Number(code);
  if (hasOwn(responses, code)) {
    return { key: code, status };
  }
  const range = `${code.slice(0, 1)}XX`;
  for (const key of Object.keys(responses)) {
    if (key.toUpperCase() === range) {
      return { key, status };
    }
  }
  return hasOwn(responses, "default") ? { key: "default", status } : undefined;
}

function lowestSuccess(responses: JsonObject): Chosen | undefined {
  let best: number | undefined;
  for (const key of Object.keys(responses)) {
    if (/^2[0-9]{2}$/.test(key)) {
      const value = Number(key);
      if (best === undefined || value < best) {
        best = value;
      }
    }
  }
  if (best !== undefined) {
    return { key: String(best), status: best };
  }
  for (const key of Object.keys(responses)) {
    if (key.toUpperCase() === "2XX") {
      return { key, status: 200 };
    }
  }
  return hasOwn(responses, "default") ? { key: "default", status: 200 } : undefined;
}

function mediaScore(type: string): number {
  const name = (type.split(";")[0] ?? "").trim().toLowerCase();
  if (name === "application/json") {
    return 0;
  }
  return name.includes("json") ? 1 : 2;
}

function mediaEntries(response: unknown): Array<[string, JsonObject]> {
  if (!isObject(response) || !isObject(response.content)) {
    return [];
  }
  const entries = Object.entries(response.content).filter((entry): entry is [string, JsonObject] =>
    isObject(entry[1]),
  );
  return entries.sort((a, b) => mediaScore(a[0]) - mediaScore(b[0]));
}

function namedExample(
  spec: OpenApiDocument,
  media: JsonObject,
  name: string,
): { readonly value: unknown } | undefined {
  const examples = media.examples;
  if (!isObject(examples) || !hasOwn(examples, name)) {
    return undefined;
  }
  const entry = deref(spec, examples[name]);
  if (isObject(entry) && hasOwn(entry, "value")) {
    return { value: entry.value };
  }
  return undefined;
}

function defaultBody(spec: OpenApiDocument, media: JsonObject): unknown {
  if (hasOwn(media, "example")) {
    return media.example;
  }
  if (isObject(media.examples)) {
    for (const raw of Object.values(media.examples)) {
      const entry = deref(spec, raw);
      if (isObject(entry) && hasOwn(entry, "value")) {
        return entry.value;
      }
    }
  }
  if (hasOwn(media, "schema")) {
    return generateFromSchema(media.schema, spec);
  }
  return undefined;
}

function buildResponse(
  spec: OpenApiDocument,
  raw: unknown,
  status: number,
  example: string | undefined,
): MockResponse {
  const media = mediaEntries(deref(spec, raw));
  if (example !== undefined) {
    for (const [type, entry] of media) {
      const named = namedExample(spec, entry, example);
      if (named !== undefined) {
        return {
          status,
          headers: { "content-type": type },
          body: structuredClone(named.value),
        };
      }
    }
    return problem(400, "The requested example is not documented for this response.");
  }
  const first = media[0];
  if (first === undefined) {
    return { status, headers: {}, body: undefined };
  }
  return {
    status,
    headers: { "content-type": first[0] },
    body: structuredClone(defaultBody(spec, first[1])),
  };
}

function selectResponse(
  spec: OpenApiDocument,
  operation: JsonObject,
  headers: ReadonlyMap<string, string>,
): MockResponse {
  const responses = operation.responses;
  const prefer = headers.get("prefer");
  if (prefer !== undefined && prefer.length > MAX_PREFER_LENGTH) {
    return problem(400, "The Prefer header is too long.");
  }
  const directives = prefer === undefined ? undefined : parsePrefer(prefer);
  const code = directives?.code;
  if (!isObject(responses)) {
    return problem(501, "The operation documents no responses.");
  }
  const chosen = code === undefined ? lowestSuccess(responses) : codedResponse(responses, code);
  if (chosen === undefined) {
    return code === undefined
      ? problem(501, "The operation documents no success response.")
      : problem(400, "The requested response code is not documented for this operation.");
  }
  return buildResponse(spec, responses[chosen.key], chosen.status, directives?.example);
}

function handle(
  spec: OpenApiDocument,
  routes: readonly Route[],
  req: MockRequest,
  method: string,
  inject: boolean,
): Outcome {
  const path = req.path;
  if (path.length > MAX_PATH_LENGTH) {
    return { response: problem(414, "The request path is too long."), route: "" };
  }
  const shown = truncate(path);
  if (!path.startsWith("/")) {
    return { response: problem(404, NOT_FOUND_DETAIL), route: shown };
  }
  let parts: string[];
  try {
    parts = path.split("/").map((part) => decodeURIComponent(part));
  } catch {
    return {
      response: problem(400, "The request path has malformed percent-encoding."),
      route: shown,
    };
  }
  const route = findRoute(routes, parts);
  if (route === undefined) {
    return { response: problem(404, NOT_FOUND_DETAIL), route: shown };
  }
  const operation = route.operations.get(method);
  if (operation === undefined) {
    const allow = [...route.operations.keys()].sort().join(", ");
    return {
      response: problem(405, "The path does not support this method.", {
        allow,
      }),
      route: route.template,
    };
  }
  const headers = new Map<string, string>(
    Object.entries(req.headers).map(([name, value]): [string, string] => [
      name.toLowerCase(),
      value,
    ]),
  );
  const invalid = validateRequest(spec, route, operation, req, headers);
  if (invalid !== undefined) {
    return { response: problem(400, invalid), route: route.template };
  }
  if (inject) {
    return {
      response: problem(500, "A failure was injected by the errorRate option."),
      route: route.template,
    };
  }
  return {
    response: selectResponse(spec, operation, headers),
    route: route.template,
  };
}

/**
 * Creates a pure synchronous mock handler for a loaded specification.
 *
 * Exactly one value is drawn from the seeded generator per request; when it is
 * below `errorRate` a request that passed routing and validation answers 500.
 *
 * @throws {RangeError} When `errorRate` is outside [0, 1] or `seed` is not finite.
 */
export function createMockHandler(spec: OpenApiDocument, options: MockOptions = {}): MockHandler {
  const errorRate = options.errorRate ?? 0;
  if (!(errorRate >= 0 && errorRate <= 1)) {
    throw new RangeError("errorRate must be between 0 and 1");
  }
  const rng = createRng(options.seed ?? 1);
  const routes = buildRoutes(spec);
  const onEvent = options.onEvent;
  return (req) => {
    const draw = rng();
    const method = req.method.toUpperCase();
    const outcome = handle(spec, routes, req, method, draw < errorRate);
    if (onEvent !== undefined) {
      try {
        onEvent({
          method,
          route: outcome.route,
          status: outcome.response.status,
        });
      } catch {
        // A failing listener must never break the handler.
      }
    }
    return outcome.response;
  };
}
