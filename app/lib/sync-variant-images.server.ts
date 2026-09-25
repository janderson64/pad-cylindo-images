import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

import { getCylindoConfig } from "./cylindo-config.server";
import {
  buildCylindoFrameUrlForVariant,
  parseFeaturesCode,
  parseProductMetafields,
  validateCylindoImageUrl,
} from "./cylindo";

export type SyncLogEntry = {
  productTitle: string;
  sku: string;
  variantId: string;
  message: string;
  url?: string;
};

export type SyncSummary = {
  synced: SyncLogEntry[];
  skippedHasImage: SyncLogEntry[];
  skippedMissingMetafields: SyncLogEntry[];
  failed: SyncLogEntry[];
  variantsRequested: number;
  statusMessage?: string;
};

export type SyncOptions = {
  frame?: number;
  overwriteExisting?: boolean;
};

export type SyncPreview = {
  variantsWithImages: number;
  skusWithImages: string[];
};

const MAX_SKUS_PER_SYNC = 150;
const SYNC_BATCH_SIZE = 50;

export { MAX_SKUS_PER_SYNC, SYNC_BATCH_SIZE };

type AdminGraphql = AdminApiContext["graphql"];

type VariantLookup = {
  id: string;
  sku: string | null;
  image: { id: string } | null;
  metafield: { jsonValue: unknown } | null;
  product: {
    id: string;
    title: string;
    metafields: {
      nodes: Array<{ key: string; value: string | null }>;
    };
  };
};

const VARIANT_BY_SKU_QUERY = `#graphql
  query CylindoVariantBySku($query: String!) {
    productVariants(first: 1, query: $query) {
      nodes {
        id
        sku
        image {
          id
        }
        metafield(namespace: "cylindo", key: "features_code") {
          jsonValue
        }
        product {
          id
          title
          metafields(first: 20, namespace: "cylindo") {
            nodes {
              key
              value
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_VARIANT_SKUS_QUERY = `#graphql
  query CylindoProductVariantSkus($id: ID!, $cursor: String) {
    product(id: $id) {
      title
      variants(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          sku
        }
      }
    }
  }
`;

const CREATE_MEDIA_MUTATION = `#graphql
  mutation CylindoProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
        status
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const MEDIA_STATUS_QUERY = `#graphql
  query CylindoMediaStatus($id: ID!) {
    node(id: $id) {
      ... on Media {
        id
        status
      }
    }
  }
`;

