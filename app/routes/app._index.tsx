import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  Banner,
  InlineStack,
  DataTable,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-remix/server";

import { getCylindoConfig } from "../lib/cylindo-config.server";
import { syncCylindoVariantImages, type SyncSummary } from "../lib/sync-variant-images.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  let configSummary: Record<string, string | number> | null = null;
  let configError: string | null = null;

  try {
    const config = getCylindoConfig();
    configSummary = {
      accountId: config.accountId,
      frame: config.frame,
      size: config.size,
      version: config.version,
    };
  } catch (error) {
    configError =
      error instanceof Error ? error.message : "Missing Cylindo configuration";
  }

  return { configSummary, configError };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    getCylindoConfig();
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error ? error.message : "Missing Cylindo configuration",
    };
  }

  try {
    const summary = await syncCylindoVariantImages(admin);
    return { ok: true as const, summary };
  } catch (error) {
    console.error("Cylindo sync failed:", error);

    if (error instanceof Response) {
      const body = await error.text().catch(() => "");
      return {
        ok: false as const,
        error: `Shopify API error (${error.status}): ${body || error.statusText}`,
      };
    }

    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unexpected sync error",
    };
  }
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

type ActionData =
  | { ok: true; summary: SyncSummary }
  | { ok: false; error: string };

function buildLogRows(summary: SyncSummary) {
  const rows: Array<[string, string, string, string]> = [];

  const append = (
    items: SyncSummary["synced"],
    status: string,
  ) => {
    for (const item of items) {
      rows.push([
        status,
        item.productTitle,
        item.sku,
        item.message + (item.url ? ` — ${item.url}` : ""),
      ]);
    }
  };

  append(summary.synced, "Synced");
  append(summary.skippedHasImage, "Skipped (has image)");
  append(summary.skippedMissingMetafields, "Skipped (metafields)");
  append(summary.failed, "Failed");

  return rows;
}

export default function Index() {
  const fetcher = useFetcher<ActionData>();
  const { configSummary, configError } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const runSync = async () => {
    const params = new URLSearchParams(window.location.search);

    try {
      const token = await shopify.idToken();
      params.set("id_token", token);
    } catch (error) {
      shopify.toast.show(
        error instanceof Error ? error.message : "Could not get session token",
        { isError: true },
      );
      return;
    }

    fetcher.submit({}, { method: "POST", action: `/app?${params.toString()}` });
  };

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show(
        `Sync complete: ${fetcher.data.summary.synced.length} synced`,
      );
    } else if (fetcher.data && !fetcher.data.ok) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const summary = fetcher.data?.ok ? fetcher.data.summary : null;

  return (
    <Page>
      <TitleBar title="Cylindo Variant Images">
        <button variant="primary" onClick={() => void runSync()} disabled={isLoading || Boolean(configError)}>
          Sync Cylindo variant images
        </button>
      </TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Sync frame 30 images from Cylindo
                </Text>
                <Text as="p" variant="bodyMd">
                  Scans products with <code>cylindo.enabled = true</code>, builds
                  a Cylindo frame URL from product and variant metafields, and
                  uploads the image only for variants that do not already have an
                  image.
                </Text>
                {configError && (
                  <Banner tone="warning" title="Configuration required">
                    <p>{configError}</p>
                  </Banner>
                )}
                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    loading={isLoading}
                    onClick={runSync}
                    disabled={Boolean(configError)}
                  >
                    Sync Cylindo variant images
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Cylindo settings
                </Text>
                <Text as="p" variant="bodyMd">
                  Configure via environment variables on the app host.
                </Text>
                {configSummary && (
                  <Box
                    padding="300"
                    background="bg-surface-active"
                    borderRadius="200"
                  >
                    <pre style={{ margin: 0, fontSize: "12px" }}>
                      {JSON.stringify(configSummary, null, 2)}
                    </pre>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {fetcher.data && !fetcher.data.ok && (
          <Banner tone="critical" title="Sync failed">
            <p>{fetcher.data.error}</p>
          </Banner>
        )}

        {summary && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Sync results
              </Text>
              <InlineStack gap="400">
                <Text as="span" variant="bodyMd">
                  Products scanned: {summary.productsScanned}
                </Text>
                <Text as="span" variant="bodyMd">
                  Synced: {summary.synced.length}
                </Text>
                <Text as="span" variant="bodyMd">
                  Skipped (has image): {summary.skippedHasImage.length}
                </Text>
                <Text as="span" variant="bodyMd">
                  Skipped (metafields): {summary.skippedMissingMetafields.length}
                </Text>
                <Text as="span" variant="bodyMd">
                  Failed: {summary.failed.length}
                </Text>
              </InlineStack>
              {buildLogRows(summary).length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Status", "Product", "SKU", "Details"]}
                  rows={buildLogRows(summary)}
                />
              ) : (
                <Text as="p" variant="bodyMd">
                  No variants matched the sync criteria.
                </Text>
              )}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
