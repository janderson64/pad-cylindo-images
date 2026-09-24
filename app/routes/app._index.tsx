import { useCallback, useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
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
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-remix/server";

import { getCylindoConfig } from "../lib/cylindo-config.server";
import {
  syncCylindoVariantImages,
  truncateSyncSummaryForClient,
  type SyncSummary,
} from "../lib/sync-variant-images.server";
import { authenticate } from "../shopify.server";

type ActionData =
  | { ok: true; summary: SyncSummary }
  | { ok: false; error: string; summary?: SyncSummary };

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

  return json({ configSummary, configError });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let admin;

  try {
    ({ admin } = await authenticate.admin(request));
  } catch (error) {
    console.error("Sync action authentication failed:", error);
    throw error;
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "ping") {
    return json({ ok: true as const, summary: emptySummary("App connection OK") });
  }

  try {
    getCylindoConfig();
  } catch (error) {
    return json({
      ok: false as const,
      error:
        error instanceof Error ? error.message : "Missing Cylindo configuration",
    });
  }

  try {
    const summary = truncateSyncSummaryForClient(
      await syncCylindoVariantImages(admin),
    );

    if (summary.timedOut) {
      return json({
        ok: false as const,
        error:
          summary.statusMessage ??
          "Sync stopped early to avoid a request timeout. Run sync again to continue.",
        summary,
      });
    }

    return json({ ok: true as const, summary });
  } catch (error) {
    console.error("Cylindo sync failed:", error);

    if (error instanceof Response) {
      const body = await error.text().catch(() => "");
      return json({
        ok: false as const,
        error: `Shopify API error (${error.status}): ${body || error.statusText}`,
      });
    }

    return json({
      ok: false as const,
      error: error instanceof Error ? error.message : "Unexpected sync error",
    });
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

function emptySummary(statusMessage: string): SyncSummary {
  return {
    synced: [],
    skippedHasImage: [],
    skippedMissingMetafields: [],
    failed: [],
    productsScanned: 0,
    statusMessage,
  };
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

async function postAppAction(
  getIdToken: () => Promise<string>,
  body: URLSearchParams,
): Promise<{ response: Response; data: ActionData | null }> {
  const params = new URLSearchParams(window.location.search);
  const token = await getIdToken();

  params.set("id_token", token);

  const response = await fetch(`${window.location.pathname}?${params.toString()}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: body.toString(),
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(
      `Unexpected response (${response.status}). ${text.slice(0, 200)}`,
    );
  }

  return {
    response,
    data: (await response.json()) as ActionData,
  };
}

export default function Index() {
  const { configSummary, configError } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [actionData, setActionData] = useState<ActionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const runAction = useCallback(
    async (intent: "sync" | "ping") => {
      setIsLoading(true);
      setRequestError(null);

      try {
        const body = new URLSearchParams();
        body.set("intent", intent);

        const { response, data } = await postAppAction(() => shopify.idToken(), body);

        if (!response.ok) {
          throw new Error(
            data?.ok === false
              ? data.error
              : `Request failed with status ${response.status}`,
          );
        }

        if (!data) {
          throw new Error("Sync returned an empty response.");
        }

        setActionData(data);

        if (data.ok) {
          shopify.toast.show(
            intent === "ping"
              ? "Connection OK"
              : `Sync complete: ${data.summary.synced.length} synced`,
          );
        } else {
          shopify.toast.show(data.error, { isError: true });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Sync request failed";
        setRequestError(message);
        shopify.toast.show(message, { isError: true });
      } finally {
        setIsLoading(false);
      }
    },
    [shopify],
  );

  useEffect(() => {
    void runAction("ping");
  }, [runAction]);

  const summary =
    actionData && (actionData.ok || actionData.summary) ? actionData.summary : null;
  const syncDisabled = Boolean(configError) || isLoading;

  return (
    <Page>
      <TitleBar title="Cylindo Variant Images">
        <button
          variant="primary"
          onClick={() => void runAction("sync")}
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
                {requestError && (
                  <Banner tone="critical" title="Request failed">
                    <p>{requestError}</p>
                  </Banner>
                )}
                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    loading={isLoading}
                    onClick={() => void runAction("sync")}
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

        {actionData && !actionData.ok && (
          <Banner tone="critical" title="Sync failed">
            <p>{actionData.error}</p>
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