const APPEND_MEDIA_MUTATION = `#graphql
  mutation CylindoProductVariantAppendMedia(
    $productId: ID!
    $variantMedia: [ProductVariantAppendMediaInput!]!
  ) {
    productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
      productVariants {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DETACH_MEDIA_MUTATION = `#graphql
  mutation CylindoProductVariantDetachMedia(
    $productId: ID!
    $variantMedia: [ProductVariantDetachMediaInput!]!
  ) {
    productVariantDetachMedia(productId: $productId, variantMedia: $variantMedia) {
      productVariants {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function entry(
  productTitle: string,
  variant: { id: string; sku: string | null },
  message: string,
  url?: string,
): SyncLogEntry {
  return {
    productTitle,
    sku: variant.sku ?? "(no sku)",
    variantId: variant.id,
    message,
    url,
  };
}

export function parseSkuList(input: string): string[] {
  const seen = new Set<string>();
  const skus: string[] = [];

  for (const part of input.split(/[\n,]+/)) {
    const sku = part.trim();
    if (!sku) continue;

    const key = sku.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    skus.push(sku);
  }

  return skus;
}

function buildSkuSearchQuery(sku: string): string {
  const escaped = sku.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `sku:"${escaped}"`;
}

function emptySummary(): SyncSummary {
  return {
    synced: [],
    skippedHasImage: [],
    skippedMissingMetafields: [],
    failed: [],
    variantsRequested: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMediaReady(
  admin: { graphql: AdminGraphql },
  mediaId: string,
  maxAttempts = 15,
  delayMs = 1000,
): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await admin.graphql(MEDIA_STATUS_QUERY, {
      variables: { id: mediaId },
    });

    const json = (await response.json()) as {
      data?: {
        node?: {
          status?: string;
        };
      };
    };

    const status = json.data?.node?.status;

    if (status === "READY") {
      return null;
    }

    if (status === "FAILED") {
      return "Shopify media processing failed";
    }

    if (attempt < maxAttempts - 1) {
      await sleep(delayMs);
    }
  }

  return "Timed out waiting for Shopify to process the image";
}

async function detachVariantImage(
  admin: { graphql: AdminGraphql },
  productId: string,
  variantId: string,
  mediaId: string,
): Promise<string | null> {
  const response = await admin.graphql(DETACH_MEDIA_MUTATION, {
    variables: {
      productId,
      variantMedia: [
        {
          variantId,
          mediaIds: [mediaId],
        },
      ],
    },
  });

  const json = await response.json();
  const errors = json.data?.productVariantDetachMedia?.userErrors ?? [];

  if (errors.length > 0) {
    return errors.map((error: { message: string }) => error.message).join("; ");
  }

  return null;
}

async function attachImageToVariant(
  admin: { graphql: AdminGraphql },
  productId: string,
  variantId: string,
  imageUrl: string,
  alt: string,
  existingImageId?: string | null,
): Promise<string | null> {
  if (existingImageId) {
    const detachError = await detachVariantImage(
      admin,
      productId,
      variantId,
      existingImageId,
    );

    if (detachError) {
      return detachError;
    }
  }
  const createResponse = await admin.graphql(CREATE_MEDIA_MUTATION, {
    variables: {
      productId,
      media: [
        {
          originalSource: imageUrl,
          mediaContentType: "IMAGE",
          alt,
        },
      ],
    },
  });

  const createJson = await createResponse.json();
  const createErrors = createJson.data?.productCreateMedia?.mediaUserErrors ?? [];

  if (createErrors.length > 0) {
    return createErrors.map((error: { message: string }) => error.message).join("; ");
  }

  const mediaId = createJson.data?.productCreateMedia?.media?.[0]?.id;

  if (!mediaId) {
    return "productCreateMedia did not return a media id";
  }

  const waitError = await waitForMediaReady(admin, mediaId);
  if (waitError) {
    return waitError;
  }

  const appendResponse = await admin.graphql(APPEND_MEDIA_MUTATION, {
    variables: {
      productId,
      variantMedia: [
        {
          variantId,
          mediaIds: [mediaId],
        },
      ],
    },
  });

  const appendJson = await appendResponse.json();
  const appendErrors = appendJson.data?.productVariantAppendMedia?.userErrors ?? [];

  if (appendErrors.length > 0) {
    return appendErrors.map((error: { message: string }) => error.message).join("; ");
  }

  return null;
}

async function fetchVariantBySku(
  admin: { graphql: AdminGraphql },
  sku: string,
): Promise<VariantLookup | null> {
  const response = await admin.graphql(VARIANT_BY_SKU_QUERY, {
    variables: { query: buildSkuSearchQuery(sku) },
  });

  const json = (await response.json()) as {
    data?: {
      productVariants?: {
        nodes?: VariantLookup[];
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(
      json.errors
        .map((error) => error.message ?? "GraphQL error")
        .join("; "),
    );
  }

  return json.data?.productVariants?.nodes?.[0] ?? null;
}

async function fetchProductVariantSkus(
  admin: { graphql: AdminGraphql },
  productId: string,
): Promise<{ productTitle: string; skus: string[] }> {
  const skus: string[] = [];
  const seen = new Set<string>();
  let productTitle = "";
  let cursor: string | null = null;

  while (true) {
    const response = await admin.graphql(PRODUCT_VARIANT_SKUS_QUERY, {
      variables: {
        id: productId,
        cursor,
      },
    });

    const json = (await response.json()) as {
      errors?: Array<{ message?: string }>;
      data?: {
        product?: {
          title?: string;
          variants?: {
            pageInfo?: {
              hasNextPage?: boolean;
              endCursor?: string | null;
            };
            nodes?: Array<{ sku: string | null }>;
          };
        };
      };
    };

    if (json.errors?.length) {
      throw new Error(
        json.errors
          .map((error) => error.message ?? "GraphQL error")
          .join("; "),
      );
    }

    const product = json.data?.product;

    if (!product) {
      throw new Error("Product not found");
    }

    productTitle = product.title ?? productTitle;

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

    if (
      !product.variants?.pageInfo?.hasNextPage ||
      !product.variants.pageInfo.endCursor
    ) {
      break;
    }

    cursor = product.variants.pageInfo.endCursor;
  }

  return { productTitle, skus };
}

async function syncVariant(
  admin: { graphql: AdminGraphql },
  variant: VariantLookup,
  summary: SyncSummary,
  options?: SyncOptions,
): Promise<void> {
  const config = getCylindoConfig(
    options?.frame !== undefined ? { frame: options.frame } : undefined,
  );
  const productMetafields = parseProductMetafields(variant.product.metafields.nodes);
  const enabled = productMetafields.enabled?.trim().toLowerCase();

  if (enabled !== "true" && enabled !== "1") {
    summary.skippedMissingMetafields.push(
      entry(
        variant.product.title,
        variant,
        "Product is not Cylindo-enabled (cylindo.enabled is not true)",
      ),
    );
    return;
  }

  const hadExistingImage = Boolean(variant.image?.id);

  if (hadExistingImage && !options?.overwriteExisting) {
    summary.skippedHasImage.push(
      entry(variant.product.title, variant, "Variant already has an image"),
    );
    return;
  }

  const featuresCode = parseFeaturesCode(variant.metafield?.jsonValue);

  if (featuresCode.length === 0) {
    summary.skippedMissingMetafields.push(
      entry(
        variant.product.title,
        variant,
        "Missing variant metafield cylindo.features_code",
      ),
    );
    return;
  }

  const urlResult = buildCylindoFrameUrlForVariant(
    config,
    productMetafields,
    featuresCode,
  );

  if (!urlResult.ok) {
    summary.skippedMissingMetafields.push(
      entry(variant.product.title, variant, urlResult.reason),
    );
    return;
  }

  const imageExists = await validateCylindoImageUrl(urlResult.url);

  if (!imageExists) {
    summary.failed.push(
      entry(
        variant.product.title,
        variant,
        "Cylindo image not found for feature combination",
        urlResult.url,
      ),
    );
    return;
  }

  const alt = variant.sku ?? variant.id;
  const shopifyError = await attachImageToVariant(
    admin,
    variant.product.id,
    variant.id,
    urlResult.url,
    alt,
    options?.overwriteExisting ? variant.image?.id : null,
  );

  if (shopifyError) {
    summary.failed.push(
      entry(variant.product.title, variant, shopifyError, urlResult.url),
    );
    return;
  }

  summary.synced.push(
    entry(
      variant.product.title,
      variant,
      hadExistingImage
        ? "Replaced existing variant image with Cylindo frame image"
        : "Synced Cylindo frame image",
      urlResult.url,
    ),
  );
}

export async function previewCylindoSync(
  admin: { graphql: AdminGraphql },
  skusInput: string,
): Promise<SyncPreview> {
  const skus = parseSkuList(skusInput);
  const skusWithImages: string[] = [];

  for (const sku of skus) {
    const variant = await fetchVariantBySku(admin, sku);

    if (variant?.image?.id) {
      skusWithImages.push(variant.sku ?? sku);
    }
  }

  return {
    variantsWithImages: skusWithImages.length,
    skusWithImages,
  };
}

export async function previewCylindoSyncByProductId(
  admin: { graphql: AdminGraphql },
  productId: string,
): Promise<SyncPreview> {
  const { skus } = await fetchProductVariantSkus(admin, productId);
  return previewCylindoSync(admin, skus.join("\n"));
}

function mergeSummaries(target: SyncSummary, batch: SyncSummary): void {
  target.synced.push(...batch.synced);
  target.skippedHasImage.push(...batch.skippedHasImage);
  target.skippedMissingMetafields.push(...batch.skippedMissingMetafields);
  target.failed.push(...batch.failed);
}

async function syncSkuBatch(
  admin: { graphql: AdminGraphql },
  skus: string[],
  options?: SyncOptions,
): Promise<SyncSummary> {
  const summary = emptySummary();

  for (const sku of skus) {
    const variant = await fetchVariantBySku(admin, sku);

    if (!variant) {
      summary.failed.push({
        productTitle: "(not found)",
        sku,
        variantId: "",
        message: "No variant found with this SKU",
      });
      continue;
    }

    await syncVariant(admin, variant, summary, options);
  }

  return summary;
}

export async function syncCylindoVariantImagesBySkuList(
  admin: { graphql: AdminGraphql },
  skus: string[],
  options?: SyncOptions,
): Promise<SyncSummary> {
  if (skus.length === 0) {
    const summary = emptySummary();
    summary.statusMessage = "No variant SKUs to sync.";
    return summary;
  }

  const summary: SyncSummary = {
    ...emptySummary(),
    variantsRequested: skus.length,
  };

  const batchCount = Math.ceil(skus.length / SYNC_BATCH_SIZE);

  for (let index = 0; index < skus.length; index += SYNC_BATCH_SIZE) {
    const batchSkus = skus.slice(index, index + SYNC_BATCH_SIZE);
    const batchSummary = await syncSkuBatch(admin, batchSkus, options);
    mergeSummaries(summary, batchSummary);
  }

  if (batchCount > 1) {
    summary.statusMessage = `Processed ${skus.length} SKUs in ${batchCount} batches of up to ${SYNC_BATCH_SIZE}.`;
  }

  return summary;
}

export async function syncCylindoVariantImagesByProductId(
  admin: { graphql: AdminGraphql },
  productId: string,
  options?: SyncOptions,
): Promise<SyncSummary> {
  const { productTitle, skus } = await fetchProductVariantSkus(admin, productId);
  const summary = await syncCylindoVariantImagesBySkuList(admin, skus, options);

  if (summary.statusMessage === "No variant SKUs to sync.") {
    summary.statusMessage = `${productTitle} has no variant SKUs to sync.`;
  }

  return summary;
}

export async function syncCylindoVariantImagesBySkus(
  admin: { graphql: AdminGraphql },
  skusInput: string,
  options?: SyncOptions,
): Promise<SyncSummary> {
  const skus = parseSkuList(skusInput);

  if (skus.length === 0) {
    const summary = emptySummary();
    summary.statusMessage = "Enter at least one variant SKU to sync.";
    return summary;
  }

  if (skus.length > MAX_SKUS_PER_SYNC) {
    throw new Error(`Too many SKUs. Sync up to ${MAX_SKUS_PER_SYNC} at a time.`);
  }

  return syncCylindoVariantImagesBySkuList(admin, skus, options);
}

export function truncateSyncSummaryForClient(
  summary: SyncSummary,
  limit = MAX_SKUS_PER_SYNC,
): SyncSummary {
  return {
    ...summary,
    synced: summary.synced.slice(0, limit),
    skippedHasImage: summary.skippedHasImage.slice(0, limit),
    skippedMissingMetafields: summary.skippedMissingMetafields.slice(0, limit),
    failed: summary.failed.slice(0, limit),
  };
}

export function buildBatchProgressLogs(summary: SyncSummary): string[] {
  const logs: string[] = [];

  for (const item of summary.synced) {
    logs.push(`Synced ${item.sku}`);
  }

  for (const item of summary.skippedHasImage) {
    logs.push(`Skipped ${item.sku} (already has image)`);
  }

  for (const item of summary.skippedMissingMetafields) {
    logs.push(`Skipped ${item.sku} (${item.message})`);
  }

  for (const item of summary.failed) {
    logs.push(`Failed ${item.sku}: ${item.message}`);
  }

  return logs;
}

export type ProductSyncBatchResult = {
  summary: SyncSummary;
  batchIndex: number;
  batchCount: number;
  skusTotal: number;
  productTitle: string;
};

export async function syncCylindoVariantImagesByProductIdBatch(
  admin: { graphql: AdminGraphql },
  productId: string,
  batchIndex: number,
  options?: SyncOptions,
): Promise<ProductSyncBatchResult> {
  const { productTitle, skus } = await fetchProductVariantSkus(admin, productId);
  const batchCount = Math.max(1, Math.ceil(skus.length / SYNC_BATCH_SIZE));

  if (batchIndex < 0 || batchIndex >= batchCount) {
    throw new Error(`Invalid batch index ${batchIndex + 1} of ${batchCount}.`);
  }

  const batchSkus = skus.slice(
    batchIndex * SYNC_BATCH_SIZE,
    batchIndex * SYNC_BATCH_SIZE + SYNC_BATCH_SIZE,
  );
  const summary = await syncSkuBatch(admin, batchSkus, options);
  summary.variantsRequested = skus.length;

  if (batchCount > 1) {
    summary.statusMessage = `Processed ${skus.length} SKUs in ${batchCount} batches of up to ${SYNC_BATCH_SIZE}.`;
  } else if (summary.statusMessage === "No variant SKUs to sync.") {
    summary.statusMessage = `${productTitle} has no variant SKUs to sync.`;
  }

  return {
    summary,
    batchIndex,
    batchCount,
    skusTotal: skus.length,
    productTitle,
  };
}

// Backwards-compatible export name used by the sync route.
export const syncCylindoVariantImages = syncCylindoVariantImagesBySkus;
