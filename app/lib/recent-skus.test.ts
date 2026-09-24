import assert from "node:assert/strict";

import {
  buildRecentProductSearchQuery,
  buildRecentVariantSearchQuery,
  getRecentSkuCutoffDate,
  isCreatedWithinDays,
} from "./recent-skus.server";

assert.match(buildRecentVariantSearchQuery(30), /^updated_at:>=\d{4}-\d{2}-\d{2}$/);
assert.match(buildRecentProductSearchQuery(30), /^created_at:>=\d{4}-\d{2}-\d{2}$/);

const cutoff = getRecentSkuCutoffDate(30);
assert.equal(cutoff.getUTCHours(), 0);
assert.equal(cutoff.getUTCMinutes(), 0);
assert.equal(cutoff.getUTCSeconds(), 0);

assert.equal(isCreatedWithinDays(new Date().toISOString(), 30), true);
assert.equal(isCreatedWithinDays("2020-01-01T00:00:00.000Z", 30), false);

console.log("recent-skus.test.ts passed");
