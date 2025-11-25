# 🚀 LibreClinica Deployment Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     PRODUCTION SETUP                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Frontend (Vercel/Cloudflare)                               │
│  ├─ Angular App                                             │
│  ├─ Static Assets                                           │
│  └─ CDN Distribution                                        │
│                          │                                   │
│                          ▼                                   │
│                    HTTPS/API Calls                           │
│                          │                                   │
│                          ▼                                   │
│  Backend Server (VPS/Cloud)                                 │
│  ├─ LibreClinica API (Node.js/Express)                      │
│  ├─ PostgreSQL Database                                     │
│  ├─ Redis Cache                                             │
│  └─ NGINX Reverse Proxy                                     │
│                          │                                   │
│                          ▼                                   │
│  External Services                                           │
│  ├─ LibreClinica SOAP (existing)                            │
│  ├─ Firebase Auth                                           │
│  └─ Cloud Storage                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Part 1: Backend Server Setup

### Option A: DigitalOcean Droplet (Recommended)

#### 1. Create Droplet
```bash
# Specifications
- OS: Ubuntu 22.04 LTS
- RAM: 4GB minimum (8GB recommended)
- CPU: 2 vCPUs minimum
- Storage: 80GB SSD
- Cost: ~$24/month (4GB) or ~$48/month (8GB)
```

#### 2. Initial Server Setup
```bash
# SSH into your server
ssh root@your-server-ip

# Update system
apt update && apt upgrade -y

# Create deployment user
adduser libreclinica
usermod -aG sudo libreclinica

# Setup firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

#### 3. Install Dependencies
```bash
# Switch to deployment user
su - libreclinica

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL 15
sudo apt install -y postgresql postgresql-contrib

# Install Redis
sudo apt install -y redis-server

# Install NGINX
sudo apt install -y nginx

# Install PM2 (Process Manager)
sudo npm install -g pm2

# Install Git
sudo apt install -y git
```

#### 4. Setup PostgreSQL
```bash
# Switch to postgres user
sudo -u postgres psql

# Create database and user
CREATE DATABASE libreclinica_prod;
CREATE USER clinica WITH ENCRYPTED PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE libreclinica_prod TO clinica;
\q

# Configure PostgreSQL for remote connections (if needed)
sudo nano /etc/postgresql/15/main/postgresql.conf
# Set: listen_addresses = 'localhost'

sudo nano /etc/postgresql/15/main/pg_hba.conf
# Add: local   all   clinica   md5

sudo systemctl restart postgresql
```

#### 5. Deploy LibreClinica API
```bash
# Clone repository
cd /home/libreclinica
git clone https://github.com/your-org/libreclinica-api.git
cd libreclinica-api

# Install dependencies
npm install --production

# Create production environment file
nano .env.production
```

**`.env.production`**:
```env
# Server
NODE_ENV=production
PORT=3000
API_BASE_URL=https://api.yourdomain.com

# Database
LIBRECLINICA_DB_HOST=localhost
LIBRECLINICA_DB_PORT=5432
LIBRECLINICA_DB_NAME=libreclinica_prod
LIBRECLINICA_DB_USER=clinica
LIBRECLINICA_DB_PASSWORD=your-secure-password
LIBRECLINICA_DB_SSL=false

# JWT
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRES_IN=24h
JWT_REFRESH_SECRET=your-refresh-token-secret
JWT_REFRESH_EXPIRES_IN=7d

# SOAP (LibreClinica)
SOAP_URL=https://your-libreclinica-instance.com/OpenClinica-ws/ws
SOAP_USERNAME=your-soap-username
SOAP_PASSWORD=your-soap-password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Security
BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# CORS
CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com

# Logging
LOG_LEVEL=info
LOG_FILE=/var/log/libreclinica/api.log
```

#### 6. Build and Start API
```bash
# Build TypeScript
npm run build

# Create log directory
sudo mkdir -p /var/log/libreclinica
sudo chown libreclinica:libreclinica /var/log/libreclinica

# Start with PM2
pm2 start dist/index.js --name libreclinica-api --env production

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Run the command it outputs
```

#### 7. Configure NGINX
```bash
sudo nano /etc/nginx/sites-available/libreclinica-api
```

**NGINX Configuration**:
```nginx
# Rate limiting
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

# Upstream
upstream libreclinica_api {
    server localhost:3000;
    keepalive 64;
}

# HTTP -> HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name api.yourdomain.com;
    
    return 301 https://$server_name$request_uri;
}

