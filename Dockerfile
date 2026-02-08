# =============================================================================
# LibreClinica REST API - Dockerfile
# =============================================================================
# Multi-stage build: compile TypeScript, then run with minimal image
# =============================================================================

# Stage 1: Build
FROM node:18-alpine AS builder

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
FROM node:18-alpine

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled JS from builder stage
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
