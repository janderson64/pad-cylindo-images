# Deploy to Railway

Host the Cylindo variant image app on [Railway](https://railway.app) with a PostgreSQL database for Shopify OAuth sessions.

Repo: https://github.com/janderson64/pad-cylindo-images

## 1. Create the Railway project

1. Go to [railway.app/new](https://railway.app/new)
2. **Deploy from GitHub repo** → select `janderson64/pad-cylindo-images`
3. Railway detects `railway.toml` and builds from the `Dockerfile`

## 2. Add PostgreSQL

1. In the project, click **+ New** → **Database** → **PostgreSQL**
2. Open the web service → **Variables** → **Add reference** → select `DATABASE_URL` from the Postgres service

Railway injects `DATABASE_URL` automatically when referenced.

## 3. Set environment variables

On the **web service** (not the database), add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Reference from Postgres service |
| `SHOPIFY_API_KEY` | `21128d690914e4ca94bb1ded5b4442fa` |
| `SHOPIFY_API_SECRET` | From `shopify app env show` (mark as secret) |
| `SCOPES` | `read_products,write_products` |
| `SHOPIFY_APP_URL` | Set after first deploy (step 4) |
| `SHOP_CUSTOM_DOMAIN` | `paddyo.com` |
| `CYLINDO_ACCOUNT_ID` | `4932` |
| `CYLINDO_FRAME` | `30` |
| `CYLINDO_SIZE` | `1024` |
| `CYLINDO_VERSION` | `5` |
| `NODE_ENV` | `production` |

`PORT` is set automatically by Railway.

## 4. Deploy and get the public URL

1. Deploy the service (Railway deploys on push to `main`)
2. **Settings → Networking → Generate domain** (e.g. `pad-cylindo-images-production.up.railway.app`)
3. Set `SHOPIFY_APP_URL` to that full URL (`https://...`)
4. Redeploy so the app picks up the URL

## 5. Update Shopify app config

Edit `shopify.app.production.toml` — replace `REPLACE-WITH-YOUR-APP.up.railway.app` with your Railway domain:

```bash
cd cylindo-variant-images-app
shopify app deploy --config shopify.app.production.toml
```

## 6. Install on production (paddyo.com)

1. Open [Dev Dashboard → cylindo-image-update](https://dev.shopify.com/dashboard/129349149/apps/427374149633)
2. **Home → Install app → jimbo-635.myshopify.com**
3. In Admin, open **cylindo-image-update** → **Sync Cylindo variant images**

## 7. Verify

- Pick a Cylindo-enabled product with a variant that has no image
- Run sync → image should appear on the variant in Admin
- Run sync again → variant should show **Skipped (has image)**

## Local development

See the **Local development** section in [README.md](../README.md).

Quick Postgres for local:

```bash
docker run -d --name cylindo-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=cylindo_app \
  -p 5432:5432 postgres:16

export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cylindo_app
npx prisma migrate deploy
shopify app dev --store pos-rsa-poc.myshopify.com
```

## CLI deploy (optional)

If you use the [Railway CLI](https://docs.railway.app/guides/cli):

```bash
npm i -g @railway/cli
railway login
railway link
railway up
```

## Troubleshooting

| Issue | Fix |
|---|---|
| App blank in Admin | `SHOPIFY_APP_URL` must match `application_url` in `shopify.app.production.toml` after `shopify app deploy` |
| Database errors on boot | Confirm Postgres is linked and `npm run setup` (migrations) ran — check deploy logs |
| OAuth redirect errors | Redeploy Shopify config after changing Railway domain; include `/auth/callback` redirect URLs |
| Build fails | Ensure `package-lock.json` is committed (required by `npm ci` in Dockerfile) |

## Optional: custom domain

In Railway **Settings → Networking**, add a custom domain (e.g. `cylindo-apps.paddyo.com`), then update `SHOPIFY_APP_URL`, `shopify.app.production.toml`, and run `shopify app deploy --config production` again.
