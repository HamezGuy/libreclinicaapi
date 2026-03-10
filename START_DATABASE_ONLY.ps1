# ============================================================================
# LibreClinica API - Start with Database Only (No SOAP)
# ============================================================================
# This script starts the API with SOAP disabled.
# Uses direct PostgreSQL database access for all operations.
#
# Use this mode when:
# - LibreClinica is not running
# - You want faster local development
# - SOAP services are not needed
# ============================================================================

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  LibreClinica API - Database Only Mode   " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

Write-Host "`n⚠️  SOAP is DISABLED in this mode" -ForegroundColor Yellow
Write-Host "   All operations use direct database access" -ForegroundColor Yellow

# Database Configuration (Docker maps 5434:5432)
$env:LIBRECLINICA_DB_HOST = "localhost"
$env:LIBRECLINICA_DB_PORT = "5434"
$env:LIBRECLINICA_DB_NAME = "libreclinica"
$env:LIBRECLINICA_DB_USER = "clinica"
$env:LIBRECLINICA_DB_PASSWORD = "clinica"

# SOAP Configuration - DISABLED (use database only)
$env:DISABLE_SOAP = "true"
$env:LIBRECLINICA_SOAP_URL = "http://localhost:8090/LibreClinica/ws"

# Server Configuration
$env:PORT = "3001"
$env:NODE_ENV = "development"

# JWT Configuration
if (-not $env:JWT_SECRET) {
    $env:JWT_SECRET = [System.Guid]::NewGuid().ToString() + "-" + [System.Guid]::NewGuid().ToString()
    Write-Host "⚠ JWT_SECRET not set — generated random secret for this session" -ForegroundColor Yellow
    Write-Host "  Set JWT_SECRET environment variable for persistent sessions" -ForegroundColor Yellow
}
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
Write-Host "  SOAP: DISABLED" -ForegroundColor Red
Write-Host "  Port: $($env:PORT)" -ForegroundColor White

Write-Host "`nStarting LibreClinica API..." -ForegroundColor Yellow

# Navigate to project directory
Set-Location $PSScriptRoot

# Start the server
npx ts-node src/server.ts

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  API Server Stopped" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

