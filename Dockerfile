# =============================================================================
# LibreClinica REST API - Dockerfile
# =============================================================================
# Single-stage production image. TypeScript is compiled locally before deploy.
# Only installs production dependencies -- no devDeps, no tsc.
# =============================================================================

FROM node:20-alpine

WORKDIR /app

# shared-types must be in ../shared-types relative to /app so the
# "file:../shared-types" dependency in package.json resolves during npm ci.
COPY shared-types /shared-types

# Production dependencies only — npm ci uses the lockfile for deterministic builds.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Pre-compiled dist from local build
COPY dist ./dist

# Port must match nginx proxy_pass (http://api:3000) and healthcheck.
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=8 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "--max-http-header-size=65536", "dist/server.js"]
