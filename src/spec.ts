import { parse } from "yaml";
import { MockError } from "./errors.js";
import type { OpenApiDocument } from "./types.js";
import { isObject, resolveRef, truncate } from "./util.js";

/** Maximum accepted size of a specification in UTF-8 bytes. */
export const MAX_SPEC_BYTES = 10_485_760;

const MAX_NODES = 1_000_000;
const VERSION_PATTERN = /^3[.][01][.][0-9]+(?:-[0-9A-Za-z.-]+)?$/;

function errorCode(error: unknown): string {
  if (isObject(error) && typeof error.code === "string") {
    return error.code;
  }
  return "unknown";
}

function checkRefs(doc: Record<string, unknown>): void {
  const seen = new WeakSet<object>();
  const stack: unknown[] = [doc];
  let nodes = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== "object" || node === null || seen.has(node)) {
      continue;
    }
    seen.add(node);
    nodes += 1;
    if (nodes > MAX_NODES) {
      throw new MockError("too_large", "The document has too many nodes.");
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        stack.push(item);
      }
      continue;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        if (resolveRef(doc, value) === undefined) {
          throw new MockError(
            "unresolved_ref",
            `Unresolved or non-local $ref: ${truncate(value, 100)}`,
          );
        }
      } else {
        stack.push(value);
      }
    }
  }
}

/**
 * Parses an OpenAPI 3.0.x or 3.1.x document written as JSON or YAML.
 *
 * @param text - The document source, at most 10_485_760 UTF-8 bytes.
 * @returns The parsed document.
 * @throws {MockError} `too_large`, `parse_error`, `unsupported_version` or
 * `unresolved_ref` (only local `#/...` references are supported).
 */
export function loadSpec(text: string): OpenApiDocument {
  if (typeof text !== "string") {
    throw new MockError("parse_error", "The specification must be a string.");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_SPEC_BYTES) {
    throw new MockError("too_large", `The specification exceeds ${MAX_SPEC_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = parse(text, { maxAliasCount: 100, uniqueKeys: true });
  } catch (error) {
    throw new MockError(
      "parse_error",
      `The specification is not valid JSON or YAML (${errorCode(error)}).`,
    );
  }
  if (!isObject(parsed)) {
    throw new MockError("parse_error", "The specification must be a mapping at the top level.");
  }
  const version = parsed.openapi;
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new MockError(
      "unsupported_version",
      "Only OpenAPI 3.0.x and 3.1.x documents are supported.",
    );
  }
  checkRefs(parsed);
  return parsed as OpenApiDocument;
}
