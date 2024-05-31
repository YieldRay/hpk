import { parse } from "node:url";
import http from "node:http";
import { Buffer } from "node:buffer";
import { request } from "./request";
import { MaybeRewrite, rewrite, LocationStrategy, rewriteLocation } from "./rewrite";

export type Middleware = http.RequestListener<typeof http.IncomingMessage, typeof http.ServerResponse>;

export interface ProxyOptions {
    /**
     * The mount pathname, must starts with '/'.
     * Middleware only handle when req.path starts with the mount path.
     * @default "/"
     */
    mount?: string;
    /**
     * The target URL, for example `https://example.net/subpath/`.
     */
    target: string;
    /**
     * This is only for the proxy request, the original error event for the server is not trapped.
     */
    onError?: (e: unknown) => void;
    /**
     * same: Do nothing (default)
     *
     * rewrite: Rewrite (when is not external site) based on the `mount`
     *
     * redirect: Redirect to the original url.
     */
    location?: LocationStrategy;

    /**
     * [experimental] Delete some encoding related headers
     */
    dropEncodingHeaders?: boolean;
}

/**
 * @param proxyOptions Highly recommend that both `mount` and `target` should end with '/'
 * @param requestOptions  Additional options that apply to the request
 * @param responseOptions For rewrite the response send back to the client, note that if you provide a rewrite function, it will be called twice, the second time is for trailers
 * @param rewriteBody The `responseOptions` allows you to rewrite all other stuff, if rewriteBody is specified, we stop streaming (pipe) and collect the entire body for rewrite. NOTE: you MUST carefully consider whether some encoding related header should also be rewritten.
 */
export function createProxyMiddleware(
    proxyOptions: string | ProxyOptions,
    requestOptions?: Partial<http.RequestOptions>,
    responseOptions?: MaybeRewrite<Pick<http.IncomingMessage, "statusCode" | "statusMessage" | "headers" | "trailers">>,
    rewriteBody?: (
        body: Buffer,
        info: Pick<http.IncomingMessage, "statusCode" | "statusMessage" | "headers" | "trailers">
    ) => Buffer
): Middleware {
    const {
        mount = "/",
        target,
        onError = console.error,
        location: locationStrategy = "same",
        dropEncodingHeaders = false,
    } = typeof proxyOptions === "string" ? { target: proxyOptions } : proxyOptions;

    let reqOptions = { ...requestOptions };

    return (req, res) => {
        const path = req.url || "/";
        if (!path.startsWith(mount)) return; // DO NOT handle when unmatched

        // apply target url for request
        const u = target + path.replace(mount, "");
        const nodeUrl = parse(u, false, true);

        reqOptions = Object.assign(reqOptions, nodeUrl);
        reqOptions.method = req.method;

        if (!reqOptions.protocol) {
            // auto determined protocol when not specified by `options.target`
            const protocol = (req.socket as { encrypted?: boolean }).encrypted ? "https:" : "http:";
            reqOptions.protocol = protocol;
        }

        const requestHeaders = { ...req.headers };
        requestHeaders["host"] = (nodeUrl.host || nodeUrl.hostname)!;
        delete requestHeaders["connection"];

        if (dropEncodingHeaders) {
            delete requestHeaders["accept-encoding"];
        }

        if (req.httpVersion === "1.0") {
            delete requestHeaders["transfer-encoding"];
        }

        reqOptions = Object.assign({ headers: requestHeaders }, reqOptions);

        const proxyReq = request(reqOptions, (proxyRes) => {
            const responseHeaders = { ...proxyRes.headers };

            delete responseHeaders["connection"];
            if (dropEncodingHeaders) {
                delete responseHeaders["content-encoding"];
                delete responseHeaders["transfer-encoding"];
            }

            const toModRes = {
                headers: responseHeaders,
                statusCode: proxyRes.statusCode,
                statusMessage: proxyRes.statusMessage,
                trailers: proxyRes.trailers, // note: no trailers for now
            };
            const modRes = rewrite(toModRes, responseOptions);

            const headers = modRes.headers;
            headers["location"] &&= rewriteLocation({
                mount,
                target,
                url: u,
                location: headers["location"],
                strategy: locationStrategy,
            });

            // send proxy head
            res.writeHead(modRes.statusCode!, modRes.statusMessage, headers);

            const chunks: Buffer[] = [];
            if (rewriteBody) {
                proxyRes.on("data", (chunk: Buffer) => {
                    chunks.push(chunk);
                });
            }

            // for rewrite trailers
            proxyReq.on("end", (proxyRes: http.IncomingMessage) => {
                if (rewriteBody) {
                    rewriteBody(Buffer.concat(chunks), toModRes);
                }

                toModRes.trailers = proxyRes.trailers;
                const { trailers } = rewrite(toModRes, responseOptions);
                trailers["location"] &&= rewriteLocation({
                    mount,
                    target,
                    url: u,
                    location: trailers["location"],
                    strategy: locationStrategy,
                });
                res.addTrailers(trailers);
            });

            try {
                if (!rewriteBody) proxyRes.pipe(res);
            } catch (e) {
                onError(e);
            }
        });

        proxyReq.on("error", onError);

        try {
            req.pipe(proxyReq);
        } catch (e) {
            onError(e);
        }
    };
}
