import http from "node:http";

/** NodeJS http server middleware type */
export type Middleware = http.RequestListener<
    typeof http.IncomingMessage,
    typeof http.ServerResponse
>;

/** NodeJS http server request type */
export type MiddlewareRequest = Parameters<Middleware>[0];
/** NodeJS http server response type */
export type MiddlewareResponse = Parameters<Middleware>[1];

/**
 * Creates a CORS middleware function for handling CORS requests.
 * @param allowedOrigins - List of allowed origins for CORS. If not provided, all origins are allowed.
 */
export function createCORSMiddleware(allowedOrigins?: string[]): Middleware {
    const originsSet = new Set(allowedOrigins);
    originsSet.delete("*");

    return (req, res) => {
        const origin = req.headers.origin;
        if (!origin) return;

        if (originsSet.size === 0) {
            // if no allowed origins, set the origin to the request origin (allow all origins)
            res.setHeader("access-control-allow-origin", origin !== "null" ? origin : "*");
        } else {
            res.setHeader("access-control-allow-origin", Array.from(originsSet).join(","));
        }
        res.setHeader("access-control-allow-credentials", "true");

        if (req.method === "OPTIONS") {
            res.setHeader(
                "access-control-allow-headers",
                req.headers["access-control-request-headers"] || "*"
            );
            res.setHeader(
                "access-control-allow-methods",
                req.headers["access-control-request-method"] || "*"
            );
            res.setHeader("access-control-max-age", "7200");
        } else {
            res.setHeader("access-control-expose-headers", "*");
        }

        res.flushHeaders();
    };
}

/**
 * Sets CORS headers for the response based on the request and allowed origin.
 * @param allowedOrigin - The allowed origin string for CORS. If not provided, no CORS headers are set.
 */
export function setCORSHeaders(
    req: MiddlewareRequest,
    headers: http.IncomingHttpHeaders,
    allowedOrigin?: string
) {
    const origin = req.headers.origin;
    if (!origin || !allowedOrigin) return;

    headers["access-control-allow-origin"] = allowedOrigin;
    headers["access-control-allow-credentials"] = "true";
    if (req.method === "OPTIONS") {
        headers["access-control-max-age"] = "7200";
        headers["access-control-allow-headers"] = headers["access-control-request-headers"] || "*";
        headers["access-control-allow-methods"] = headers["access-control-request-method"];
    } else {
        headers["access-control-expose-headers"] = "*";
    }
}

/**
 * Removes restriction headers from the response headers.
 */
export function removeRestrictionHeaders(headers: http.IncomingHttpHeaders) {
    for (const k of [
        "strict-transport-security",
        "content-security-policy",
        "content-security-policy-report-only",
        "cross-origin-resource-policy",
        "cross-origin-embedder-policy",
        "permissions-policy",
        "x-frame-options",
    ])
        delete headers[k];
    return headers;
}
