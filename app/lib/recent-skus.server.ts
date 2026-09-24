import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

type AdminGraphql = AdminApiContext["graphql"];

export type RecentSku = {
  sku: string;
  productTitle: string;
  createdAt: string;
  hasImage: boolean;
};

const RECENT_VARIANTS_BY_ID_QUERY = `#graphql
  query CylindoRecentVariantsById($cursor: String) {
    productVariants(first: 100, after: $cursor, sortKey: ID, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        sku
        createdAt
        image {
          id
        }
        product {
          title
        }
      }
    }
  }
`;

const RECENT_PRODUCTS_QUERY = `#graphql
  query CylindoRecentProducts($query: String!, $cursor: String) {
    products(first: 25, after: $cursor, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        title
        createdAt
        variants(first: 100) {
          nodes {
            sku
            createdAt
            image {
              id
            }
          }
        }
      }
    }
  }
`;

const DEFAULT_DAYS = 30;
const DEFAULT_MAX_RESULTS = 200;
const MAX_ID_SCAN_PAGES = 5;
const MAX_PRODUCT_PAGES = 2;

export function getRecentSkuCutoffDate(days: number): Date {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);
  return since;
}

export function buildRecentProductSearchQuery(days: number): string {
  const dateFilter = getRecentSkuCutoffDate(days).toISOString().slice(0, 10);

  return `created_at:>=${dateFilter}`;
}

export function isCreatedWithinDays(createdAt: string, days: number): boolean {
  return new Date(createdAt).getTime() >= getRecentSkuCutoffDate(days).getTime();
}

function upsertRecentSku(
  results: Map<string, RecentSku>,
  candidate: RecentSku,
): void {
  const existing = results.get(candidate.sku);

  if (
    !existing ||
    new Date(candidate.createdAt).getTime() > new Date(existing.createdAt).getTime()
  ) {
    results.set(candidate.sku, candidate);
  }
}

async function fetchRecentVariantsByIdScan(
  admin: { graphql: AdminGraphql },
  days: number,
  maxResults: number,
  results: Map<string, RecentSku>,
): Promise<void> {
  let cursor: string | null = null;
  let stalePages = 0;

  for (let page = 0; page < MAX_ID_SCAN_PAGES && results.size < maxResults; page++) {
    const response = await admin.graphql(RECENT_VARIANTS_BY_ID_QUERY, {
      variables: { cursor },
    });

    const json = (await response.json()) as {
      errors?: Array<{ message: string }>;
      data?: {
        productVariants?: {
          pageInfo?: {
            hasNextPage?: boolean;
            endCursor?: string | null;
          };
          nodes?: Array<{
            sku: string | null;
            createdAt: string;
            image: { id: string } | null;
            product: { title: string };
          }>;
        };
      };
    };

    if (json.errors?.length) {
      throw new Error(json.errors.map((error) => error.message).join("; "));
    }

    const connection = json.data?.productVariants;
    const nodes = connection?.nodes ?? [];
    let pageHasRecentVariant = false;

    for (const node of nodes) {
      const sku = node.sku?.trim();

      if (!sku || !isCreatedWithinDays(node.createdAt, days)) {
        continue;
      }

      pageHasRecentVariant = true;

      upsertRecentSku(results, {
        sku,
        productTitle: node.product.title,
        createdAt: node.createdAt,
        hasImage: Boolean(node.image?.id),
      });

      if (results.size >= maxResults) {
        return;
      }
    }

    stalePages = pageHasRecentVariant ? 0 : stalePages + 1;

    if (stalePages >= 2) {
      break;
    }

    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }

    cursor = connection.pageInfo.endCursor;
  }
}

async function fetchRecentVariantsFromNewProducts(
  admin: { graphql: AdminGraphql },
  days: number,
  maxResults: number,
  results: Map<string, RecentSku>,
): Promise<void> {
  const query = buildRecentProductSearchQuery(days);
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PRODUCT_PAGES && results.size < maxResults; page++) {
    const response = await admin.graphql(RECENT_PRODUCTS_QUERY, {
      variables: {
        query,
        cursor,
      },
    });

    const json = (await response.json()) as {
      errors?: Array<{ message: string }>;
      data?: {
        products?: {
          pageInfo?: {
            hasNextPage?: boolean;
            endCursor?: string | null;
          };
          nodes?: Array<{
            title: string;
            createdAt: string;
            variants: {
              nodes: Array<{
                sku: string | null;
                createdAt: string;
                image: { id: string } | null;
              }>;
            };
          }>;
        };
      };
    };

    if (json.errors?.length) {
      throw new Error(json.errors.map((error) => error.message).join("; "));
    }

    const connection = json.data?.products;
    const nodes = connection?.nodes ?? [];

    for (const product of nodes) {
      for (const variant of product.variants.nodes) {
        const sku = variant.sku?.trim();

        if (!sku || !isCreatedWithinDays(variant.createdAt, days)) {
          continue;
        }

        upsertRecentSku(results, {
          sku,
          productTitle: product.title,
          createdAt: variant.createdAt,
          hasImage: Boolean(variant.image?.id),
        });

        if (results.size >= maxResults) {
          return;
        }
      }
    }

    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }

    cursor = connection.pageInfo.endCursor;
  }
}

export async function fetchRecentVariantSkus(
  admin: { graphql: AdminGraphql },
  days = DEFAULT_DAYS,
  maxResults = DEFAULT_MAX_RESULTS,
): Promise<RecentSku[]> {
  const results = new Map<string, RecentSku>();

  await Promise.all([
    fetchRecentVariantsByIdScan(admin, days, maxResults, results),
    fetchRecentVariantsFromNewProducts(admin, days, maxResults, results),
  ]);

  return [...results.values()].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}
