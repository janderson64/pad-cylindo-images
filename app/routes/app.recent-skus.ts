import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { fetchRecentVariantSkus } from "../lib/recent-skus.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const recentSkus = await fetchRecentVariantSkus(admin);
    return json({ ok: true as const, recentSkus });
  } catch (error) {
    console.error("Failed to load recent SKUs:", error);

    return json({
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load recently added SKUs",
    });
  }
};
