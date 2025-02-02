import http from "node:http";
import { parse } from "node:url";
import { request } from "./request.ts";
import { rewrite, rewriteLocation } from "./rewrite.ts";
import type { MaybeRewrite, LocationStrategy } from "./rewrite.ts";

export type Middleware = http.RequestListener<
    typeof http.IncomingMessage,
    typeof http.ServerResponse
>;

export interface ProxyOptions {
    /**
     * The base pathname, must starts with '/', recommend to ends with '/'.
     * Middleware only handle when req.path starts with the mount path.
     * @default "/"
     */
    base?: string;
    /**
     * The target URL, for example `https://example.net/subpath/`.
     */
    target: string;
    /**
     * Note that this is ONLY for the proxy request and piping.
     * You should handle errors for req and res for your own.
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
}

/**
 * @param proxyOptions Highly recommend that both `mount` and `target` should end with '/'
 * @param requestOptions  For rewrite (not merge) the request options
 * @param responseOptions For rewrite (not merge) the response object
 */
export function createProxyMiddleware(
    proxyOptions: string | ProxyOptions,
    rewriteRequestOptions?: MaybeRewrite<http.RequestOptions>,
    rewriteResponseOptions?: MaybeRewrite<
        Pick<http.IncomingMessage, "statusCode" | "statusMessage" | "headers">
    >
): Middleware {
    const {
        base = "/",
        target,
        onError = console.error,
        location: locationStrategy = "same",
    } = typeof proxyOptions === "string" ? { target: proxyOptions } : proxyOptions;

    return (
        /** we make sure this object unchanged for code readability */ req,
        /** this object is used to send proxied response */ res
    ) => {
        const path = req.url || "/";
        if (!path.startsWith(base)) return; // DO NOT handle when unmatched

        // apply target url for request
        let replacePath = path.replace(base, "");
        if (!replacePath.startsWith("/")) replacePath = "/" + replacePath;
        const u = target + replacePath;

        const nodeUrl = parse(u, false, true);

        let reqOptions: Partial<http.RequestOptions> = nodeUrl;
        reqOptions.method = req.method;

        if (!reqOptions.protocol) {
            // auto determined protocol when not specified by `options.target`
            const protocol = (req.socket as { encrypted?: boolean }).encrypted ? "https:" : "http:";
            reqOptions.protocol = protocol;
        }

        // request headers that will be used for `request`
        const requestHeaders = { ...req.headers };
        delete requestHeaders["host"];
        requestHeaders["host"] = (nodeUrl.host || nodeUrl.hostname)!;

        // RFC 9110 7.6.1. Connection
        for (const k of ["proxy-connection", "keep-alive", "te", "transfer-encoding", "upgrade"]) {
            delete requestHeaders[k];
        }

        /** sets `content-length` to '0' if request is of DELETE type */
        if (
            (req.method === "DELETE" || req.method === "OPTIONS") &&
            !requestHeaders["content-length"]
        ) {
            requestHeaders["content-length"] = "0";
        }

        reqOptions = Object.assign({ headers: requestHeaders }, reqOptions);
        const modReqOptions = rewrite(reqOptions, rewriteRequestOptions);

        // now, send the request to the target
        const proxyReq = request(modReqOptions, (proxyRes) => {
            const responseHeaders = { ...proxyRes.headers };

            const toModRes: Pick<http.IncomingMessage, "statusCode" | "statusMessage" | "headers"> =
                {
                    headers: responseHeaders,
                    statusCode: proxyRes.statusCode,
                    statusMessage: proxyRes.statusMessage,
                };
            const modRes = rewrite(toModRes, rewriteResponseOptions);

            const headers = modRes.headers;

            // auto rewrite location
            headers["location"] &&= rewriteLocation({
                base,
                target,
                location: headers["location"],
                strategy: locationStrategy,
            });

            // rewrite trailers
            if (proxyRes.trailers && Object.keys(proxyRes.trailers).length) {
                headers["trailer"] = Object.keys(proxyRes.trailers).join(", ");
            }

            // send proxy head
            res.writeHead(modRes.statusCode!, modRes.statusMessage, headers);

            // for rewrite trailers
            proxyReq.on("end", (proxyRes: http.IncomingMessage) => {
                res.addTrailers(proxyRes.trailers);
            });

            try {
                proxyRes.pipe(res);
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
