#!/bin/bash
# =============================================================================
# LibreClinica Production Deployment Script
# Server: 18.225.57.5 (AWS Lightsail Ohio)
# =============================================================================

set -e

echo "=============================================="
echo "  LibreClinica Production Deployment"
echo "=============================================="

cd ~/edc-app

# Extract deployment package
echo ""
echo "Step 1: Extracting deployment package..."
if [ -f "deploy-package.tar.gz" ]; then
    tar -xzf deploy-package.tar.gz
    rm deploy-package.tar.gz
    echo "Extracted deployment package"
fi

# Create necessary directories
echo ""
echo "Step 2: Creating directories..."
mkdir -p certbot/conf certbot/www

# Check if SSL certificates exist
if [ ! -d "certbot/conf/live/api.accuratrials.com" ]; then
    echo "SSL certificates not found. Using HTTP-only config initially."
    cp nginx-init.conf nginx.conf
else
    echo "SSL certificates found. Using HTTPS config."
    # nginx.conf should already be the HTTPS version
fi

# Build the API Docker image
echo ""
echo "Step 3: Building API Docker image..."
cd libreclinica-api
docker build -t libreclinica-api:latest .
cd ..

# Start services
echo ""
echo "Step 4: Starting Docker services..."
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
echo ""
echo "Step 5: Waiting for services to start..."
echo "Waiting for PostgreSQL..."
sleep 10

echo "Waiting for LibreClinica Core (this may take 2-4 minutes)..."
for i in {1..60}; do
    if docker exec libreclinica_core curl -sf http://localhost:8080/libreclinica/pages/login/login > /dev/null 2>&1; then
        echo "LibreClinica Core is ready!"
        break
    fi
    echo "  Waiting... ($i/60)"
    sleep 5
done

echo ""
echo "Step 6: Checking service status..."
docker ps

# Test API
echo ""
echo "Step 7: Testing API..."
sleep 5
curl -s http://localhost:3000/health || echo "API health check pending..."

echo ""
echo "=============================================="
echo "  Deployment Complete!"
echo "=============================================="
echo ""
echo "Services:"
echo "  - API: http://18.225.57.5/api (or https://api.accuratrials.com/api)"
echo "  - LibreClinica: http://18.225.57.5/libreclinica"
echo "  - Health: http://18.225.57.5/health"
echo ""
echo "To check logs:"
echo "  docker logs libreclinica_api"
echo "  docker logs libreclinica_core"
echo ""
echo "To get SSL certificate (if not already done):"
echo "  docker-compose -f docker-compose.prod.yml run --rm certbot certonly --webroot -w /var/www/certbot -d api.accuratrials.com --email admin@accuratrials.com --agree-tos --no-eff-email"
echo "  Then update nginx.conf and restart nginx"
echo ""

