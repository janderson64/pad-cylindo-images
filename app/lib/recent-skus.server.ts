import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

type AdminGraphql = AdminApiContext["graphql"];

export type RecentSku = {
  sku: string;
  productTitle: string;
  createdAt: string;
  hasImage: boolean;
};

const RECENT_VARIANTS_QUERY = `#graphql
  query CylindoRecentVariants($query: String!, $cursor: String) {
    productVariants(first: 250, after: $cursor, query: $query, sortKey: CREATED_AT, reverse: true) {
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

function buildRecentSkuSearchQuery(days: number): string {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const dateFilter = since.toISOString().slice(0, 10);

  return `created_at:>=${dateFilter}`;
}

export async function fetchRecentVariantSkus(
  admin: { graphql: AdminGraphql },
  days = 30,
  maxResults = 500,
): Promise<RecentSku[]> {
  const query = buildRecentSkuSearchQuery(days);
  const results: RecentSku[] = [];
  let cursor: string | null = null;

  while (results.length < maxResults) {
    const response = await admin.graphql(RECENT_VARIANTS_QUERY, {
      variables: {
        query,
        cursor,
      },
    });

    const json = (await response.json()) as {
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

    const connection = json.data?.productVariants;
    const nodes = connection?.nodes ?? [];

    for (const node of nodes) {
      const sku = node.sku?.trim();

      if (!sku) {
        continue;
      }

      results.push({
        sku,
        productTitle: node.product.title,
        createdAt: node.createdAt,
        hasImage: Boolean(node.image?.id),
      });

      if (results.length >= maxResults) {
        break;
      }
    }

    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }

    cursor = connection.pageInfo.endCursor;
  }

  return results;
}
