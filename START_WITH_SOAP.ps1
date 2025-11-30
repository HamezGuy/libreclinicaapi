# ============================================================================
# LibreClinica API - Start with SOAP Enabled
# ============================================================================
# This script starts the API with SOAP integration enabled.
#
# IMPORTANT: LibreClinica Docker must be running first:
#   cd libreclinica-api
#   docker-compose -f docker-compose.libreclinica.yml up -d
#
# SOAP is used for:
# - Subject enrollment (GxP compliant validation)
# - Form data import/export (ODM format)
# - Audit trail recording (21 CFR Part 11)
# - Electronic signatures
# ============================================================================

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  LibreClinica API with SOAP Integration  " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Check Docker containers
Write-Host "`nChecking Docker containers..." -ForegroundColor Yellow
$containers = docker ps --format "{{.Names}}" 2>$null

if ($containers -notmatch "libreclinica-postgres") {
    Write-Host "✗ PostgreSQL not running! Start Docker first:" -ForegroundColor Red
    Write-Host "  docker-compose -f docker-compose.libreclinica.yml up -d" -ForegroundColor Yellow
    exit 1
}
Write-Host "✓ PostgreSQL running" -ForegroundColor Green

if ($containers -notmatch "libreclinica-test-app") {
    Write-Host "✗ LibreClinica not running! Start Docker first:" -ForegroundColor Red
    Write-Host "  docker-compose -f docker-compose.libreclinica.yml up -d" -ForegroundColor Yellow
    exit 1
}
Write-Host "✓ LibreClinica running" -ForegroundColor Green

# Test SOAP endpoint
# NOTE: The SOAP services are in the libreclinica-ws webapp, NOT libreclinica
$soapUrl = "http://localhost:8090/libreclinica-ws/ws"
Write-Host "`nTesting SOAP endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$soapUrl/studySubject/v1" -Method POST -ContentType "text/xml" -Body "<test/>" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
} catch {
    # 500 error with "No Security Header" means SOAP is working (just needs auth)
    if ($_.Exception.Message -match "500|Security") {
        Write-Host "✓ SOAP endpoint responding (requires authentication)" -ForegroundColor Green
        $soapAvailable = $true
    } else {
        Write-Host "⚠ SOAP endpoint returned: $($_.Exception.Message)" -ForegroundColor Yellow
        $soapAvailable = $false
    }
}

# Database Configuration (Docker maps 5434:5432)
$env:LIBRECLINICA_DB_HOST = "localhost"
$env:LIBRECLINICA_DB_PORT = "5434"
$env:LIBRECLINICA_DB_NAME = "libreclinica"
$env:LIBRECLINICA_DB_USER = "libreclinica"
$env:LIBRECLINICA_DB_PASSWORD = "libreclinica"

# SOAP Configuration - ENABLED
# IMPORTANT: SOAP is at /libreclinica-ws/ws NOT /libreclinica/ws
$env:LIBRECLINICA_SOAP_URL = "http://localhost:8090/libreclinica-ws/ws"
$env:SOAP_USERNAME = "root"
$env:SOAP_PASSWORD = "root"
$env:DISABLE_SOAP = "false"  # Enable SOAP

# Server Configuration
$env:PORT = "3001"
$env:NODE_ENV = "development"

# JWT Configuration
$env:JWT_SECRET = "your-super-secret-jwt-key-change-in-production"
$env:JWT_EXPIRES_IN = "1h"
$env:JWT_REFRESH_EXPIRES_IN = "7d"

# 21 CFR Part 11 Configuration
$env:PASSWORD_EXPIRY_DAYS = "90"
$env:PASSWORD_MIN_LENGTH = "12"
$env:MAX_LOGIN_ATTEMPTS = "5"
$env:ACCOUNT_LOCKOUT_DURATION_MINUTES = "30"
$env:SESSION_TIMEOUT_MINUTES = "30"

Write-Host "`nConfiguration:" -ForegroundColor Cyan
Write-Host "  Database: localhost:5434/libreclinica" -ForegroundColor White
Write-Host "  SOAP URL: $($env:LIBRECLINICA_SOAP_URL)" -ForegroundColor White
Write-Host "  SOAP Enabled: true" -ForegroundColor Green
Write-Host "  Port: $($env:PORT)" -ForegroundColor White

Write-Host "`nStarting LibreClinica API with SOAP..." -ForegroundColor Yellow
Write-Host "API will be available at: http://localhost:3001" -ForegroundColor Green

# Navigate to project directory
Set-Location $PSScriptRoot

# Start the server
npx ts-node src/server.ts
