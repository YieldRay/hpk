import { describe, it } from "node:test";
import * as assert from "node:assert";
import { setCORSHeaders } from "./middleware.ts";

describe("setCORSHeaders", () => {
  it("fills preflight allow-methods when request header is missing", () => {
    const req = {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
      },
    } as any;

    const headers: Record<string, string | string[] | undefined> = {};
    setCORSHeaders(req, headers, "https://example.com");

    assert.equal(headers["access-control-allow-methods"], "*");
    assert.equal(headers["access-control-allow-headers"], "*");
  });

  it("uses preflight request headers from request object", () => {
    const req = {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "x-custom",
      },
    } as any;

    const headers: Record<string, string | string[] | undefined> = {};
    setCORSHeaders(req, headers, "https://example.com");

    assert.equal(headers["access-control-allow-methods"], "PATCH");
    assert.equal(headers["access-control-allow-headers"], "x-custom");
  });
});
