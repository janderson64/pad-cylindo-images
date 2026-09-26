import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import {
  buildCylindoFrameUrlForVariant,
  parseFeaturesCode,
  parseProductMetafields,
} from "./cylindo.js";
import { CYLINDO_ACCOUNT_ID, CYLINDO_SIZE } from "./config.js";
import { syncCylindoVariant } from "./sync-variant.js";

const MAX_VISIBLE_LOGS = 50;
const PRODUCT_PREVIEW_QUERY = `query ProductCylindoPreview($id: ID!) {
  product(id: $id) {
    title
    metafields(first: 20, namespace: "cylindo") {
      nodes {
        key
        value
      }
    }
    variants(first: 250) {
      nodes {
        id
        sku
        image {
          id
        }
        media(first: 10) {
          nodes {
            id
          }
        }
        metafield(namespace: "cylindo", key: "features_code") {
          jsonValue
        }
      }
    }
  }
}`;

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

function Extension() {
  const { i18n, close, data } = shopify;
  const productId = data.selected[0]?.id;

  const [loadingProduct, setLoadingProduct] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [productTitle, setProductTitle] = useState("");
  const [skuList, setSkuList] = useState([]);
  const [skusWithImages, setSkusWithImages] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [frame, setFrame] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewSku, setPreviewSku] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewImageError, setPreviewImageError] = useState(false);
  const [productMetafields, setProductMetafields] = useState(null);
  const [firstPreviewVariant, setFirstPreviewVariant] = useState(null);
  const [variantsBySku, setVariantsBySku] = useState({});
  const [showOverwriteWarning, setShowOverwriteWarning] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [syncLogs, setSyncLogs] = useState([]);
  const [result, setResult] = useState(null);

  const skuCount = skuList.length;
  const overwriteCount = skusWithImages.length;
  const skusWithImagesSet = new Set(
    skusWithImages.map((sku) => sku.toLowerCase()),
  );

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
            query: PRODUCT_PREVIEW_QUERY,
            variables: { id: productId },
          }),
        });

        const json = await response.json();
        const product = json.data?.product;

        if (!product) {
          setLoadError("Product not found.");
          return;
        }

        const metafields = parseProductMetafields(
          product.metafields?.nodes ?? [],
        );
        const enabled = metafields.enabled?.trim().toLowerCase();

        if (enabled !== "true" && enabled !== "1") {
          setLoadError(
            "Product is not Cylindo-enabled (cylindo.enabled is not true).",
          );
          return;
        }

        const seen = new Set();
        const skus = [];
        const withImages = [];
        const variantMap = {};
        let previewVariant = null;

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

          const variantData = {
            id: variant.id,
            sku,
            imageId: variant.image?.id ?? null,
            mediaIds: (variant.media?.nodes ?? [])
              .map((node) => node.id)
              .filter(Boolean),
            featuresCode: parseFeaturesCode(variant.metafield?.jsonValue),
          };

          variantMap[key] = variantData;

          if (variant.image?.id || variantData.mediaIds.length > 0) {
            withImages.push(sku);
          }

          if (!previewVariant) {
            previewVariant = variantData;
          }
        }

        setProductTitle(product.title ?? "");
        setProductMetafields(metafields);
        setFirstPreviewVariant(previewVariant);
        setVariantsBySku(variantMap);
        setSkuList(skus);
        setSkusWithImages(withImages);
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

  useEffect(() => {
    if (!productId || loadingProduct || syncing || result || !productMetafields) {
      return;
    }

    const frameNumber = Number(frame);

    if (!frame.trim() || !Number.isInteger(frameNumber) || frameNumber < 0) {
      setPreviewUrl("");
      setPreviewSku("");
      setPreviewError("");
      setPreviewImageError(false);
      return;
    }

    if (!firstPreviewVariant?.sku) {
      setPreviewUrl("");
      setPreviewSku("");
      setPreviewError("No variant SKUs on this product.");
      setPreviewImageError(false);
      return;
    }

    if (firstPreviewVariant.featuresCode.length === 0) {
      setPreviewUrl("");
      setPreviewSku(firstPreviewVariant.sku);
      setPreviewError(
        "Missing variant metafield cylindo.features_code on first variant.",
      );
      setPreviewImageError(false);
      return;
    }

    const urlResult = buildCylindoFrameUrlForVariant(
      {
        accountId: CYLINDO_ACCOUNT_ID,
        frame: frameNumber,
        size: CYLINDO_SIZE,
      },
      productMetafields,
      firstPreviewVariant.featuresCode,
    );

    setPreviewImageError(false);
    setPreviewSku(firstPreviewVariant.sku);

    if (!urlResult.ok) {
      setPreviewUrl("");
      setPreviewError(urlResult.reason);
      return;
    }

    setPreviewUrl(urlResult.url);
    setPreviewError("");
  }, [
    frame,
    productId,
    loadingProduct,
    syncing,
    result,
    productMetafields,
    firstPreviewVariant,
  ]);

  async function runSync(overwriteExisting) {
    if (!productId || syncing || skuList.length === 0) {
      return;
    }

    const frameNumber = Number(frame);

    if (!frame.trim() || !Number.isInteger(frameNumber) || frameNumber < 0) {
      setSyncError("Enter a valid Cylindo frame number (0 or greater).");
      return;
    }

    const skusToSync = overwriteExisting
      ? skuList
      : skuList.filter((sku) => !skusWithImagesSet.has(sku.toLowerCase()));

    if (skusToSync.length === 0) {
      setSyncError("All variants on this product already have images.");
      setShowOverwriteWarning(false);
      return;
    }

    const merged = emptySummary();
    merged.variantsRequested = skusToSync.length;

    setSyncing(true);
    setSyncError("");
    setShowOverwriteWarning(false);
    setProgressMessage("Starting sync...");
    setSyncLogs([]);
    appendLogs([`Starting sync for ${skusToSync.length} variant SKUs.`]);
    if (!overwriteExisting && overwriteCount > 0) {
      appendLogs([
        `Skipping ${overwriteCount} variant SKU(s) that already have images.`,
      ]);
    }
    await flushUi();

    try {
      const cylindoConfig = {
        accountId: CYLINDO_ACCOUNT_ID,
        size: CYLINDO_SIZE,
      };

      for (let index = 0; index < skusToSync.length; index += 1) {
        const sku = skusToSync[index];
        const position = index + 1;
        const variant = variantsBySku[sku.toLowerCase()];

        setProgressMessage(
          `Processing ${position} of ${skusToSync.length}: ${sku}`,
        );
        appendLogs([`Checking ${sku} (${position}/${skusToSync.length})...`]);
        await flushUi();

        if (!variant) {
          merged.failed.push({
            productTitle,
            sku,
            variantId: "",
            message: "Variant not found on this product",
          });
          appendLogs([`${sku}: Variant not found on this product.`]);
          await flushUi();
          continue;
        }

        const syncResult = await syncCylindoVariant({
          productId,
          productTitle,
          productMetafields,
          variant,
          frame: frameNumber,
          overwriteExisting,
          cylindoConfig,
        });

        merged[syncResult.bucket].push(syncResult.entry);
        appendLogs([`${sku}: ${syncResult.entry.message}`]);
        await flushUi();
      }

      if (skusToSync.length > 1) {
        merged.statusMessage = `Processed ${skusToSync.length} SKUs one at a time.`;
      } else if (!overwriteExisting && overwriteCount > 0) {
        merged.statusMessage = `Skipped ${overwriteCount} variant SKU(s) with existing images.`;
      }

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

  function handleSyncClick() {
    const frameNumber = Number(frame);

    if (!frame.trim() || !Number.isInteger(frameNumber) || frameNumber < 0) {
      setSyncError("Enter a valid Cylindo frame number (0 or greater).");
      return;
    }

    if (overwriteCount > 0 && !showOverwriteWarning) {
      setShowOverwriteWarning(true);
      setSyncError("");
      return;
    }

    void runSync(showOverwriteWarning);
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
        ) : showOverwriteWarning ? (
          <>
            <s-text type="strong">{productTitle}</s-text>
            <s-banner tone="warning" heading={i18n.translate("overwriteTitle")}>
              <s-text>
                {i18n.translate("overwriteMessage", {
                  count: overwriteCount,
                })}
              </s-text>
            </s-banner>
            {skusWithImages.length > 0 ? (
              <s-text tone="neutral">
                {i18n.translate("overwriteSkus", {
                  skus: skusWithImages.join(", "),
                })}
              </s-text>
            ) : null}
            {syncError ? <s-text tone="critical">{syncError}</s-text> : null}
          </>
        ) : (
          <>
            <s-text type="strong">{productTitle}</s-text>
            <s-number-field
              label="Cylindo frame"
              value={frame}
              min={0}
              step={1}
              inputMode="numeric"
              onChange={(event) => {
                setFrame(event.currentTarget.value);
              }}
            />
            {frame.trim() ? (
              <s-stack direction="block" gap="small">
                <s-text tone="neutral">
                  {i18n.translate("framePreviewLabel", {
                    sku: previewSku || skuList[0] || "—",
                    frame: frame.trim(),
                  })}
                </s-text>
                {previewError ? (
                  <s-text tone="critical">{previewError}</s-text>
                ) : previewUrl ? (
                  <>
                    <s-image
                      src={previewUrl}
                      alt={i18n.translate("framePreviewAlt", {
                        frame: frame.trim(),
                      })}
                      aspectRatio="1"
                      objectFit="contain"
                      inlineSize="fill"
                      onError={() => setPreviewImageError(true)}
                    />
                    {previewImageError ? (
                      <s-text tone="critical">
                        {i18n.translate("framePreviewLoadFailed")}
                      </s-text>
                    ) : null}
                  </>
                ) : null}
              </s-stack>
            ) : null}
            <s-text>
              {i18n.translate("description", {
                count: skuCount,
                frame: frame.trim() || "—",
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
      ) : showOverwriteWarning ? (
        <>
          <s-button
            slot="primary-action"
            disabled={syncing}
            onClick={() => void runSync(true)}
          >
            {i18n.translate("overwriteProceed")}
          </s-button>
          <s-button
            slot="secondary-actions"
            disabled={syncing}
            onClick={() => void runSync(false)}
          >
            {i18n.translate("overwriteSkip")}
          </s-button>
          <s-button
            slot="secondary-actions"
            disabled={syncing}
            onClick={() => setShowOverwriteWarning(false)}
          >
            {i18n.translate("cancel")}
          </s-button>
        </>
      ) : (
        <>
          <s-button
            slot="primary-action"
            disabled={loadingProduct || syncing || skuCount === 0 || Boolean(loadError) || !frame.trim()}
            onClick={() => handleSyncClick()}
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
