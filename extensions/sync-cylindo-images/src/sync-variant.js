import { buildCylindoFrameUrlForVariant } from "./cylindo.js";

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

const DELETE_MEDIA_MUTATION = `#graphql
  mutation CylindoProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      deletedProductImageIds
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

async function adminGraphql(query, variables) {
  const response = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(
      json.errors.map((error) => error.message ?? "GraphQL error").join("; "),
    );
  }

  return json;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeEntry(productTitle, variant, message, url) {
  return {
    productTitle,
    sku: variant.sku ?? "(no sku)",
    variantId: variant.id,
    message,
    ...(url ? { url } : {}),
  };
}

function variantHasExistingImage(variant) {
  return (
    Boolean(variant.imageId) || (variant.mediaIds?.length ?? 0) > 0
  );
}

function getReplaceableMediaIds(variant) {
  const ids = [...(variant.mediaIds ?? [])];

  if (variant.imageId && !ids.includes(variant.imageId)) {
    ids.push(variant.imageId);
  }

  return ids;
}

function mediaIdsForDetach(mediaIds) {
  return mediaIds.filter((id) => id.includes("/MediaImage/"));
}

async function validateCylindoImageUrl(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });

    if (response.ok) {
      return true;
    }

    if (response.status === 405 || response.status === 403) {
      const getResponse = await fetch(url, { method: "GET" });
      return getResponse.ok;
    }
  } catch {
    // Fall through.
  }

  return false;
}

async function waitForMediaReady(mediaId, maxAttempts = 15, delayMs = 1000) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const json = await adminGraphql(MEDIA_STATUS_QUERY, { id: mediaId });
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

async function detachVariantMedia(productId, variantId, mediaIds) {
  if (mediaIds.length === 0) {
    return null;
  }

  const json = await adminGraphql(DETACH_MEDIA_MUTATION, {
    productId,
    variantMedia: [
      {
        variantId,
        mediaIds,
      },
    ],
  });
  const errors = json.data?.productVariantDetachMedia?.userErrors ?? [];

  if (errors.length > 0) {
    return errors.map((error) => error.message).join("; ");
  }

  return null;
}

async function deleteProductMedia(productId, mediaIds) {
  if (mediaIds.length === 0) {
    return null;
  }

  const json = await adminGraphql(DELETE_MEDIA_MUTATION, {
    productId,
    mediaIds,
  });
  const errors = json.data?.productDeleteMedia?.mediaUserErrors ?? [];

  if (errors.length > 0) {
    return errors.map((error) => error.message).join("; ");
  }

  return null;
}

async function attachImageToVariant(
  productId,
  variantId,
  imageUrl,
  alt,
  existingMediaIds = [],
) {
  if (existingMediaIds.length > 0) {
    const detachIds = mediaIdsForDetach(existingMediaIds);

    if (detachIds.length > 0) {
      const detachError = await detachVariantMedia(
        productId,
        variantId,
        detachIds,
      );

      if (detachError) {
        return detachError;
      }
    }

    const deleteError = await deleteProductMedia(productId, existingMediaIds);

    if (deleteError) {
      return deleteError;
    }
  }

  const createJson = await adminGraphql(CREATE_MEDIA_MUTATION, {
    productId,
    media: [
      {
        originalSource: imageUrl,
        mediaContentType: "IMAGE",
        alt,
      },
    ],
  });
  const createErrors = createJson.data?.productCreateMedia?.mediaUserErrors ?? [];

  if (createErrors.length > 0) {
    return createErrors.map((error) => error.message).join("; ");
  }

  const mediaId = createJson.data?.productCreateMedia?.media?.[0]?.id;

  if (!mediaId) {
    return "productCreateMedia did not return a media id";
  }

  const waitError = await waitForMediaReady(mediaId);

  if (waitError) {
    return waitError;
  }

  const appendJson = await adminGraphql(APPEND_MEDIA_MUTATION, {
    productId,
    variantMedia: [
      {
        variantId,
        mediaIds: [mediaId],
      },
    ],
  });
  const appendErrors =
    appendJson.data?.productVariantAppendMedia?.userErrors ?? [];

  if (appendErrors.length > 0) {
    return appendErrors.map((error) => error.message).join("; ");
  }

  return null;
}

export async function syncCylindoVariant({
  productId,
  productTitle,
  productMetafields,
  variant,
  frame,
  overwriteExisting,
  cylindoConfig,
}) {
  const hadExistingImage = variantHasExistingImage(variant);

  if (hadExistingImage && !overwriteExisting) {
    return {
      bucket: "skippedHasImage",
      entry: makeEntry(
        productTitle,
        variant,
        "Variant already has an image",
      ),
    };
  }

  const urlResult = buildCylindoFrameUrlForVariant(
    { ...cylindoConfig, frame },
    productMetafields,
    variant.featuresCode,
  );

  if (!urlResult.ok) {
    return {
      bucket: "skippedMissingMetafields",
      entry: makeEntry(productTitle, variant, urlResult.reason),
    };
  }

  const imageExists = await validateCylindoImageUrl(urlResult.url);

  if (!imageExists) {
    return {
      bucket: "failed",
      entry: makeEntry(
        productTitle,
        variant,
        "Cylindo image not found for feature combination",
        urlResult.url,
      ),
    };
  }

  const shopifyError = await attachImageToVariant(
    productId,
    variant.id,
    urlResult.url,
    variant.sku ?? variant.id,
    overwriteExisting ? getReplaceableMediaIds(variant) : [],
  );

  if (shopifyError) {
    return {
      bucket: "failed",
      entry: makeEntry(
        productTitle,
        variant,
        shopifyError,
        urlResult.url,
      ),
    };
  }

  return {
    bucket: "synced",
    entry: makeEntry(
      productTitle,
      variant,
      hadExistingImage
        ? "Replaced existing variant image and removed previous media from gallery"
        : "Synced Cylindo frame image",
      urlResult.url,
    ),
  };
}
