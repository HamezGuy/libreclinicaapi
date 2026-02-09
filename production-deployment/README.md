# AWS Lightsail Production Deployment

Deploy the EDC backend stack (PostgreSQL + LibreClinica Core + Node.js API + Nginx + SSL) to AWS Lightsail.

## Architecture

| Component | Description | Port |
|-----------|-------------|------|
| **PostgreSQL 14** | Shared database (schema created by LibreClinica Core) | 5432 (internal) |
| **LibreClinica Core** | Java/Tomcat - creates 100+ tables, provides SOAP services | 8080 (internal) |
| **LibreClinica API** | Node.js REST API - creates supplementary `acc_*` tables | 3000 (internal) |
| **Nginx** | Reverse proxy with SSL (Let's Encrypt) | 80, 443 |
| **Certbot** | Automatic SSL certificate renewal | - |

- **Frontend**: Deployed separately on Vercel (`accuratrials.com`)
- **Backend**: This stack on Lightsail (`api.accuratrials.com`)

## Step 1: Create Lightsail Instance

1. AWS Console -> Lightsail -> Create Instance
2. **OS**: Linux/Unix -> Ubuntu 22.04 LTS
3. **Plan**: 4GB RAM minimum ($24/mo) — LibreClinica Core is memory-heavy
4. Name: `libreclinica-backend`
5. Networking -> Create Static IP
6. IPv4 Firewall -> Add rules: **HTTP (80)** and **HTTPS (443)**

## Step 2: Install Docker

```bash
# SSH into server
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
# Log out and back in for group change
```

## Step 3: Upload Files

From your local machine, copy the deployment files:

```bash
scp -r production-deployment ubuntu@<STATIC_IP>:~/production-deployment
```

Also copy the API source code (needed to build the Docker image):

```bash
# From the libreclinicaapi directory
scp -r . ubuntu@<STATIC_IP>:~/libreclinicaapi
```

Or tar it up:
```bash
tar -czf deploy-api.tar.gz --exclude=node_modules --exclude=.git libreclinicaapi/
scp deploy-api.tar.gz ubuntu@<STATIC_IP>:~/
ssh ubuntu@<STATIC_IP> "tar -xzf deploy-api.tar.gz"
```

## Step 4: Configure Secrets

```bash
cd ~/production-deployment
nano .env
```

Add these values:
```bash
DB_PASSWORD=<strong-random-password>
JWT_SECRET=<strong-random-secret>
ADMIN_EMAIL=admin@accuratrials.com
```

Generate secure values:
```bash
# DB Password
openssl rand -base64 24
# JWT Secret
openssl rand -base64 32
```

## Step 5: Deploy

```bash
chmod +x deploy.sh
./deploy.sh
```

This script:
1. Bootstraps SSL certificate via Let's Encrypt (first run only)
2. Switches to production nginx config with SSL
3. Starts all services

## Step 6: Verify

```bash
# Check all services are running
docker compose ps

# Test API health
curl https://api.accuratrials.com/health

# Check API logs
docker compose logs -f api

# Check LibreClinica Core logs (takes 2-4 min to fully start)
docker compose logs -f core
```

## Maintenance

```bash
# View logs
docker compose logs -f api
docker compose logs -f core

# Restart a service
docker compose restart api

# Rebuild and restart API after code changes
docker compose up -d --build api

# Full restart
docker compose down && docker compose up -d

# Database backup
docker exec libreclinica_db pg_dump -U libreclinica libreclinica > backup-$(date +%Y%m%d).sql

# Restore from backup
cat backup.sql | docker exec -i libreclinica_db psql -U libreclinica -d libreclinica
```

## Files in This Directory

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Main production compose file |
| `nginx.conf` | Active nginx config (copied by deploy.sh) |
| `nginx-init.conf` | HTTP-only config for SSL bootstrap |
| `nginx-prod.conf` | Full SSL production config |
| `deploy.sh` | Deployment script with SSL bootstrapping |
| `.env` | Secrets (create manually, never commit) |
