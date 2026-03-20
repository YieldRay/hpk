import { describe, it } from "node:test";
import * as assert from "node:assert";
import http from "node:http";
import { createProxyMiddleware } from "./core.ts";

/** Spin up a simple HTTP server acting as the upstream target. */
function createUpstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port, url: `http://127.0.0.1:${port}/` });
    });
  });
}

/** Spin up a proxy server using createProxyMiddleware. */
function createProxy(
  ...args: Parameters<typeof createProxyMiddleware>
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const middleware = createProxyMiddleware(...args);
    const server = http.createServer((req, res) => {
      middleware(req, res);
    });
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port });
    });
  });
}

/** Make an HTTP request and return status + headers + body. */
function fetch(
  options: http.RequestOptions,
  body?: string,
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode!, headers: res.headers, body: data }),
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("createProxyMiddleware", () => {
  it("proxies a GET request and returns the upstream body", async () => {
    const { port: upPort, server: up } = await createUpstream((_, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello from upstream");
    });
    const { port: proxyPort, server: proxy } = await createProxy(
      `http://127.0.0.1:${upPort}/`,
    );

    try {
      const { status, body } = await fetch({
        host: "127.0.0.1",
        port: proxyPort,
        path: "/",
      });
      assert.equal(status, 200);
      assert.equal(body, "hello from upstream");
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("forwards request path to upstream", async () => {
    let receivedPath = "";
    const { port: upPort, server: up } = await createUpstream((req, res) => {
      receivedPath = req.url!;
      res.writeHead(200);
      res.end();
    });
    const { port: proxyPort, server: proxy } = await createProxy(
      `http://127.0.0.1:${upPort}/`,
    );

    try {
      await fetch({ host: "127.0.0.1", port: proxyPort, path: "/foo/bar?q=1" });
      assert.equal(receivedPath, "/foo/bar?q=1");
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("rewrites host header to target host", async () => {
    let receivedHost = "";
    const { port: upPort, server: up } = await createUpstream((req, res) => {
      receivedHost = req.headers.host!;
      res.writeHead(200);
      res.end();
    });
    const { port: proxyPort, server: proxy } = await createProxy(
      `http://127.0.0.1:${upPort}/`,
    );

    try {
      await fetch({
        host: "127.0.0.1",
        port: proxyPort,
        path: "/",
        headers: { host: "original.example.com" },
      });
      assert.equal(receivedHost, `127.0.0.1:${upPort}`);
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("strips hop-by-hop headers before forwarding", async () => {
    let upstreamHeaders: http.IncomingHttpHeaders = {};
    const { port: upPort, server: up } = await createUpstream((req, res) => {
      upstreamHeaders = req.headers;
      res.writeHead(200);
      res.end();
    });
    const { port: proxyPort, server: proxy } = await createProxy(
      `http://127.0.0.1:${upPort}/`,
    );

    try {
      await fetch({
        host: "127.0.0.1",
        port: proxyPort,
        path: "/",
        headers: {
          "proxy-connection": "keep-alive",
          "keep-alive": "timeout=5",
          te: "trailers",
          "transfer-encoding": "chunked",
          upgrade: "websocket",
          "x-custom": "preserved",
        },
      });
      assert.equal(upstreamHeaders["proxy-connection"], undefined);
      assert.equal(upstreamHeaders["keep-alive"], undefined);
      assert.equal(upstreamHeaders["te"], undefined);
      assert.equal(upstreamHeaders["transfer-encoding"], undefined);
      assert.equal(upstreamHeaders["upgrade"], undefined);
      assert.equal(upstreamHeaders["x-custom"], "preserved");
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("does not override content-length for DELETE when already set", async () => {
    let receivedContentLength = "";
    const { port: upPort, server: up } = await createUpstream((req, res) => {
      receivedContentLength = req.headers["content-length"] ?? "";
      res.writeHead(200);
      res.end();
    });
    const { port: proxyPort, server: proxy } = await createProxy(
      `http://127.0.0.1:${upPort}/`,
    );

    try {
      await fetch(
        {
          host: "127.0.0.1",
          port: proxyPort,
          path: "/",
          method: "DELETE",
          headers: { "content-length": "5" },
        },
        "hello",
      );
      assert.equal(receivedContentLength, "5");
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("ignores requests that don't match base path", async () => {
    let called = false;
    const { port: upPort, server: up } = await createUpstream((_, res) => {
      called = true;
      res.writeHead(200);
      res.end();
    });
    // Mount proxy only at /api/
    const middleware = createProxyMiddleware({
      target: `http://127.0.0.1:${upPort}/`,
      base: "/api/",
    });
    const { port: proxyPort, server: proxy } = await new Promise<{
      server: http.Server;
      port: number;
    }>((resolve) => {
      const server = http.createServer((req, res) => {
        middleware(req, res);
        // If middleware didn't handle it, send a 404
        if (!res.headersSent) {
          res.writeHead(404);
          res.end("not found");
        }
      });
      server.unref();
      server.listen(0, "127.0.0.1", () => {
        resolve({ server, port: (server.address() as { port: number }).port });
      });
    });

    try {
      const { status, body } = await fetch({
        host: "127.0.0.1",
        port: proxyPort,
        path: "/other/path",
      });
      assert.equal(status, 404);
      assert.equal(body, "not found");
      assert.equal(called, false);
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("strips base path before forwarding to upstream", async () => {
    let receivedPath = "";
    const { port: upPort, server: up } = await createUpstream((req, res) => {
      receivedPath = req.url!;
      res.writeHead(200);
      res.end();
    });
    const { port: proxyPort, server: proxy } = await createProxy({
      target: `http://127.0.0.1:${upPort}/`,
      base: "/api/",
    });

    try {
      await fetch({
        host: "127.0.0.1",
        port: proxyPort,
        path: "/api/users?page=2",
      });
      assert.equal(receivedPath, "/users?page=2");
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("removes restriction headers when removeRestrictionHeaders is true", async () => {
    const { port: upPort, server: up } = await createUpstream((_, res) => {
      res.writeHead(200, {
        "x-frame-options": "DENY",
        "content-security-policy": "default-src 'none'",
        "strict-transport-security": "max-age=31536000",
        "x-custom": "keep-me",
      });
      res.end("body");
    });
    const { port: proxyPort, server: proxy } = await createProxy({
      target: `http://127.0.0.1:${upPort}/`,
      removeRestrictionHeaders: true,
    });

    try {
      const { headers } = await fetch({
        host: "127.0.0.1",
        port: proxyPort,
        path: "/",
      });
      assert.equal(headers["x-frame-options"], undefined);
      assert.equal(headers["content-security-policy"], undefined);
      assert.equal(headers["strict-transport-security"], undefined);
      assert.equal(headers["x-custom"], "keep-me");
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("keeps restriction headers when removeRestrictionHeaders is false (default)", async () => {
    const { port: upPort, server: up } = await createUpstream((_, res) => {
      res.writeHead(200, { "x-frame-options": "DENY" });
      res.end();
    });
    const { port: proxyPort, server: proxy } = await createProxy(
      `http://127.0.0.1:${upPort}/`,
    );

    try {
      const { headers } = await fetch({
        host: "127.0.0.1",
        port: proxyPort,
        path: "/",
      });
      assert.equal(headers["x-frame-options"], "DENY");
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("accepts string shorthand for target", async () => {
    const { port: upPort, server: up } = await createUpstream((_, res) => {
      res.writeHead(201);
      res.end("created");
    });
    const { port: proxyPort, server: proxy } = await createProxy(
      `http://127.0.0.1:${upPort}/`,
    );

    try {
      const { status, body } = await fetch({
        host: "127.0.0.1",
        port: proxyPort,
        path: "/",
      });
      assert.equal(status, 201);
      assert.equal(body, "created");
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("applies rewriteRequestOptions callback", async () => {
    let receivedHeader = "";
    const { port: upPort, server: up } = await createUpstream((req, res) => {
      receivedHeader = req.headers["x-injected"] as string;
      res.writeHead(200);
      res.end();
    });
    const { port: proxyPort, server: proxy } = await createProxy(
      `http://127.0.0.1:${upPort}/`,
      (opts) => {
        (opts.headers as Record<string, string>)["x-injected"] = "from-rewrite";
        return opts;
      },
    );

    try {
      await fetch({ host: "127.0.0.1", port: proxyPort, path: "/" });
      assert.equal(receivedHeader, "from-rewrite");
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("applies rewriteResponseOptions callback", async () => {
    const { port: upPort, server: up } = await createUpstream((_, res) => {
      res.writeHead(200);
      res.end("original");
    });
    const { port: proxyPort, server: proxy } = await createProxy(
      `http://127.0.0.1:${upPort}/`,
      undefined,
      (res) => ({ ...res, statusCode: 202 }),
    );

    try {
      const { status } = await fetch({
        host: "127.0.0.1",
        port: proxyPort,
        path: "/",
      });
      assert.equal(status, 202);
    } finally {
      proxy.close();
      up.close();
    }
  });

  it("calls onError when upstream is unreachable", async () => {
    const errors: unknown[] = [];
    const { server: proxy, port: proxyPort } = await createProxy({
      target: "http://127.0.0.1:1/", // port 1 not listening
      onError: (e) => errors.push(e),
    });

    try {
      await new Promise<void>((resolve) => {
        const clientReq = http.request(
          { host: "127.0.0.1", port: proxyPort, path: "/" },
          (res) => {
            res.resume();
          },
        );
        clientReq.on("error", () => {});
        // unref so this socket doesn't keep the event loop alive
        clientReq.once("socket", (s) => s.unref());
        clientReq.end();

        const interval = setInterval(() => {
          if (errors.length > 0) {
            clearInterval(interval);
            clientReq.destroy();
            resolve();
          }
        }, 10);
        setTimeout(() => {
          clearInterval(interval);
          clientReq.destroy();
          resolve();
        }, 2000);
      });

      assert.ok(errors.length > 0, "onError should have been called");
    } finally {
      proxy.close();
    }
  });

  it("forwards POST body to upstream", async () => {
    let receivedBody = "";
    const { port: upPort, server: up } = await createUpstream((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        receivedBody = data;
        res.writeHead(200);
        res.end();
      });
    });
    const { port: proxyPort, server: proxy } = await createProxy(
      `http://127.0.0.1:${upPort}/`,
    );

    try {
      await fetch(
        {
          host: "127.0.0.1",
          port: proxyPort,
          path: "/",
          method: "POST",
          headers: { "content-length": "5" },
        },
        "hello",
      );
      assert.equal(receivedBody, "hello");
    } finally {
      proxy.close();
      up.close();
    }
  });
});
