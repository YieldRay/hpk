import http from "node:http";
import { parse } from "node:url";
import { request } from "./request.ts";
import { rewrite, rewriteLocation } from "./rewrite.ts";
import type { MaybeRewrite, LocationStrategy } from "./rewrite.ts";
import type { Middleware } from "./middleware.ts";
import { removeRestrictionHeaders } from "./middleware.ts";

export interface ProxyOptions {
  /**
   * The base pathname, must start with '/', recommended to end with '/'.
   * Middleware only handles when req.path starts with the mount path.
   * @default "/"
   */
  base?: string;
  /**
   * The target URL, for example `https://example.net/subpath/`.
   */
  target: string;
  /**
   * Note that this is ONLY for the proxy request and piping.
   * You should handle errors for req and res on your own.
   */
  onError?: (e: unknown) => void;
  /**
   * same: Do nothing (default)
   *
   * rewrite: Rewrite (when not an external site) based on the `mount`
   *
   * redirect: Redirect to the original url.
   */
  location?: LocationStrategy;
  removeRestrictionHeaders?: boolean;
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
  >,
): Middleware {
  const {
    base = "/",
    target,
    onError = console.error,
    location: locationStrategy = "same",
    removeRestrictionHeaders: isRemoveRestrictionHeaders = false,
  } = typeof proxyOptions === "string"
    ? { target: proxyOptions }
    : proxyOptions;

  return (
    /** we keep this object unchanged for code readability */ req,
    /** this object is used to send proxied response */ res,
  ) => {
    const path = req.url || "/";
    if (!path.startsWith(base)) return; // DO NOT handle when unmatched

    // apply target url for request
    let replacePath = path.replace(base, "");
    if (target.endsWith("/")) {
      replacePath = replacePath.replace(/^\//, "");
    } else if (!replacePath.startsWith("/")) {
      replacePath = "/" + replacePath;
    }
    const u = target + replacePath;

    const nodeUrl = parse(u, false, true);

    let reqOptions: Partial<http.RequestOptions> = nodeUrl;
    reqOptions.method = req.method;

    if (!reqOptions.protocol) {
      // protocol auto-determined when not specified by `options.target`
      const protocol = (req.socket as { encrypted?: boolean }).encrypted
        ? "https:"
        : "http:";
      reqOptions.protocol = protocol;
    }

    // request headers that will be used for `request`
    const requestHeaders = { ...req.headers };
    delete requestHeaders["host"];
    requestHeaders["host"] = (nodeUrl.host || nodeUrl.hostname)!;

    // RFC 9110 7.6.1. Connection
    for (const k of [
      "proxy-connection",
      "keep-alive",
      "te",
      "transfer-encoding",
      "upgrade",
    ]) {
      delete requestHeaders[k];
    }

    reqOptions = Object.assign({ headers: requestHeaders }, reqOptions);
    const modReqOptions = rewrite(reqOptions, rewriteRequestOptions);

    // now, send the request to the target
    const proxyReq = request(modReqOptions, (proxyRes) => {
      let responseHeaders = { ...proxyRes.headers };

      // remove restriction headers
      if (isRemoveRestrictionHeaders) {
        responseHeaders = removeRestrictionHeaders(responseHeaders);
      }

      const toModRes: Pick<
        http.IncomingMessage,
        "statusCode" | "statusMessage" | "headers"
      > = {
        headers: responseHeaders,
        statusCode: proxyRes.statusCode,
        statusMessage: proxyRes.statusMessage,
      };
      const modRes = rewrite(toModRes, rewriteResponseOptions);

      // copy headers from modRes.headers
      const headers: http.OutgoingHttpHeaders = {};
      for (const [k, v] of Object.entries(modRes.headers)) {
        if (v != null) headers[k] = v;
      }

      // auto rewrite location
      headers["location"] &&= rewriteLocation({
        base,
        target,
        location: headers["location"],
        strategy: locationStrategy,
      });

      // rewrite trailers
      // NOTE: proxyRes.trailers is only populated after the stream ends,
      // so the Trailer header cannot be pre-announced here.
      // if (proxyRes.trailers && Object.keys(proxyRes.trailers).length > 0) {
      //   headers["trailer"] = Object.keys(proxyRes.trailers).join(", ");
      // }

      // send proxy head
      res.writeHead(modRes.statusCode!, modRes.statusMessage, headers);

      proxyRes.on("end", () => {
        if (proxyRes.trailers && Object.keys(proxyRes.trailers).length > 0) {
          res.addTrailers(proxyRes.trailers);
        }
      });

      try {
        proxyRes.pipe(res);
      } catch (error_) {
        onError(error_);
      }
    });

    proxyReq.on("error", onError);

    try {
      req.pipe(proxyReq);
    } catch (error_) {
      onError(error_);
    }
  };
}
