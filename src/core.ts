import http from "node:http";
import { parse } from "node:url";
import { request } from "./request.ts";
import { MaybeRewrite, rewrite, LocationStrategy, rewriteLocation } from "./rewrite.ts";

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

    /**
     * [experimental] Delete some encoding related headers
     */
    dropEncodingHeaders?: boolean;
}

/**
 * @param proxyOptions Highly recommend that both `mount` and `target` should end with '/'
 * @param requestOptions  Additional options that apply to the request
 * @param responseOptions For rewrite the response send back to the client, note that if you provide a rewrite function, it will be called twice, the second time is for trailers
 */
export function createProxyMiddleware(
    proxyOptions: string | ProxyOptions,
    requestOptions?: MaybeRewrite<Partial<http.RequestOptions>>,
    responseOptions?: MaybeRewrite<
        Pick<http.IncomingMessage, "statusCode" | "statusMessage" | "headers">
    >
): Middleware {
    const {
        base = "/",
        target,
        onError = console.error,
        location: locationStrategy = "same",
        dropEncodingHeaders = false,
    } = typeof proxyOptions === "string" ? { target: proxyOptions } : proxyOptions;

    return (req, res) => {
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
        const modReqOptions = rewrite(reqOptions, requestOptions);

        const proxyReq = request(modReqOptions, (proxyRes) => {
            const responseHeaders = { ...proxyRes.headers };

            delete responseHeaders["connection"];
            if (dropEncodingHeaders) {
                delete responseHeaders["content-encoding"];
                delete responseHeaders["transfer-encoding"];
            }

            const toModRes: Pick<http.IncomingMessage, "statusCode" | "statusMessage" | "headers"> =
                {
                    headers: responseHeaders,
                    statusCode: proxyRes.statusCode,
                    statusMessage: proxyRes.statusMessage,
                };
            const modRes = rewrite(toModRes, responseOptions);

            const headers = modRes.headers;

            // auto rewrite location
            headers["location"] &&= rewriteLocation({
                base,
                target,
                location: headers["location"],
                strategy: locationStrategy,
            });

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
