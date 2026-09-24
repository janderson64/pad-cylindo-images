import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { i18n, close, data } = shopify;
  const productId = data.selected[0]?.id;

  const [loadingProduct, setLoadingProduct] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [productTitle, setProductTitle] = useState("");
  const [skuCount, setSkuCount] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [result, setResult] = useState(null);

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

    setSyncing(true);
    setSyncError("");

    try {
      const response = await fetch(
        `/app/sync-product?productId=${encodeURIComponent(productId)}`,
      );

      const responseText = await response.text();
      let json;

      try {
        json = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          responseText || `Sync request failed (${response.status}).`,
        );
      }

      if (!response.ok || !json.ok) {
        throw new Error(json.error ?? "Sync failed.");
      }

      setResult(json.summary);
    } catch (syncError) {
      setSyncError(
        syncError instanceof Error ? syncError.message : "Sync failed.",
      );
    } finally {
      setSyncing(false);
    }
  }

  const loading = loadingProduct || syncing;

  return (
    <s-admin-action heading={i18n.translate("title")} loading={loading}>
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
            {(loadError || syncError) ? (
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
            disabled={loading || skuCount === 0 || Boolean(loadError)}
            onClick={() => void runSync()}
          >
            {i18n.translate("sync")}
          </s-button>
          <s-button slot="secondary-actions" onClick={() => close()}>
            {i18n.translate("cancel")}
          </s-button>
        </>
      )}
    </s-admin-action>
  );
}
