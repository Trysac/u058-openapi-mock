# Project record: openapi-mock

## Objective

Provide a pure, synchronous mock HTTP handler generated from an OpenAPI 3.0.x or 3.1.x document, so that frontend and integration work can proceed before the real API exists and mocks stay aligned with the contract. The measurable outcomes are the acceptance behaviours checked by the test suites: for example, a `GET /pets/1` request returns the documented 200 example with `content-type: application/json`, the same seed and error rate always produce the same status sequence, and undocumented `Prefer` codes return a 400 problem response. The intended users are developers writing tests or small prototypes against an OpenAPI contract.

## Scope

In scope:

- The public API documented in the README: `loadSpec`, `createMockHandler`, `generateFromSchema`, `createRng`, `startServer`, `MockError`.
- Routing per OpenAPI 3.1 section 4.8.8, RFC 7240 `Prefer` handling for `code` and `example`, and RFC 9457 problem responses.
- Deterministic response bodies from examples or from schemas.
- Seeded injection of 500 responses through `errorRate`.
- A node:http loopback adapter with body, content-type and Host checks.
- A command-line runner with `--dry-run`.

Out of scope:

- Full request and response validation against the schema.
- Callbacks, authentication emulation, proxy mode, CORS and latency simulation.
- Remote `$ref` targets; only local `#/...` references are resolved.
- Random generation of example data.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Effort metrics

Measured values only. Leave "pending measurement" until a real figure is recorded; never estimate here.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | 290825 / 124749 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 0.7575 | factory ledger |

## Factory run u058 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | claude-sonnet-5-5 | yes | 2403 | 107905 | 0 | 4473 | 0.5424 |
| audit | claude-sonnet-5-5 | no | 14 | 4340 | 33341 | 171231 | 0.1439 |
| fix-1 | claude-sonnet-5-5 | no | 10 | 2880 | 10527 | 76762 | 0.0628 |
| docs | claude-haiku-5-5 | no | 35932 | 9624 | 0 | 0 | 0.0084 |

Total: $0.7575. Prices: Anthropic list prices.
