#!/bin/bash
#
# Deploy LibreClinica and LibreClinica-API to AWS Lightsail
#
# Server: 18.225.57.5 (Ohio, us-east-2a)
# Username: ubuntu
#
# USAGE:
# 1. Save your SSH private key to a file (e.g., lightsail-key.pem)
# 2. chmod 600 lightsail-key.pem
# 3. Run: ./deploy-to-lightsail.sh
#

set -e

# Configuration
LIGHTSAIL_IP="18.225.57.5"
LIGHTSAIL_USER="ubuntu"
SSH_KEY="lightsail-key.pem"
REMOTE_DIR="/home/ubuntu/edc-app"

echo "=========================================="
echo "  EDC Deployment to AWS Lightsail"
echo "=========================================="

# Check if SSH key exists
if [ ! -f "$SSH_KEY" ]; then
    echo "ERROR: SSH key file '$SSH_KEY' not found!"
    echo ""
    echo "Please create the key file by running:"
    echo "  cat > lightsail-key.pem << 'EOF'"
    echo "  (paste your private key here)"
    echo "  EOF"
    echo "  chmod 600 lightsail-key.pem"
    exit 1
fi

# SSH command helper
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $LIGHTSAIL_USER@$LIGHTSAIL_IP"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no"

echo ""
echo "Step 1: Testing SSH connection..."
$SSH_CMD "echo 'SSH connection successful!'"

echo ""
echo "Step 2: Setting up server..."
$SSH_CMD << 'SETUP_SCRIPT'
#!/bin/bash
set -e

# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker ubuntu
    rm get-docker.sh
fi

# Install Docker Compose if not present
if ! command -v docker-compose &> /dev/null; then
    echo "Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Install Node.js 18 if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install PM2 for process management
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    sudo npm install -g pm2
fi

# Install nginx if not present
if ! command -v nginx &> /dev/null; then
    echo "Installing nginx..."
    sudo apt-get install -y nginx
fi

# Create app directory
mkdir -p ~/edc-app

echo "Server setup complete!"
SETUP_SCRIPT

echo ""
echo "Step 3: Uploading application files..."

# Create a tarball of the API (excluding node_modules)
echo "Creating libreclinicaapi archive..."
cd "$(dirname "$0")"
tar --exclude='node_modules' --exclude='coverage' --exclude='logs' -czf /tmp/libreclinicaapi.tar.gz .

# Upload the archive
$SCP_CMD /tmp/libreclinicaapi.tar.gz $LIGHTSAIL_USER@$LIGHTSAIL_IP:$REMOTE_DIR/

echo ""
echo "Step 4: Deploying on server..."
$SSH_CMD << 'DEPLOY_SCRIPT'
#!/bin/bash
set -e

cd ~/edc-app

# Extract API
echo "Extracting libreclinicaapi..."
mkdir -p libreclinicaapi
tar -xzf libreclinicaapi.tar.gz -C libreclinicaapi
rm libreclinicaapi.tar.gz

# Install dependencies
cd libreclinicaapi
echo "Installing dependencies..."
npm install --production

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Create environment file
echo "Creating .env file..."
cat > .env << 'ENVFILE'
# LibreClinica API Configuration
PORT=3000
NODE_ENV=production
DEMO_MODE=false

# Database - LibreClinica PostgreSQL
LIBRECLINICA_DB_HOST=localhost
LIBRECLINICA_DB_PORT=5434
LIBRECLINICA_DB_NAME=libreclinica
LIBRECLINICA_DB_USER=libreclinica
LIBRECLINICA_DB_PASSWORD=libreclinica

# SOAP Configuration - LibreClinica Web Services
LIBRECLINICA_SOAP_URL=http://localhost:8090/libreclinica-ws/ws
DISABLE_SOAP=true
SOAP_USERNAME=root
SOAP_PASSWORD=25d55ad283aa400af464c76d713c07ad

# Security
JWT_SECRET=your-production-jwt-secret-change-me-now
JWT_EXPIRES_IN=24h

# CORS - Allow Vercel frontend (restrict to actual origins)
ALLOWED_ORIGINS=https://www.accuratrials.com,https://accuratrials.com,https://edc-real.vercel.app,https://edc-real-james-guis-projects.vercel.app,https://edc-real-git-main-james-guis-projects.vercel.app

# Feature Flags
ENABLE_EMAIL_NOTIFICATIONS=true
ENABLE_SUBJECT_TRANSFERS=true
ENABLE_ECONSENT=true
ENABLE_EPRO=true
ENABLE_RTSM=true

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000
ENVFILE

# Start LibreClinica with Docker
echo "Starting LibreClinica Docker containers..."
cd ~/edc-app/libreclinicaapi
docker-compose -f docker-compose.libreclinica.yml up -d || echo "Docker compose may need manual start"

# Wait for services to start
sleep 10

# Start API with PM2
echo "Starting API with PM2..."
pm2 delete libreclinica-api 2>/dev/null || true
pm2 start dist/server.js --name "libreclinica-api" --env production

# Save PM2 configuration
pm2 save
pm2 startup | tail -1 | sudo bash

echo ""
echo "Deployment complete!"
echo ""
echo "Services running:"
pm2 list
docker ps
DEPLOY_SCRIPT

echo ""
echo "Step 5: Configuring nginx..."
$SSH_CMD << 'NGINX_SCRIPT'
#!/bin/bash

# Create nginx configuration
sudo tee /etc/nginx/sites-available/edc-api << 'NGINX_CONF'
server {
    listen 80;
    server_name _;

    # API proxy
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # CORS headers
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Origin, X-Requested-With, Content-Type, Accept, Authorization' always;
        
        if ($request_method = 'OPTIONS') {
            add_header 'Access-Control-Allow-Origin' '*';
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS';
            add_header 'Access-Control-Allow-Headers' 'Origin, X-Requested-With, Content-Type, Accept, Authorization';
            add_header 'Access-Control-Max-Age' 1728000;
            add_header 'Content-Type' 'text/plain; charset=utf-8';
            add_header 'Content-Length' 0;
            return 204;
        }
    }

    # LibreClinica UI (optional)
    location /libreclinica {
        proxy_pass http://localhost:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:3000/api/health;
    }
}
NGINX_CONF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/edc-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload nginx
sudo nginx -t
sudo systemctl reload nginx

echo "Nginx configured!"
NGINX_SCRIPT

echo ""
echo "=========================================="
echo "  DEPLOYMENT COMPLETE!"
echo "=========================================="
echo ""
echo "API URL: http://$LIGHTSAIL_IP/api"
echo "Health Check: http://$LIGHTSAIL_IP/health"
echo ""
echo "To check status:"
echo "  $SSH_CMD 'pm2 status'"
echo ""
echo "To view logs:"
echo "  $SSH_CMD 'pm2 logs libreclinica-api'"
echo ""
echo "To restart:"
echo "  $SSH_CMD 'pm2 restart libreclinica-api'"
echo ""

