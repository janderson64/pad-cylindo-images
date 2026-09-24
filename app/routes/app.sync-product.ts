import type { ActionFunctionArgs, HeadersFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useRouteError, type ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";

import { getCylindoConfig } from "../lib/cylindo-config.server";
import { createSyncJob } from "../lib/sync-history.server";
import {
  syncCylindoVariantImagesByProductId,
  truncateSyncSummaryForClient,
} from "../lib/sync-variant-images.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let admin;
  let session;
  let cors;

  try {
    ({ admin, session, cors } = await authenticate.admin(request));
  } catch (error) {
    console.error("Sync product action authentication failed:", error);
    throw error;
  }

  try {
    getCylindoConfig();
  } catch (error) {
    return cors(
      json({
        ok: false as const,
        error:
          error instanceof Error
            ? error.message
            : "Missing Cylindo configuration",
      }),
    );
  }

  try {
    const body = (await request.json()) as { productId?: string };
    const productId = String(body.productId ?? "").trim();

    if (!productId) {
      return cors(
        json({
          ok: false as const,
          error: "Missing productId",
        }),
      );
    }

    const summary = truncateSyncSummaryForClient(
      await syncCylindoVariantImagesByProductId(admin, productId),
      50,
    );

    const skuInput = `product:${productId}`;

    try {
      await createSyncJob(session.shop, skuInput, summary);
    } catch (historyError) {
      console.error("Failed to persist sync job history:", historyError);
    }

    if (
      summary.statusMessage &&
      summary.synced.length === 0 &&
      summary.failed.length === 0
    ) {
      return cors(
        json({
          ok: false as const,
          error: summary.statusMessage,
          summary,
        }),
      );
    }

    return cors(json({ ok: true as const, summary }));
  } catch (error) {
    console.error("Cylindo product sync failed:", error);

    if (error instanceof Response) {
      const body = await error.text().catch(() => "");
      return cors(
        json({
          ok: false as const,
          error: `Shopify API error (${error.status}): ${body || error.statusText}`,
        }),
      );
    }

    return cors(
      json({
        ok: false as const,
        error: error instanceof Error ? error.message : "Unexpected sync error",
      }),
    );
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
