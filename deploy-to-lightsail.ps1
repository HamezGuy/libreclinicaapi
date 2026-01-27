# Deploy LibreClinica API to AWS Lightsail
# Usage: .\deploy-to-lightsail.ps1

$ErrorActionPreference = "Stop"

$LIGHTSAIL_IP = "18.225.57.5"
$LIGHTSAIL_USER = "ubuntu"
$SSH_KEY = "$env:USERPROFILE\.ssh\lightsail-key.pem"
$REMOTE_APP_DIR = "/home/ubuntu/libreclinica-api"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deploying LibreClinica API to Lightsail" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build the project locally
Write-Host "[1/5] Building project..." -ForegroundColor Yellow
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Build successful" -ForegroundColor Green

# Step 2: Create deployment archive with dist folder
Write-Host "[2/5] Creating deployment archive..." -ForegroundColor Yellow
if (Test-Path deploy.zip) { Remove-Item deploy.zip -Force }
Compress-Archive -Path "dist", "package.json", "package-lock.json" -DestinationPath "deploy.zip" -Force
Write-Host "  Archive created: deploy.zip" -ForegroundColor Green

# Step 3: Upload to Lightsail
Write-Host "[3/5] Uploading to Lightsail ($LIGHTSAIL_IP)..." -ForegroundColor Yellow
scp -o StrictHostKeyChecking=no -i $SSH_KEY deploy.zip "${LIGHTSAIL_USER}@${LIGHTSAIL_IP}:/home/ubuntu/"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Upload failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Upload successful" -ForegroundColor Green

# Step 4: Setup on remote server
Write-Host "[4/5] Setting up on remote server..." -ForegroundColor Yellow

$setupScript = @"
set -e
echo 'Stopping existing service...'
sudo systemctl stop libreclinica-api 2>/dev/null || true
pm2 stop libreclinica-api 2>/dev/null || true

echo 'Extracting deployment...'
rm -rf $REMOTE_APP_DIR
mkdir -p $REMOTE_APP_DIR
cd $REMOTE_APP_DIR
unzip -o /home/ubuntu/deploy.zip

echo 'Installing dependencies...'
npm ci --production

echo 'Creating .env file...'
cat > .env << 'ENVEOF'
PORT=3001
NODE_ENV=production
LIBRECLINICA_DB_HOST=localhost
LIBRECLINICA_DB_PORT=5432
LIBRECLINICA_DB_NAME=libreclinica
LIBRECLINICA_DB_USER=clinica
LIBRECLINICA_DB_PASSWORD=clinica
LIBRECLINICA_SOAP_URL=http://localhost:8080/libreclinica
JWT_SECRET=your-production-jwt-secret-change-this
DEMO_MODE=false
ENVEOF

echo 'Starting application with PM2...'
pm2 delete libreclinica-api 2>/dev/null || true
pm2 start dist/server.js --name libreclinica-api --env production
pm2 save

echo 'Deployment complete!'
"@

ssh -o StrictHostKeyChecking=no -i $SSH_KEY "${LIGHTSAIL_USER}@${LIGHTSAIL_IP}" $setupScript
if ($LASTEXITCODE -ne 0) {
    Write-Host "Remote setup failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Remote setup successful" -ForegroundColor Green

# Step 5: Verify deployment
Write-Host "[5/5] Verifying deployment..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
$healthCheck = ssh -o StrictHostKeyChecking=no -i $SSH_KEY "${LIGHTSAIL_USER}@${LIGHTSAIL_IP}" "curl -s http://localhost:3001/api/health || echo 'HEALTH_CHECK_FAILED'"
if ($healthCheck -like "*healthy*") {
    Write-Host "  Health check passed!" -ForegroundColor Green
} else {
    Write-Host "  Health check response: $healthCheck" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Backend URL: http://${LIGHTSAIL_IP}:3001/api" -ForegroundColor White
Write-Host ""

# Cleanup
Remove-Item deploy.zip -Force 2>$null

