import type { CylindoConfig } from "./cylindo-config.server";

export type FeaturePair = {
  name: string;
  code: string;
};

export type BuildUrlResult =
  | { ok: true; url: string; pairs: FeaturePair[] }
  | { ok: false; reason: string };

const OPTION_NAME_KEYS = [
  "variant_option1_name",
  "variant_option2_name",
  "variant_option3_name",
] as const;

export function parseProductMetafields(
  metafields: Array<{ key: string; value: string | null }>,
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const metafield of metafields) {
    if (metafield.value != null) {
      map[metafield.key] = metafield.value;
    }
  }

  return map;
}

export function parseFeaturesCode(jsonValue: unknown): string[] {
  if (Array.isArray(jsonValue)) {
    return jsonValue
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (typeof jsonValue === "string") {
    try {
      return parseFeaturesCode(JSON.parse(jsonValue));
    } catch {
      const trimmed = jsonValue.trim();
      return trimmed ? [trimmed] : [];
    }
  }

  return [];
}

export function buildFeaturePairs(
  productMetafields: Record<string, string>,
  featuresCode: string[],
): FeaturePair[] | null {
  if (featuresCode.length === 0) {
    return null;
  }

  const pairs: FeaturePair[] = [];

  for (let index = 0; index < featuresCode.length; index++) {
    const optionKey = OPTION_NAME_KEYS[index];

    if (!optionKey) {
      return null;
    }

    const optionName = productMetafields[optionKey]?.trim();
    const code = featuresCode[index]?.trim();

    if (!optionName || !code) {
      return null;
    }

    pairs.push({ name: optionName, code });
  }

  return pairs;
}

export function buildCylindoFrameUrl(
  config: CylindoConfig,
  productCode: string,
  pairs: FeaturePair[],
): string {
  const params = new URLSearchParams();
  params.set("size", String(config.size));
  params.set("version", String(config.version));

  for (const pair of pairs) {
    params.append("feature", `${pair.name}:${pair.code}`);
  }

  const encodedProductCode = encodeURIComponent(productCode);

  return `https://content-v2.cylindo.com/api/v2/${config.accountId}/products/${encodedProductCode}/frames/${config.frame}/${encodedProductCode}.png?${params.toString()}`;
}

export function buildCylindoFrameUrlForVariant(
  config: CylindoConfig,
  productMetafields: Record<string, string>,
  featuresCode: string[],
): BuildUrlResult {
  const productCode = productMetafields.product_code?.trim();

  if (!productCode) {
    return { ok: false, reason: "Missing product metafield cylindo.product_code" };
  }

  const pairs = buildFeaturePairs(productMetafields, featuresCode);

  if (!pairs) {
    return {
      ok: false,
      reason: "Missing variant features_code or matching product variant_option names",
    };
  }

  return {
    ok: true,
    url: buildCylindoFrameUrl(config, productCode, pairs),
    pairs,
  };
}

export async function validateCylindoImageUrl(url: string): Promise<boolean> {
  const response = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(15_000),
  });

  if (response.ok) {
    return true;
  }

  if (response.status === 405 || response.status === 403) {
    const getResponse = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
    });
    return getResponse.ok;
  }

  return false;
}
