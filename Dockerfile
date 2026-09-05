FROM node:22-bookworm-slim AS base

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV OZMO_DATABASE_PATH=/app/data/ozmo.sqlite

RUN mkdir -p /app/data && chown node:node /app/data

COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
COPY --chown=node:node --from=builder /app/scripts/local-scheduler.mjs ./scripts/local-scheduler.mjs
COPY --chown=node:node --from=builder /app/scripts/backup-database.mjs ./scripts/backup-database.mjs
COPY --chown=node:node --from=builder /app/scripts/import-d1-database.mjs ./scripts/import-d1-database.mjs
COPY --chown=node:node --from=builder /app/package.json ./package.json

USER node
EXPOSE 3000

CMD ["node", "server.js"]
