import { useCallback, useEffect, useRef, useState } from "react";
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
  Text,
  Card,
  Button,
  BlockStack,
  Banner,
  InlineStack,
  DataTable,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-remix/server";

import { getCylindoConfig } from "../lib/cylindo-config.server";
import type { RecentSku } from "../lib/recent-skus.server";
import { listSyncJobs } from "../lib/sync-history.server";
import type { SyncSummary } from "../lib/sync-variant-images.server";
import { MAX_SKUS_PER_SYNC } from "../lib/sync-variant-images.server";
import { authenticate } from "../shopify.server";

type ActionData =
  | { ok: true; summary: SyncSummary }
  | { ok: false; error: string; summary?: SyncSummary };

type RecentSkusData =
  | { ok: true; recentSkus: RecentSku[] }
  | { ok: false; error: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  let configError: string | null = null;
  let defaultFrame = 30;

  try {
    defaultFrame = getCylindoConfig().frame;
  } catch (error) {
    configError =
      error instanceof Error ? error.message : "Missing Cylindo configuration";
  }

  let syncHistory: Awaited<ReturnType<typeof listSyncJobs>> = [];

  try {
    syncHistory = await listSyncJobs(session.shop);
  } catch (error) {
    console.error("Failed to load sync history:", error);
  }

  return json({ configError, syncHistory, maxSkusPerSync: MAX_SKUS_PER_SYNC, defaultFrame });
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

function formatSkuInput(skuInput: string): string {
  return skuInput.replace(/\s+/g, " ").trim();
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
  const recentSkusFetcher = useFetcher<RecentSkusData>();
  const revalidator = useRevalidator();
  const { configError, syncHistory, maxSkusPerSync, defaultFrame } =
    useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [skuInput, setSkuInput] = useState("");
  const [frameInput, setFrameInput] = useState(String(defaultFrame));

  const recentSkus =
    recentSkusFetcher.data?.ok === true ? recentSkusFetcher.data.recentSkus : [];
  const recentSkusError =
    recentSkusFetcher.data?.ok === false ? recentSkusFetcher.data.error : null;
  const recentSkusLoading =
    recentSkusFetcher.state === "loading" ||
    (recentSkusFetcher.state === "idle" && !recentSkusFetcher.data);
  const recentSkuList = recentSkus.map((item) => item.sku).join("\n");
  const recentSkusRequested = useRef(false);

  useEffect(() => {
    if (recentSkusRequested.current) {
      return;
    }

    recentSkusRequested.current = true;
    const params = new URLSearchParams(window.location.search);
    recentSkusFetcher.load(`/app/recent-skus?${params.toString()}`);
  }, [recentSkusFetcher]);

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const runSync = useCallback(async () => {
    const skus = skuInput.trim();

    if (!skus) {
      shopify.toast.show("Enter at least one variant SKU", { isError: true });
      return;
    }

    const frame = Number(frameInput);

    if (!Number.isInteger(frame) || frame < 0) {
      shopify.toast.show("Enter a valid Cylindo frame number (0 or greater)", {
        isError: true,
      });
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
      { skus, frame: String(frame) },
      { method: "POST", action: `/app/sync?${params.toString()}` },
    );
  }, [fetcher, frameInput, shopify, skuInput]);

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
  const syncDisabled =
    Boolean(configError) || isLoading || !skuInput.trim() || !frameInput.trim();

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
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Sync Cylindo Images
            </Text>
            <Text as="p" variant="bodyMd">
              Enter variant SKUs to sync. The app looks up each SKU, builds
              a Cylindo frame URL from product and variant metafields, and
              uploads the image only when the variant does not already have
              one.
            </Text>
            <TextField
              label="Cylindo frame"
              value={frameInput}
              onChange={setFrameInput}
              type="number"
              autoComplete="off"
              helpText="Frame number used in the Cylindo image URL (for example, 5 or 30)."
            />
            <TextField
              label="Variant SKUs"
              value={skuInput}
              onChange={setSkuInput}
              multiline={4}
              autoComplete="off"
              helpText={`One SKU per line, or comma-separated. Up to ${maxSkusPerSync} SKUs per sync (processed in batches of 50).`}
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
                  formatSkuInput(job.skuInput),
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
              Variants created in the last 30 days that do not have an image yet.
              Copy the list or load it into the sync field above.
            </Text>
            {recentSkusError && (
              <Banner tone="warning" title="Could not load recent SKUs">
                <p>{recentSkusError}</p>
              </Banner>
            )}
            {recentSkusLoading ? (
              <Text as="p" variant="bodyMd">
                Loading recently added SKUs...
              </Text>
            ) : recentSkus.length > 0 ? (
              <>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    SKU list
                  </Text>
                  <textarea
                    readOnly
                    value={recentSkuList}
                    aria-label="SKU list"
                    style={{
                      width: "100%",
                      height: "160px",
                      overflowY: "auto",
                      padding: "8px 12px",
                      border: "1px solid var(--p-color-border-secondary)",
                      borderRadius: "8px",
                      fontFamily: "inherit",
                      fontSize: "13px",
                      lineHeight: "20px",
                      resize: "none",
                      boxSizing: "border-box",
                      background: "var(--p-color-bg-surface)",
                      color: "var(--p-color-text)",
                    }}
                  />
                  <Text as="p" variant="bodySm" tone="subdued">
                    One SKU per line, ready to copy into another tool or the sync
                    field. Scroll to view the full list.
                  </Text>
                </BlockStack>
                <InlineStack gap="300">
                  <Button onClick={() => void copyRecentSkus()}>
                    Copy SKUs
                  </Button>
                  <Button onClick={fillSyncInputWithRecentSkus}>
                    Use in sync field
                  </Button>
                </InlineStack>
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["SKU", "Product", "Created"]}
                  rows={recentSkus.map((item) => [
                    item.sku,
                    item.productTitle,
                    formatDateTime(item.createdAt),
                  ])}
                />
              </>
            ) : (
              <Text as="p" variant="bodyMd">
                No recent variants without images were found in the last 30 days.
              </Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
