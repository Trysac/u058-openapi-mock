import { describe, expect, it } from "vitest";
import { parsePrefer } from "../src/prefer.js";

describe("parsePrefer", () => {
  it("reads code in the accepted spellings", () => {
    expect(parsePrefer("code=404").code).toBe("404");
    expect(parsePrefer('code="404"').code).toBe("404");
    expect(parsePrefer("respond-async, CODE=404").code).toBe("404");
    expect(parsePrefer("code = 404").code).toBe("404");
    expect(parsePrefer(" , ,code=201").code).toBe("201");
    expect(parsePrefer("code=404;foo=bar").code).toBe("404");
  });

  it("ignores invalid codes and keeps the first valid one", () => {
    expect(parsePrefer("code=4044").code).toBeUndefined();
    expect(parsePrefer("code=040").code).toBeUndefined();
    expect(parsePrefer("code=600").code).toBeUndefined();
    expect(parsePrefer("code=abc, code=500").code).toBe("500");
    expect(parsePrefer("code=404, code=500").code).toBe("404");
  });

  it("reads example with quoting rules", () => {
    expect(parsePrefer("example=cat").example).toBe("cat");
    expect(parsePrefer('example="a,b"').example).toBe("a,b");
    expect(parsePrefer('example="a;b"').example).toBe("a;b");
    expect(parsePrefer('example="a\\"b"').example).toBe('a"b');
    expect(parsePrefer("example=").example).toBeUndefined();
    expect(parsePrefer("example=a, example=b").example).toBe("a");
  });

  it("ignores other preferences", () => {
    const result = parsePrefer("respond-async, wait=10;x=y, handling=lenient");
    expect(result.code).toBeUndefined();
    expect(result.example).toBeUndefined();
    expect(parsePrefer("").code).toBeUndefined();
  });
});
