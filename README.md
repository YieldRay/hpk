# hpk

> [!WARNING]  
> This is a WIP project.

Easy-to-use HTTP Proxy Kit for Node.js.

## Features

**Supported by this library:**

-   Rewrite response status and headers
-   Customize requests using Node.js's built-in `http.request`
-   Smartly rewrite the location header based on the base path
-   Proxy for subpaths and base at any subpath
-   Zero dependencies, requiring only built-in Node.js modules

**Not supported:**

WebSocket support is not available and there are no plans to add it.  
If WebSocket support is crucial for your application, consider using a different library such as [http-proxy-middleware](https://github.com/chimurai/http-proxy-middleware).

## Usage

Here's how you can use `hpk` to create proxy servers:

```ts
import { createServer } from "node:http";
import { createProxyMiddleware } from "hpk";

// Simple proxy server
createServer(createProxyMiddleware("https://example.net")).listen(8080);

// Proxy server with specific configuration
createServer(
    createProxyMiddleware({
        base: "/npm/",
        target: "https://cdn.jsdelivr.net/npm/",
        location: "rewrite",
    })
).listen(8081);

// Proxy server with conditional middleware
createServer((req, res) => {
    createProxyMiddleware({
        base: "/npm/",
        target: "https://cdn.jsdelivr.net/npm",
        location: "rewrite",
    })(req, res);

    createProxyMiddleware({
        base: "/gh/",
        target: "https://cdn.jsdelivr.net/gh",
        location: "rewrite",
    })(req, res);

    res.end("Resource not found");
}).listen(8082);
```

This middleware is also compatible with Express:

```js
const express = require("express");
const { createProxyMiddleware } = require("./src");

const app = express();

app.use("/example/", createProxyMiddleware("https://example.net"));
```
