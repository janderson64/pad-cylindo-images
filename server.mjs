import { createRequestHandler } from "@remix-run/express";
import { installGlobals } from "@remix-run/node";
import compression from "compression";
import express from "express";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildPath = path.resolve(__dirname, "./build/server/index.js");
const build = await import(buildPath);

installGlobals({
  nativeFetch: build.future?.v3_singleFetch,
});

const ADMIN_EXTENSION_API_PATHS = new Set(["/api/sync-product"]);
const REAUTH_URL_HEADER = "X-Shopify-API-Request-Failure-Reauthorize-Url";

function applyAdminExtensionCorsHeaders(request, response) {
  const origin = request.headers.origin;
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");

  if (
    response.headersSent ||
    response.getHeader("Access-Control-Allow-Origin") ||
    !origin ||
    origin === appUrl
  ) {
    return false;
  }

  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type",
  );
  response.setHeader("Access-Control-Expose-Headers", REAUTH_URL_HEADER);
  response.setHeader("Access-Control-Max-Age", "7200");
  return true;
}

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(
  build.publicPath,
  express.static(build.assetsBuildDirectory, {
    immutable: true,
    maxAge: "1y",
  }),
);
app.use(express.static("public", { maxAge: "1h" }));
app.use(morgan("tiny"));

app.use((request, response, next) => {
  if (!ADMIN_EXTENSION_API_PATHS.has(request.path)) {
    next();
    return;
  }

  const originalEnd = response.end.bind(response);
  response.end = (...args) => {
    applyAdminExtensionCorsHeaders(request, response);
    return originalEnd(...args);
  };

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  next();
});

app.all(
  "*",
  createRequestHandler({
    build,
    mode: process.env.NODE_ENV ?? "production",
  }),
);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`[server] http://localhost:${port}`);
});
