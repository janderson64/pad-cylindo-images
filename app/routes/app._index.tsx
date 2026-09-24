import { useCallback, useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useRevalidator,
  useRouteError,
  type ShouldRevalidateFunctionArgs,
} from "@remix-run/react";
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
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-remix/server";

import { getCylindoConfig } from "../lib/cylindo-config.server";
import { fetchRecentVariantSkus } from "../lib/recent-skus.server";
import { listSyncJobs } from "../lib/sync-history.server";
import type { SyncSummary } from "../lib/sync-variant-images.server";
import { authenticate } from "../shopify.server";

type ActionData =
  | { ok: true; summary: SyncSummary }
  | { ok: false; error: string; summary?: SyncSummary };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

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

  let syncHistory: Awaited<ReturnType<typeof listSyncJobs>> = [];
  let recentSkus: Awaited<ReturnType<typeof fetchRecentVariantSkus>> = [];

  try {
    [syncHistory, recentSkus] = await Promise.all([
      listSyncJobs(session.shop),
      fetchRecentVariantSkus(admin),
    ]);
  } catch (error) {
    console.error("Failed to load sync dashboard data:", error);
  }

  return json({ configSummary, configError, syncHistory, recentSkus });
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

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function truncateSkuInput(skuInput: string, maxLength = 80): string {
  const normalized = skuInput.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildLogRows(summary: SyncSummary) {
  const rows: Array<[string, string, string, string]> = [];

  const append = (items: SyncSummary["synced"], status: string) => {
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
  const revalidator = useRevalidator();
  const { configSummary, configError, syncHistory, recentSkus } =
    useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [skuInput, setSkuInput] = useState("");

  const recentSkuList = recentSkus.map((item) => item.sku).join("\n");

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const runSync = useCallback(async () => {
    const skus = skuInput.trim();

    if (!skus) {
      shopify.toast.show("Enter at least one variant SKU", { isError: true });
      return;
    }

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

    fetcher.submit(
      { skus },
      { method: "POST", action: `/app/sync?${params.toString()}` },
    );
  }, [fetcher, shopify, skuInput]);

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show(
        `Sync complete: ${fetcher.data.summary.synced.length} synced`,
      );
      revalidator.revalidate();
    } else if (fetcher.data && !fetcher.data.ok) {
      shopify.toast.show(fetcher.data.error, { isError: true });
      if (fetcher.data.summary) {
        revalidator.revalidate();
      }
    }
  }, [fetcher.data, revalidator, shopify]);

  const copyRecentSkus = useCallback(async () => {
    if (!recentSkuList) {
      shopify.toast.show("No recent SKUs to copy", { isError: true });
      return;
    }

    try {
      await navigator.clipboard.writeText(recentSkuList);
      shopify.toast.show(`Copied ${recentSkus.length} SKUs`);
    } catch (error) {
      shopify.toast.show(
        error instanceof Error ? error.message : "Could not copy SKUs",
        { isError: true },
      );
    }
  }, [recentSkuList, recentSkus.length, shopify]);

  const fillSyncInputWithRecentSkus = useCallback(() => {
    setSkuInput(recentSkuList);
    shopify.toast.show(`Loaded ${recentSkus.length} SKUs into sync input`);
  }, [recentSkuList, recentSkus.length, shopify]);

  const summary =
    fetcher.data && (fetcher.data.ok || fetcher.data.summary)
      ? fetcher.data.summary
      : null;
  const syncDisabled = Boolean(configError) || isLoading || !skuInput.trim();

  return (
    <Page>
      <TitleBar title="Cylindo Variant Images">
        <button
          variant="primary"
          onClick={() => void runSync()}
          disabled={syncDisabled}
        >
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
                  Enter variant SKUs to sync. The app looks up each SKU, builds
                  a Cylindo frame URL from product and variant metafields, and
                  uploads the image only when the variant does not already have
                  one.
                </Text>
                <TextField
                  label="Variant SKUs"
                  value={skuInput}
                  onChange={setSkuInput}
                  multiline={4}
                  autoComplete="off"
                  helpText="One SKU per line, or comma-separated. Up to 50 SKUs per sync."
                  placeholder={"FRMDSEC_3-BLISS\nFRMDSEC_3-WALNUT"}
                />
                {configError && (
                  <Banner tone="warning" title="Configuration required">
                    <p>{configError}</p>
                  </Banner>
                )}
                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    loading={isLoading}
                    onClick={() => void runSync()}
                    disabled={syncDisabled}
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
              {summary.statusMessage && (
                <Banner tone="info">
                  <p>{summary.statusMessage}</p>
                </Banner>
              )}
              <InlineStack gap="400">
                <Text as="span" variant="bodyMd">
                  SKUs requested: {summary.variantsRequested}
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

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Sync history
            </Text>
            <Text as="p" variant="bodyMd">
              Previous sync jobs for this shop, newest first.
            </Text>
            {syncHistory.length > 0 ? (
              <DataTable
                columnContentTypes={[
                  "text",
                  "numeric",
                  "numeric",
                  "numeric",
                  "numeric",
                  "numeric",
                  "text",
                ]}
                headings={[
                  "When",
                  "Requested",
                  "Synced",
                  "Skipped (image)",
                  "Skipped (meta)",
                  "Failed",
                  "SKUs",
                ]}
                rows={syncHistory.map((job) => [
                  formatDateTime(job.createdAt),
                  String(job.variantsRequested),
                  String(job.syncedCount),
                  String(job.skippedHasImageCount),
                  String(job.skippedMissingMetafieldsCount),
                  String(job.failedCount),
                  truncateSkuInput(job.skuInput),
                ])}
              />
            ) : (
              <Text as="p" variant="bodyMd">
                No sync jobs yet. Run a sync to start building history.
              </Text>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Recently added SKUs
            </Text>
            <Text as="p" variant="bodyMd">
              Variants created in the last 30 days. Copy the list or load it
              into the sync field above.
            </Text>
            {recentSkus.length > 0 ? (
              <>
                <TextField
                  label="SKU list"
                  value={recentSkuList}
                  multiline={6}
                  autoComplete="off"
                  readOnly
                  helpText="One SKU per line, ready to copy into another tool or the sync field."
                />
                <InlineStack gap="300">
                  <Button onClick={() => void copyRecentSkus()}>
                    Copy SKUs
                  </Button>
                  <Button onClick={fillSyncInputWithRecentSkus}>
                    Use in sync field
                  </Button>
                </InlineStack>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["SKU", "Product", "Created", "Has image"]}
                  rows={recentSkus.map((item) => [
                    item.sku,
                    item.productTitle,
                    formatDateTime(item.createdAt),
                    item.hasImage ? "Yes" : "No",
                  ])}
                />
              </>
            ) : (
              <Text as="p" variant="bodyMd">
                No variants with SKUs were created in the last 30 days.
              </Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