# HTTPS
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.yourdomain.com;

    # SSL certificates (will be added by Certbot)
    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # Logging
    access_log /var/log/nginx/libreclinica-api-access.log;
    error_log /var/log/nginx/libreclinica-api-error.log;
    
    # Client body size (for file uploads)
    client_max_body_size 10M;
    
    # Proxy settings
    location / {
        limit_req zone=api_limit burst=20 nodelay;
        
        proxy_pass http://libreclinica_api;
        proxy_http_version 1.1;
        
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_cache_bypass $http_upgrade;
        proxy_buffering off;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Health check endpoint (no rate limit)
    location /health {
        proxy_pass http://libreclinica_api;
        access_log off;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/libreclinica-api /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart NGINX
sudo systemctl restart nginx
```

#### 8. Setup SSL with Let's Encrypt
```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d api.yourdomain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

#### 9. Database Migration
```bash
# Run migrations (if you have them)
cd /home/libreclinica/libreclinica-api
npm run migrate:prod

# Or manually load schema
psql -U clinica -d libreclinica_prod -f schema/production-schema.sql
```

### Option B: AWS EC2 (Alternative)

Similar setup but using AWS services:
- EC2 instance (t3.medium or larger)
- RDS PostgreSQL (managed database)
- ElastiCache Redis (managed cache)
- Application Load Balancer
- Route 53 for DNS

### Option C: Docker Deployment

Create production Docker setup:

**`docker-compose.prod.yml`**:
```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.prod
    restart: always
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    depends_on:
      - postgres
      - redis
    volumes:
      - ./logs:/var/log/libreclinica

  postgres:
    image: postgres:15-alpine
    restart: always
    environment:
      POSTGRES_DB: libreclinica_prod
      POSTGRES_USER: clinica
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./schema:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
      - certbot_data:/var/www/certbot
    depends_on:
      - api

volumes:
  postgres_data:
  redis_data:
  certbot_data:
```

**`Dockerfile.prod`**:
```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

## Part 2: Frontend Deployment (Vercel)

### 1. Prepare Angular App

**Update `environment.prod.ts`**:
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://api.yourdomain.com',
  firebaseConfig: {
    apiKey: "your-api-key",
    authDomain: "your-auth-domain",
    projectId: "your-project-id",
    storageBucket: "your-storage-bucket",
    messagingSenderId: "your-sender-id",
    appId: "your-app-id"
  }
};
```

**Create `vercel.json`**:
```json
{
  "version": 2,
  "name": "libreclinica-frontend",
  "builds": [
    {
      "src": "package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "dist/electronic-data-capture-real"
      }
    }
  ],
  "routes": [
    {
      "src": "/assets/(.*)",
      "dest": "/assets/$1"
    },
    {
      "src": "/(.*\\.(js|css|png|jpg|jpeg|gif|svg|ico|json|woff|woff2|ttf|eot))",
      "dest": "/$1"
    },
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

**Update `package.json`**:
```json
{
  "scripts": {
    "build": "ng build --configuration production",
    "vercel-build": "ng build --configuration production"
  }
}
```

### 2. Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy from your frontend directory
cd /path/to/ElectronicDataCaptureReal
vercel

# Follow prompts:
# - Link to existing project or create new
# - Set build command: npm run build
# - Set output directory: dist/electronic-data-capture-real
# - Set root directory: ./

# Deploy to production
vercel --prod
```

**Or use Vercel Dashboard**:
1. Go to https://vercel.com
2. Import Git repository
3. Configure:
   - Framework: Angular
   - Build Command: `npm run build`
   - Output Directory: `dist/electronic-data-capture-real`
   - Install Command: `npm install`
4. Add environment variables
5. Deploy

### 3. Environment Variables in Vercel

Add these in Vercel Dashboard → Settings → Environment Variables:
```
PRODUCTION=true
API_URL=https://api.yourdomain.com
FIREBASE_API_KEY=your-key
FIREBASE_AUTH_DOMAIN=your-domain
FIREBASE_PROJECT_ID=your-id
```

## Part 3: Frontend Deployment (Cloudflare Pages)

### Alternative to Vercel

**Create `wrangler.toml`**:
```toml
name = "libreclinica-frontend"
type = "webpack"
account_id = "your-account-id"
workers_dev = true
route = "yourdomain.com/*"
zone_id = "your-zone-id"

[site]
bucket = "./dist/electronic-data-capture-real"

[env.production]
name = "libreclinica-frontend-prod"
route = "yourdomain.com/*"
```

**Deploy to Cloudflare Pages**:
```bash
# Install Wrangler
npm install -g wrangler

# Login
wrangler login

# Build
npm run build

# Deploy
wrangler pages publish dist/electronic-data-capture-real --project-name=libreclinica
```

**Or use Cloudflare Dashboard**:
1. Go to Cloudflare Pages
2. Connect Git repository
3. Configure:
   - Build command: `npm run build`
   - Build output: `dist/electronic-data-capture-real`
   - Root directory: `/`
4. Deploy

## Part 4: DNS Configuration

### Setup Custom Domains

**For Backend (api.yourdomain.com)**:
```
Type: A
Name: api
Value: your-server-ip
TTL: Auto
```

**For Frontend (yourdomain.com)**:
```
# Vercel
Type: CNAME
Name: @
Value: cname.vercel-dns.com
TTL: Auto

Type: CNAME
Name: www
Value: cname.vercel-dns.com
TTL: Auto

# Or Cloudflare Pages
Type: CNAME
Name: @
Value: your-pages-url.pages.dev
TTL: Auto
```

## Part 5: CI/CD Pipeline

### GitHub Actions for Backend

**`.github/workflows/deploy-backend.yml`**:
```yaml
name: Deploy Backend

on:
  push:
    branches: [main]
    paths:
      - 'libreclinica-api/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: |
          cd libreclinica-api
          npm ci
      
      - name: Run tests
        run: |
          cd libreclinica-api
          npm test
      
      - name: Build
        run: |
          cd libreclinica-api
          npm run build
      
      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /home/libreclinica/libreclinica-api
            git pull origin main
            npm install --production
            npm run build
            pm2 restart libreclinica-api
```

### GitHub Actions for Frontend

**`.github/workflows/deploy-frontend.yml`**:
```yaml
name: Deploy Frontend

on:
  push:
    branches: [main]
    paths:
      - 'ElectronicDataCaptureReal/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: |
          cd ElectronicDataCaptureReal
          npm ci
      
      - name: Build
        run: |
          cd ElectronicDataCaptureReal
          npm run build
        env:
          API_URL: ${{ secrets.API_URL }}
      
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: ./ElectronicDataCaptureReal
```

## Part 6: Monitoring & Maintenance

### Setup Monitoring

**Install monitoring tools**:
```bash
# PM2 monitoring
pm2 install pm2-logrotate

# Setup log rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

# Install monitoring dashboard
pm2 install pm2-server-monit
```

### Health Checks

**Add to your API** (`src/routes/health.routes.ts`):
```typescript
router.get('/health', async (req, res) => {
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    status: 'OK',
    checks: {
      database: await checkDatabase(),
      redis: await checkRedis(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    }
  };
  res.json(health);
});
```

### Backup Strategy

**Automated PostgreSQL backups**:
```bash
# Create backup script
nano /home/libreclinica/backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/home/libreclinica/backups"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="libreclinica_backup_$DATE.sql"

mkdir -p $BACKUP_DIR

pg_dump -U clinica libreclinica_prod > $BACKUP_DIR/$FILENAME

# Compress
gzip $BACKUP_DIR/$FILENAME

# Keep only last 7 days
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete

# Upload to S3 (optional)
# aws s3 cp $BACKUP_DIR/$FILENAME.gz s3://your-bucket/backups/
```

```bash
# Make executable
chmod +x /home/libreclinica/backup.sh

# Add to crontab
crontab -e
# Add: 0 2 * * * /home/libreclinica/backup.sh
```

## Part 7: Security Checklist

- [ ] SSL/TLS certificates installed
- [ ] Firewall configured (UFW)
- [ ] SSH key-only authentication
- [ ] Database password secured
- [ ] JWT secrets generated (32+ chars)
- [ ] CORS properly configured
- [ ] Rate limiting enabled
- [ ] Security headers set
- [ ] Environment variables secured
- [ ] Backups automated
- [ ] Monitoring enabled
- [ ] Log rotation configured

## Quick Start Commands

### Backend Server
```bash
# Start
pm2 start libreclinica-api

# Stop
pm2 stop libreclinica-api

# Restart
pm2 restart libreclinica-api

# Logs
pm2 logs libreclinica-api

# Status
pm2 status
```

### Frontend
```bash
# Deploy to Vercel
vercel --prod

# Deploy to Cloudflare
wrangler pages publish dist/electronic-data-capture-real
```

## Cost Estimate

| Service | Provider | Cost/Month |
|---------|----------|------------|
| Backend Server | DigitalOcean | $24-48 |
| Database | Included | $0 |
| Frontend | Vercel (Pro) | $20 |
| SSL | Let's Encrypt | $0 |
| Domain | Namecheap | $1-2 |
| **Total** | | **$45-70/month** |

## Support & Troubleshooting

### Common Issues

**API not accessible**:
```bash
# Check if API is running
pm2 status

# Check NGINX
sudo nginx -t
sudo systemctl status nginx

# Check logs
pm2 logs libreclinica-api
sudo tail -f /var/log/nginx/error.log
```

**Database connection issues**:
```bash
# Check PostgreSQL
sudo systemctl status postgresql
sudo -u postgres psql -l

# Test connection
psql -U clinica -d libreclinica_prod -h localhost
```

**Frontend not loading**:
- Check Vercel deployment logs
- Verify API URL in environment
- Check CORS settings on backend
- Verify DNS propagation

---

**Ready to deploy!** Follow this guide step-by-step for a production-ready setup.
