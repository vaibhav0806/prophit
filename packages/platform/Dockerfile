# Stage 1: Install dependencies
FROM node:20-alpine AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy package.json for platform and its workspace dependencies
COPY packages/platform/package.json packages/platform/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/shared/package.json packages/shared/package.json

# Install dependencies (platform + workspace deps)
RUN pnpm install --frozen-lockfile --filter @prophet/platform...

# Stage 2: Runtime
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache curl

WORKDIR /app

# Copy workspace root
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy installed node_modules
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/platform/node_modules ./packages/platform/node_modules
COPY --from=deps /app/packages/agent/node_modules ./packages/agent/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy source for platform and its workspace dependencies
COPY packages/platform/ packages/platform/
COPY packages/agent/ packages/agent/
COPY packages/shared/ packages/shared/

ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

WORKDIR /app/packages/platform
CMD ["pnpm", "start"]
