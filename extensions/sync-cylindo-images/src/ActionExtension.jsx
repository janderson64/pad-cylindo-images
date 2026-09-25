import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

const MAX_VISIBLE_LOGS = 50;

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

function flushUi() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function fetchSyncJson(url, onHeartbeat) {
  const startedAt = Date.now();
  const heartbeat = onHeartbeat
    ? setInterval(() => {
        onHeartbeat(Math.floor((Date.now() - startedAt) / 1000));
      }, 2000)
    : null;

  try {
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
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}

function Extension() {
  const { i18n, close, data } = shopify;
  const productId = data.selected[0]?.id;

  const [loadingProduct, setLoadingProduct] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [productTitle, setProductTitle] = useState("");
  const [skuList, setSkuList] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [frame, setFrame] = useState(30);
  const [progressMessage, setProgressMessage] = useState("");
  const [syncLogs, setSyncLogs] = useState([]);
  const [result, setResult] = useState(null);

  const skuCount = skuList.length;

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

        const seen = new Set();
        const skus = [];

        for (const variant of product.variants?.nodes ?? []) {
          const sku = variant.sku?.trim();

          if (!sku) {
            continue;
          }

          const key = sku.toLowerCase();

          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          skus.push(sku);
        }

        setProductTitle(product.title ?? "");
        setSkuList(skus);
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
    if (!productId || syncing || skuList.length === 0) {
      return;
    }

    if (!Number.isInteger(frame) || frame < 0) {
      setSyncError("Enter a valid Cylindo frame number (0 or greater).");
      return;
    }

    const merged = emptySummary();
    merged.variantsRequested = skuList.length;

    setSyncing(true);
    setSyncError("");
    setProgressMessage("Starting sync...");
    setSyncLogs([]);
    appendLogs([`Starting sync for ${skuList.length} variant SKUs.`]);
    await flushUi();

    try {
      for (let index = 0; index < skuList.length; index += 1) {
        const sku = skuList[index];
        const position = index + 1;

        setProgressMessage(`Processing ${position} of ${skuList.length}: ${sku}`);
        appendLogs([`Checking ${sku} (${position}/${skuList.length})...`]);
        await flushUi();

        const params = new URLSearchParams({
          productId,
          skus: sku,
          frame: String(frame),
        });

        const json = await fetchSyncJson(
          `/api/sync-product?${params.toString()}`,
          (elapsedSeconds) => {
            setProgressMessage(
              `Processing ${position} of ${skuList.length}: ${sku} (${elapsedSeconds}s)`,
            );
          },
        );

        mergeSummary(merged, json.summary);
        appendLogs(json.logs ?? [`Finished ${sku}.`]);
        await flushUi();
      }

      if (skuList.length > 1) {
        merged.statusMessage = `Processed ${skuList.length} SKUs one at a time.`;
      }

      const historyParams = new URLSearchParams({
        productId,
        historyOnly: "1",
        variantsRequested: String(skuList.length),
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
            <s-number-field
              label="Cylindo frame"
              value={String(frame)}
              min={0}
              step={1}
              inputMode="numeric"
              onChange={(event) => {
                const next = Number(event.currentTarget.value);

                if (Number.isInteger(next) && next >= 0) {
                  setFrame(next);
                }
              }}
            />
            <s-text>
              {i18n.translate("description", {
                count: skuCount,
                frame,
              })}
            </s-text>
            {syncing && progressMessage ? (
              <s-text type="strong">{progressMessage}</s-text>
            ) : null}
            {syncing && syncLogs.length > 0 ? (
              <s-stack direction="block" gap="small">
                {syncLogs.slice(-12).map((log, index) => (
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
