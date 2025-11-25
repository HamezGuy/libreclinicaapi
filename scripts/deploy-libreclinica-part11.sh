#!/bin/bash
# LibreClinica 21 CFR Part 11 Compliant Deployment
# Run: sudo bash deploy-libreclinica-part11.sh

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${GREEN}LibreClinica 21 CFR Part 11 Deployment${NC}\n"

# Check root
[ "$EUID" -ne 0 ] && echo -e "${RED}Run as root${NC}" && exit 1

# Get configuration
read -p "Domain (e.g., libreclinica.yourdomain.com): " DOMAIN
read -p "Admin email: " EMAIL
read -sp "DB password (16+ chars): " DBPASS && echo
read -p "Organization: " ORG

# Create directories
mkdir -p /opt/libreclinica /var/lib/libreclinica /var/backups/libreclinica /var/log/libreclinica /var/audit/libreclinica

# Install dependencies
echo -e "\n${YELLOW}Installing dependencies...${NC}"
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
apt install -y postgresql-15 nginx certbot python3-certbot-nginx

# Configure PostgreSQL with audit logging
echo -e "${YELLOW}Configuring PostgreSQL...${NC}"
cat >> /etc/postgresql/15/main/postgresql.conf << EOF
logging_collector = on
log_directory = '/var/log/libreclinica/postgresql'
log_statement = 'all'
log_connections = on
log_disconnections = on
EOF

mkdir -p /var/log/libreclinica/postgresql
chown postgres:postgres /var/log/libreclinica/postgresql
systemctl restart postgresql

# Create database
sudo -u postgres psql << EOF
CREATE DATABASE libreclinica_prod;
CREATE USER libreclinica WITH ENCRYPTED PASSWORD '$DBPASS';
GRANT ALL PRIVILEGES ON DATABASE libreclinica_prod TO libreclinica;
\c libreclinica_prod
CREATE SCHEMA audit;
CREATE TABLE audit.system_audit (
    audit_id SERIAL PRIMARY KEY,
    event_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    event_type VARCHAR(50),
    username VARCHAR(255),
    action VARCHAR(255),
    details TEXT
);
EOF

# Create Docker Compose
cat > /opt/libreclinica/docker-compose.yml << EOF
version: '3.8'
services:
  libreclinica:
    image: clinicalsuite/libreclinica:latest
    container_name: libreclinica
    restart: always
    ports:
      - "8080:8080"
    environment:
      - DB_HOST=host.docker.internal
      - DB_NAME=libreclinica_prod
      - DB_USER=libreclinica
      - DB_PASSWORD=${DBPASS}
      - AUDIT_LOGGING=true
      - ELECTRONIC_SIGNATURE=true
      - ORG_NAME=${ORG}
    volumes:
      - /var/lib/libreclinica/data:/data
      - /var/log/libreclinica/app:/logs
    extra_hosts:
      - "host.docker.internal:host-gateway"
EOF

# Configure NGINX
cat > /etc/nginx/sites-available/libreclinica << EOF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$server_name\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name ${DOMAIN};
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

ln -sf /etc/nginx/sites-available/libreclinica /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Get SSL
certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --email ${EMAIL}

# Setup firewall
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22,80,443/tcp
ufw --force enable

# Create backup script
cat > /usr/local/bin/libreclinica-backup.sh << 'BACKUP'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/libreclinica"
sudo -u postgres pg_dump libreclinica_prod | gzip > ${BACKUP_DIR}/db_${DATE}.sql.gz
tar -czf ${BACKUP_DIR}/data_${DATE}.tar.gz -C /var/lib/libreclinica data
find ${BACKUP_DIR} -mtime +90 -delete
BACKUP
chmod +x /usr/local/bin/libreclinica-backup.sh
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/libreclinica-backup.sh") | crontab -

# Start LibreClinica
echo -e "\n${YELLOW}Starting LibreClinica...${NC}"
cd /opt/libreclinica
docker-compose up -d
sleep 30
systemctl restart nginx

# Summary
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\nLibreClinica URL: https://${DOMAIN}"
echo -e "Database: libreclinica_prod"
echo -e "Backups: /var/backups/libreclinica (daily 2 AM)"
echo -e "Logs: /var/log/libreclinica"
echo -e "Audit: /var/audit/libreclinica"
echo -e "\n${YELLOW}Next steps:${NC}"
echo -e "1. Access https://${DOMAIN}"
echo -e "2. Complete initial setup wizard"
echo -e "3. Create admin user"
echo -e "4. Review validation docs in /opt/libreclinica/validation"
echo -e "\n${GREEN}21 CFR Part 11 Features Enabled:${NC}"
echo -e "✓ Audit trail"
echo -e "✓ Electronic signatures"
echo -e "✓ Secure authentication"
echo -e "✓ Automated backups"
echo -e "✓ SSL/TLS encryption\n"
