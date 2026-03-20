import { describe, it } from "node:test";
import * as assert from "node:assert";
import net from "node:net";
import http from "node:http";
import { createWebSocketProxy } from "./ws.ts";

const WS_101 =
  "HTTP/1.1 101 Switching Protocols\r\n" +
  "Upgrade: websocket\r\n" +
  "Connection: Upgrade\r\n" +
  "\r\n";

/** Fake upstream: responds 101 then echoes data back. */
function createFakeWsServer(
  onRequest?: (raw: string) => void,
): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.once("data", (chunk) => {
        onRequest?.(chunk.toString());
        socket.write(WS_101);
        socket.pipe(socket); // echo
      });
    });
    // unref so the server doesn't keep the process alive after tests
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as net.AddressInfo).port });
    });
  });
}

/** Proxy HTTP server that attaches createWebSocketProxy to its upgrade event. */
function createProxyServer(
  target: string,
  options?: Parameters<typeof createWebSocketProxy>[1],
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.on("upgrade", createWebSocketProxy(target, options));
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as net.AddressInfo).port });
    });
  });
}

function sendUpgradeRequest(socket: net.Socket, path: string, host: string) {
  socket.write(
    `GET ${path} HTTP/1.1\r\n` +
      `Host: ${host}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
      `Sec-WebSocket-Version: 13\r\n` +
      `\r\n`,
  );
}

/** Read from socket until predicate returns true or timeout (ms) elapses. */
function readUntil(
  socket: net.Socket,
  predicate: (buf: string) => boolean,
  timeout = 2000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => resolve(buf), timeout);
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      if (predicate(buf)) {
        clearTimeout(timer);
        resolve(buf);
      }
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(buf);
    });
  });
}

describe("createWebSocketProxy", () => {
  it("proxies a WebSocket upgrade and tunnels data bidirectionally", async () => {
    const { server: upstream, port: upstreamPort } = await createFakeWsServer();
    const { server: proxy, port: proxyPort } = await createProxyServer(
      `http://127.0.0.1:${upstreamPort}/`,
    );

    const socket = net.connect(proxyPort, "127.0.0.1");
    socket.unref();
    try {
      sendUpgradeRequest(socket, "/", `127.0.0.1:${proxyPort}`);

      const response = await readUntil(socket, (b) => b.includes("\r\n\r\n"));
      assert.ok(response.includes("101"), `Expected 101, got: ${response}`);
      assert.ok(
        response.includes("Upgrade: websocket"),
        `Missing Upgrade header`,
      );

      // Verify bidirectional tunnel: echo "hello"
      const echoed = await new Promise<string>((resolve, reject) => {
        socket.once("data", (chunk) => resolve(chunk.toString()));
        socket.once("error", reject);
        socket.write("hello");
      });
      assert.equal(echoed, "hello");
    } finally {
      socket.destroy();
      proxy.close();
      upstream.close();
    }
  });

  it("ignores upgrade requests that don't match base path", async () => {
    const { server: upstream, port: upstreamPort } = await createFakeWsServer();
    const { server: proxy, port: proxyPort } = await createProxyServer(
      `http://127.0.0.1:${upstreamPort}/`,
      { base: "/ws/" },
    );

    const socket = net.connect(proxyPort, "127.0.0.1");
    socket.unref();
    try {
      sendUpgradeRequest(socket, "/other/path", `127.0.0.1:${proxyPort}`);

      // Proxy doesn't handle it — no 101 should come back within timeout
      const result = await readUntil(socket, (b) => b.includes("101"), 300);
      assert.ok(
        !result.includes("101"),
        `Should not have gotten 101, got: ${result}`,
      );
    } finally {
      socket.destroy();
      proxy.close();
      upstream.close();
    }
  });

  it("rewrites host header to target host", async () => {
    let receivedHeaders = "";
    const { server: upstream, port: upstreamPort } = await createFakeWsServer(
      (raw) => {
        receivedHeaders = raw;
      },
    );
    const { server: proxy, port: proxyPort } = await createProxyServer(
      `http://127.0.0.1:${upstreamPort}/`,
    );

    const socket = net.connect(proxyPort, "127.0.0.1");
    socket.unref();
    try {
      // Send with a client-side host header that differs from the target
      socket.write(
        `GET / HTTP/1.1\r\n` +
          `Host: original-client-host.example.com\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
          `Sec-WebSocket-Version: 13\r\n` +
          `\r\n`,
      );

      await readUntil(socket, (b) => b.includes("101"));

      const hostLine = receivedHeaders
        .split("\r\n")
        .find((l) => l.toLowerCase().startsWith("host:"));
      assert.ok(hostLine, "Host header should be present in upstream request");
      assert.ok(
        hostLine!.includes(`127.0.0.1:${upstreamPort}`),
        `Host should be rewritten to target, got: ${hostLine}`,
      );
    } finally {
      socket.destroy();
      proxy.close();
      upstream.close();
    }
  });

  it("calls onError when upstream is unreachable", async () => {
    const errors: unknown[] = [];
    const { server: proxy, port: proxyPort } = await createProxyServer(
      "http://127.0.0.1:1/", // port 1 is not listening
      { onError: (e) => errors.push(e) },
    );

    const socket = net.connect(proxyPort, "127.0.0.1");
    socket.unref();
    try {
      sendUpgradeRequest(socket, "/", `127.0.0.1:${proxyPort}`);

      // Wait for socket to close (proxy destroys it on upstream error)
      await new Promise<void>((resolve) => {
        socket.on("close", resolve);
        socket.on("error", resolve as () => void);
      });

      assert.ok(errors.length > 0, "onError should have been called");
    } finally {
      socket.destroy();
      proxy.close();
    }
  });

  it("handles 101 response split across multiple TCP chunks", async () => {
    // Send the 101 response in two parts with a timer between them to guarantee
    // the proxy receives two separate data events rather than one coalesced chunk.
    const { server: upstream, port: upstreamPort } = await new Promise<{
      server: net.Server;
      port: number;
    }>((resolve) => {
      const server = net.createServer((socket) => {
        socket.setNoDelay(true);
        socket.once("data", () => {
          // Set up echo before sending the 101 so it's ready when the tunnel opens
          socket.on("data", (chunk) => socket.write(chunk));
          socket.write("HTTP/1.1 101 Switching Protocols\r\n", () => {
            setTimeout(() => {
              socket.write("Upgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
            }, 10);
          });
        });
      });
      server.unref();
      server.listen(0, "127.0.0.1", () => {
        resolve({ server, port: (server.address() as net.AddressInfo).port });
      });
    });
    const { server: proxy, port: proxyPort } = await createProxyServer(
      `http://127.0.0.1:${upstreamPort}/`,
    );

    const socket = net.connect(proxyPort, "127.0.0.1");
    socket.unref();
    try {
      sendUpgradeRequest(socket, "/", `127.0.0.1:${proxyPort}`);

      const response = await readUntil(socket, (b) => b.includes("\r\n\r\n"));
      assert.ok(response.includes("101"), `Expected 101, got: ${response}`);

      // Verify the tunnel works after a split 101
      const echoed = await new Promise<string>((resolve, reject) => {
        socket.once("data", (chunk) => resolve(chunk.toString()));
        socket.once("error", reject);
        socket.write("ping");
      });
      assert.equal(echoed, "ping");
    } finally {
      socket.destroy();
      proxy.close();
      upstream.close();
    }
  });

  it("appends request path onto target base path", async () => {
    let receivedPath = "";
    const { server: upstream, port: upstreamPort } = await createFakeWsServer(
      (raw) => {
        receivedPath = raw.split("\r\n")[0].split(" ")[1]; // GET <path> HTTP/1.1
      },
    );
    const { server: proxy, port: proxyPort } = await createProxyServer(
      `http://127.0.0.1:${upstreamPort}/base/`,
      { base: "/ws/" },
    );

    const socket = net.connect(proxyPort, "127.0.0.1");
    socket.unref();
    try {
      sendUpgradeRequest(socket, "/ws/room/42", `127.0.0.1:${proxyPort}`);
      await readUntil(socket, (b) => b.includes("101"));

      assert.equal(receivedPath, "/base/room/42");
    } finally {
      socket.destroy();
      proxy.close();
      upstream.close();
    }
  });
});
