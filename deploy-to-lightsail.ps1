# LibreClinica API Deployment Script for AWS Lightsail
# This script properly deploys the backend to Lightsail with all dependencies

param(
    [string]$LightsailIP = "18.225.57.5",
    [string]$LightsailUser = "ubuntu",
    [string]$SSHKeyPath = "d:\EDC-Projects\lightsail-deploy-key.pem"
)

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " LibreClinica API Deployment to Lightsail" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build TypeScript
Write-Host "[1/6] Building TypeScript..." -ForegroundColor Yellow
Push-Location "d:\EDC-Projects\libreclinica-api"
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: TypeScript build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "Build successful!" -ForegroundColor Green

# Step 2: Create deployment package
Write-Host "[2/6] Creating deployment package..." -ForegroundColor Yellow
$deployZip = "d:\EDC-Projects\libreclinica-api\deploy.zip"
Remove-Item -Path $deployZip -ErrorAction SilentlyContinue

# Include dist, package.json, package-lock.json, and .env.example
Compress-Archive -Path @(
    "d:\EDC-Projects\libreclinica-api\dist",
    "d:\EDC-Projects\libreclinica-api\package.json",
    "d:\EDC-Projects\libreclinica-api\package-lock.json"
) -DestinationPath $deployZip -Force

$zipSize = [math]::Round((Get-Item $deployZip).Length / 1MB, 2)
Write-Host "Package created: $zipSize MB" -ForegroundColor Green

# Step 3: Upload to Lightsail
Write-Host "[3/6] Uploading to Lightsail..." -ForegroundColor Yellow
scp -i $SSHKeyPath -o StrictHostKeyChecking=no $deployZip "${LightsailUser}@${LightsailIP}:/home/ubuntu/"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Upload failed!" -ForegroundColor Red
    exit 1
}
Write-Host "Upload successful!" -ForegroundColor Green

# Step 4: Deploy on server
Write-Host "[4/6] Deploying on server..." -ForegroundColor Yellow
$deployScript = @'
set -e
echo "=== Stopping PM2 service ==="
pm2 stop libreclinica-api 2>/dev/null || true

echo "=== Backing up current deployment ==="
rm -rf /home/ubuntu/libreclinica-api-backup
mv /home/ubuntu/libreclinica-api /home/ubuntu/libreclinica-api-backup 2>/dev/null || true

echo "=== Creating new deployment directory ==="
mkdir -p /home/ubuntu/libreclinica-api
cd /home/ubuntu/libreclinica-api

echo "=== Extracting deployment package ==="
unzip -o /home/ubuntu/deploy.zip

echo "=== Fixing permissions ==="
chown -R ubuntu:ubuntu .
chmod -R 755 dist

echo "=== Installing production dependencies ==="
npm ci --omit=dev

echo "=== Creating .env file ==="
cat > .env << 'ENVFILE'
PORT=3001
NODE_ENV=production
LIBRECLINICA_DB_HOST=localhost
LIBRECLINICA_DB_PORT=5432
LIBRECLINICA_DB_NAME=libreclinica
LIBRECLINICA_DB_USER=libreclinica
LIBRECLINICA_DB_PASSWORD=libreclinica
LIBRECLINICA_SOAP_URL=http://localhost:8080/libreclinica
JWT_SECRET=accura-trials-production-secret-2026
DEMO_MODE=false
ENVFILE

echo "=== Starting application with PM2 (fresh start) ==="
pm2 kill 2>/dev/null || true
sleep 2
pm2 start dist/server.js --name libreclinica-api
pm2 save

echo "=== Waiting for application to start ==="
sleep 5

echo "=== Checking application health ==="
curl -s http://localhost:3001/health

echo ""
echo "=== Deployment complete! ==="
pm2 list
'@

ssh -i $SSHKeyPath -o StrictHostKeyChecking=no "${LightsailUser}@${LightsailIP}" $deployScript
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Deployment failed!" -ForegroundColor Red
    exit 1
}
Write-Host "Deployment successful!" -ForegroundColor Green

# Step 5: Verify API is accessible
Write-Host "[5/6] Verifying API health..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
try {
    $response = Invoke-WebRequest -Uri "https://api.accuratrials.com/health" -TimeoutSec 15 -UseBasicParsing
    $health = $response.Content | ConvertFrom-Json
    Write-Host "API Status: $($health.status)" -ForegroundColor Green
    Write-Host "Environment: $($health.environment)" -ForegroundColor Green
    Write-Host "Version: $($health.version)" -ForegroundColor Green
} catch {
    Write-Host "WARNING: Could not verify API health through domain" -ForegroundColor Yellow
    Write-Host "The API may still be starting up or nginx may need configuration" -ForegroundColor Yellow
}

# Step 6: Show summary
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Deployment Summary" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Server: $LightsailIP" -ForegroundColor White
Write-Host "API URL: https://api.accuratrials.com" -ForegroundColor White
Write-Host "Health: https://api.accuratrials.com/health" -ForegroundColor White
Write-Host ""
Write-Host "To check logs: ssh -i $SSHKeyPath ${LightsailUser}@${LightsailIP} 'pm2 logs libreclinica-api'" -ForegroundColor Gray
Write-Host ""

Pop-Location
