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
  productsScanned: number;
};

type AdminGraphql = AdminApiContext["admin"]["graphql"];

type ProductNode = {
  id: string;
  title: string;
  metafields: Array<{ key: string; value: string | null }>;
  variants: {
    nodes: Array<{
      id: string;
      sku: string | null;
      image: { id: string } | null;
      metafield: { jsonValue: unknown } | null;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

const PRODUCTS_QUERY = `#graphql
  query CylindoProducts($cursor: String) {
    products(first: 50, after: $cursor, query: "metafields.cylindo.enabled:true") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        metafields(
          identifiers: [
            { namespace: "cylindo", key: "enabled" },
            { namespace: "cylindo", key: "product_code" },
            { namespace: "cylindo", key: "variant_option1_name" },
            { namespace: "cylindo", key: "variant_option2_name" },
            { namespace: "cylindo", key: "variant_option3_name" }
          ]
        ) {
          key
          value
        }
        variants(first: 100) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            sku
            image {
              id
            }
            metafield(namespace: "cylindo", key: "features_code") {
              jsonValue
            }
          }
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
      }
      mediaUserErrors {
        field
        message
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

async function attachImageToVariant(
  admin: { graphql: AdminGraphql },
  productId: string,
  variantId: string,
  imageUrl: string,
  alt: string,
): Promise<string | null> {
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

async function syncProductVariants(
  admin: { graphql: AdminGraphql },
  product: ProductNode,
  summary: SyncSummary,
): Promise<void> {
  const config = getCylindoConfig();
  const productMetafields = parseProductMetafields(product.metafields);

  for (const variant of product.variants.nodes) {
    if (variant.image?.id) {
      summary.skippedHasImage.push(
        entry(product.title, variant, "Variant already has an image"),
      );
      continue;
    }

    const featuresCode = parseFeaturesCode(variant.metafield?.jsonValue);

    if (featuresCode.length === 0) {
      summary.skippedMissingMetafields.push(
        entry(product.title, variant, "Missing variant metafield cylindo.features_code"),
      );
      continue;
    }

    const urlResult = buildCylindoFrameUrlForVariant(
      config,
      productMetafields,
      featuresCode,
    );

    if (!urlResult.ok) {
      summary.skippedMissingMetafields.push(
        entry(product.title, variant, urlResult.reason),
      );
      continue;
    }

    const imageExists = await validateCylindoImageUrl(urlResult.url);

    if (!imageExists) {
      summary.failed.push(
        entry(
          product.title,
          variant,
          "Cylindo image not found for feature combination",
          urlResult.url,
        ),
      );
      continue;
    }

    const alt = `Cylindo frame ${config.frame} — ${variant.sku ?? variant.id}`;
    const shopifyError = await attachImageToVariant(
      admin,
      product.id,
      variant.id,
      urlResult.url,
      alt,
    );

    if (shopifyError) {
      summary.failed.push(
        entry(product.title, variant, shopifyError, urlResult.url),
      );
      continue;
    }

    summary.synced.push(
      entry(product.title, variant, "Synced Cylindo frame image", urlResult.url),
    );
  }
}

async function fetchProductsPage(
  admin: { graphql: AdminGraphql },
  cursor: string | null,
): Promise<{
  nodes: ProductNode[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: { cursor },
  });
  const json = await response.json();
  const products = json.data?.products;

  return {
    nodes: products?.nodes ?? [],
    hasNextPage: products?.pageInfo?.hasNextPage ?? false,
    endCursor: products?.pageInfo?.endCursor ?? null,
  };
}

export async function syncCylindoVariantImages(admin: {
  graphql: AdminGraphql;
}): Promise<SyncSummary> {
  const summary: SyncSummary = {
    synced: [],
    skippedHasImage: [],
    skippedMissingMetafields: [],
    failed: [],
    productsScanned: 0,
  };

  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await fetchProductsPage(admin, cursor);

    for (const product of page.nodes) {
      summary.productsScanned += 1;
      await syncProductVariants(admin, product, summary);
    }

    hasNextPage = page.hasNextPage;
    cursor = page.endCursor;
  }

  return summary;
}
