import type { JsonObject } from "./types.js";
import { hasOwn, isObject, resolveRef, setOwn } from "./util.js";

const MAX_DEPTH = 5;
const MAX_NODES = 100_000;
const MAX_ITEMS = 100;
const MAX_STRING_LENGTH = 10_000;
const MAX_REF_CHAIN = 32;
const MAX_RECURSION = 200;

interface Context {
  readonly root: unknown;
  nodes: number;
  active: number;
}

/**
 * Generates a fully deterministic value for a JSON schema.
 *
 * Rules: `const`, else the first `enum` value, else by type (integer and
 * number use `minimum` or 0, boolean false, string 'string' padded with x to
 * `minLength`, formats date-time, date, email and uuid, objects fill required
 * properties or all properties, arrays emit max(minItems, 1) items).
 * `oneOf` and `anyOf` use the first branch, `allOf` merges objects. Nesting
 * deeper than 5 levels and `$ref` cycles yield `null`.
 *
 * @param schema - The schema object.
 * @param root - Document used to resolve local `$ref` pointers.
 */
export function generateFromSchema(schema: unknown, root?: unknown): unknown {
  return generate(schema, { root, nodes: 0, active: 0 }, 0, []);
}

function generate(schema: unknown, ctx: Context, depth: number, refs: readonly string[]): unknown {
  ctx.nodes += 1;
  if (depth > MAX_DEPTH || ctx.nodes > MAX_NODES || ctx.active >= MAX_RECURSION) {
    return null;
  }
  ctx.active += 1;
  try {
    return generateInner(schema, ctx, depth, refs);
  } finally {
    ctx.active -= 1;
  }
}

function generateInner(
  schema: unknown,
  ctx: Context,
  depth: number,
  refs: readonly string[],
): unknown {
  if (!isObject(schema)) {
    return null;
  }
  const ref = schema.$ref;
  if (typeof ref === "string") {
    if (refs.includes(ref) || refs.length >= MAX_REF_CHAIN) {
      return null;
    }
    return generate(resolveRef(ctx.root, ref), ctx, depth, [...refs, ref]);
  }
  if (hasOwn(schema, "const")) {
    return structuredClone(schema.const);
  }
  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return structuredClone(enumValues[0]);
  }
  const allOf = schema.allOf;
  if (Array.isArray(allOf) && allOf.length > 0) {
    return generateAllOf(schema, allOf, ctx, depth, refs);
  }
  for (const key of ["oneOf", "anyOf"]) {
    const branches = schema[key];
    if (Array.isArray(branches) && branches.length > 0) {
      return generate(branches[0], ctx, depth, refs);
    }
  }
  const type = pickType(schema);
  if (type === "integer") {
    return generateNumber(schema, true);
  }
  if (type === "number") {
    return generateNumber(schema, false);
  }
  if (type === "boolean") {
    return false;
  }
  if (type === "string") {
    return generateString(schema);
  }
  if (type === "array") {
    return generateArray(schema, ctx, depth, refs);
  }
  if (type === "object") {
    return generateObject(schema, ctx, depth, refs);
  }
  return null;
}

function pickType(schema: JsonObject): string | undefined {
  const type = schema.type;
  if (typeof type === "string") {
    return type;
  }
  if (Array.isArray(type)) {
    const first = type.find(
      (entry): entry is string => typeof entry === "string" && entry !== "null",
    );
    if (first !== undefined) {
      return first;
    }
    return type.includes("null") ? "null" : undefined;
  }
  if (
    hasOwn(schema, "properties") ||
    hasOwn(schema, "required") ||
    hasOwn(schema, "additionalProperties")
  ) {
    return "object";
  }
  if (hasOwn(schema, "items")) {
    return "array";
  }
  return undefined;
}

function generateNumber(schema: JsonObject, integer: boolean): number {
  const minimum = schema.minimum;
  const base = typeof minimum === "number" && Number.isFinite(minimum) ? minimum : 0;
  return (integer ? Math.ceil(base) : base) + 0;
}

function generateString(schema: JsonObject): string {
  const format = schema.format;
  if (format === "date-time") {
    return "2024-01-01T00:00:00Z";
  }
  if (format === "date") {
    return "2024-01-01";
  }
  if (format === "email") {
    return "user@example.com";
  }
  if (format === "uuid") {
    return "00000000-0000-4000-8000-000000000000";
  }
  const minLength = schema.minLength;
  const length =
    typeof minLength === "number" && Number.isFinite(minLength)
      ? Math.min(Math.max(Math.floor(minLength), 0), MAX_STRING_LENGTH)
      : 0;
  return "string".padEnd(length, "x");
}

function generateArray(
  schema: JsonObject,
  ctx: Context,
  depth: number,
  refs: readonly string[],
): unknown[] {
  const minItems = schema.minItems;
  const wanted =
    typeof minItems === "number" && Number.isFinite(minItems) ? Math.floor(minItems) : 0;
  const count = Math.min(Math.max(wanted, 1), MAX_ITEMS);
  const items: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    items.push(generate(schema.items, ctx, depth + 1, refs));
  }
  return items;
}

function generateObject(
  schema: JsonObject,
  ctx: Context,
  depth: number,
  refs: readonly string[],
): JsonObject {
  const properties: JsonObject = isObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : [];
  const names = Object.keys(properties);
  const selected = required.length > 0 ? names.filter((n) => required.includes(n)) : names;
  const result: JsonObject = {};
  for (const name of selected) {
    setOwn(result, name, generate(properties[name], ctx, depth + 1, refs));
  }
  return result;
}

function generateAllOf(
  schema: JsonObject,
  parts: unknown[],
  ctx: Context,
  depth: number,
  refs: readonly string[],
): unknown {
  const all = [...parts];
  if (hasOwn(schema, "properties") || hasOwn(schema, "type")) {
    all.push(Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "allOf")));
  }
  const results = all.map((part) => generate(part, ctx, depth, refs));
  const merged: JsonObject = {};
  let sawObject = false;
  for (const result of results) {
    if (isObject(result)) {
      sawObject = true;
      for (const [key, value] of Object.entries(result)) {
        setOwn(merged, key, value);
      }
    }
  }
  if (sawObject) {
    return merged;
  }
  return results.find((result) => result !== null) ?? null;
}
