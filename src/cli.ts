#!/usr/bin/env node
import process from "node:process";
import { parseArgs } from "node:util";
import { createServer } from "node:http";
import { createProxyMiddleware } from "./core.ts";
import { isUrl } from "./rewrite.ts";

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
    }).then((port) => {
        console.log(`Proxy server is listen at http://localhost:${port}`);
    });
}

function help() {
    console.log(`nhpm <url>

Options:
    --port PORT         Port to listen on (default: ${PORT})
    --cors [<origin>]   CORS allowed origin`);
    process.exit(1);
}

function server(
    url: string,
    options: {
        port?: number;
        cors?: string | boolean;
    }
) {
    const { port = PORT, cors = false } = options;
    return new Promise<number>((resolve, reject) => {
        createServer((req, res) => {
            let acao: string | undefined;
            if (cors === true) {
                acao = req.headers["origin"] || "*";
            } else if (cors) {
                acao = cors;
            }

            createProxyMiddleware(url, {}, (o) => {
                if (acao) o.headers["access-control-allow-origin"] = acao;
                return o;
            })(req, res);
        })
            .listen(port)
            .on("listening", () => resolve(port))
            .on("error", reject);
    });
}
