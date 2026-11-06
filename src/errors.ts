import { truncate } from "./util.js";

/** Stable machine-readable error codes of the library. */
export type MockErrorCode = "parse_error" | "too_large" | "unsupported_version" | "unresolved_ref";

/** Base error of the library. Messages never exceed 200 characters. */
export class MockError extends Error {
  /** Stable machine-readable code. */
  readonly code: MockErrorCode;

  constructor(code: MockErrorCode, message: string) {
    super(truncate(message));
    this.name = "MockError";
    this.code = code;
  }
}
