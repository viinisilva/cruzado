# syntax=docker/dockerfile:1
# Multi-stage build: dependencies → Next.js standalone build → minimal runtime image.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN npm run build

# Full toolchain image, used by the optional `worker` service (runs scripts/*.ts with tsx).
FROM deps AS tools
WORKDIR /app
COPY . .
ENV NODE_ENV=production
USER node
CMD ["npx", "tsx", "scripts/worker.ts"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
# Migrations run automatically on first request (idempotent). Set SKIP_AUTO_MIGRATE=1 to manage them yourself.
CMD ["node", "server.js"]
