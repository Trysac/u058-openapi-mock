/**
 * Public entry point of @trysac/openapi-mock.
 *
 * Mock HTTP handler from an OpenAPI 3.x document with examples, deterministic
 * schema bodies, RFC 7240 Prefer control and seeded errors.
 */

export type { MockErrorCode } from "./errors.js";
export { MockError } from "./errors.js";
export { generateFromSchema } from "./generate.js";
export { createMockHandler } from "./handler.js";
export { createRng } from "./rng.js";
export type { RunningServer, StartServerOptions } from "./server.js";
export { startServer } from "./server.js";
export { loadSpec } from "./spec.js";
export type {
  MockEvent,
  MockHandler,
  MockOptions,
  MockRequest,
  MockResponse,
  OpenApiDocument,
} from "./types.js";
