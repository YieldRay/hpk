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

const styles = {
    bold: "1",
    dim: "2",
    italic: "3",
    underline: "4",
    inverse: "7",
    strikethrough: "9",
    black: "30",
    red: "31",
    green: "32",
    yellow: "33",
    blue: "34",
    magenta: "35",
    cyan: "36",
    white: "37",
    default: "39",
    blackBg: "40",
    redBg: "41",
    greenBg: "42",
    yellowBg: "43",
    blueBg: "44",
    magentaBg: "45",
    cyanBg: "46",
    whiteBg: "47",
    defaultBg: "49",
} as const;

function styled(options: Array<keyof typeof styles>, text: string | number) {
    const ESC = "\x1b[";
    const RESET = "\x1b[0m";
    let ansiCode = `${ESC}`;
    for (const [i, option] of options.entries()) {
        ansiCode += styles[option];
        if (i < options.length - 1) {
            ansiCode += ";";
        }
    }
    ansiCode += "m";
    return `${ansiCode}${text}${RESET}`;
}

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
            `hpx is listening on:\n- Local: ${styled(["cyan"], `http://localhost:${port}`)}\n`
        );
    });
}

function help() {
    console.log(`\
USAGE:
    ${styled(["bold"], "hpk")} <url> [options]
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
                const lDate = new Date(beginTime).toLocaleString();
                const lStatusCode = styled([ok ? "green" : "red"], res.statusCode);
                const lMethod = styled(["blue"], req.method!.padEnd(7));
                const lUrl = req.url;
                const lDuration = styled(["black"], "(" + duration + ")");
                console.log(`[hpk] ${lDate} | ${lStatusCode} | ${lMethod} | ${lUrl} ${lDuration}`);
            });
        })
            .listen(port)
            .on("listening", () => resolve(port))
            .on("error", reject);
    });
}
