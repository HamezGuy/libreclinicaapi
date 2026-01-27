#!/bin/bash
# Setup script for Lightsail server - run this once to install dependencies
set -e

echo "=========================================="
echo "Setting up LibreClinica API server"
echo "=========================================="

# Install Node.js 20.x
echo "[1/4] Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# Install PM2 globally
echo "[2/4] Installing PM2..."
sudo npm install -g pm2

# Install unzip if not present
echo "[3/4] Installing utilities..."
sudo apt-get install -y unzip

# Setup PM2 startup
echo "[4/4] Configuring PM2 startup..."
pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -n 1 | sudo bash || true

echo ""
echo "=========================================="
echo "Server setup complete!"
echo "=========================================="

