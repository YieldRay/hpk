import http from "node:http";
import https from "node:https";
import { URL, format, parse } from "node:url";

export type HTTPRequestOptions = string | http.RequestOptions | URL;

/**
 * isomorphic http/https.request, whether it's https will be automatically determined by the options
 *
 * http2 is not supported
 */
export function request(
    options: HTTPRequestOptions,
    callback?: (res: http.IncomingMessage) => void
): http.ClientRequest {
    // we use the legacy parse function rather than URL
    // because it's consist with request options
    const url = parse(format(options), false, true);
    const module = url.protocol === "https:" ? https : http;
    return module.request(options, callback);
}
