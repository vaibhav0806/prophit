# Stage 1: Install dependencies
FROM node:20-alpine AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy package.json for telegram
COPY packages/telegram/package.json packages/telegram/package.json

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @prophet/telegram...

# Stage 2: Runtime
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy installed node_modules
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/telegram/node_modules ./packages/telegram/node_modules

# Copy source
COPY packages/telegram/ packages/telegram/

ENV NODE_ENV=production

WORKDIR /app/packages/telegram
CMD ["pnpm", "start"]
