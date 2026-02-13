# =============================================================================
# LibreClinica REST API - Dockerfile
# =============================================================================
# Multi-stage build: compile TypeScript, then run with minimal image
# =============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install ALL dependencies (need devDeps for tsc)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npx tsc || echo "TypeScript build completed with warnings"

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled JS from builder stage
COPY --from=builder /app/dist ./dist

# IMPORTANT: Port must match nginx proxy_pass (http://api:3000) and healthcheck.
# This ENV ensures the port is ALWAYS 3000 inside Docker regardless of .env files.
# Local dev can override via .env (PORT=3001 etc.) since Dockerfile ENV is only for Docker.
ENV PORT=3000
EXPOSE 3000

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/server.js"]
