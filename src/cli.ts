#!/usr/bin/env node
import process from "node:process";
import { parseArgs } from "node:util";
import { createServer } from "node:http";
import { createProxyMiddleware } from "./core.ts";
import { isUrl, type LocationStrategy } from "./rewrite.ts";

const PORT = 8090;

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
    const url = positionals[0];
    if (!url || !isUrl(url)) help();

    server(url, {
        port: Number(values.port),
        cors: values.cors,
        location: values.location as LocationStrategy,
        base: values.base,
    }).then((port) => {
        console.log(`Listening on:\n- Local: http://localhost:${port}\n`);
    });
}

function help() {
    console.log(`hpk <url>
USAGE:
    hpk <url> [options]
Options:
    --port <PORT>         Port to listen on (default: ${PORT})
    --base <PATH>         Mount Base  (default: /)
    --location <STRATEGY> same | rewrite | redirect (default: rewrite)
    --cors [<ORIGIN>]     CORS allowed origin`);
    process.exit(1);
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
            let acao: string | undefined;
            if (cors === true) {
                acao = req.headers["origin"] || "*";
            } else if (cors) {
                acao = cors;
            }

            createProxyMiddleware({ target: url, base, location }, {}, (o) => {
                if (acao) o.headers["access-control-allow-origin"] = acao;
                return o;
            })(req, res);

            res.on("finish", () => {
                const duration = Date.now() - beginTime;
                console.log(
                    `${new Date(beginTime).toLocaleString()} [${req.method}] ${res.statusCode} ${
                        req.url
                    } (${duration} ms)`
                );
            });
        })
            .listen(port)
            .on("listening", () => resolve(port))
            .on("error", reject);
    });
}
