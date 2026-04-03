# =============================================================================
# LibreClinica REST API - Dockerfile
# =============================================================================
# Single-stage production image. TypeScript is compiled locally before deploy.
# Only installs production dependencies -- no devDeps, no tsc.
# =============================================================================

FROM node:20-alpine

WORKDIR /app

# Production dependencies only (cached unless package.json changes)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Pre-compiled dist from local build
COPY dist ./dist

# Port must match nginx proxy_pass (http://api:3000) and healthcheck.
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "--max-http-header-size=65536", "dist/server.js"]
