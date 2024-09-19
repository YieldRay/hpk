import { describe, it } from "node:test";
import * as assert from "node:assert";
import { rewriteLocation, rewrite } from "./rewrite.ts";

describe("rewriteLocation", () => {
    it("strategy=same", () => {
        assert.equal(
            rewriteLocation({
                strategy: "same",
                base: "/npm/",
                target: "https://cdn.jsdelivr.net/npm/",
                location: "/npm/pkg@1.0.0",
            }),
            "/npm/pkg@1.0.0"
        );
    });

    it("strategy=redirect", () => {
        assert.equal(
            rewriteLocation({
                strategy: "redirect",
                base: "/npm/",
                target: "https://cdn.jsdelivr.net/npm/",
                location: "/npm/pkg@1.0.0",
            }),
            "https://cdn.jsdelivr.net/npm/pkg@1.0.0"
        );
    });

    it("strategy=rewrite", () => {
        assert.equal(
            rewriteLocation({
                strategy: "rewrite",
                base: "/npm/",
                target: "https://cdn.jsdelivr.net/npm/",
                location: "https://example.net",
            }),
            "https://example.net"
        );

        assert.equal(
            rewriteLocation({
                strategy: "rewrite",
                base: "/gh/",
                target: "https://cdn.jsdelivr.net/gh/",
                location: "https://cdn.jsdelivr.net/npm/pkg@1.0.0",
            }),
            "https://cdn.jsdelivr.net/npm/pkg@1.0.0"
        );

        assert.equal(
            rewriteLocation({
                strategy: "rewrite",
                base: "/npm/",
                target: "https://cdn.jsdelivr.net/npm/",
                location: "https://cdn.jsdelivr.net/npm/pkg@1.0.0",
            }),
            "/npm/pkg@1.0.0"
        );

        assert.equal(
            rewriteLocation({
                strategy: "rewrite",
                base: "/npm/",
                target: "https://cdn.jsdelivr.net/npm/",
                location: "/npm/pkg@1.0.0",
            }),
            "/npm/pkg@1.0.0"
        );

        assert.equal(
            rewriteLocation({
                strategy: "rewrite",
                base: "/npm/",
                target: "https://cdn.jsdelivr.net/npm/",
                location: "pkg@1.0.0",
            }),
            "/npm/pkg@1.0.0"
        );

        assert.equal(
            rewriteLocation({
                strategy: "rewrite",
                base: "/jsd/",
                target: "https://cdn.jsdelivr.net/npm/",
                location: "/external/pkg@1.0.0",
            }),
            "https://cdn.jsdelivr.net/external/pkg@1.0.0"
        );

        assert.equal(
            rewriteLocation({
                strategy: "rewrite",
                base: "/jsd/",
                target: "https://cdn.jsdelivr.net/npm/",
                location: "/npm/pkg@1.0.0",
            }),
            "/jsd/pkg@1.0.0"
        );

        assert.equal(
            rewriteLocation({
                strategy: "rewrite",
                base: "/jsd/",
                target: "https://cdn.jsdelivr.net/npm/",
                location: "pkg@1.0.0",
            }),
            "/jsd/pkg@1.0.0"
        );

        assert.equal(
            rewriteLocation({
                strategy: "rewrite",
                base: "/jsd/",
                target: "https://cdn.jsdelivr.net/npm/",
                location: "./pkg@1.0.0",
            }),
            "/jsd/pkg@1.0.0"
        );
    });
});

describe("rewrite", () => {
    it("redirect", () => {
        assert.equal(rewrite("x"), "x");
        assert.equal(rewrite("x", "y"), "y");
        assert.equal(
            rewrite("aBc", (s) => s.toUpperCase()),
            "ABC"
        );
    });
});
