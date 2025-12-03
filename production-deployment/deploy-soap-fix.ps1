# =============================================================================
# Deploy LibreClinica SOAP Fix to AWS Lightsail
# =============================================================================
# This script uploads the fixed WAR file and updated docker-compose to your
# Lightsail servers and restarts the containers.
#
# PREREQUISITES:
# 1. SSH key for your Lightsail instances (download from Lightsail console)
# 2. Both servers should be running Ubuntu with Docker installed
#
# USAGE:
#   .\deploy-soap-fix.ps1
#
# Or to specify a single server:
#   .\deploy-soap-fix.ps1 -Server1Only
#   .\deploy-soap-fix.ps1 -Server2Only
# =============================================================================

param(
    [switch]$Server1Only,
    [switch]$Server2Only
)

# =============================================================================
# CONFIGURATION - UPDATE THESE VALUES
# =============================================================================

# Server 1 (api.accuratrials.com)
$SERVER1_IP = "YOUR_LIGHTSAIL_1_IP"     # <-- Replace with actual IP
$SERVER1_USER = "ubuntu"                 # Default Lightsail user
$SERVER1_KEY = "$HOME\.ssh\LightsailDefaultKey-us-east-1.pem"  # Update path to your key

# Server 2 (second Lightsail instance)
$SERVER2_IP = "YOUR_LIGHTSAIL_2_IP"     # <-- Replace with actual IP  
$SERVER2_USER = "ubuntu"
$SERVER2_KEY = "$HOME\.ssh\LightsailDefaultKey-us-east-1.pem"  # Update path to your key

# Files to upload
$WAR_FILE = "..\..\..\libreclinica-fix\LibreClinica-soap-fixed.war"
$DOCKER_COMPOSE = ".\docker-compose.yml"
$NGINX_PROD = ".\nginx-prod.conf"

# Remote destination
$REMOTE_PATH = "/home/ubuntu/production-deployment"

# =============================================================================
# FUNCTIONS
# =============================================================================

function Test-SshKey {
    param([string]$KeyPath)
    if (-not (Test-Path $KeyPath)) {
        Write-Host "ERROR: SSH key not found at $KeyPath" -ForegroundColor Red
        Write-Host "Download your Lightsail default key from:" -ForegroundColor Yellow
        Write-Host "  AWS Console -> Lightsail -> Account -> SSH Keys" -ForegroundColor Yellow
        return $false
    }
    return $true
}

