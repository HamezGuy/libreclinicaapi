# ============================================================================
# LibreClinica API - Local Development Startup
# ============================================================================
# This script starts the API in database-only mode for local development.
# 
# IMPORTANT: LibreClinica Docker containers must be running first:
#   docker-compose -f docker-compose.libreclinica.yml up -d
#
# Access Points:
# - API:         http://localhost:3001
# - LibreClinica: http://localhost:8090/libreclinica/
# - Database:    localhost:5434 (libreclinica/libreclinica)
# ============================================================================

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  LibreClinica API - Local Development     " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Check if Docker containers are running
Write-Host "`nChecking Docker containers..." -ForegroundColor Yellow
$containers = docker ps --format "{{.Names}}" 2>$null
if ($containers -match "libreclinica-postgres") {
    Write-Host "✓ PostgreSQL database is running" -ForegroundColor Green
} else {
    Write-Host "✗ PostgreSQL database is not running!" -ForegroundColor Red
    Write-Host "  Run: docker-compose -f docker-compose.libreclinica.yml up -d" -ForegroundColor Yellow
    exit 1
}

if ($containers -match "libreclinica-test-app") {
    Write-Host "✓ LibreClinica web app is running" -ForegroundColor Green
} else {
    Write-Host "⚠ LibreClinica web app is not running (optional for API)" -ForegroundColor Yellow
}

# Check LibreClinica web UI accessibility
$libreClinicaUrl = "http://localhost:8090/libreclinica/pages/login/login"
try {
    $response = Invoke-WebRequest -Uri $libreClinicaUrl -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    Write-Host "✓ LibreClinica web UI accessible at http://localhost:8090/libreclinica/" -ForegroundColor Green
} catch {
    Write-Host "⚠ LibreClinica web UI not accessible (API will still work)" -ForegroundColor Yellow
}

# Database Configuration (Docker maps 5434:5432)
$env:LIBRECLINICA_DB_HOST = "localhost"
$env:LIBRECLINICA_DB_PORT = "5434"
$env:LIBRECLINICA_DB_NAME = "libreclinica"
$env:LIBRECLINICA_DB_USER = "libreclinica"
$env:LIBRECLINICA_DB_PASSWORD = "libreclinica"

# SOAP Configuration - DISABLED for local development
# (SOAP services have classloader issues in the Docker image)
$env:LIBRECLINICA_SOAP_URL = "http://localhost:8090/libreclinica/ws"
$env:SOAP_USERNAME = "root"
$env:SOAP_PASSWORD = "root"
$env:DISABLE_SOAP = "true"  # Disable SOAP, use database mode

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
Write-Host "  SOAP: Disabled (database-only mode)" -ForegroundColor Yellow
Write-Host "  Port: $($env:PORT)" -ForegroundColor White
Write-Host "  Mode: Development" -ForegroundColor White

Write-Host "`nStarting LibreClinica API..." -ForegroundColor Yellow
Write-Host "API will be available at: http://localhost:3001" -ForegroundColor Green
Write-Host "`nPress Ctrl+C to stop the server" -ForegroundColor Gray

# Navigate to project directory
Set-Location $PSScriptRoot

# Start the server
npx ts-node src/server.ts
