import type { MockRequest } from "../src/types.js";

const jsonContent = (example: unknown): object => ({
  "application/json": { example },
});

export const specObject = {
  openapi: "3.0.3",
  info: { title: "Pets", version: "1.0.0" },
  paths: {
    "/pets": {
      get: {
        parameters: [
          {
            name: "limit",
            in: "query",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Pet" },
                },
              },
            },
          },
        },
      },
      post: {
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "201": { description: "created" } },
      },
    },
    "/pets/mine": {
      get: {
        responses: {
          "200": {
            description: "mine",
            content: jsonContent({ id: 99, name: "mine" }),
          },
        },
      },
    },
    "/pets/{id}": {
      get: {
        responses: {
          "201": { description: "created", content: jsonContent({ id: 201 }) },
          "200": {
            description: "ok",
            content: {
              "application/json": {
                example: { id: 1, name: "Rex" },
                examples: { cat: { value: { id: 2, name: "Cat" } } },
              },
            },
          },
          "404": {
            description: "not found",
            content: jsonContent({ message: "not found" }),
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "integer", minimum: 1 },
          name: { type: "string" },
          tag: { type: "string" },
        },
      },
    },
  },
};

export const specText = JSON.stringify(specObject);

/** Builds a mock request with empty defaults. */
export function request(
  method: string,
  path: string,
  init: {
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): MockRequest {
  return {
    method,
    path,
    query: init.query ?? {},
    headers: init.headers ?? {},
    body: init.body,
  };
}
