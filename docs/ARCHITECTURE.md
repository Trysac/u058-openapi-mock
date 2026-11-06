# Architecture

## Overview

`@trysac/openapi-mock` is a TypeScript library published to npm as ES modules with type declarations. It turns an OpenAPI 3.0.x or 3.1.x document into a pure synchronous request handler, and offers a thin node:http adapter and a command-line runner around it. Its only runtime dependency is `yaml`.

## Modules

| Module | Responsibility |
|---|---|
| `src/index.ts` | Public API. Re-exports `loadSpec`, `createMockHandler`, `generateFromSchema`, `createRng`, `startServer`, `MockError` and the public types. |
| `src/spec.ts` | Parses JSON or YAML, enforces the size cap, checks the OpenAPI version and verifies local `$ref` targets. |
| `src/handler.ts` | Routing, request validation, response selection and the seeded error injection of `createMockHandler`. |
| `src/generate.ts` | Deterministic value generation from JSON schemas. |
| `src/prefer.ts` | Parses RFC 7240 `Prefer` headers, keeping only `code` and `example`. |
| `src/problem.ts` | Builds RFC 9457 `application/problem+json` responses. |
| `src/rng.ts` | mulberry32 pseudo random generator. |
| `src/server.ts` | node:http adapter: body limits, content-type checks, Host allow-list and response serialization. |
| `src/cli.ts` | `run()` command-line logic. `src/bin.ts` is the process entry point that calls it. |
| `src/errors.ts` | `MockError` with stable error codes. |
| `src/util.ts` | Shared helpers: own-property access, JSON pointer resolution, truncation. |
| `src/types.ts` | Public request, response, option and document types. |

## Boundaries

- The handler (`createMockHandler`) performs no I/O and holds no clock or randomness other than its seeded generator.
- The server adapter (`startServer`) and the CLI are the only modules that touch the network or the file system.
- Invalid specifications raise `MockError`. Invalid numeric options raise `RangeError`.
- Dependencies beyond `yaml` are justified in [STACK.md](STACK.md).

## Build and distribution

`npm run build` compiles `src/` to `dist/` with `tsconfig.build.json`. Only `dist/` is published (`files` in `package.json`).

## Decisions

Architectural decisions are recorded in [decisions/](decisions/), starting with [0001](decisions/0001-record-architecture-decisions.md).
