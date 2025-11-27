#!/bin/bash
set -e

DOMAIN="api.accuratrials.com"
EMAIL="admin@accuratrials.com"

# Detect Docker Compose command
if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
else
    echo "Error: neither 'docker compose' nor 'docker-compose' found."
    exit 1
fi

echo "=== Starting Deployment for $DOMAIN using $DOCKER_COMPOSE ==="

# 0. Ensure correct directory
cd "$(dirname "$0")"

# 1. Stop any existing containers
echo "Stopping existing containers..."
$DOCKER_COMPOSE down || true

# Ensure certbot directories exist
mkdir -p certbot/conf certbot/www

# 2. Bootstrapping SSL
# Use sudo to check directory existence due to root permissions
if ! sudo test -d "./certbot/conf/live/$DOMAIN"; then
    echo "SSL certificate not found. Starting bootstrapping process..."
    
    # Copy init config (HTTP only) to active config
    cp nginx-init.conf nginx.conf
    
    echo "Starting Nginx for validation..."
    $DOCKER_COMPOSE up -d nginx
    
    echo "Waiting for Nginx to be ready..."
    sleep 10
    
    echo "Requesting Certificate from Let's Encrypt..."
    $DOCKER_COMPOSE run --rm --entrypoint "" certbot certbot certonly --webroot --webroot-path /var/www/certbot -d $DOMAIN --email $EMAIL --agree-tos --no-eff-email --force-renewal
    
    # Use sudo to check file existence due to root permissions on certbot files
    if ! sudo test -f "./certbot/conf/live/$DOMAIN/fullchain.pem"; then
        echo "ERROR: Certificate generation failed! Check the logs above."
        exit 1
    fi

    echo "Certificate obtained! Stopping Nginx..."
    $DOCKER_COMPOSE stop nginx
else
    echo "SSL certificate already exists. Skipping bootstrap."
fi

# 3. Final Deployment
echo "Applying production configuration..."
cp nginx-prod.conf nginx.conf

echo "Starting full stack..."
$DOCKER_COMPOSE up -d --build

echo "=== Deployment Complete ==="
echo "API should be reachable at https://$DOMAIN/api/health"
echo "Core should be reachable at https://$DOMAIN/LibreClinica"
