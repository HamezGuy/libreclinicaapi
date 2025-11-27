# Deployment Guide (AWS Lightsail Recommended)

This guide explains how to deploy the backend to a server. For Part 11 Compliance + Ease of Use, we recommend **AWS Lightsail**.

## Why AWS Lightsail?
- **Compliance**: It runs on AWS infrastructure (Industry Standard for GxP).
- **Simplicity**: It is a "Virtual Private Server" (VPS). You get a Linux box, and that's it. No complex VPC/Subnet configuration.
- **Cost**: Fixed monthly price (approx $20-40/mo for the required 4GB RAM).

## Architecture
- **Frontend**: Hosted on Vercel (connects to this backend via API).
- **Backend**: Hosted on AWS Lightsail using Docker Compose.
  - `postgres`: The shared database.
  - `libreclinica-core`: The Java-based core system.
  - `libreclinica-api`: The Node.js API layer.
  - `nginx`: Reverse proxy for SSL and Routing.

## Step 1: Create Server
1. Log in to AWS Console and search for **Lightsail**.
2. Click **Create Instance**.
3. Select **Linux/Unix** -> **OS Only** -> **Ubuntu 22.04 LTS**.
4. Choose a plan with at least **4GB RAM** (LibreClinica is heavy).
   - *Tip: The $20-40/mo plan usually covers this.*
5. Name it `libreclinica-backend` and create.
6. Click the specific instance, go to **Networking**, and **Create Static IP**.
7. Under **Networking** -> **IPv4 Firewall**, add a rule:
   - Application: `HTTPS` | Protocol: `TCP` | Port: `443`

## Step 2: Prepare Server
1. SSH into your server (click the orange "Connect using SSH" button in the browser).
2. Install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker ubuntu
   # (Log out and log back in for group change to take effect)
   ```
3. Install Docker Compose:
   ```bash
   sudo apt-get update
   sudo apt-get install docker-compose-plugin
   ```

## Step 3: Deploy Code
1. On your local machine, copy the `production-deployment` folder to the server.
   - *Mac/Linux*: `scp -r production-deployment ubuntu@<YOUR_STATIC_IP>:~/`
   - *Windows*: Use WinSCP or just create the files manually on the server using `nano`.

2. SSH back into the server:
   ```bash
   cd production-deployment
   ```

3. Create your secrets file:
   ```bash
   nano .env
   ```
   Paste this (fill in real values):
   ```bash
   DB_PASSWORD=secure_password_here
   JWT_SECRET=random_secret_string_here
   DOMAIN=api.your-domain.com
   FRONTEND_DOMAIN=your-frontend.vercel.app
   ADMIN_EMAIL=you@example.com
   SOAP_PASSWORD=root
   ```

## Step 4: Start System
1. Run the containers:
   ```bash
   docker compose up -d
   ```

2. Set up SSL (HTTPS):
   ```bash
   # 1. Request Certificate
   docker compose run --rm certbot certonly --webroot --webroot-path /var/www/certbot -d api.your-domain.com
   
   # 2. Edit nginx config to enable SSL
   nano nginx.conf
   # (Uncomment the 2 ssl_certificate lines)
   
   # 3. Restart Nginx
   docker compose restart nginx
   ```

## Step 5: Connect Frontend
1. Go to Vercel project settings.
2. Set `API_URL` to `https://api.your-domain.com/api`.
3. Redeploy Frontend.
