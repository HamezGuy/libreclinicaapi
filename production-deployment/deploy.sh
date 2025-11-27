#!/bin/bash
set -e

DOMAIN="api.accuratrials.com"
EMAIL="admin@accuratrials.com" # Replace if needed

echo "=== Starting Deployment for $DOMAIN ==="

# 0. Ensure correct directory
cd "$(dirname "$0")"

# 1. Stop any existing containers
echo "Stopping existing containers..."
docker-compose down

# Ensure certbot directories exist
mkdir -p certbot/conf certbot/www

# 2. Bootstrapping SSL
if [ ! -d "./certbot/conf/live/$DOMAIN" ]; then
    echo "SSL certificate not found. Starting bootstrapping process..."
    
    # Copy init config (HTTP only) to active config
    cp nginx-init.conf nginx.conf
    
    echo "Starting Nginx for validation..."
    docker-compose up -d nginx
    
    echo "Waiting for Nginx to be ready..."
    sleep 5
    
    echo "Requesting Certificate from Let's Encrypt..."
    docker-compose run --rm certbot certonly --webroot --webroot-path /var/www/certbot -d $DOMAIN --email $EMAIL --agree-tos --no-eff-email
    
    echo "Certificate obtained! Stopping Nginx..."
    docker-compose stop nginx
else
    echo "SSL certificate already exists. Skipping bootstrap."
fi

# 3. Final Deployment
echo "Applying production configuration..."
cp nginx-prod.conf nginx.conf

echo "Starting full stack..."
docker-compose up -d --build

echo "=== Deployment Complete ==="
echo "API should be reachable at https://$DOMAIN/api/health"
echo "Core should be reachable at https://$DOMAIN/LibreClinica"

