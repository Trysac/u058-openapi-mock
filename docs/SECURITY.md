# Security practices

How this repository keeps the package and its users safe. The disclosure policy is in [../SECURITY.md](../SECURITY.md).

## Threat model

The package is a development tool. It is intended for loopback use by a developer or a test suite, and it trusts the specification file supplied by its caller.

Defended:

- Oversized specifications: sources over 10 MiB are rejected before parsing; the CLI also checks the file size before reading it.
- YAML abuse: alias expansion is capped at 100 and duplicate keys are rejected.
- Unbounded generation: depth 5, 100,000 nodes, 100 array items, 10,000 string characters, and `$ref` cycles yield `null`.
- Prototype pollution through property names such as `__proto__`: properties are written as own data properties.
- DNS rebinding against the server: a Host header outside `allowedHosts` gets 403. The defaults are `127.0.0.1:<port>` and `localhost:<port>`.
- Large or malformed request bodies: bodies over 1 MiB get 413, non-JSON bodies 415, invalid JSON 400. Bodies above 16 MiB make the server destroy the connection.
- Slow requests: `requestTimeout` is 30 seconds.
- Oversized paths and `Prefer` headers: 8192 and 4096 characters respectively.
- Information leakage in errors: problem details name specification items only and do not echo request data. Error messages are truncated to 200 characters.
- Handler exceptions: the server answers 500 and does not expose the exception.

Not defended:

- Authentication and authorization: the mock performs none and does not emulate them.
- Transport security: the server speaks plain HTTP only and provides no TLS.
- Rate limiting and resource exhaustion from many concurrent connections.
- Request content validation: only presence of required query, header and body values is checked; types, formats and schema constraints of requests are not validated.
- Trust in the specification: a hostile specification can still define large responses within the limits above, and examples are returned verbatim.
- Binding: `startServer` accepts any `host`; binding to a non-loopback interface exposes the mock to the network.
- Error injection is deliberate behaviour and is not a security control.

## Secrets

- No secrets, tokens or credentials in the repository, commit history, logs or prompts.
- `gitleaks` runs as the last step of `npm run check` and as a dedicated CI job. Its configuration is `.gitleaks.toml`.
- Publishing credentials live only in the CI secret store or the maintainer's local npm configuration.

## Dependencies

- The only runtime dependency is `yaml` (`^2.8.0`). Development dependencies are limited to the toolchain listed in [STACK.md](STACK.md).
- Dependabot opens weekly updates for npm packages and GitHub Actions.
- Commit the generated `package-lock.json` so installs are reproducible.

## Code

- No `eval`, dynamic `Function` construction or shelling out from library code.
- Randomness comes only from the seeded mulberry32 generator; `Math.random` is not used.
- Inputs from callers are validated and rejected with explicit errors.

## Publishing

- Packages are published from a clean checkout after `npm run check` passes.
- Only `dist/` is included in the published tarball.
