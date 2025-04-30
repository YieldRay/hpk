#!/usr/bin/env node
import process from "node:process";
import { parseArgs, styleText } from "node:util";
import { createServer } from "node:http";
import { createProxyMiddleware } from "./core.ts";
import { isUrl, type LocationStrategy } from "./rewrite.ts";

const PORT = Number(process.env.PORT) || 8090;

// https://nodejs.org/api/util.html#utilparseargsconfig
const { values, positionals } = parseArgs({
    options: {
        help: {
            type: "boolean",
            multiple: false,
            short: "h",
            default: false,
        },
        port: {
            type: "string",
            short: "p",
            default: String(PORT),
        },
        base: {
            type: "string",
            default: "/",
        },
        location: {
            type: "string",
            default: "rewrite",
        },
        cors: {
            type: "string",
            multiple: true,
        },
        "cors-origin": {
            type: "boolean",
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

    server(url, {
        port: Number(values.port),
        cors: values["cors-origin"] ? true : values.cors?.join(","),
        location: values.location as LocationStrategy,
        base: values.base,
    }).then((port) => {
        console.log(
            `hpx is listening on:
- Local: ${styleText(["cyan"], `http://localhost:${port}`)}
- For:   ${styleText(["cyan"], url)}
`
        );
    });
}

function help() {
    console.log(`\
USAGE:
    ${styleText(["bold"], "hpk")} <url> [options]
Options:
    --port <PORT>         Port to listen on         (default: ${PORT})
    --base <PATH>         Mount base path           (default: /)
    --location <STRATEGY> same | rewrite | redirect (default: rewrite)
    --cors [<ORIGIN>...]  Allowed CORS origin
    --cors-origin         Add CORS headers by request origin header`);
    process.exit(0);
}

function server(
    url: string,
    options: {
        port?: number;
        base?: string;
        location?: LocationStrategy;
        cors?: string | boolean;
    }
) {
    const { port = PORT, cors = false, base, location } = options;
    return new Promise<number>((resolve, reject) => {
        createServer((req, res) => {
            const beginTime = Date.now();

            const { method } = req;
            const { origin } = req.headers;

            // acao = Access-Control-Allow-Origin
            let acao: string | undefined;
            if (cors === true) {
                // cors=true
                acao = origin !== "null" ? origin : "*";
            } else if (cors) {
                // cors=<ORIGIN>
                acao = cors;
            }

            createProxyMiddleware({ target: url, base, location }, undefined, (o) => {
                if (origin && acao) {
                    o.headers["access-control-allow-origin"] = acao;
                    o.headers["access-control-allow-credentials"] = "true";
                    if (method === "OPTIONS") {
                        o.headers["access-control-max-age"] = "7200";
                        o.headers["access-control-allow-headers"] =
                            req.headers["access-control-request-headers"] || "*";
                        o.headers["access-control-allow-methods"] =
                            req.headers["access-control-request-method"];
                    } else {
                        o.headers["access-control-expose-headers"] = "*";
                    }
                }
                return o;
            })(req, res);

            res.on("finish", () => {
                const ms = Date.now() - beginTime;
                const duration = ms < 1000 ? `${ms} ms` : `${ms / 1000} s`;
                const ok = res.statusCode < 400;
                const lDate = new Date(beginTime).toLocaleString();
                const lStatusCode = styleText([ok ? "green" : "red"], String(res.statusCode));
                const lMethod = styleText(["blue"], method!.padEnd(7));
                const lUrl = req.url;
                const lDuration = styleText(["black"], "(" + duration + ")");
                console.log(`[hpk] ${lDate} | ${lStatusCode} | ${lMethod} | ${lUrl} ${lDuration}`);
            });
        })
            .listen(port)
            .on("listening", () => resolve(port))
            .on("error", reject);
    });
}
