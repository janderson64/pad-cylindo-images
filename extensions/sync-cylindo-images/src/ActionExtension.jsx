import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

const SYNC_BATCH_SIZE = 50;
const MAX_VISIBLE_LOGS = 40;

export default async () => {
  render(<Extension />, document.body);
};

function emptySummary() {
  return {
    synced: [],
    skippedHasImage: [],
    skippedMissingMetafields: [],
    failed: [],
    variantsRequested: 0,
    statusMessage: undefined,
  };
}

function mergeSummary(target, batch) {
  target.synced.push(...batch.synced);
  target.skippedHasImage.push(...batch.skippedHasImage);
  target.skippedMissingMetafields.push(...batch.skippedMissingMetafields);
  target.failed.push(...batch.failed);
  target.variantsRequested = batch.variantsRequested ?? target.variantsRequested;
  if (batch.statusMessage) {
    target.statusMessage = batch.statusMessage;
  }
}

async function fetchSyncJson(url) {
  const response = await fetch(url);
  const contentType = response.headers.get("content-type") ?? "";
  const responseText = await response.text();

  if (!contentType.includes("application/json")) {
    throw new Error(
      response.ok
        ? "Unexpected sync response format."
        : `Sync request failed (${response.status}).`,
    );
  }

  let json;

  try {
    json = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error("Sync response was not valid JSON.");
  }

  if (!response.ok || !json.ok) {
    throw new Error(json.error ?? "Sync failed.");
  }

  return json;
}

function Extension() {
  const { i18n, close, data } = shopify;
  const productId = data.selected[0]?.id;

  const [loadingProduct, setLoadingProduct] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [productTitle, setProductTitle] = useState("");
  const [skuCount, setSkuCount] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const [syncLogs, setSyncLogs] = useState([]);
  const [result, setResult] = useState(null);

  function appendLogs(messages) {
    if (!messages.length) {
      return;
    }

    setSyncLogs((current) => [...current, ...messages].slice(-MAX_VISIBLE_LOGS));
  }

  useEffect(() => {
    if (!productId) {
      setLoadError("No product selected.");
      setLoadingProduct(false);
      return;
    }

    (async () => {
      try {
        const response = await fetch("shopify:admin/api/graphql.json", {
          method: "POST",
          body: JSON.stringify({
            query: `query ProductVariantSkus($id: ID!) {
              product(id: $id) {
                title
                variants(first: 250) {
                  nodes {
                    sku
                  }
                }
              }
            }`,
            variables: { id: productId },
          }),
        });

        const json = await response.json();
        const product = json.data?.product;

        if (!product) {
          setLoadError("Product not found.");
          return;
        }

        const skus = (product.variants?.nodes ?? [])
          .map((variant) => variant.sku?.trim())
          .filter(Boolean);

        setProductTitle(product.title ?? "");
        setSkuCount(new Set(skus.map((sku) => sku.toLowerCase())).size);
      } catch (loadError) {
        setLoadError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load product variants.",
        );
      } finally {
        setLoadingProduct(false);
      }
    })();
  }, [productId]);

  async function runSync() {
    if (!productId || syncing) {
      return;
    }

    const batchCount = Math.max(1, Math.ceil(skuCount / SYNC_BATCH_SIZE));
    const merged = emptySummary();

    setSyncing(true);
    setSyncError("");
    setProgressMessage("Starting sync...");
    setSyncLogs([]);
    appendLogs([`Starting sync for ${skuCount} variant SKUs.`]);

    try {
      for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
        setProgressMessage(
          `Processing batch ${batchIndex + 1} of ${batchCount}...`,
        );
        appendLogs([`Batch ${batchIndex + 1} of ${batchCount} started.`]);

        const params = new URLSearchParams({
          productId,
          batch: String(batchIndex),
        });

        const json = await fetchSyncJson(
          `/api/sync-product?${params.toString()}`,
        );
        mergeSummary(merged, json.summary);
        appendLogs(json.logs ?? []);

        appendLogs([
          `Batch ${batchIndex + 1} complete: synced ${json.summary.synced.length}, skipped ${json.summary.skippedHasImage.length + json.summary.skippedMissingMetafields.length}, failed ${json.summary.failed.length}.`,
        ]);
      }

      if (batchCount > 1) {
        merged.statusMessage = `Processed ${skuCount} SKUs in ${batchCount} batches of up to ${SYNC_BATCH_SIZE}.`;
      }

      const historyParams = new URLSearchParams({
        productId,
        historyOnly: "1",
        variantsRequested: String(skuCount),
        syncedCount: String(merged.synced.length),
        skippedHasImageCount: String(merged.skippedHasImage.length),
        skippedMissingMetafieldsCount: String(
          merged.skippedMissingMetafields.length,
        ),
        failedCount: String(merged.failed.length),
      });

      if (merged.statusMessage) {
        historyParams.set("statusMessage", merged.statusMessage);
      }

      await fetchSyncJson(`/api/sync-product?${historyParams.toString()}`);

      appendLogs(["Sync complete."]);
      setProgressMessage("Sync complete.");
      setResult(merged);
    } catch (syncError) {
      setSyncError(
        syncError instanceof Error ? syncError.message : "Sync failed.",
      );
      setProgressMessage("");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <s-admin-action heading={i18n.translate("title")} loading={loadingProduct}>
      <s-stack direction="block" gap="base">
        {loadingProduct ? (
          <s-text>Loading product variants...</s-text>
        ) : result ? (
          <>
            <s-text type="strong">{productTitle}</s-text>
            <s-text>
              Synced: {result.synced.length} | Skipped (has image):{" "}
              {result.skippedHasImage.length} | Skipped (metafields):{" "}
              {result.skippedMissingMetafields.length} | Failed:{" "}
              {result.failed.length}
            </s-text>
            {result.statusMessage ? (
              <s-text tone="neutral">{result.statusMessage}</s-text>
            ) : null}
          </>
        ) : (
          <>
            <s-text type="strong">{productTitle}</s-text>
            <s-text>
              {i18n.translate("description", {
                count: skuCount,
              })}
            </s-text>
            {syncing && progressMessage ? (
              <s-text type="strong">{progressMessage}</s-text>
            ) : null}
            {syncing && syncLogs.length > 0 ? (
              <s-stack direction="block" gap="small">
                {syncLogs.map((log, index) => (
                  <s-text key={`${index}-${log}`} tone="neutral">
                    {log}
                  </s-text>
                ))}
              </s-stack>
            ) : null}
            {loadError || syncError ? (
              <s-text tone="critical">{loadError || syncError}</s-text>
            ) : null}
          </>
        )}
      </s-stack>

      {result ? (
        <s-button slot="primary-action" onClick={() => close()}>
          {i18n.translate("close")}
        </s-button>
      ) : (
        <>
          <s-button
            slot="primary-action"
            disabled={loadingProduct || syncing || skuCount === 0 || Boolean(loadError)}
            onClick={() => void runSync()}
          >
            {syncing ? "Syncing..." : i18n.translate("sync")}
          </s-button>
          <s-button
            slot="secondary-actions"
            disabled={syncing}
            onClick={() => close()}
          >
            {i18n.translate("cancel")}
          </s-button>
        </>
      )}
    </s-admin-action>
  );
}
