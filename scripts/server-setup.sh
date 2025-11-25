#!/bin/bash

# LibreClinica API - Server Setup Script
# Run this on a fresh Ubuntu 22.04 server

set -e

echo "🚀 Starting LibreClinica API server setup..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root (use sudo)${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Running as root"

# Update system
echo -e "\n${YELLOW}Updating system packages...${NC}"
apt update && apt upgrade -y
echo -e "${GREEN}✓${NC} System updated"

# Install Node.js 20.x
echo -e "\n${YELLOW}Installing Node.js 20.x...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
echo -e "${GREEN}✓${NC} Node.js $(node --version) installed"

# Install PostgreSQL 15
echo -e "\n${YELLOW}Installing PostgreSQL 15...${NC}"
apt install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql
echo -e "${GREEN}✓${NC} PostgreSQL installed"

# Install Redis
echo -e "\n${YELLOW}Installing Redis...${NC}"
apt install -y redis-server
systemctl start redis-server
systemctl enable redis-server
echo -e "${GREEN}✓${NC} Redis installed"

# Install NGINX
echo -e "\n${YELLOW}Installing NGINX...${NC}"
apt install -y nginx
systemctl start nginx
systemctl enable nginx
echo -e "${GREEN}✓${NC} NGINX installed"

# Install PM2
echo -e "\n${YELLOW}Installing PM2...${NC}"
npm install -g pm2
echo -e "${GREEN}✓${NC} PM2 installed"

# Install Git
echo -e "\n${YELLOW}Installing Git...${NC}"
apt install -y git
echo -e "${GREEN}✓${NC} Git installed"

# Install Certbot for SSL
echo -e "\n${YELLOW}Installing Certbot...${NC}"
apt install -y certbot python3-certbot-nginx
echo -e "${GREEN}✓${NC} Certbot installed"

# Create deployment user
echo -e "\n${YELLOW}Creating deployment user 'libreclinica'...${NC}"
if id "libreclinica" &>/dev/null; then
    echo -e "${YELLOW}User 'libreclinica' already exists${NC}"
else
    adduser --disabled-password --gecos "" libreclinica
    usermod -aG sudo libreclinica
    echo -e "${GREEN}✓${NC} User 'libreclinica' created"
fi

# Setup firewall
echo -e "\n${YELLOW}Configuring firewall...${NC}"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo -e "${GREEN}✓${NC} Firewall configured"

# Create directories
echo -e "\n${YELLOW}Creating directories...${NC}"
mkdir -p /var/log/libreclinica
chown libreclinica:libreclinica /var/log/libreclinica
mkdir -p /home/libreclinica/backups
chown libreclinica:libreclinica /home/libreclinica/backups
echo -e "${GREEN}✓${NC} Directories created"

# Setup PostgreSQL
echo -e "\n${YELLOW}Setting up PostgreSQL database...${NC}"
sudo -u postgres psql <<EOF
CREATE DATABASE libreclinica_prod;
CREATE USER clinica WITH ENCRYPTED PASSWORD 'changeme123';
GRANT ALL PRIVILEGES ON DATABASE libreclinica_prod TO clinica;
\q
EOF
echo -e "${GREEN}✓${NC} PostgreSQL database created"
echo -e "${YELLOW}⚠ Remember to change the database password!${NC}"

# Configure PostgreSQL
echo -e "\n${YELLOW}Configuring PostgreSQL...${NC}"
PG_VERSION=$(ls /etc/postgresql/)
PG_CONF="/etc/postgresql/$PG_VERSION/main/postgresql.conf"
PG_HBA="/etc/postgresql/$PG_VERSION/main/pg_hba.conf"

# Backup original configs
cp $PG_CONF ${PG_CONF}.backup
cp $PG_HBA ${PG_HBA}.backup

# Update pg_hba.conf
echo "local   all   clinica   md5" >> $PG_HBA

systemctl restart postgresql
echo -e "${GREEN}✓${NC} PostgreSQL configured"

# Install PM2 log rotation
echo -e "\n${YELLOW}Setting up PM2 log rotation...${NC}"
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
echo -e "${GREEN}✓${NC} PM2 log rotation configured"

# Create backup script
echo -e "\n${YELLOW}Creating backup script...${NC}"
cat > /home/libreclinica/backup.sh <<'BACKUP_SCRIPT'
#!/bin/bash
BACKUP_DIR="/home/libreclinica/backups"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="libreclinica_backup_$DATE.sql"

mkdir -p $BACKUP_DIR
pg_dump -U clinica libreclinica_prod > $BACKUP_DIR/$FILENAME
gzip $BACKUP_DIR/$FILENAME
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete

echo "Backup completed: $FILENAME.gz"
BACKUP_SCRIPT

chmod +x /home/libreclinica/backup.sh
chown libreclinica:libreclinica /home/libreclinica/backup.sh
echo -e "${GREEN}✓${NC} Backup script created"

# Add backup to crontab
echo -e "\n${YELLOW}Setting up automated backups...${NC}"
(crontab -u libreclinica -l 2>/dev/null; echo "0 2 * * * /home/libreclinica/backup.sh") | crontab -u libreclinica -
echo -e "${GREEN}✓${NC} Automated backups configured (daily at 2 AM)"

# Print summary
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Server setup complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\nInstalled components:"
echo -e "  • Node.js $(node --version)"
echo -e "  • npm $(npm --version)"
echo -e "  • PostgreSQL $(sudo -u postgres psql --version | head -n1)"
echo -e "  • Redis $(redis-server --version)"
echo -e "  • NGINX $(nginx -v 2>&1)"
echo -e "  • PM2 $(pm2 --version)"
echo -e "  • Git $(git --version)"

echo -e "\n${YELLOW}Next steps:${NC}"
echo -e "1. Switch to libreclinica user: ${GREEN}su - libreclinica${NC}"
echo -e "2. Clone your repository: ${GREEN}git clone <your-repo-url>${NC}"
echo -e "3. Setup environment: ${GREEN}cp .env.example .env.production${NC}"
echo -e "4. Install dependencies: ${GREEN}npm install${NC}"
echo -e "5. Build application: ${GREEN}npm run build${NC}"
echo -e "6. Start with PM2: ${GREEN}pm2 start dist/index.js --name libreclinica-api${NC}"
echo -e "7. Configure NGINX (see DEPLOYMENT_GUIDE.md)"
echo -e "8. Get SSL certificate: ${GREEN}sudo certbot --nginx -d api.yourdomain.com${NC}"

echo -e "\n${YELLOW}⚠ Important:${NC}"
echo -e "  • Change PostgreSQL password: ${GREEN}sudo -u postgres psql${NC}"
echo -e "  • Update .env.production with secure values"
echo -e "  • Configure firewall rules as needed"

echo -e "\n${GREEN}Happy deploying! 🚀${NC}\n"
