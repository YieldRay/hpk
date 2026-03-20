import { describe, it } from "node:test";
import * as assert from "node:assert";
import http from "node:http";
import { setCORSHeaders, createCORSMiddleware } from "./middleware.ts";

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

function makeServer(
  middleware: ReturnType<typeof createCORSMiddleware>,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      middleware(req, res);
      res.end();
    });
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

function request(
  options: http.RequestOptions,
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      res.resume();
      res.on("end", () =>
        resolve({ status: res.statusCode!, headers: res.headers }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("createCORSMiddleware", () => {
  it("allows all origins when no allowedOrigins provided", async () => {
    const { server, port } = await makeServer(createCORSMiddleware());
    try {
      const { headers } = await request({
        host: "127.0.0.1",
        port,
        path: "/",
        headers: { origin: "https://example.com" },
      });
      assert.equal(
        headers["access-control-allow-origin"],
        "https://example.com",
      );
      assert.equal(headers["access-control-allow-credentials"], "true");
    } finally {
      server.close();
    }
  });

  it("reflects * for null origin when no allowedOrigins provided", async () => {
    const { server, port } = await makeServer(createCORSMiddleware());
    try {
      const { headers } = await request({
        host: "127.0.0.1",
        port,
        path: "/",
        headers: { origin: "null" },
      });
      assert.equal(headers["access-control-allow-origin"], "*");
    } finally {
      server.close();
    }
  });

  it("sets specific allowed origins when provided", async () => {
    const { server, port } = await makeServer(
      createCORSMiddleware(["https://allowed.com"]),
    );
    try {
      const { headers } = await request({
        host: "127.0.0.1",
        port,
        path: "/",
        headers: { origin: "https://allowed.com" },
      });
      assert.equal(
        headers["access-control-allow-origin"],
        "https://allowed.com",
      );
    } finally {
      server.close();
    }
  });

  it("sets preflight headers for OPTIONS requests", async () => {
    const { server, port } = await makeServer(createCORSMiddleware());
    try {
      const { headers } = await request({
        host: "127.0.0.1",
        port,
        path: "/",
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "DELETE",
          "access-control-request-headers": "x-token",
        },
      });
      assert.equal(headers["access-control-allow-methods"], "DELETE");
      assert.equal(headers["access-control-allow-headers"], "x-token");
      assert.equal(headers["access-control-max-age"], "7200");
    } finally {
      server.close();
    }
  });

  it("sets expose-headers for non-OPTIONS requests", async () => {
    const { server, port } = await makeServer(createCORSMiddleware());
    try {
      const { headers } = await request({
        host: "127.0.0.1",
        port,
        path: "/",
        headers: { origin: "https://example.com" },
      });
      assert.equal(headers["access-control-expose-headers"], "*");
    } finally {
      server.close();
    }
  });

  it("does nothing when request has no origin header", async () => {
    const { server, port } = await makeServer(createCORSMiddleware());
    try {
      const { headers } = await request({
        host: "127.0.0.1",
        port,
        path: "/",
      });
      assert.equal(headers["access-control-allow-origin"], undefined);
    } finally {
      server.close();
    }
  });
});
