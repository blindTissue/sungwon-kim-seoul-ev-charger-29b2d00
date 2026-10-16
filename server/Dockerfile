# Build context is the repo root (see docker-compose.yml) so /shared is available.
FROM node:20-bookworm-slim
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
# better-sqlite3 ships prebuilt binaries for node 20 / linux; build tools are a fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ wget && rm -rf /var/lib/apt/lists/* \
 && npm ci --workspace server --include-workspace-root=false --omit=dev \
 && npm cache clean --force
COPY shared shared
COPY server server
COPY docs docs
WORKDIR /repo/server
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "--import", "tsx", "src/index.ts"]
