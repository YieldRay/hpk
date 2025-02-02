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

/**
 * https://github.com/YieldRay/terminal-sequences/blob/main/sgr/style.ts
 */
const SGR = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    italic: "\x1b[3m",
    underscore: "\x1b[4m",
    reverse: "\x1b[7m",
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    bgBlue: "\x1b[44m",
    bgRed: "\x1b[41m",
    bgGreen: "\x1b[42m",
};

if (values.help) {
    help();
} else {
    const url = positionals[0];
    if (!url || !isUrl(url)) help();

    server(url, {
        port: Number(values.port),
        cors: values["cors-origin"] ? true : values.cors?.join(","),
        location: values.location as LocationStrategy,
        base: values.base,
    }).then((port) => {
        console.log(
            `hpx is listening on:\n- Local: ${SGR.cyan}http://localhost:${port}${SGR.reset}\n`
        );
    });
}

function help() {
    console.log(`${SGR.bright}hpk${SGR.reset} <url>
USAGE:
    hpk <url> [options]
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
            let acao: string | undefined;
            if (cors === true) {
                acao = req.headers["origin"] || "*";
            } else if (cors) {
                acao = cors;
            }

            createProxyMiddleware({ target: url, base, location }, undefined, (o) => {
                if (acao) {
                    o.headers["access-control-allow-origin"] = acao;
                    o.headers["access-control-allow-methods"] = "*";
                }
                return o;
            })(req, res);

            res.on("finish", () => {
                const ms = Date.now() - beginTime;
                const duration = ms < 1000 ? `${ms} ms` : `${ms / 1000} s`;

                const ok = res.statusCode < 400;
                const c = ok ? SGR.bgGreen : SGR.bgRed;
                console.log(
                    `[hpk] ${new Date(beginTime).toLocaleString()} |${c} ${res.statusCode} ${
                        SGR.reset
                    }|${SGR.blue} ${req.method!.padEnd(7)} ${SGR.reset}| ${req.url} ${
                        SGR.black
                    }(${duration})${SGR.reset}`
                );
            });
        })
            .listen(port)
            .on("listening", () => resolve(port))
            .on("error", reject);
    });
}
