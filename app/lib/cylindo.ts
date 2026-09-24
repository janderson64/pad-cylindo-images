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
      map[metafield.key] = unwrapMetafieldValue(metafield.value);
    }
  }

  return map;
}

export function unwrapMetafieldValue(value: string): string {
  const trimmed = value.trim();

  if (!trimmed.startsWith("[") && !trimmed.startsWith("{") && !trimmed.startsWith('"')) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      if (parsed.length === 1 && typeof parsed[0] === "string") {
        return parsed[0].trim();
      }

      if (parsed.every((item) => typeof item === "string") && parsed.length > 0) {
        return parsed[0].trim();
      }
    }

    if (typeof parsed === "string") {
      return parsed.trim();
    }
  } catch {
    // Fall back to the raw metafield string.
  }

  return trimmed;
}

export function parseFeaturesCode(jsonValue: unknown): string[] {
  if (Array.isArray(jsonValue)) {
    return jsonValue
      .filter((value): value is string => typeof value === "string")
      .map((value) => unwrapMetafieldValue(value))
      .filter(Boolean);
  }

  if (typeof jsonValue === "string") {
    try {
      return parseFeaturesCode(JSON.parse(jsonValue));
    } catch {
      const trimmed = unwrapMetafieldValue(jsonValue);
      return trimmed ? [trimmed] : [];
    }
  }

  return [];
}

function tryParsePairedFeaturesCode(featuresCode: string[]): FeaturePair[] | null {
  if (featuresCode.length === 0) {
    return null;
  }

  const pairs: FeaturePair[] = [];

  for (const entry of featuresCode) {
    const colonIndex = entry.indexOf(":");

    if (colonIndex <= 0) {
      return null;
    }

    const name = unwrapMetafieldValue(entry.slice(0, colonIndex));
    const code = unwrapMetafieldValue(entry.slice(colonIndex + 1));

    if (!name || !code) {
      return null;
    }

    pairs.push({ name, code });
  }

  return pairs;
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

  const pairs = buildFeaturePairsFromMetafields(productMetafields, featuresCode);

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

export function buildFeaturePairsFromMetafields(
  productMetafields: Record<string, string>,
  featuresCode: string[],
): FeaturePair[] | null {
  const pairedFromCodes = tryParsePairedFeaturesCode(featuresCode);

  if (pairedFromCodes) {
    return pairedFromCodes;
  }

  return buildFeaturePairs(productMetafields, featuresCode);
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
