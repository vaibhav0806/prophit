# Stage 1: Install dependencies and build
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy frontend package.json
COPY packages/frontend/package.json packages/frontend/package.json

# Install dependencies (frontend only)
RUN pnpm install --frozen-lockfile --filter frontend...

# Copy frontend source (node_modules excluded via .dockerignore)
COPY packages/frontend/ packages/frontend/

WORKDIR /app/packages/frontend
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build && mkdir -p public

# Stage 2: Runtime
FROM node:20-alpine AS runner

RUN apk add --no-cache curl

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone output
COPY --from=builder /app/packages/frontend/.next/standalone ./
COPY --from=builder /app/packages/frontend/.next/static ./packages/frontend/.next/static
COPY --from=builder /app/packages/frontend/public ./packages/frontend/public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000 || exit 1

CMD ["node", "packages/frontend/server.js"]
