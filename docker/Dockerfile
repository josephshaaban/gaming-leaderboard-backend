# node:20-slim (Debian, not Alpine) deliberately - argon2 needs native
# bindings and Alpine's musl libc is a common source of "docker compose up
# fails on a clean checkout" failures for exactly this dependency. This
# argon2 version has no prebuilt binary for this platform and falls back to
# compiling from source via node-gyp, hence python3/make/g++ below.
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

RUN useradd --create-home --shell /bin/bash appuser \
  && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "dist/main.js"]
