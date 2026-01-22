# =============================================================================
# LibreClinica API - AWS Lightsail Deployment Script (PowerShell)
# =============================================================================
# Server: 18.225.57.5 (Ohio, us-east-2a)
# Username: ubuntu
#
# This script deploys:
# 1. PostgreSQL 14 database
# 2. LibreClinica API (Node.js)
# 3. Nginx reverse proxy
#
# Usage:
#   .\deploy-lightsail.ps1
# =============================================================================

$ErrorActionPreference = "Stop"

# Configuration
$LIGHTSAIL_IP = "18.225.57.5"
$LIGHTSAIL_USER = "ubuntu"
$SSH_KEY = "lightsail-key.pem"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$API_DIR = Split-Path -Parent $SCRIPT_DIR
$REMOTE_DIR = "/home/ubuntu/libreclinica-api"

Write-Host "=============================================="
Write-Host "  LibreClinica API - Lightsail Deployment"
Write-Host "=============================================="
Write-Host ""
Write-Host "Server: $LIGHTSAIL_IP"
Write-Host "API Directory: $API_DIR"
Write-Host ""

# Check if SSH key exists
$keyPath = Join-Path $SCRIPT_DIR $SSH_KEY
if (-not (Test-Path $keyPath)) {
    Write-Host "ERROR: SSH key file '$keyPath' not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please create the key file by saving your private key to:"
    Write-Host "  $keyPath"
    exit 1
}

# Step 1: Test SSH connection
Write-Host "Step 1: Testing SSH connection..."
try {
    ssh -i $keyPath -o StrictHostKeyChecking=no -o BatchMode=yes "$LIGHTSAIL_USER@$LIGHTSAIL_IP" "echo 'SSH connection successful!'"
} catch {
    Write-Host "SSH connection failed. Make sure:" -ForegroundColor Red
    Write-Host "  1. The SSH key is correct"
    Write-Host "  2. The server is running"
    Write-Host "  3. Your IP is allowed in the Lightsail firewall"
    exit 1
}
Write-Host ""

# Step 2: Setup server
Write-Host "Step 2: Setting up server dependencies..."
$setupScript = @'
#!/bin/bash
set -e
echo "Updating system..."
sudo apt-get update
sudo apt-get upgrade -y

# Install Docker
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker ubuntu
    rm get-docker.sh
fi

# Install Docker Compose v2
if ! docker compose version &> /dev/null; then
    echo "Installing Docker Compose..."
    sudo apt-get install -y docker-compose-plugin
fi

# Create directories
mkdir -p ~/libreclinica-api/production-deployment/init-db
mkdir -p ~/libreclinica-api/production-deployment/certbot/conf
mkdir -p ~/libreclinica-api/production-deployment/certbot/www

echo "Server setup complete!"
'@
$setupScript | ssh -i $keyPath -o StrictHostKeyChecking=no "$LIGHTSAIL_USER@$LIGHTSAIL_IP" "bash -s"
Write-Host ""

# Step 3: Create deployment package
Write-Host "Step 3: Creating deployment package..."
Set-Location $API_DIR

# Create tarball (using Windows tar or 7zip)
$tempTar = "$env:TEMP\libreclinica-api.tar.gz"
if (Test-Path $tempTar) { Remove-Item $tempTar }

# Use tar if available (Windows 10+)
$excludeArgs = @(
    "--exclude=node_modules",
    "--exclude=coverage", 
    "--exclude=logs",
    "--exclude=.git",
    "--exclude=*.log",
    "--exclude=tests"
)
tar -czf $tempTar $excludeArgs -C $API_DIR .

$tarSize = (Get-Item $tempTar).Length / 1MB
Write-Host "Package created: $([math]::Round($tarSize, 2)) MB"
Write-Host ""

# Step 4: Upload package
Write-Host "Step 4: Uploading to server..."
scp -i $keyPath -o StrictHostKeyChecking=no $tempTar "${LIGHTSAIL_USER}@${LIGHTSAIL_IP}:${REMOTE_DIR}/"
Write-Host ""

# Step 5: Deploy on server
Write-Host "Step 5: Deploying application..."
$deployScript = @'
#!/bin/bash
set -e

cd ~/libreclinica-api

# Extract package
echo "Extracting package..."
tar -xzf libreclinica-api.tar.gz
rm libreclinica-api.tar.gz

# Create environment file
echo "Creating environment configuration..."
cat > production-deployment/.env << 'ENVFILE'
# Database password (CHANGE THIS IN PRODUCTION!)
DB_PASSWORD=SecurePassword123!

# JWT Secret (CHANGE THIS!)
JWT_SECRET=change-this-to-a-secure-random-string-min-32-chars

# Allowed CORS origins
ALLOWED_ORIGINS=https://www.accuratrials.com,https://accuratrials.com,https://edc-real.vercel.app,http://localhost:4200
ENVFILE

# Build Docker image
echo "Building API Docker image..."
docker build -t libreclinica-api:latest .

# Stop existing containers
cd ~/libreclinica-api/production-deployment
echo "Stopping existing containers..."
docker compose -f docker-compose-api-only.yml down 2>/dev/null || true

# Start containers
echo "Starting containers..."
docker compose -f docker-compose-api-only.yml up -d

# Wait for services
echo "Waiting for services to initialize..."
sleep 15

# Check status
echo ""
echo "Container status:"
docker ps

echo ""
echo "Checking API health..."
for i in {1..10}; do
    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
        echo "API is healthy!"
        curl -s http://localhost:3000/health | head -c 200
        echo ""
        break
    fi
    echo "Waiting for API to start... ($i/10)"
    sleep 3
done

echo ""
echo "=============================================="
echo "  Deployment Complete!"
echo "=============================================="
echo ""
echo "API URL: http://18.225.57.5/api"
echo "Health Check: http://18.225.57.5/health"
'@
$deployScript | ssh -i $keyPath -o StrictHostKeyChecking=no "$LIGHTSAIL_USER@$LIGHTSAIL_IP" "bash -s"

# Cleanup
Remove-Item $tempTar -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=============================================="
Write-Host "  Deployment Complete!"
Write-Host "=============================================="
Write-Host ""
Write-Host "Your API should now be accessible at:"
Write-Host "  http://$LIGHTSAIL_IP/api" -ForegroundColor Green
Write-Host "  http://$LIGHTSAIL_IP/health" -ForegroundColor Green
Write-Host ""
Write-Host "To SSH into the server:"
Write-Host "  ssh -i $keyPath $LIGHTSAIL_USER@$LIGHTSAIL_IP"
Write-Host ""
