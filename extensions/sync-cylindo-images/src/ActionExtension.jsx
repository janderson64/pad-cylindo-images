import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import { APP_URL } from "./config";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { i18n, close, data, auth } = shopify;
  const productId = data.selected[0]?.id;

  const [loadingProduct, setLoadingProduct] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [productTitle, setProductTitle] = useState("");
  const [skuCount, setSkuCount] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!productId) {
      setError("No product selected.");
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
          setError("Product not found.");
          return;
        }

        const skus = (product.variants?.nodes ?? [])
          .map((variant) => variant.sku?.trim())
          .filter(Boolean);

        setProductTitle(product.title ?? "");
        setSkuCount(new Set(skus.map((sku) => sku.toLowerCase())).size);
      } catch (loadError) {
        setError(
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
    setError("");

    try {
      const token = await auth.idToken();

      if (!token) {
        throw new Error("Could not authenticate with the app.");
      }

      const params = new URLSearchParams({ id_token: token });
      const response = await fetch(`${APP_URL}/app/sync-product?${params.toString()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productId }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.error ?? "Sync failed.");
      }

      setResult(json.summary);
    } catch (syncError) {
      setError(
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
            {error ? <s-text tone="critical">{error}</s-text> : null}
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
            disabled={loading || skuCount === 0 || Boolean(error)}
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
