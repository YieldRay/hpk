# hpk

[![npm](https://img.shields.io/npm/v/hpk)](https://www.npmjs.com/package/hpk)
[![install size](https://packagephobia.com/badge?p=hpk)](https://packagephobia.com/result?p=hpk)

Easy-to-use **H**TTP **P**roxy **K**it for Node.js.

## Features

**Supported by this library:**

-   Rewrite response status and headers
-   Customize requests using Node.js's built-in `http.request`
-   Smartly rewrite the location header based on the base path
-   Proxy for subpaths and base at any subpath
-   Zero dependencies, requiring only built-in Node.js modules
-   WebSocket proxy support

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

### WebSocket proxy

Use `createWebSocketProxy` to proxy WebSocket connections. Attach it to your server's `upgrade` event:

```ts
import { createServer } from "node:http";
import { createProxyMiddleware, createWebSocketProxy } from "hpk";

const server = createServer(createProxyMiddleware("https://example.net"));

// Proxy WebSocket upgrades to the same target
server.on("upgrade", createWebSocketProxy("https://example.net"));

server.listen(8080);
```

Both `ws://` and `wss://` targets are supported. The `base` option works the same way as in `createProxyMiddleware`:

```ts
server.on(
    "upgrade",
    createWebSocketProxy("wss://example.net/socket/", { base: "/ws/" })
);
```

This middleware is also compatible with Express:

```js
const express = require("express");
const { createProxyMiddleware } = require("./src");

const app = express();

app.use("/example/", createProxyMiddleware("https://example.net"));
```

### CLI

```sh
# use npx
npx hpk -h
# or install globally
npm i -g hpk

# example
hpk https://example.net --port=8080 --cors=*

# disable WebSocket proxy
hpk https://example.net --no-ws
```

### Docker

```sh
docker run -d \
  -p 8080:80 \
  -e URL=https://i.pximg.net \
  -e CORS=https://my.domain \
  -e REFERER=https://pixiv.net \
  ghcr.io/yieldray/hpk:main
```

| Env     | Description                                                               |
| ------- | ------------------------------------------------------------------------- |
| URL     | Required, the origin server url                                           |
| CORS    | Optional, allow only specified origin to bypass cors, or `*` to allow all |
| REFERER | Optional, request with extra referer header to origin server              |
