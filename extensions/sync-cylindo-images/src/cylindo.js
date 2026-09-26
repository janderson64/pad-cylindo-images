const OPTION_NAME_KEYS = [
  "variant_option1_name",
  "variant_option2_name",
  "variant_option3_name",
];

export function parseProductMetafields(metafields) {
  const map = {};

  for (const metafield of metafields) {
    if (metafield.value != null) {
      map[metafield.key] = unwrapMetafieldValue(metafield.value);
    }
  }

  return map;
}

export function unwrapMetafieldValue(value) {
  const trimmed = value.trim();

  if (
    !trimmed.startsWith("[") &&
    !trimmed.startsWith("{") &&
    !trimmed.startsWith('"')
  ) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      if (parsed.length === 1 && typeof parsed[0] === "string") {
        return parsed[0].trim();
      }

      if (
        parsed.every((item) => typeof item === "string") &&
        parsed.length > 0
      ) {
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

export function parseFeaturesCode(jsonValue) {
  if (Array.isArray(jsonValue)) {
    return jsonValue
      .filter((value) => typeof value === "string")
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

function tryParsePairedFeaturesCode(featuresCode) {
  if (featuresCode.length === 0) {
    return null;
  }

  const pairs = [];

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

function buildFeaturePairs(productMetafields, featuresCode) {
  if (featuresCode.length === 0) {
    return null;
  }

  const pairs = [];

  for (let index = 0; index < featuresCode.length; index += 1) {
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

function buildFeaturePairsFromMetafields(productMetafields, featuresCode) {
  const pairedFromCodes = tryParsePairedFeaturesCode(featuresCode);

  if (pairedFromCodes) {
    return pairedFromCodes;
  }

  return buildFeaturePairs(productMetafields, featuresCode);
}

export function buildCylindoFrameUrl(config, productCode, pairs) {
  const params = new URLSearchParams();
  params.set("size", String(config.size));

  for (const pair of pairs) {
    params.append("feature", `${pair.name}:${pair.code}`);
  }

  const encodedProductCode = encodeURIComponent(productCode);

  return `https://content-v2.cylindo.com/api/v2/${config.accountId}/products/${encodedProductCode}/frames/${config.frame}/${encodedProductCode}.png?${params.toString()}`;
}

export function buildCylindoFrameUrlForVariant(
  config,
  productMetafields,
  featuresCode,
) {
  const productCode = productMetafields.product_code?.trim();

  if (!productCode) {
    return {
      ok: false,
      reason: "Missing product metafield cylindo.product_code",
    };
  }

  const pairs = buildFeaturePairsFromMetafields(
    productMetafields,
    featuresCode,
  );

  if (!pairs) {
    return {
      ok: false,
      reason:
        "Missing variant features_code or matching product variant_option names",
    };
  }

  return {
    ok: true,
    url: buildCylindoFrameUrl(config, productCode, pairs),
  };
}
