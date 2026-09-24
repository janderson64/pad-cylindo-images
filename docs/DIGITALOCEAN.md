# Deploy to DigitalOcean App Platform

Host the Cylindo variant image app on DigitalOcean with a managed PostgreSQL database for Shopify OAuth sessions.

## Prerequisites

- DigitalOcean account
- GitHub repo containing this app
- Shopify Partners access to **cylindo-image-update**
- `SHOPIFY_API_SECRET` from `shopify app env show`

## 1. Push to GitHub

```bash
cd cylindo-variant-images-app
git remote add origin git@github.com:YOUR_ORG/cylindo-variant-images-app.git
git push -u origin main
```

## 2. Create the App Platform app

1. Open [DigitalOcean Apps](https://cloud.digitalocean.com/apps)
2. **Create App → GitHub** → select `cylindo-variant-images-app`
3. Choose **Use existing app spec** and point to `.do/app.yaml`, or edit the generated spec to match it
4. Update `github.repo` in `.do/app.yaml` before importing if needed

## 3. Configure secrets

In the App Platform **Environment Variables** for the `web` service:

| Variable | Type | Value |
|---|---|---|
| `SHOPIFY_API_SECRET` | Encrypted | From `shopify app env show` |
| `SHOPIFY_APP_URL` | Plain | Set after first deploy (see step 4) |

All other variables are defined in `.do/app.yaml`.

## 4. Deploy and note the URL

1. Click **Create Resources** / deploy
2. When live, copy the default URL, e.g. `https://cylindo-image-update-xxxxx.ondigitalocean.app`
3. Update in DO dashboard:
   - `SHOPIFY_APP_URL` = that URL
4. Redeploy the app

## 5. Update Shopify app config

Edit `shopify.app.production.toml` — replace `REPLACE-WITH-YOUR-APP.ondigitalocean.app` with your real App Platform hostname.

```bash
shopify app config use production
shopify app deploy --config production
```

Or:

```bash
shopify app deploy --config shopify.app.production.toml
```

## 6. Install on production (paddyo.com)

1. Open [Dev Dashboard → cylindo-image-update](https://dev.shopify.com/dashboard/129349149/apps/427374149633)
2. **Home → Install app → jimbo-635.myshopify.com**
3. Open the app in Admin and run **Sync Cylindo variant images**

## Optional: custom domain

In App Platform → **Settings → Domains**, add e.g. `cylindo-apps.paddyo.com` and update:

- `SHOPIFY_APP_URL` in DO
- `shopify.app.production.toml`
- Run `shopify app deploy --config production` again

## Local Docker test

```bash
docker build -t cylindo-image-update .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e SHOPIFY_API_KEY=21128d690914e4ca94bb1ded5b4442fa \
  -e SHOPIFY_API_SECRET=... \
  -e SCOPES=read_products,write_products \
  -e SHOPIFY_APP_URL=http://localhost:3000 \
  cylindo-image-update
```

## Troubleshooting

- **App won't load in Admin** — `SHOPIFY_APP_URL` must exactly match `application_url` in `shopify.app.production.toml` after `shopify app deploy`
- **OAuth errors** — confirm `SHOP_CUSTOM_DOMAIN=paddyo.com` if installing on the custom domain store
- **Database errors** — verify the `session-db` Postgres component is linked and migrations ran (`npm run setup` runs on container start)
