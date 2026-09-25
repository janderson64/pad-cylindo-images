import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";

import { previewCylindoSync } from "../lib/sync-variant-images.server";
import { authenticate } from "../shopify.server";

// Resource route outside the /app layout so fetch() and fetcher.load()
// receive JSON instead of the embedded app HTML shell.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const skus = String(url.searchParams.get("skus") ?? "").trim();

    if (!skus) {
      return json({
        ok: false as const,
        error: "Enter at least one variant SKU to preview.",
      });
    }

    const preview = await previewCylindoSync(admin, skus);

    return json({ ok: true as const, ...preview });
  } catch (error) {
    console.error("Cylindo sync preview failed:", error);

    return json({
      ok: false as const,
      error: error instanceof Error ? error.message : "Unexpected preview error",
    });
  }
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
