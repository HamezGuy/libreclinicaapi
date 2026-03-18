#!/bin/bash
set -e

DOMAIN="api.accuratrials.com"
EMAIL="admin@accuratrials.com"

if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
else
    echo "Error: neither 'docker compose' nor 'docker-compose' found."
    exit 1
fi

cd "$(dirname "$0")"

echo "=== SSL Certificate Renewal for $DOMAIN ==="

echo "Step 1: Force-renewing certificate..."
$DOCKER_COMPOSE run --rm --entrypoint "" certbot \
    certbot certonly --webroot --webroot-path /var/www/certbot \
    -d $DOMAIN --email $EMAIL --agree-tos --no-eff-email --force-renewal

if ! sudo test -f "./certbot/conf/live/$DOMAIN/fullchain.pem"; then
    echo "ERROR: Certificate renewal failed!"
    exit 1
fi

echo "Step 2: Reloading Nginx..."
$DOCKER_COMPOSE exec nginx nginx -s reload

echo "Step 3: Verifying HTTPS..."
sleep 3
if curl -sf --max-time 10 "https://$DOMAIN/health" > /dev/null 2>&1; then
    echo "SUCCESS: https://$DOMAIN is responding with valid SSL"
else
    echo "WARNING: Could not verify HTTPS. Check manually: curl -vI https://$DOMAIN/api/health"
fi

echo "=== SSL Renewal Complete ==="
