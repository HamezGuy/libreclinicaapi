#!/bin/bash
#
# Deploy LibreClinica Stack to AWS Lightsail
# This script deploys PostgreSQL, LibreClinica Core, and LibreClinica API
# and creates all database tables for new features
#

set -e

# Configuration
LIGHTSAIL_IP="18.225.57.5"
LIGHTSAIL_USER="ubuntu"
SSH_KEY="../lightsail.pem"
REMOTE_DIR="/home/ubuntu/edc-app"

echo "=========================================="
echo "  EDC Full Stack Deployment to Lightsail"
echo "=========================================="
echo ""

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Resolve SSH key path
if [ ! -f "$SSH_KEY" ]; then
    SSH_KEY="$SCRIPT_DIR/../lightsail.pem"
fi

if [ ! -f "$SSH_KEY" ]; then
    echo "ERROR: SSH key not found!"
    exit 1
fi

# Fix SSH key permissions
chmod 600 "$SSH_KEY"

echo "SSH Key: $SSH_KEY"
echo "Target: $LIGHTSAIL_USER@$LIGHTSAIL_IP"
echo ""

# SSH/SCP options
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
SSH_CMD="ssh -i $SSH_KEY $SSH_OPTS $LIGHTSAIL_USER@$LIGHTSAIL_IP"
SCP_CMD="scp -i $SSH_KEY $SSH_OPTS"

echo "Step 1: Testing SSH connection..."
$SSH_CMD "echo 'SSH connection successful!'"

echo ""
echo "Step 2: Setting up server prerequisites..."
$SSH_CMD << 'SETUP_SCRIPT'
#!/bin/bash
set -e

# Update system
sudo apt-get update -y

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker ubuntu
    rm get-docker.sh
fi

# Install Docker Compose plugin if not present
if ! docker compose version &> /dev/null; then
    echo "Installing Docker Compose..."
    sudo apt-get install -y docker-compose-plugin || {
        sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
    }
fi

# Create app directory
mkdir -p ~/edc-app
mkdir -p ~/edc-app/certbot/conf
mkdir -p ~/edc-app/certbot/www

echo "Server setup complete!"
SETUP_SCRIPT

echo ""
echo "Step 3: Creating combined migrations file..."

# Create combined migrations file
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"
COMBINED_MIGRATIONS="/tmp/all_migrations.sql"

cat > "$COMBINED_MIGRATIONS" << 'MIGRATIONS_HEADER'
-- Combined Migrations for AccuraTrials EDC
-- This file creates all tables for new features

BEGIN;

MIGRATIONS_HEADER

# Add each migration file
for migration in \
    "20241215_email_notifications.sql" \
    "20241215_subject_transfer.sql" \
    "20241215_double_data_entry.sql" \
    "20241215_econsent.sql" \
    "20241215_epro_patient_portal.sql" \
    "20241215_rtsm_irt.sql"
do
    if [ -f "$MIGRATIONS_DIR/$migration" ]; then
        echo "  Adding: $migration"
        echo "" >> "$COMBINED_MIGRATIONS"
        echo "-- ============================================" >> "$COMBINED_MIGRATIONS"
        echo "-- Migration: $migration" >> "$COMBINED_MIGRATIONS"
        echo "-- ============================================" >> "$COMBINED_MIGRATIONS"
        # Remove BEGIN/COMMIT from individual files
        sed 's/^BEGIN;$/-- (BEGIN removed)/g; s/^COMMIT;$/-- (COMMIT removed)/g' "$MIGRATIONS_DIR/$migration" >> "$COMBINED_MIGRATIONS"
    fi
done

cat >> "$COMBINED_MIGRATIONS" << 'MIGRATIONS_FOOTER'

COMMIT;

-- Verify tables created
SELECT 'Tables created:' as status;
SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'acc_%' ORDER BY table_name;
MIGRATIONS_FOOTER

echo ""
echo "Step 4: Uploading deployment files..."