function Deploy-ToServer {
    param(
        [string]$ServerIP,
        [string]$User,
        [string]$KeyPath,
        [string]$ServerName
    )
    
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host " Deploying to $ServerName ($ServerIP)" -ForegroundColor Cyan
    Write-Host "=============================================" -ForegroundColor Cyan
    
    if (-not (Test-SshKey $KeyPath)) {
        return $false
    }

    $sshTarget = "$User@$ServerIP"
    $scpOpts = "-o StrictHostKeyChecking=no -i `"$KeyPath`""
    
    # Step 1: Create remote directory
    Write-Host "[1/5] Creating remote directory..." -ForegroundColor Yellow
    ssh -o StrictHostKeyChecking=no -i "$KeyPath" $sshTarget "mkdir -p $REMOTE_PATH"
    
    # Step 2: Upload the fixed WAR file
    Write-Host "[2/5] Uploading LibreClinica-soap-fixed.war (this may take a minute)..." -ForegroundColor Yellow
    scp -o StrictHostKeyChecking=no -i "$KeyPath" "$WAR_FILE" "${sshTarget}:${REMOTE_PATH}/LibreClinica-soap-fixed.war"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to upload WAR file" -ForegroundColor Red
        return $false
    }
    Write-Host "  WAR file uploaded successfully!" -ForegroundColor Green
    
    # Step 3: Upload docker-compose.yml
    Write-Host "[3/5] Uploading docker-compose.yml..." -ForegroundColor Yellow
    scp -o StrictHostKeyChecking=no -i "$KeyPath" "$DOCKER_COMPOSE" "${sshTarget}:${REMOTE_PATH}/docker-compose.yml"
    
    # Step 4: Upload nginx config
    Write-Host "[4/5] Uploading nginx-prod.conf..." -ForegroundColor Yellow
    scp -o StrictHostKeyChecking=no -i "$KeyPath" "$NGINX_PROD" "${sshTarget}:${REMOTE_PATH}/nginx.conf"
    
    # Step 5: Restart containers
    Write-Host "[5/5] Restarting Docker containers..." -ForegroundColor Yellow
    ssh -o StrictHostKeyChecking=no -i "$KeyPath" $sshTarget @"
cd $REMOTE_PATH
echo 'Stopping containers...'
docker compose down
echo 'Starting containers with new WAR...'
docker compose up -d
echo 'Waiting for LibreClinica to start (this takes ~2 minutes)...'
sleep 30
echo 'Checking container status...'
docker compose ps
echo ''
echo 'Checking SOAP endpoints...'
curl -sf http://localhost:8080/libreclinica/ws/studySubject/v1?wsdl | head -5 || echo 'SOAP not ready yet - may need more time to initialize'
"@
    
    Write-Host ""
    Write-Host "Deployment to $ServerName complete!" -ForegroundColor Green
    return $true
}

# =============================================================================
# MAIN SCRIPT
# =============================================================================

Write-Host ""
Write-Host "========================================================" -ForegroundColor Magenta
Write-Host " LibreClinica SOAP Fix Deployment Script" -ForegroundColor Magenta  
Write-Host "========================================================" -ForegroundColor Magenta
Write-Host ""

# Check if WAR file exists
if (-not (Test-Path $WAR_FILE)) {
    Write-Host "ERROR: WAR file not found at $WAR_FILE" -ForegroundColor Red
    Write-Host "Make sure LibreClinica-soap-fixed.war exists in libreclinica-fix folder" -ForegroundColor Yellow
    exit 1
}

$warSize = (Get-Item $WAR_FILE).Length / 1MB
Write-Host "Found WAR file: $WAR_FILE ($([math]::Round($warSize, 2)) MB)" -ForegroundColor Green

# Check configuration
if ($SERVER1_IP -eq "YOUR_LIGHTSAIL_1_IP" -or $SERVER2_IP -eq "YOUR_LIGHTSAIL_2_IP") {
    Write-Host ""
    Write-Host "WARNING: You need to configure the server IPs!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Edit this script and update:" -ForegroundColor Cyan
    Write-Host '  $SERVER1_IP = "YOUR_LIGHTSAIL_1_IP"  -> Your first Lightsail IP'
    Write-Host '  $SERVER2_IP = "YOUR_LIGHTSAIL_2_IP"  -> Your second Lightsail IP'
    Write-Host '  $SERVER1_KEY = "path\to\key.pem"    -> Path to your SSH key'
    Write-Host ""
    Write-Host "Get your Static IPs from AWS Lightsail Console" -ForegroundColor Yellow
    exit 1
}

# Deploy based on flags
$success = $true

if (-not $Server2Only) {
    $result = Deploy-ToServer -ServerIP $SERVER1_IP -User $SERVER1_USER -KeyPath $SERVER1_KEY -ServerName "Server 1 (api.accuratrials.com)"
    $success = $success -and $result
}

if (-not $Server1Only) {
    $result = Deploy-ToServer -ServerIP $SERVER2_IP -User $SERVER2_USER -KeyPath $SERVER2_KEY -ServerName "Server 2"
    $success = $success -and $result
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Magenta

if ($success) {
    Write-Host " DEPLOYMENT COMPLETE!" -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Wait 2-3 minutes for LibreClinica to fully start"
    Write-Host "2. Test SOAP endpoints:"
    Write-Host "   https://api.accuratrials.com/libreclinica/ws/studySubject/v1?wsdl"
    Write-Host ""
    Write-Host "3. Test from your Angular frontend - SOAP auth should now work!"
} else {
    Write-Host " DEPLOYMENT HAD ERRORS - Check output above" -ForegroundColor Red
    Write-Host "========================================================" -ForegroundColor Magenta
}

