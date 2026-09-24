FROM node:20-alpine AS build
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Prisma reads DATABASE_URL from schema at generate time; build has no Railway env yet.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

EXPOSE 3000

CMD ["./scripts/docker-entrypoint.sh"]
