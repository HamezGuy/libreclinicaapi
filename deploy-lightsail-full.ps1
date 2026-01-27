# Deploy LibreClinica Stack to AWS Lightsail
# This script deploys PostgreSQL, LibreClinica Core, and LibreClinica API
# and creates all database tables for new features

param(
    [string]$LightsailIP = "18.225.57.5",
    [string]$LightsailUser = "ubuntu",
    [string]$SSHKeyPath = "..\lightsail.pem"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  EDC Full Stack Deployment to Lightsail" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Resolve SSH key path
$SSHKeyFullPath = Resolve-Path $SSHKeyPath -ErrorAction SilentlyContinue
if (-not $SSHKeyFullPath) {
    $SSHKeyFullPath = Join-Path $PSScriptRoot "..\lightsail.pem"
}

Write-Host "SSH Key: $SSHKeyFullPath" -ForegroundColor Yellow
Write-Host "Target: $LightsailUser@$LightsailIP" -ForegroundColor Yellow
Write-Host ""

# Check if SSH key exists
if (-not (Test-Path $SSHKeyFullPath)) {
    Write-Host "ERROR: SSH key not found at $SSHKeyFullPath" -ForegroundColor Red
    exit 1
}

# Create temp directory for deployment files
$TempDir = Join-Path $env:TEMP "edc-deploy-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

Write-Host "Step 1: Preparing deployment files..." -ForegroundColor Green

# Copy production deployment files
$ProductionDir = Join-Path $PSScriptRoot "production-deployment"
Copy-Item -Path "$ProductionDir\*" -Destination $TempDir -Recurse -Force

# Copy migrations
$MigrationsDir = Join-Path $PSScriptRoot "migrations"
$MigrationsDest = Join-Path $TempDir "migrations"
New-Item -ItemType Directory -Path $MigrationsDest -Force | Out-Null
Copy-Item -Path "$MigrationsDir\*.sql" -Destination $MigrationsDest -Force

# Create combined migrations file
$CombinedMigrations = Join-Path $TempDir "all_migrations.sql"
$MigrationContent = @"
-- Combined Migrations for AccuraTrials EDC
-- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
-- This file creates all tables for new features

-- Start transaction
BEGIN;

"@

# Add each migration file in order
$MigrationFiles = @(
    "20241215_email_notifications.sql",
    "20241215_subject_transfer.sql",
    "20241215_double_data_entry.sql",
    "20241215_econsent.sql",
    "20241215_epro_patient_portal.sql",
    "20241215_rtsm_irt.sql"
)

foreach ($file in $MigrationFiles) {
    $filePath = Join-Path $MigrationsDir $file
    if (Test-Path $filePath) {
        Write-Host "  Adding migration: $file" -ForegroundColor Gray
        $content = Get-Content $filePath -Raw
        # Remove BEGIN/COMMIT from individual files since we wrap them
        $content = $content -replace "(?m)^BEGIN;\s*$", "-- (BEGIN from $file)"
        $content = $content -replace "(?m)^COMMIT;\s*$", "-- (COMMIT from $file)"
        $MigrationContent += "`n-- ============================================`n"
        $MigrationContent += "-- Migration: $file`n"
        $MigrationContent += "-- ============================================`n"
        $MigrationContent += $content
    }
}

$MigrationContent += @"

-- Commit all migrations
COMMIT;

-- Verify tables created
SELECT 'Email Templates' as feature, count(*) as tables FROM information_schema.tables WHERE table_name LIKE 'acc_email%';
SELECT 'Subject Transfer' as feature, count(*) as tables FROM information_schema.tables WHERE table_name = 'acc_transfer_log';
SELECT 'Double Data Entry' as feature, count(*) as tables FROM information_schema.tables WHERE table_name LIKE 'acc_dde%';
SELECT 'eConsent' as feature, count(*) as tables FROM information_schema.tables WHERE table_name LIKE 'acc_consent%';
SELECT 'ePRO' as feature, count(*) as tables FROM information_schema.tables WHERE table_name LIKE 'acc_pro%' OR table_name = 'acc_patient_account';
SELECT 'RTSM/IRT' as feature, count(*) as tables FROM information_schema.tables WHERE table_name LIKE 'acc_kit%' OR table_name LIKE 'acc_shipment%' OR table_name LIKE 'acc_inventory%' OR table_name LIKE 'acc_temperature%';
"@

Set-Content -Path $CombinedMigrations -Value $MigrationContent -Encoding UTF8

# Create the deployment script that will run on the server
$ServerScript = @'
#!/bin/bash
set -e

echo "=========================================="
echo "  Server-side Deployment Script"
echo "=========================================="

# Configuration
APP_DIR="/home/ubuntu/edc-app"
DOCKER_COMPOSE_FILE="docker-compose.yml"

cd $APP_DIR

echo ""
echo "Step 1: Stopping existing containers..."
docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true

echo ""
echo "Step 2: Starting PostgreSQL first..."
docker compose up -d postgres 2>/dev/null || docker-compose up -d postgres 2>/dev/null

echo "Waiting for PostgreSQL to be ready..."
sleep 15

# Wait for PostgreSQL to be healthy
for i in {1..30}; do
    if docker exec libreclinica_db pg_isready -U libreclinica -d libreclinica > /dev/null 2>&1; then
        echo "PostgreSQL is ready!"
        break
    fi
    echo "Waiting for PostgreSQL... ($i/30)"
    sleep 2
done

echo ""
echo "Step 3: Running database migrations..."
docker cp all_migrations.sql libreclinica_db:/tmp/all_migrations.sql
docker exec libreclinica_db psql -U libreclinica -d libreclinica -f /tmp/all_migrations.sql

echo ""
echo "Step 4: Starting LibreClinica Core..."
docker compose up -d core 2>/dev/null || docker-compose up -d core 2>/dev/null

echo "Waiting for LibreClinica Core to start (this may take 2-3 minutes)..."
sleep 30

# Wait for core to be healthy
for i in {1..60}; do
    if curl -sf http://localhost:8080/libreclinica/pages/login/login > /dev/null 2>&1; then
        echo "LibreClinica Core is ready!"
        break
    fi
    echo "Waiting for LibreClinica Core... ($i/60)"
    sleep 5
done

echo ""
echo "Step 5: Starting LibreClinica API..."
docker compose up -d api 2>/dev/null || docker-compose up -d api 2>/dev/null

sleep 10

echo ""
echo "Step 6: Starting Nginx..."
docker compose up -d nginx 2>/dev/null || docker-compose up -d nginx 2>/dev/null

sleep 5

echo ""
echo "Step 7: Starting Certbot..."
docker compose up -d certbot 2>/dev/null || docker-compose up -d certbot 2>/dev/null

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
echo "Services Status:"
docker compose ps 2>/dev/null || docker-compose ps 2>/dev/null

echo ""
echo "Checking API health..."
curl -sf http://localhost:3000/api/health || echo "API not responding yet (may need more time)"

echo ""
echo "Checking database tables..."
docker exec libreclinica_db psql -U libreclinica -d libreclinica -c "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'acc_%' ORDER BY table_name;"

echo ""
echo "Done!"
'@

$ServerScriptPath = Join-Path $TempDir "deploy-server.sh"
Set-Content -Path $ServerScriptPath -Value $ServerScript -Encoding UTF8 -NoNewline

Write-Host "Step 2: Creating deployment archive..." -ForegroundColor Green

# Create archive of API source (excluding node_modules)
$ApiSourceDir = $PSScriptRoot
$ApiArchive = Join-Path $TempDir "libreclinica-api.tar.gz"

# Use tar to create archive (via WSL or Git Bash)
Push-Location $ApiSourceDir
try {
    # Try using tar directly (Windows 10+ has tar)
    $excludes = "--exclude=node_modules --exclude=coverage --exclude=logs --exclude=.git --exclude=*.tar.gz"
    $tarCmd = "tar $excludes -czf `"$ApiArchive`" ."
    Invoke-Expression $tarCmd
} catch {
    Write-Host "Warning: Could not create tar archive. Will copy files directly." -ForegroundColor Yellow
}
Pop-Location

Write-Host "Step 3: Uploading files to Lightsail..." -ForegroundColor Green

# Upload files using SCP
$ScpOptions = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

# Create remote directory
$SshCmd = "ssh -i `"$SSHKeyFullPath`" $ScpOptions $LightsailUser@$LightsailIP"
Invoke-Expression "$SshCmd `"mkdir -p /home/ubuntu/edc-app`""

# Upload docker-compose and nginx configs
$FilesToUpload = @(
    "docker-compose.yml",
    "nginx.conf",
    "nginx-init.conf",
    "nginx-prod.conf",
    "all_migrations.sql",
    "deploy-server.sh"
)

foreach ($file in $FilesToUpload) {
    $filePath = Join-Path $TempDir $file
    if (Test-Path $filePath) {
        Write-Host "  Uploading $file..." -ForegroundColor Gray
        $ScpCmd = "scp -i `"$SSHKeyFullPath`" $ScpOptions `"$filePath`" $LightsailUser@$LightsailIP:/home/ubuntu/edc-app/"
        Invoke-Expression $ScpCmd
    }
}

