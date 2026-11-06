# Pure mock handler with deterministic bodies and a thin node:http adapter

Status: accepted (generated, pending human review)

## Context

Frontend and integration work needs mocks that stay aligned with the OpenAPI contract without installing a heavy mock server. Mocks must be testable in process and reproducible: the same request and seed must always give the same answer, including injected failures.

## Decision

The core is a pure synchronous function (MockRequest) => MockResponse built from a loaded document. Routing follows OpenAPI 3.1 section 4.8.8 (split on / before percent-decoding, concrete segments before templated ones). Response choice uses the RFC 7240 Prefer header (code and example, as Stoplight Prism does) and otherwise the lowest documented 2xx. Bodies come from examples or from a fully deterministic schema generator with depth, node and size caps. Failure injection uses a mulberry32 generator with exactly one draw per request and never Math.random. All errors are RFC 9457 problem+json whose detail names only specification items. A thin node:http adapter (loopback by default, 1 MiB body cap, JSON-only bodies, Host allow-list against DNS rebinding) and a CLI wrap the handler. The only runtime dependency is yaml, used with maxAliasCount 100 and uniqueKeys.

## Consequences

Handlers are trivial to test and embed because they have no I/O or clock. Bodies are never random, so tests are stable but not varied. Only local references are supported and no validation, callbacks, auth, CORS, proxying or latency are emulated. The generator caps (depth 5, 100 items, 100k nodes, 10k string length) trade completeness for safety on hostile specifications.
