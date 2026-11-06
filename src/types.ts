/** A plain JSON-like object. */
export type JsonObject = Record<string, unknown>;

/** A parsed OpenAPI 3.0.x or 3.1.x document. */
export interface OpenApiDocument {
  readonly openapi: string;
  readonly paths?: Record<string, unknown>;
  readonly components?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

/** An HTTP request as seen by the mock handler. */
export interface MockRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

/** An HTTP response produced by the mock handler. Header names are lowercase. */
export interface MockResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** Event reported to `onEvent` after every handled request. */
export interface MockEvent {
  readonly method: string;
  readonly route: string;
  readonly status: number;
}

/** A pure, synchronous request handler. */
export type MockHandler = (req: MockRequest) => MockResponse;

/** Options of `createMockHandler`. */
export interface MockOptions {
  /** Seed of the error-injection generator. Defaults to 1. */
  readonly seed?: number | undefined;
  /** Probability in [0, 1] that a valid request answers 500. Defaults to 0. */
  readonly errorRate?: number | undefined;
  /** Called after every request; failures of the callback are ignored. */
  readonly onEvent?: ((event: MockEvent) => void) | undefined;
}
