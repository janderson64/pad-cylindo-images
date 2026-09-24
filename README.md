# Cylindo Variant Images App

Private Shopify app that syncs Cylindo **frame 30** PNGs into Shopify variant images for products with Cylindo metafields enabled.

## What it does

1. Finds products where `cylindo.enabled = true`
2. For each variant **without an existing image**, reads:
   - Product: `cylindo.product_code`, `cylindo.variant_option1_name`, etc.
   - Variant: `cylindo.features_code` (array)
3. Builds a Cylindo v2 frames URL, for example:

```
https://content-v2.cylindo.com/api/v2/4932/products/FRMDSEC_3/frames/30/FRMDSEC_3.png?size=1024&version=5&feature=BACK:BLISS_OATMEAL&feature=FINISH:WOOD_CGRA
```

4. Validates the image exists on Cylindo, then imports it via Admin GraphQL and links it to the variant.

## Setup (local development only)

Use `shopify app dev` only when testing changes locally. **Do not use dev mode for production.**

Requires local PostgreSQL — see [docs/RAILWAY.md](docs/RAILWAY.md#local-development).

```bash
cd cylindo-variant-images-app
npm install
cp .env.example .env
# add DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cylindo_app
npx prisma migrate deploy
shopify app dev --store pos-rsa-poc.myshopify.com
```

Use a **dev store** (`pos-rsa-poc.myshopify.com`), not `jimbo-635` (production).

## Install on production (paddyo.com)

**Production store:** `jimbo-635.myshopify.com` (custom domain `paddyo.com`).

This is the live store. It is **not** a Shopify dev store, so you cannot use `shopify app dev --store jimbo-635.myshopify.com`. Use deploy + Dev Dashboard install instead.

### 1. Deploy app config

```bash
cd cylindo-variant-images-app
shopify app build
shopify app deploy
```

If deploy fails on webhook URLs, ensure `application_url` in `shopify.app.toml` is a valid `https://` URL (not `https://shopify.dev/apps/default-app-home`). After first successful deploy, pull the hosted URL from the Dev Dashboard and set it in `shopify.app.toml` before redeploying.

### 2. Host the Remix app on Railway

Deploy the app to Railway (see **[docs/RAILWAY.md](docs/RAILWAY.md)**). Set:

- `SHOPIFY_APP_URL` = your Railway public URL
- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`
- `SCOPES=read_products,write_products`
- `DATABASE_URL` from Railway Postgres
- Cylindo vars (`CYLINDO_ACCOUNT_ID=4932`, etc.)

Then update `shopify.app.production.toml` and run:

```bash
shopify app deploy --config shopify.app.production.toml
```

### 3. Set Cylindo environment variables on the host

| Variable | Value |
|---|---|
| `CYLINDO_ACCOUNT_ID` | `4932` |
| `CYLINDO_FRAME` | `30` |
| `CYLINDO_SIZE` | `1024` |
| `CYLINDO_VERSION` | `5` |

### 4. Install on production

Open the app in [Dev Dashboard](https://dev.shopify.com/dashboard/129349149/apps/427374149633):

1. Go to **Home**
2. Under **Installs**, click **Install app**
3. Choose **`jimbo-635.myshopify.com`** (Paddy O / paddyo.com)

Or from production Admin after install:

```
https://admin.shopify.com/store/jimbo-635/settings/apps
```

Open **cylindo-image-update**, then run **Sync Cylindo variant images**.

### 5. Verify

- Pick a Cylindo-enabled product with a variant that has no image
- Run sync once → variant image should appear in Admin
- Run sync again → that variant should show **Skipped (has image)**

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `CYLINDO_ACCOUNT_ID` | *(required)* | Cylindo account ID (e.g. `4932`) |
| `CYLINDO_FRAME` | `30` | Frame number for the static PNG |
| `CYLINDO_SIZE` | `1024` | Image size query param |
| `CYLINDO_VERSION` | `5` | Cylindo version query param |

Shopify CLI sets `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, and `SHOPIFY_APP_URL` automatically during dev/deploy.

### Scopes

- `read_products`
- `write_products`

## Usage

Open the app in Shopify Admin and click **Sync Cylindo variant images**.

The results table shows synced, skipped, and failed variants with SKU-level detail.

Re-running sync is safe: variants that already have an image are skipped.

## Tests

```bash
npm run test:cylindo
```

This validates URL construction against the `FRMDSEC_3` example from the plan.

## Deploy

Production hosting: **[docs/RAILWAY.md](docs/RAILWAY.md)** (Railway + PostgreSQL).

Quick summary:

1. Railway → **New Project** → deploy `janderson64/pad-cylindo-images`
2. Add **PostgreSQL** and link `DATABASE_URL`
3. Set env vars (`SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, Cylindo vars)
4. Generate Railway domain → update `SHOPIFY_APP_URL` → redeploy
5. Update `shopify.app.production.toml` → `shopify app deploy --config production`
6. Install on `jimbo-635.myshopify.com` from Dev Dashboard

Alternative: [docs/DIGITALOCEAN.md](docs/DIGITALOCEAN.md)
