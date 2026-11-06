import type { JsonObject } from "./types.js";

const MAX_REF_HOPS = 16;

/** Returns true for non-null, non-array objects. */
export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Own-property check that ignores the prototype chain. */
export function hasOwn(target: object, key: string): boolean {
  return Object.hasOwn(target, key);
}

/** Defines an own enumerable property, even for keys such as `__proto__`. */
export function setOwn(target: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Shortens text to at most `max` characters. */
export function truncate(text: string, max = 200): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

/**
 * Resolves a local JSON pointer reference such as `#/components/schemas/Pet`.
 * Returns `undefined` when the reference is not local or does not resolve.
 */
export function resolveRef(root: unknown, ref: string): unknown {
  if (ref === "#") {
    return root;
  }
  if (!ref.startsWith("#/")) {
    return undefined;
  }
  let current: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    let token: string;
    try {
      token = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    token = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) {
        return undefined;
      }
      current = current[Number(token)];
    } else if (isObject(current) && hasOwn(current, token)) {
      current = current[token];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Follows `$ref` chains (at most 16 hops) and returns the final value. */
export function deref(root: unknown, value: unknown): unknown {
  let current = value;
  for (let hop = 0; hop <= MAX_REF_HOPS; hop += 1) {
    if (!isObject(current) || typeof current.$ref !== "string") {
      return current;
    }
    current = resolveRef(root, current.$ref);
  }
  return undefined;
}
