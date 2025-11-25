@echo off
REM ============================================================================
REM LibreClinica Test Database Setup
REM Creates a Docker PostgreSQL instance with the REAL LibreClinica schema
REM ============================================================================

echo.
echo ========================================
echo LibreClinica Test Database Setup
echo ========================================
echo.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running!
    echo.
    echo Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

echo [1/4] Stopping existing test database...
docker stop libreclinica-test-db >nul 2>&1
docker rm libreclinica-test-db >nul 2>&1

echo [2/4] Starting PostgreSQL container...
docker run -d ^
  --name libreclinica-test-db ^
  -e POSTGRES_PASSWORD=clinica ^
  -e POSTGRES_USER=clinica ^
  -e POSTGRES_DB=libreclinica_test ^
  -p 5433:5432 ^
  postgres:14

if errorlevel 1 (
    echo [ERROR] Failed to start Docker container!
    pause
    exit /b 1
)

echo [3/4] Waiting for PostgreSQL to be ready...
timeout /t 5 /nobreak >nul

REM Wait for PostgreSQL to accept connections
:wait_loop
docker exec libreclinica-test-db pg_isready -U clinica >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_loop
)

echo [4/4] Loading LibreClinica schema...
docker exec -i libreclinica-test-db psql -U clinica -d libreclinica_test < schema\libreclinica-schema.sql

if errorlevel 1 (
    echo [ERROR] Failed to load schema!
    pause
    exit /b 1
)

echo.
echo ========================================
echo SUCCESS! Test database is ready!
echo ========================================
echo.
echo Connection details:
echo   Host: localhost
echo   Port: 5433
echo   Database: libreclinica_test
echo   User: clinica
echo   Password: clinica
echo.
echo You can now run: npm test
echo.
echo To stop the database: docker stop libreclinica-test-db
echo To remove the database: docker rm libreclinica-test-db
echo.
