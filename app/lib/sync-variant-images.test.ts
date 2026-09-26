import assert from "node:assert/strict";

import {
  isSyncableProductStatus,
  selectSyncableVariant,
} from "./sync-variant-images.server";

function makeVariant(status: "ACTIVE" | "ARCHIVED" | "DRAFT", sku = "SKU-1") {
  return {
    id: `gid://shopify/ProductVariant/${status}`,
    sku,
    image: null,
    media: { nodes: [] },
    metafield: null,
    product: {
      id: `gid://shopify/Product/${status}`,
      title: status,
      status,
      metafields: { nodes: [] },
    },
  };
}

assert.equal(isSyncableProductStatus("ACTIVE"), true);
assert.equal(isSyncableProductStatus("DRAFT"), true);
assert.equal(isSyncableProductStatus("ARCHIVED"), false);

const activeFirst = selectSyncableVariant([
  makeVariant("ARCHIVED"),
  makeVariant("ACTIVE"),
]);
assert.equal(activeFirst.ok, true);
if (activeFirst.ok) {
  assert.equal(activeFirst.variant.product.status, "ACTIVE");
}

const draftOnly = selectSyncableVariant([makeVariant("DRAFT")]);
assert.equal(draftOnly.ok, true);

const archivedOnly = selectSyncableVariant([makeVariant("ARCHIVED")]);
assert.equal(archivedOnly.ok, false);
if (!archivedOnly.ok) {
  assert.equal(archivedOnly.reason, "archived_only");
}

const notFound = selectSyncableVariant([]);
assert.equal(notFound.ok, false);
if (!notFound.ok) {
  assert.equal(notFound.reason, "not_found");
}

console.log("sync-variant-images.test.ts passed");
