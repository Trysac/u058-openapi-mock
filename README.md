# openapi-mock

[![npm version](https://img.shields.io/npm/v/@trysac/openapi-mock.svg)](https://www.npmjs.com/package/@trysac/openapi-mock)
[![license: MIT](https://img.shields.io/npm/l/@trysac/openapi-mock.svg)](LICENSE)
[![CI](https://github.com/Trysac/u058-openapi-mock/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u058-openapi-mock/actions/workflows/ci.yml)

Mock HTTP handler from an OpenAPI 3.x document with examples, deterministic schema bodies, RFC 7240 Prefer control and seeded errors.

## Problem

Frontend and integration work stalls while the real API is not ready, and hand-written stubs drift from the contract. Existing mock servers such as Prism are heavy to install for a small project or test suite. This package provides a pure request handler generated from an OpenAPI document, plus a thin loopback server, so mocks stay aligned with the contract and can be tested in process.

## Install

```sh
npm install @trysac/openapi-mock
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations. Its only runtime dependency is `yaml`, used to read YAML documents.

## Usage

```ts
import { createMockHandler, loadSpec } from "@trysac/openapi-mock";

const spec = loadSpec(
  '{"openapi":"3.0.3","paths":{"/ping":{"get":{"responses":{"200":{"description":"ok","content":{"application/json":{"example":{"pong":true}}}}}}}}}',
);
const handler = createMockHandler(spec, { seed: 1, errorRate: 0 });
const res = handler({ method: "GET", path: "/ping", query: {}, headers: {} });
console.log(res.status, res.body); // 200 { pong: true }
```

### Response selection

The `Prefer` header (RFC 7240) is honoured for two directives. `code=NNN` returns the documented response with that code; values not matching `^[1-5][0-9]{2}$` are ignored, and an undocumented code gives a 400 `application/problem+json`. `example=name` returns the named example. Other preferences are ignored. Without a preference the lowest documented 2xx is returned. A body comes from `example`, else the first `examples` entry, else a deterministic value generated from the schema. With `errorRate`, a seeded generator decides whether a valid request answers 500. Every error response is `application/problem+json` (RFC 9457).

### Routing

Paths are matched segment by segment following OpenAPI 3.1 section 4.8.8: concrete paths take precedence over templated ones. Segments are split on `/` before percent-decoding. A trailing slash is a different path. Request paths longer than 8192 characters get 414.

## API

| Export | Signature | Description |
|---|---|---|
| `loadSpec` | `(text: string) => OpenApiDocument` | Parses a JSON or YAML OpenAPI 3.0.x or 3.1.x document of at most 10 MiB. Only local `#/...` references are supported. |
| `createMockHandler` | `(spec, options?: { seed?, errorRate?, onEvent? }) => MockHandler` | Pure synchronous `(req: MockRequest) => MockResponse`. Throws `RangeError` when `errorRate` is outside [0, 1] or `seed` is not finite. |
| `generateFromSchema` | `(schema: unknown, root?: unknown) => unknown` | Deterministic value for a JSON schema. The optional `root` document resolves local `$ref`. |
| `createRng` | `(seed: number) => () => number` | mulberry32 generator returning numbers in [0, 1). Throws `RangeError` for a non-finite seed. |
| `startServer` | `(handler, options?: { port?, host?, allowedHosts? }) => Promise<{ url, close() }>` | node:http adapter. Default host 127.0.0.1, default port 4010, port 0 picks a free port. Throws `RangeError` for an invalid port. |
| `MockError` | class with `code` | `code` is `parse_error`, `too_large`, `unsupported_version` or `unresolved_ref`. |

### Errors and limits

- Handler responses: 400 (missing required query, header or body; malformed percent-encoding; undocumented `Prefer` code or example; `Prefer` longer than 4096 characters), 404 (no matching path), 405 (path exists but not the method; `allow` header lists the methods), 414 (path longer than 8192), 500 (injected by `errorRate`), 501 (operation documents no usable response).
- Server responses: 403 (Host header not in `allowedHosts`), 413 (request body over 1 MiB), 415 (non-JSON request body), 400 (invalid JSON body).
- Specification limits: 10 MiB source size, 1,000,000 nodes, at most 100 YAML aliases, duplicate YAML keys rejected.
- Generation limits: nesting depth 5, at most 100,000 generated nodes, arrays of at most 100 items, strings of at most 10,000 characters, `$ref` cycles yield `null`.

## CLI

```sh
openapi-mock <spec> [--port 4010] [--host 127.0.0.1] [--seed 1] [--error-rate 0..1] [--dry-run]
```

`--dry-run` prints one sorted `METHOD path` line per operation and exits with 0. Otherwise the server runs and prints one `METHOD route status` line per request until SIGINT. Exit codes: `0` success, `1` the server cannot start, `2` invalid specification, bad arguments or an unknown flag.

## Why not Prism

Stoplight Prism is the best-known alternative. It is a large tool with a broader feature set, including validation and proxy mode. This package deliberately covers a smaller surface: a handler and a loopback server that can be used directly in tests. Proxy mode, callbacks, authentication emulation, CORS and latency simulation are not provided.

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model and the practices followed by this repository. The disclosure policy is in [SECURITY.md](SECURITY.md).

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez
