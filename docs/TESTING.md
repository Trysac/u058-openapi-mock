# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suites in `test/`.
- Coverage is collected with V8 (`@vitest/coverage-v8`) over `src/`.

## Commands

```sh
npm test            # vitest run --coverage
npx vitest          # watch mode while developing
npm run check       # every gate, including tests
```

## Test files

- `test/fixture.ts`: shared Pets specification (`specObject`, `specText`) and a `request()` helper that builds a `MockRequest` with empty defaults.
- `test/generate.test.ts`: `generateFromSchema` for objects, `const` and `enum`, scalar types, strings and formats, arrays, required properties, nullable and type arrays, `oneOf`/`anyOf`, `allOf` merging, depth limit, local `$ref` resolution and cycles, size bounds, and `__proto__` property names.
- `test/handler.test.ts`: response selection (lowest 2xx, example copies, `Prefer` code and example, undocumented codes and examples rejected with problem responses).
- `test/cli.test.ts`: `run()` for `--dry-run` output, option parsing in both `--name value` and `--name=value` forms, help, usage and spec errors (exit 2), a live server started on port 0 that stops on SIGINT (exit 0), and the start failure path (exit 1).

## Rules

- Coverage must stay at or above 80 % for lines, branches, functions and statements (`vitest.config.ts`). Lowering the thresholds is not allowed.
- Test through the public entry point (`src/index.ts`) where possible and assert observable behavior: return values, thrown errors and their messages.
- Each bug fix adds a test that fails without the fix.
- Tests are deterministic: no network beyond loopback, no real clock or randomness without injection, no shared state between tests. Temporary files go to the OS temp directory and are removed by the test.

## Reports

Coverage reports are written to `coverage/` (text summary and `lcov`). The folder is ignored by git.