# Upload docker-compose and config files
$SCP_CMD "$SCRIPT_DIR/production-deployment/docker-compose.yml" "$LIGHTSAIL_USER@$LIGHTSAIL_IP:$REMOTE_DIR/"
$SCP_CMD "$SCRIPT_DIR/production-deployment/nginx.conf" "$LIGHTSAIL_USER@$LIGHTSAIL_IP:$REMOTE_DIR/"
$SCP_CMD "$SCRIPT_DIR/production-deployment/nginx-init.conf" "$LIGHTSAIL_USER@$LIGHTSAIL_IP:$REMOTE_DIR/" 2>/dev/null || true
$SCP_CMD "$SCRIPT_DIR/production-deployment/nginx-prod.conf" "$LIGHTSAIL_USER@$LIGHTSAIL_IP:$REMOTE_DIR/" 2>/dev/null || true
$SCP_CMD "$COMBINED_MIGRATIONS" "$LIGHTSAIL_USER@$LIGHTSAIL_IP:$REMOTE_DIR/"

# Upload Dockerfile and API source
echo "Creating API archive..."
cd "$SCRIPT_DIR"
tar --exclude='node_modules' --exclude='coverage' --exclude='logs' --exclude='.git' --exclude='*.tar.gz' -czf /tmp/libreclinica-api.tar.gz .
$SCP_CMD /tmp/libreclinica-api.tar.gz "$LIGHTSAIL_USER@$LIGHTSAIL_IP:$REMOTE_DIR/"

echo ""
echo "Step 5: Deploying on server..."
$SSH_CMD << 'DEPLOY_SCRIPT'
#!/bin/bash
set -e

cd ~/edc-app

echo "Extracting API source..."
mkdir -p api-source
tar -xzf libreclinica-api.tar.gz -C api-source
rm libreclinica-api.tar.gz

echo ""
echo "Stopping existing containers..."
docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true

echo ""
echo "Starting PostgreSQL..."
docker compose up -d postgres 2>/dev/null || docker-compose up -d postgres

echo "Waiting for PostgreSQL to be ready..."
sleep 15

for i in {1..30}; do
    if docker exec libreclinica_db pg_isready -U libreclinica -d libreclinica > /dev/null 2>&1; then
        echo "PostgreSQL is ready!"
        break
    fi
    echo "Waiting... ($i/30)"
    sleep 2
done

echo ""
echo "Running database migrations..."
docker cp all_migrations.sql libreclinica_db:/tmp/all_migrations.sql
docker exec libreclinica_db psql -U libreclinica -d libreclinica -f /tmp/all_migrations.sql || {
    echo "Note: Some migrations may have already been applied"
}

echo ""
echo "Starting LibreClinica Core..."
docker compose up -d core 2>/dev/null || docker-compose up -d core

echo "Waiting for LibreClinica Core (2-3 minutes)..."
sleep 60

for i in {1..40}; do
    if curl -sf http://localhost:8080/libreclinica/pages/login/login > /dev/null 2>&1; then
        echo "LibreClinica Core is ready!"
        break
    fi
    echo "Waiting for Core... ($i/40)"
    sleep 5
done

echo ""
echo "Starting LibreClinica API..."
docker compose up -d api 2>/dev/null || docker-compose up -d api
sleep 10

echo ""
echo "Starting Nginx..."
docker compose up -d nginx 2>/dev/null || docker-compose up -d nginx
sleep 5

echo ""
echo "Starting Certbot..."
docker compose up -d certbot 2>/dev/null || docker-compose up -d certbot || true

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
echo "Container Status:"
docker compose ps 2>/dev/null || docker-compose ps

echo ""
echo "Database Tables Created:"
docker exec libreclinica_db psql -U libreclinica -d libreclinica -c "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'acc_%' ORDER BY table_name;" 2>/dev/null || true

echo ""
echo "API Health Check:"
curl -sf http://localhost:3000/api/health && echo "" || echo "API may need more time to start"

DEPLOY_SCRIPT

echo ""
echo "=========================================="
echo "  DEPLOYMENT COMPLETE!"
echo "=========================================="
echo ""
echo "Access Points:"
echo "  API Health: http://$LIGHTSAIL_IP/api/health"
echo "  API (direct): http://$LIGHTSAIL_IP:3000/api/health"
echo "  LibreClinica: http://$LIGHTSAIL_IP:8080/libreclinica"
echo ""
echo "SSH Access:"
echo "  ssh -i $SSH_KEY $LIGHTSAIL_USER@$LIGHTSAIL_IP"
echo ""
echo "View logs:"
echo "  $SSH_CMD 'docker compose logs -f'"
echo ""
