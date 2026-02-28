# Stage 1: Install dependencies
FROM node:20-alpine AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy agent package.json
COPY packages/agent/package.json packages/agent/package.json

# Install dependencies (agent only)
RUN pnpm install --frozen-lockfile --filter @prophet/agent...

# Stage 2: Runtime
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache curl

WORKDIR /app

# Copy workspace root
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy installed node_modules
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/agent/node_modules ./packages/agent/node_modules

# Copy agent source
COPY packages/agent/ packages/agent/

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/api/status || exit 1

WORKDIR /app/packages/agent
CMD ["pnpm", "start"]
