import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import { parse } from "node:url";

/**
 * Create a WebSocket proxy upgrade handler.
 *
 * Attach it to your `http.Server`'s `upgrade` event:
 *
 * ```ts
 * const wsProxy = createWebSocketProxy("https://example.com/ws/");
 * server.on("upgrade", wsProxy);
 * ```
 */
export function createWebSocketProxy(
  target: string,
  options: {
    /**
     * The base pathname. Only upgrade requests whose URL starts with this
     * path are handled. Defaults to "/".
     */
    base?: string;
    onError?: (e: unknown) => void;
  } = {},
): (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => void {
  const { base = "/", onError = console.error } = options;

  return (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const path = req.url || "/";
    if (!path.startsWith(base)) return;

    let replacePath = path.replace(base, "");
    if (target.endsWith("/")) {
      replacePath = replacePath.replace(/^\//, "");
    } else if (!replacePath.startsWith("/")) {
      replacePath = "/" + replacePath;
    }
    const u = target + replacePath;

    const nodeUrl = parse(u, false, true);
    const isSecure =
      nodeUrl.protocol === "wss:" || nodeUrl.protocol === "https:";
    const host = nodeUrl.hostname!;
    const port = nodeUrl.port ? Number(nodeUrl.port) : (isSecure ? 443 : 80);
    const targetPath = nodeUrl.path || "/";

    // Build the forwarded request headers, replacing host
    const headers = { ...req.headers };
    delete headers["host"];
    headers["host"] = nodeUrl.host || host;

    // Rebuild the HTTP/1.1 upgrade request to send to the target
    const requestLine = `GET ${targetPath} HTTP/1.1\r\n`;
    const headerLines =
      Object.entries(headers)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join("\r\n") + "\r\n\r\n";

    const connectOptions = { host, port };

    const upstream: net.Socket = isSecure
      ? tls.connect({ ...connectOptions, servername: host })
      : net.connect(connectOptions);

    upstream.on("connect", () => {
      upstream.write(requestLine + headerLines);
      if (head && head.length > 0) upstream.write(head);
    });

    upstream.on("error", (e) => {
      onError(e);
      socket.destroy();
    });

    socket.on("error", (e) => {
      onError(e);
      upstream.destroy();
    });

    // Once the upstream sends back the 101 Switching Protocols response,
    // pipe both sockets together bidirectionally.
    upstream.once("data", (chunk: Buffer) => {
      socket.write(chunk);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
  };
}
