/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "prettier",
  ],
  ignorePatterns: ["**/*.test.ts", "**/*.test.js"],
  globals: {
    shopify: "readonly"
  },
};
