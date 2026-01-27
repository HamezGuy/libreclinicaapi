# ============================================
# LibreClinica API - Demo Setup and Test Runner
# ============================================
# This script:
# 1. Sets up the demo database with all required reference data
# 2. Starts the API server (if not running)
# 3. Runs the complete workflow integration test
# ============================================

param(
    [switch]$SkipDbSetup,
    [switch]$SkipServerStart,
    [string]$Port = "3001",
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

Write-Host "`n" -NoNewline
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "  LibreClinica API - Demo Setup and Test Runner" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan

# ============================================
# STEP 1: Check Docker container
# ============================================
Write-Host "`n[1/4] Checking Docker database container..." -ForegroundColor Yellow

$container = docker ps --filter "name=api-test-db" --format "{{.Names}}" 2>$null
if (-not $container) {
    Write-Host "  Database container not running. Starting..." -ForegroundColor Gray
    
    # Check if docker-compose exists
    $composeFile = Join-Path $ProjectDir "docker-compose.test.yml"
    if (Test-Path $composeFile) {
        Push-Location $ProjectDir
        docker-compose -f docker-compose.test.yml up -d
        Pop-Location
        Start-Sleep -Seconds 5
    } else {
        Write-Host "  ERROR: docker-compose.test.yml not found!" -ForegroundColor Red
        Write-Host "  Please start the database manually." -ForegroundColor Red
        exit 1
    }
}
Write-Host "  Database container: OK" -ForegroundColor Green

# ============================================
# STEP 2: Setup demo database
# ============================================
if (-not $SkipDbSetup) {
    Write-Host "`n[2/4] Setting up demo database with reference data..." -ForegroundColor Yellow
    
    $sqlFile = Join-Path $ScriptDir "setup-demo-database.sql"
    if (Test-Path $sqlFile) {
        Get-Content $sqlFile | docker exec -i api-test-db psql -U clinica -d libreclinica_test 2>&1 | Out-Null
        Write-Host "  Database setup: OK" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: setup-demo-database.sql not found!" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n[2/4] Skipping database setup (--SkipDbSetup)" -ForegroundColor Gray
}

# ============================================
# STEP 3: Start API server
# ============================================
if (-not $SkipServerStart) {
    Write-Host "`n[3/4] Checking API server..." -ForegroundColor Yellow
    
    # Check if server is already running
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
        Write-Host "  API server already running on port $Port" -ForegroundColor Green
    } catch {
        Write-Host "  Starting API server..." -ForegroundColor Gray
        
        # Set environment variables
        $env:LIBRECLINICA_DB_HOST = "localhost"
        $env:LIBRECLINICA_DB_PORT = "5433"
        $env:LIBRECLINICA_DB_NAME = "libreclinica_test"
        $env:LIBRECLINICA_DB_USER = "clinica"
        $env:LIBRECLINICA_DB_PASSWORD = "clinica"
        $env:DISABLE_SOAP = "true"
        $env:DEMO_MODE = "true"
        $env:PORT = $Port
        
        # Start server in background
        Push-Location $ProjectDir
        Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WindowStyle Hidden
        Pop-Location
        
        # Wait for server to start
        Write-Host "  Waiting for server to start..." -ForegroundColor Gray
        $maxAttempts = 30
        $attempt = 0
        while ($attempt -lt $maxAttempts) {
            Start-Sleep -Seconds 1
            try {
                $response = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
                Write-Host "  API server started: OK" -ForegroundColor Green
                break
            } catch {
                $attempt++
                Write-Host "." -NoNewline
            }
        }
        
        if ($attempt -ge $maxAttempts) {
            Write-Host ""
            Write-Host "  ERROR: API server failed to start!" -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host "`n[3/4] Skipping server start (--SkipServerStart)" -ForegroundColor Gray
}

# ============================================
# STEP 4: Run integration tests
# ============================================
Write-Host "`n[4/4] Running integration tests..." -ForegroundColor Yellow

$testScript = Join-Path $ScriptDir "test-complete-workflow.ps1"
if (Test-Path $testScript) {
    $testArgs = @("-BaseUrl", "http://localhost:$Port/api")
    if ($Verbose) {
        $testArgs += "-Verbose"
    }
    
    & $testScript @testArgs
} else {
    Write-Host "  ERROR: test-complete-workflow.ps1 not found!" -ForegroundColor Red
    exit 1
}

Write-Host "`n" -NoNewline
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "  Demo test runner completed!" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""

