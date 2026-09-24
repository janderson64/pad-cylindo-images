import assert from "node:assert/strict";

import {
  buildCylindoFrameUrl,
  buildCylindoFrameUrlForVariant,
  buildFeaturePairs,
  parseFeaturesCode,
  parseProductMetafields,
  unwrapMetafieldValue,
} from "./cylindo";

const config = {
  accountId: "4932",
  frame: 30,
  size: 1024,
  version: 5,
};

const productMetafields = {
  product_code: "FRMDSEC_3",
  variant_option1_name: "BACK",
  variant_option2_name: "FINISH",
};

const featuresCode = ["BLISS_OATMEAL", "WOOD_CGRA"];

assert.deepEqual(parseFeaturesCode(["BLISS_OATMEAL", "WOOD_CGRA"]), featuresCode);
assert.deepEqual(
  parseFeaturesCode('["BLISS_OATMEAL","WOOD_CGRA"]'),
  featuresCode,
);

const pairs = buildFeaturePairs(productMetafields, featuresCode);
assert.deepEqual(pairs, [
  { name: "BACK", code: "BLISS_OATMEAL" },
  { name: "FINISH", code: "WOOD_CGRA" },
]);

const url = buildCylindoFrameUrl(config, "FRMDSEC_3", pairs!);
assert.equal(
  url,
  "https://content-v2.cylindo.com/api/v2/4932/products/FRMDSEC_3/frames/30/FRMDSEC_3.png?size=1024&version=5&feature=BACK%3ABLISS_OATMEAL&feature=FINISH%3AWOOD_CGRA",
);

const built = buildCylindoFrameUrlForVariant(
  config,
  productMetafields,
  featuresCode,
);
assert.equal(built.ok, true);

if (built.ok) {
  assert.match(built.url, /frames\/30\/FRMDSEC_3\.png/);
  assert.match(built.url, /feature=BACK%3ABLISS_OATMEAL/);
  assert.match(built.url, /feature=FINISH%3AWOOD_CGRA/);
}

const missing = buildCylindoFrameUrlForVariant(config, productMetafields, []);
assert.equal(missing.ok, false);

assert.equal(unwrapMetafieldValue('["BACK"]'), "BACK");
assert.equal(unwrapMetafieldValue('["FINISH"]'), "FINISH");

const jsonWrappedProductMetafields = parseProductMetafields([
  { key: "product_code", value: "FRMDSEC_3" },
  { key: "variant_option1_name", value: '["BACK"]' },
  { key: "variant_option2_name", value: '["FINISH"]' },
]);

const jsonWrappedBuilt = buildCylindoFrameUrlForVariant(
  config,
  jsonWrappedProductMetafields,
  ["BLISS_OATMEAL", "WOOD_BLACK"],
);
assert.equal(jsonWrappedBuilt.ok, true);

if (jsonWrappedBuilt.ok) {
  assert.match(jsonWrappedBuilt.url, /feature=BACK%3ABLISS_OATMEAL/);
  assert.match(jsonWrappedBuilt.url, /feature=FINISH%3AWOOD_BLACK/);
  assert.doesNotMatch(jsonWrappedBuilt.url, /%5B%22BACK%22%5D/);
}

console.log("cylindo.test.ts passed");
