#!/usr/bin/env node
import process from "node:process";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { parseArgs, styleText } from "node:util";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createProxyMiddleware } from "./core.ts";
import { isUrl, type LocationStrategy } from "./rewrite.ts";
import { setCORSHeaders } from "./middleware.ts";
import { createWebSocketProxy } from "./ws.ts";

const PORT = Number(process.env.PORT) || 8090;

// https://nodejs.org/api/util.html#utilparseargsconfig
const { values, positionals } = parseArgs({
  options: {
    port: {
      type: "string",
      short: "p",
      default: String(PORT),
    },
    location: {
      type: "string",
      default: "rewrite",
    },
    cors: {
      type: "string",
      multiple: true,
    },
    "no-log": {
      type: "boolean",
      default: false,
    },
    referer: {
      type: "string",
    },
    "no-ws": {
      type: "boolean",
      default: false,
    },
    host: {
      type: "string",
      short: "H",
      default: "::",
    },
    cert: {
      type: "string",
    },
    key: {
      type: "string",
    },
    help: {
      type: "boolean",
      multiple: false,
      short: "h",
      default: false,
    },
    version: {
      type: "boolean",
      short: "v",
      default: false,
    },
  },
  strict: true,
  allowPositionals: true,
});

if (values.help) {
  help();
} else {
  let url = positionals[0];
  if (!url) help();
  if (!isUrl(url)) {
    url = `http://${url}`;
  }

  const corsSet = new Set(
    values.cors?.flatMap((origins) => origins.split(",")),
  );
  const hasStar = corsSet.has("*");
  corsSet.delete("*");

  const https =
    values.cert && values.key
      ? { cert: readFileSync(values.cert), key: readFileSync(values.key) }
      : undefined;

  const host = values.host!;

  server(url, {
    port: Number(values.port),
    host,
    cors: hasStar ? true : [...corsSet].join(","),
    referer: values.referer,
    location: values.location as LocationStrategy,
    ws: !values["no-ws"],
    https,
    // eslint-disable-next-line unicorn/prefer-top-level-await
  }).then((port) => {
    const scheme = https ? "https" : "http";
    const ipv4Only = host === "0.0.0.0";
    const isAllInterfaces = ipv4Only || host === "::";
    const lines = [
      `- Local: ${styleText(["cyan"], `${scheme}://localhost:${port}`)}`,
    ];
    if (isAllInterfaces) {
      const ipv4Lines: string[] = [];
      const ipv6Lines: string[] = [];
      const seen = new Set<string>();
      for (const iface of Object.values(networkInterfaces())) {
        for (const addr of iface ?? []) {
          if (addr.internal || seen.has(addr.address)) continue;
          seen.add(addr.address);
          if (addr.family === "IPv4") {
            ipv4Lines.push(
              `- Network: ${styleText(["cyan"], `${scheme}://${addr.address}:${port}`)}`,
            );
          } else if (
            !ipv4Only &&
            addr.family === "IPv6" &&
            !addr.address.startsWith("fe80")
          ) {
            ipv6Lines.push(
              `- Network: ${styleText(["cyan"], `${scheme}://[${addr.address}]:${port}`)}`,
            );
          }
        }
      }
      lines.push(...ipv4Lines, ...ipv6Lines);
    }
    console.log(
      `${styleText(["bold"], "hpk")} is running for ${styleText(
        ["underline", "bold"],
        url,
      )} and listening on:\n\n${lines.join("\n")}`,
    );
  });
}

function help() {
  console.log(`\
USAGE:
    ${styleText(["bold"], "hpk")} <url> [options]
Options:
    --port <PORT>         Port to listen on         (default: ${PORT})
    --location <STRATEGY> same | rewrite | redirect (default: rewrite)
    --cors [<ORIGIN>...]  Allowed CORS origin
    --referer <URL>       Request with extra referer header to origin server
    --host <HOST>         Host/IP to listen on      (default: ::)
    --no-ws               Disable WebSocket proxy
    --no-log              Disable request logging
    --cert <FILE>         TLS certificate file (enables HTTPS)
    --key  <FILE>         TLS private key file  (enables HTTPS)`);
  process.exit(0);
}

function server(
  url: string,
  options: {
    port?: number;
    location?: LocationStrategy;
    /**
     * true: allow all origins (by request origin)
     *
     * false / empty string: no CORS headers
     *
     * string: allow only this origin(s)
     */
    cors?: string | boolean;
    referer?: string | boolean;
    /** Enable WebSocket proxy (default: true) */
    ws?: boolean;
    /** TLS options to enable HTTPS */
    https?: { cert: Buffer; key: Buffer };
    /** Host/IP to listen on (default: ::) */
    host?: string;
  },
) {
  const {
    port = PORT,
    host = "::",
    cors = false,
    referer = false,
    location,
    ws = true,
    https: tlsOptions,
  } = options;
  return new Promise<number>((resolve, reject) => {
    const requestHandler = (req: IncomingMessage, res: ServerResponse) => {
      const beginTime = Date.now();

      const { method } = req;
      const { origin } = req.headers;

      // acao = Access-Control-Allow-Origin
      let acao: string | undefined;
      if (cors === true) {
        // cors=true
        acao = origin === "null" ? "*" : origin;
      } else if (cors) {
        // cors=<ORIGIN> (when cors is not empty string)
        acao = cors;
      }

      if (acao && method === "OPTIONS") {
        // for preflight request, response directly without proxying
        const headers: IncomingHttpHeaders = {};
        setCORSHeaders(req, headers, acao);
        res.writeHead(204, headers).end();
      } else {
        createProxyMiddleware(
          { target: url, location },
          (req) => {
            if (referer) {
              if (referer === true) {
                (req.headers as OutgoingHttpHeaders).referer = url;
              } else {
                (req.headers as OutgoingHttpHeaders).referer = referer;
              }
            }
            return req;
          },
          (res) => {
            setCORSHeaders(req, res.headers, acao);
            return res;
          },
        )(req, res);
      }

      // no-log: don't log the request
      if (!values["no-log"]) {
        res.on("finish", () => {
          const ms = Date.now() - beginTime;
          const duration = ms < 1000 ? `${ms} ms` : `${ms / 1000} s`;
          const ok = res.statusCode < 400;
          const lDate = new Date(beginTime).toLocaleString();
          const lStatusCode = styleText(
            [ok ? "green" : "red"],
            String(res.statusCode),
          );
          const lMethod = styleText(["blue"], method!.padEnd(7));
          const lUrl = req.url;
          const lDuration = styleText(["black"], "(" + duration + ")");
          console.log(
            `[hpk] ${lDate} | ${lStatusCode} | ${lMethod} | ${lUrl} ${lDuration}`,
          );
        });
      }
    };

    const httpServer = tlsOptions
      ? createHttpsServer(tlsOptions, requestHandler)
      : createServer(requestHandler);

    if (ws) {
      httpServer.on("upgrade", createWebSocketProxy(url));
    }

    httpServer
      .listen(port, host)
      .on("listening", () => resolve(port))
      .on("error", reject);
  });
}