# Upload API archive if it exists
if (Test-Path $ApiArchive) {
    Write-Host "  Uploading API archive..." -ForegroundColor Gray
    $ScpCmd = "scp -i `"$SSHKeyFullPath`" $ScpOptions `"$ApiArchive`" $LightsailUser@$LightsailIP:/home/ubuntu/edc-app/"
    Invoke-Expression $ScpCmd
}

Write-Host "Step 4: Running deployment on server..." -ForegroundColor Green

# Make script executable and run it
$DeployCommands = @"
cd /home/ubuntu/edc-app
chmod +x deploy-server.sh
./deploy-server.sh
"@

Invoke-Expression "$SshCmd `"$DeployCommands`""

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  DEPLOYMENT COMPLETE!" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Access Points:" -ForegroundColor Yellow
Write-Host "  API Health: http://$LightsailIP/api/health" -ForegroundColor White
Write-Host "  LibreClinica: http://$LightsailIP/LibreClinica" -ForegroundColor White
Write-Host ""
Write-Host "SSH Access:" -ForegroundColor Yellow
Write-Host "  ssh -i `"$SSHKeyFullPath`" $LightsailUser@$LightsailIP" -ForegroundColor White
Write-Host ""

# Cleanup temp directory
Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Deployment script finished." -ForegroundColor Green
