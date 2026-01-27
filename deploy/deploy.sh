#!/bin/bash
# Deploy script - runs on the server after upload
set -e

APP_DIR="/home/ubuntu/libreclinica-api"

echo "=========================================="
echo "Deploying LibreClinica API"
echo "=========================================="

# Stop existing app if running
echo "[1/5] Stopping existing application..."
pm2 stop libreclinica-api 2>/dev/null || true
pm2 delete libreclinica-api 2>/dev/null || true

# Extract deployment
echo "[2/5] Extracting deployment..."
rm -rf $APP_DIR
mkdir -p $APP_DIR
cd $APP_DIR
unzip -o /home/ubuntu/deploy.zip

# Install dependencies
echo "[3/5] Installing dependencies..."
npm ci --production 2>/dev/null || npm install --production

# Create production .env file
echo "[4/5] Creating environment configuration..."
cat > .env << 'EOF'
PORT=3001
NODE_ENV=production
LIBRECLINICA_DB_HOST=localhost
LIBRECLINICA_DB_PORT=5432
LIBRECLINICA_DB_NAME=libreclinica
LIBRECLINICA_DB_USER=clinica
LIBRECLINICA_DB_PASSWORD=clinica
LIBRECLINICA_SOAP_URL=http://localhost:8080/libreclinica
JWT_SECRET=production-jwt-secret-change-in-production
DEMO_MODE=true
EOF

# Start with PM2
echo "[5/5] Starting application..."
cd $APP_DIR
pm2 start dist/server.js --name libreclinica-api --env production
pm2 save

# Show status
echo ""
echo "=========================================="
echo "Deployment complete!"
echo "=========================================="
pm2 status

# Health check
sleep 3
echo ""
echo "Health check:"
curl -s http://localhost:3001/api/health || echo "API not responding yet - may still be starting"

