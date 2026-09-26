import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";

import { getCylindoConfig, parseCylindoFrame, parseOverwriteExisting } from "../lib/cylindo-config.server";
import {
  createSyncJob,
  createSyncJobFromCounts,
} from "../lib/sync-history.server";
import {
  buildBatchProgressLogs,
  parseSkuList,
  previewCylindoFrameForProduct,
  previewCylindoSync,
  previewCylindoSyncByProductId,
  syncCylindoVariantImagesByProductId,
  syncCylindoVariantImagesByProductIdBatch,
  syncCylindoVariantImagesBySkuList,
  truncateSyncSummaryForClient,
} from "../lib/sync-variant-images.server";
import { authenticate } from "../shopify.server";

function parseOptionalCount(
  url: URL,
  key: string,
): number | undefined {
  const value = url.searchParams.get(key);

  if (value === null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

// Resource route for admin UI extensions. Must live outside the /app
// layout so fetch() receives JSON instead of the embedded app HTML shell.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  let admin;
  let session;
  let cors;

  try {
    ({ admin, session, cors } = await authenticate.admin(request));
  } catch (error) {
    console.error("Sync product loader authentication failed:", error);

    return json(
      {
        ok: false as const,
        error:
          error instanceof Response
            ? "Authentication failed. Open the Cylindo app in Shopify Admin, then try again."
            : error instanceof Error
              ? error.message
              : "Authentication failed",
      },
      {
        status: error instanceof Response ? error.status : 401,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers":
            "X-Shopify-API-Request-Failure-Reauthorize-Url",
        },
      },
    );
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
    const url = new URL(request.url);
    const productId = String(url.searchParams.get("productId") ?? "").trim();

    if (!productId) {
      return cors(
        json({
          ok: false as const,
          error: "Missing productId",
        }),
      );
    }

    const batchParam = url.searchParams.get("batch");
    const skuInput = `product:${productId}`;
    const frame = parseCylindoFrame(url.searchParams.get("frame"));
    const overwriteExisting = parseOverwriteExisting(
      url.searchParams.get("overwriteExisting"),
    );
    const syncOptions =
      frame !== undefined || overwriteExisting
        ? { frame, overwriteExisting }
        : undefined;

    if (url.searchParams.has("frame") && frame === undefined) {
      return cors(
        json({
          ok: false as const,
          error: "Enter a valid Cylindo frame number (0 or greater).",
        }),
      );
    }

    if (url.searchParams.get("preview") === "1") {
      const preview = await previewCylindoSyncByProductId(admin, productId);

      return cors(json({ ok: true as const, ...preview }));
    }

    if (url.searchParams.get("framePreview") === "1") {
      if (frame === undefined) {
        return cors(
          json({
            ok: false as const,
            error: "Enter a valid Cylindo frame number (0 or greater).",
          }),
        );
      }

      const preview = await previewCylindoFrameForProduct(
        admin,
        productId,
        frame,
      );

      return cors(json(preview));
    }

    if (url.searchParams.get("historyOnly") === "1") {
      const variantsRequested = parseOptionalCount(url, "variantsRequested");

      if (variantsRequested === undefined) {
        return cors(
          json({
            ok: false as const,
            error: "Missing variantsRequested for history",
          }),
        );
      }

      try {
        await createSyncJobFromCounts(session.shop, skuInput, {
          variantsRequested,
          syncedCount: parseOptionalCount(url, "syncedCount") ?? 0,
          skippedHasImageCount:
            parseOptionalCount(url, "skippedHasImageCount") ?? 0,
          skippedMissingMetafieldsCount:
            parseOptionalCount(url, "skippedMissingMetafieldsCount") ?? 0,
          failedCount: parseOptionalCount(url, "failedCount") ?? 0,
          statusMessage: url.searchParams.get("statusMessage"),
        });
      } catch (historyError) {
        console.error("Failed to persist sync job history:", historyError);
        return cors(
          json({
            ok: false as const,
            error: "Failed to save sync history",
          }),
        );
      }

      return cors(json({ ok: true as const }));
    }

    const skusParam = url.searchParams.get("skus");

    if (skusParam !== null) {
      const skus = parseSkuList(skusParam);

      if (skus.length === 0) {
        return cors(
          json({
            ok: false as const,
            error: "Provide at least one SKU",
          }),
        );
      }

      if (skus.length > 10) {
        return cors(
          json({
            ok: false as const,
            error: "Sync up to 10 SKUs per request",
          }),
        );
      }

      const summary = truncateSyncSummaryForClient(
        await syncCylindoVariantImagesBySkuList(admin, skus, syncOptions),
        skus.length,
      );
      const logs = buildBatchProgressLogs(summary);

      if (
        summary.statusMessage &&
        summary.synced.length === 0 &&
        summary.failed.length === 0 &&
        summary.skippedHasImage.length === 0 &&
        summary.skippedMissingMetafields.length === 0
      ) {
        return cors(
          json({
            ok: false as const,
            error: summary.statusMessage,
            summary,
            logs,
          }),
        );
      }

      return cors(json({ ok: true as const, summary, logs }));
    }

    if (batchParam !== null) {
      const batchIndex = Number(batchParam);

      if (!Number.isInteger(batchIndex) || batchIndex < 0) {
        return cors(
          json({
            ok: false as const,
            error: "Invalid batch index",
          }),
        );
      }

      const batchResult = await syncCylindoVariantImagesByProductIdBatch(
        admin,
        productId,
        batchIndex,
        syncOptions,
      );
      const summary = truncateSyncSummaryForClient(batchResult.summary, 50);
      const logs = buildBatchProgressLogs(summary);

      if (
        summary.statusMessage &&
        summary.synced.length === 0 &&
        summary.failed.length === 0 &&
        summary.skippedHasImage.length === 0 &&
        summary.skippedMissingMetafields.length === 0
      ) {
        return cors(
          json({
            ok: false as const,
            error: summary.statusMessage,
            summary,
            progress: {
              batchIndex: batchResult.batchIndex,
              batchCount: batchResult.batchCount,
              skusTotal: batchResult.skusTotal,
              productTitle: batchResult.productTitle,
            },
            logs,
          }),
        );
      }

      return cors(
        json({
          ok: true as const,
          summary,
          progress: {
            batchIndex: batchResult.batchIndex,
            batchCount: batchResult.batchCount,
            skusTotal: batchResult.skusTotal,
            productTitle: batchResult.productTitle,
          },
          logs,
        }),
      );
    }

    const summary = truncateSyncSummaryForClient(
      await syncCylindoVariantImagesByProductId(admin, productId, syncOptions),
      50,
    );

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

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
