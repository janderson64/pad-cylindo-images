import type { ActionFunctionArgs, HeadersFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useRouteError, type ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";

import { getCylindoConfig } from "../lib/cylindo-config.server";
import {
  syncCylindoVariantImages,
  truncateSyncSummaryForClient,
} from "../lib/sync-variant-images.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let admin;

  try {
    ({ admin } = await authenticate.admin(request));
  } catch (error) {
    console.error("Sync action authentication failed:", error);
    throw error;
  }

  try {
    getCylindoConfig();
  } catch (error) {
    return json({
      ok: false as const,
      error:
        error instanceof Error ? error.message : "Missing Cylindo configuration",
    });
  }

  try {
    const formData = await request.formData();
    const skus = String(formData.get("skus") ?? "");

    const summary = truncateSyncSummaryForClient(
      await syncCylindoVariantImages(admin, skus),
    );

    if (summary.statusMessage && summary.synced.length === 0 && summary.failed.length === 0) {
      return json({
        ok: false as const,
        error: summary.statusMessage,
        summary,
      });
    }

    return json({ ok: true as const, summary });
  } catch (error) {
    console.error("Cylindo sync failed:", error);

    if (error instanceof Response) {
      const body = await error.text().catch(() => "");
      return json({
        ok: false as const,
        error: `Shopify API error (${error.status}): ${body || error.statusText}`,
      });
    }

    return json({
      ok: false as const,
      error: error instanceof Error ? error.message : "Unexpected sync error",
    });
  }
};

export function shouldRevalidate({
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod === "POST") {
    return false;
  }

  return defaultShouldRevalidate;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
