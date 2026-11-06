/** Directives extracted from a Prefer header. */
export interface PreferDirectives {
  /** The first valid `code=NNN` value (three digits, 1xx to 5xx). */
  readonly code: string | undefined;
  /** The first non-empty `example=name` value. */
  readonly example: string | undefined;
}

const CODE_PATTERN = /^[1-5][0-9]{2}$/;

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const ch of input) {
    if (quoted) {
      current += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        quoted = false;
      }
    } else if (ch === '"') {
      quoted = true;
      current += ch;
    } else if (ch === separator) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }
  let result = "";
  let escaped = false;
  for (const ch of value.slice(1, -1)) {
    if (!escaped && ch === "\\") {
      escaped = true;
      continue;
    }
    result += ch;
    escaped = false;
  }
  return result;
}

/**
 * Parses a Prefer header per RFC 7240 section 2: comma-separated preferences,
 * case-insensitive names, optionally quoted values, parameters ignored.
 * Only `code` and `example` are honoured; everything else is ignored.
 */
export function parsePrefer(header: string): PreferDirectives {
  let code: string | undefined;
  let example: string | undefined;
  for (const preference of splitTopLevel(header, ",")) {
    const head = (splitTopLevel(preference, ";")[0] ?? "").trim();
    const eq = head.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const name = head.slice(0, eq).trim().toLowerCase();
    const value = unquote(head.slice(eq + 1).trim());
    if (name === "code" && code === undefined && CODE_PATTERN.test(value)) {
      code = value;
    } else if (name === "example" && example === undefined && value !== "") {
      example = value;
    }
  }
  return { code, example };
}
