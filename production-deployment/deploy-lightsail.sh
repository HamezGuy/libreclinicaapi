#!/bin/bash
# =============================================================================
# LibreClinica API - AWS Lightsail Deployment Script
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
#   chmod +x deploy-lightsail.sh
#   ./deploy-lightsail.sh
# =============================================================================

set -e

# Configuration
LIGHTSAIL_IP="18.225.57.5"
LIGHTSAIL_USER="ubuntu"
SSH_KEY="lightsail-key.pem"
REMOTE_DIR="/home/ubuntu/libreclinica-api"
API_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=============================================="
echo "  LibreClinica API - Lightsail Deployment"
echo "=============================================="
echo ""
echo "Server: $LIGHTSAIL_IP"
echo "API Directory: $API_DIR"
echo ""

# Check if SSH key exists
if [ ! -f "$SSH_KEY" ]; then
    echo "ERROR: SSH key file '$SSH_KEY' not found!"
    echo ""
    echo "Please create the key file with the private key from Lightsail."
    echo "Then run: chmod 600 $SSH_KEY"
    exit 1
fi

# SSH and SCP commands
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ServerAliveInterval=60 $LIGHTSAIL_USER@$LIGHTSAIL_IP"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no"

# Test SSH connection
echo "Step 1: Testing SSH connection..."
$SSH_CMD "echo 'SSH connection successful!'"
echo ""

# Setup server (Docker, Node, etc.)
echo "Step 2: Setting up server dependencies..."
$SSH_CMD << 'SETUP_SCRIPT'
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
    echo "Docker installed. You may need to log out and back in for group changes."
fi

# Install Docker Compose v2
if ! docker compose version &> /dev/null; then
    echo "Installing Docker Compose..."
    sudo apt-get install -y docker-compose-plugin
fi

# Create app directory
mkdir -p ~/libreclinica-api
mkdir -p ~/libreclinica-api/production-deployment/init-db
mkdir -p ~/libreclinica-api/production-deployment/certbot/conf
mkdir -p ~/libreclinica-api/production-deployment/certbot/www

echo "Server setup complete!"
SETUP_SCRIPT
echo ""

# Create deployment package
echo "Step 3: Creating deployment package..."
cd "$API_DIR"

# Create tarball excluding unnecessary files
tar --exclude='node_modules' \
    --exclude='coverage' \
    --exclude='logs' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='tests' \
    -czf /tmp/libreclinica-api.tar.gz .

echo "Package created: $(du -h /tmp/libreclinica-api.tar.gz | cut -f1)"
echo ""

# Upload package
echo "Step 4: Uploading to server..."
$SCP_CMD /tmp/libreclinica-api.tar.gz $LIGHTSAIL_USER@$LIGHTSAIL_IP:$REMOTE_DIR/
echo ""

# Deploy on server
echo "Step 5: Deploying application..."
$SSH_CMD << 'DEPLOY_SCRIPT'
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

# JWT Secret (CHANGE THIS! Generate with: openssl rand -base64 32)
JWT_SECRET=change-this-to-a-secure-random-string-min-32-chars

# Allowed CORS origins
ALLOWED_ORIGINS=https://www.accuratrials.com,https://accuratrials.com,https://edc-real.vercel.app,http://localhost:4200
ENVFILE

# Build Docker image
echo "Building API Docker image..."
cd ~/libreclinica-api
docker build -t libreclinica-api:latest .

# Stop existing containers
cd ~/libreclinica-api/production-deployment
echo "Stopping existing containers..."
docker compose -f docker-compose-api-only.yml down 2>/dev/null || true

# Start containers
echo "Starting containers..."
docker compose -f docker-compose-api-only.yml up -d

# Wait for services to start
echo "Waiting for services to initialize..."
sleep 15

# Check container status
echo ""
echo "Container status:"
docker ps

# Check API health
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
echo ""
echo "To view logs:"
echo "  docker compose -f docker-compose-api-only.yml logs -f"
echo ""
echo "To restart:"
echo "  docker compose -f docker-compose-api-only.yml restart"
echo ""
echo "IMPORTANT: Update the .env file with secure passwords!"
echo "  nano ~/libreclinica-api/production-deployment/.env"
echo ""
DEPLOY_SCRIPT

echo ""
echo "=============================================="
echo "  Deployment Script Complete"
echo "=============================================="
echo ""
echo "Your API should now be accessible at:"
echo "  http://$LIGHTSAIL_IP/api"
echo "  http://$LIGHTSAIL_IP/health"
echo ""
echo "To SSH into the server:"
echo "  ssh -i $SSH_KEY $LIGHTSAIL_USER@$LIGHTSAIL_IP"
echo ""
