FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY . .

# Build TypeScript
RUN npm install typescript -g
RUN npm run build

# Remove dev dependencies (optional, can skip for debugging)
# RUN npm prune --production

EXPOSE 3000

# Check if dist exists before running, otherwise run from source (fallback)
CMD ["sh", "-c", "if [ -d 'dist' ]; then node dist/server.js; else npm run start; fi"]
