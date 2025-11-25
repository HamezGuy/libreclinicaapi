# 🚀 Quick Deploy Guide - LibreClinica

## TL;DR - Fastest Path to Production

### Step 1: Backend Server (30 minutes)

```bash
# 1. Get a DigitalOcean droplet ($24/month)
# Ubuntu 22.04, 4GB RAM, 2 vCPUs

# 2. SSH in and run this script
curl -fsSL https://raw.githubusercontent.com/your-repo/setup.sh | bash

# Or manually:
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs postgresql nginx certbot python3-certbot-nginx
npm install -g pm2

# 3. Clone and setup
git clone https://github.com/your-org/libreclinica-api.git
cd libreclinica-api
npm install
npm run build

# 4. Configure environment
cp .env.example .env.production
nano .env.production  # Add your settings

# 5. Start with PM2
pm2 start dist/index.js --name libreclinica-api
pm2 save
pm2 startup

# 6. Setup NGINX (copy config from DEPLOYMENT_GUIDE.md)
# 7. Get SSL: sudo certbot --nginx -d api.yourdomain.com
```

### Step 2: Frontend to Vercel (10 minutes)

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Go to frontend directory
cd ElectronicDataCaptureReal

# 3. Update environment.prod.ts with your API URL

# 4. Deploy
vercel login
vercel --prod

# Done! Your app is live at https://your-app.vercel.app
```

### Step 3: Connect Domain (5 minutes)

**Backend DNS**:
- Type: A
- Name: api
- Value: your-server-ip

**Frontend DNS**:
- Type: CNAME
- Name: @
- Value: cname.vercel-dns.com

## Environment Variables Needed

### Backend (.env.production)
```env
NODE_ENV=production
PORT=3000
LIBRECLINICA_DB_HOST=localhost
LIBRECLINICA_DB_NAME=libreclinica_prod
LIBRECLINICA_DB_USER=clinica
LIBRECLINICA_DB_PASSWORD=your-password
JWT_SECRET=your-32-char-secret
SOAP_URL=https://your-libreclinica.com/OpenClinica-ws/ws
SOAP_USERNAME=your-username
SOAP_PASSWORD=your-password
CORS_ORIGIN=https://yourdomain.com
```

### Frontend (Vercel Dashboard)
```
PRODUCTION=true
API_URL=https://api.yourdomain.com
```

## Costs

- **DigitalOcean**: $24/month (4GB droplet)
- **Vercel**: $20/month (Pro plan) or $0 (Hobby)
- **Domain**: $12/year
- **Total**: ~$45/month

## Next Steps

1. ✅ Deploy backend to server
2. ✅ Deploy frontend to Vercel
3. ✅ Connect custom domain
4. ⏳ Setup monitoring (PM2, logs)
5. ⏳ Setup backups (automated daily)
6. ⏳ Configure CI/CD (GitHub Actions)

See **DEPLOYMENT_GUIDE.md** for detailed instructions.
