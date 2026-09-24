#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo ""
  echo "ERROR: DATABASE_URL is not set."
  echo ""
  echo "Railway setup:"
  echo "  1. In your project, click + New → Database → PostgreSQL"
  echo "  2. Postgres → Connect → select your web service"
  echo "     (or web service → Variables → Add Reference → Postgres → DATABASE_URL)"
  echo "  3. Redeploy"
  echo ""
  exit 1
fi

if [ -z "$SHOPIFY_APP_URL" ] && [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
  export SHOPIFY_APP_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
  echo "Using SHOPIFY_APP_URL=${SHOPIFY_APP_URL} from RAILWAY_PUBLIC_DOMAIN"
fi

if [ -z "$SHOPIFY_APP_URL" ]; then
  echo ""
  echo "ERROR: SHOPIFY_APP_URL is not set."
  echo ""
  echo "Railway setup:"
  echo "  1. Web service → Settings → Networking → Generate domain"
  echo "  2. Set SHOPIFY_APP_URL=https://YOUR-DOMAIN.up.railway.app on the web service"
  echo "     (or redeploy after generating a domain — Railway sets RAILWAY_PUBLIC_DOMAIN)"
  echo "  3. Update shopify.app.production.toml with the same URL and run:"
  echo "     shopify app deploy --config shopify.app.production.toml"
  echo ""
  exit 1
fi

npm run setup
exec npm run start
