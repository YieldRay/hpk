import { URL } from "node:url";

export type MaybeRewrite<T> = T | ((original: T) => T);

export function rewrite<T>(original: T, rewriter?: MaybeRewrite<T>) {
    if (typeof rewriter === "function") {
        return (rewriter as (original: Readonly<T>) => T)(original);
    }

    if (rewriter == undefined) {
        // no rewriter, so return the original one
        return original;
    } else {
        return rewriter;
    }
}

function isUrl(u: string) {
    return u.startsWith("http://") || u.startsWith("https://");
}

export type LocationStrategy = "same" | "rewrite" | "redirect";

export function rewriteLocation({
    strategy,
    location,
    target,
    url,
    mount,
}: {
    strategy: LocationStrategy;
    location: string;
    url: string;
    mount: string;
    target: string;
}): string {
    switch (strategy) {
        case "same":
            return location;
        case "redirect": {
            if (isUrl(location)) return location;
            return new URL(location, target).toString();
        }

        case "rewrite": {
            const loc = new URL(location, target);
            const tgt = new URL(target);

            if (isUrl(location)) {
                if (loc.protocol !== tgt.protocol && loc.host !== tgt.host) {
                    // external url, no need to rewrite
                    return location;
                }

                if (!loc.pathname.startsWith(tgt.pathname)) {
                    // location is out of target, so no need to rewrite
                    return location;
                }

                return mount + loc.pathname.replace(tgt.pathname, "");
            } else {
                if (!loc.pathname.startsWith(tgt.pathname)) {
                    // location is out of target, so no need to rewrite
                    return new URL(location, target).toString();
                }

                if (location.startsWith("/")) {
                    return location.replace(tgt.pathname, mount);
                } else {
                    return loc.pathname.replace(tgt.pathname, mount) + loc.search;
                }
            }
        }

        default:
            return location;
    }
}
