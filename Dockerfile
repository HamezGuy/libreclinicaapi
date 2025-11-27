FROM node:18-alpine as builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:18-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
# Copy schema file if needed at runtime
COPY --from=builder /app/database ./database

EXPOSE 3000

CMD ["node", "dist/server.js"]

