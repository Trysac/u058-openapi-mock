import type { MockResponse } from "./types.js";
import { truncate } from "./util.js";

const TITLES: Record<number, string> = {
  400: "Bad Request",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  500: "Internal Server Error",
  501: "Not Implemented",
};

/**
 * Builds an RFC 9457 `application/problem+json` response.
 * The detail must name specification items only and never echo request data.
 */
export function problem(
  status: number,
  detail: string,
  headers: Record<string, string> = {},
): MockResponse {
  return {
    status,
    headers: { ...headers, "content-type": "application/problem+json" },
    body: {
      type: "about:blank",
      title: TITLES[status] ?? "Error",
      status,
      detail: truncate(detail),
    },
  };
}
