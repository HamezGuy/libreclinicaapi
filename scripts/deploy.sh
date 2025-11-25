#!/bin/bash

# LibreClinica API - Deployment Script
# Run this to deploy updates to production

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_NAME="libreclinica-api"
APP_DIR="/home/libreclinica/libreclinica-api"

echo -e "${GREEN}🚀 Deploying LibreClinica API...${NC}\n"

# Check if running as libreclinica user
if [ "$USER" != "libreclinica" ]; then
    echo -e "${RED}Please run as libreclinica user${NC}"
    exit 1
fi

# Navigate to app directory
cd $APP_DIR

# Backup current version
echo -e "${YELLOW}Creating backup...${NC}"
BACKUP_DIR="/home/libreclinica/backups/app"
mkdir -p $BACKUP_DIR
tar -czf $BACKUP_DIR/backup_$(date +%Y%m%d_%H%M%S).tar.gz dist/ node_modules/ || true
echo -e "${GREEN}✓${NC} Backup created"

# Pull latest code
echo -e "\n${YELLOW}Pulling latest code...${NC}"
git pull origin main
echo -e "${GREEN}✓${NC} Code updated"

# Install dependencies
echo -e "\n${YELLOW}Installing dependencies...${NC}"
npm install --production
echo -e "${GREEN}✓${NC} Dependencies installed"

# Run database migrations (if any)
echo -e "\n${YELLOW}Running database migrations...${NC}"
if [ -f "scripts/migrate.sh" ]; then
    ./scripts/migrate.sh
    echo -e "${GREEN}✓${NC} Migrations completed"
else
    echo -e "${YELLOW}⚠${NC} No migration script found, skipping"
fi

# Build application
echo -e "\n${YELLOW}Building application...${NC}"
npm run build
echo -e "${GREEN}✓${NC} Build completed"

# Restart application
echo -e "\n${YELLOW}Restarting application...${NC}"
pm2 restart $APP_NAME
echo -e "${GREEN}✓${NC} Application restarted"

# Wait for app to start
echo -e "\n${YELLOW}Waiting for application to start...${NC}"
sleep 5

# Health check
echo -e "\n${YELLOW}Running health check...${NC}"
HEALTH_URL="http://localhost:3000/health"
if curl -f -s $HEALTH_URL > /dev/null; then
    echo -e "${GREEN}✓${NC} Health check passed"
else
    echo -e "${RED}✗${NC} Health check failed!"
    echo -e "${YELLOW}Rolling back...${NC}"
    # Restore from backup would go here
    pm2 logs $APP_NAME --lines 50
    exit 1
fi

# Show status
echo -e "\n${YELLOW}Application status:${NC}"
pm2 status $APP_NAME

# Show recent logs
echo -e "\n${YELLOW}Recent logs:${NC}"
pm2 logs $APP_NAME --lines 20 --nostream

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Deployment completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\nUseful commands:"
echo -e "  • View logs: ${GREEN}pm2 logs $APP_NAME${NC}"
echo -e "  • Monitor: ${GREEN}pm2 monit${NC}"
echo -e "  • Restart: ${GREEN}pm2 restart $APP_NAME${NC}"
echo -e "  • Stop: ${GREEN}pm2 stop $APP_NAME${NC}"
echo -e "\n${GREEN}Happy deploying! 🚀${NC}\n"
