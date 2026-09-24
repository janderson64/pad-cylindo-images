#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo ""
  echo "ERROR: DATABASE_URL is not set."
  echo ""
  echo "Railway setup:"
  echo "  1. In your project, click + New → Database → PostgreSQL"
  echo "  2. Open your web service (not Postgres) → Variables"
  echo "  3. New Variable → Add Reference → select Postgres → DATABASE_URL"
  echo "  4. Redeploy"
  echo ""
  exit 1
fi

npm run setup
exec npm run start
