# Environment Setup for LibreClinica API

## Step 1: Create .env File

Create a `.env` file in the `libreclinica-api` directory with the following content:

```env
# LibreClinica REST API Configuration
NODE_ENV=development
PORT=3001

# Database Connection (Docker maps 5434:5432)
LIBRECLINICA_DB_HOST=localhost
LIBRECLINICA_DB_PORT=5434
LIBRECLINICA_DB_NAME=libreclinica
LIBRECLINICA_DB_USER=libreclinica
LIBRECLINICA_DB_PASSWORD=libreclinica
LIBRECLINICA_DB_SSL=false
LIBRECLINICA_DB_MAX_CONNECTIONS=20

# SOAP Web Services (Docker runs LibreClinica on port 8090)
# IMPORTANT: Password must be MD5 HASH for WS-Security!
# Default password "12345678" -> MD5 hash below
LIBRECLINICA_SOAP_URL=http://localhost:8090/libreclinica-ws/ws
SOAP_USERNAME=root
SOAP_PASSWORD=25d55ad283aa400af464c76d713c07ad
LIBRECLINICA_SOAP_TIMEOUT=30000
DISABLE_SOAP=false

# JWT Authentication
JWT_SECRET=libreclinica-super-secret-jwt-key-change-in-production-32chars
JWT_ACCESS_TOKEN_EXPIRY=30m
JWT_REFRESH_TOKEN_EXPIRY=7d
JWT_ISSUER=libreclinica-api
JWT_AUDIENCE=libreclinica-frontend

# Security
PASSWORD_MIN_LENGTH=12
MAX_LOGIN_ATTEMPTS=5
ACCOUNT_LOCKOUT_DURATION_MINUTES=30
SESSION_TIMEOUT_MINUTES=30

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX_REQUESTS=5

# CORS
CORS_ORIGINS=http://localhost:4200,http://localhost:4300
CORS_CREDENTIALS=true

# Logging
LOG_LEVEL=debug
LOG_TO_FILE=true
LOG_TO_CONSOLE=true
AUDIT_LOG_ENABLED=true
```

## Step 2: Verify LibreClinica Docker is Running

Start the LibreClinica Docker containers with the patched SOAP WAR:

```powershell
cd D:\EDC-Projects\libreclinica-api
docker-compose -f docker-compose.libreclinica.yml up -d
```

Check if it's accessible:
- Web UI: http://localhost:8090/libreclinica/
- Database: localhost:5434 (user: libreclinica, pass: libreclinica)
- SOAP API: http://localhost:8090/libreclinica-ws/ws/studySubject/v1?wsdl

**IMPORTANT**: The default Docker image has BROKEN SOAP! 
The docker-compose.libreclinica.yml mounts a patched WAR file from `libreclinica-fix/`.

## Step 3: Start the API Server

Using PowerShell (recommended - sets all environment variables):
```powershell
cd D:\EDC-Projects\libreclinica-api
.\START_LOCAL.ps1
```

Or using npm (requires .env file):
```powershell
cd D:\EDC-Projects\libreclinica-api
npm run dev
```

The API will be available at: http://localhost:3001

## Step 4: Test the API

Health check:
```bash
curl http://localhost:3001/health
```

API health with SOAP status:
```bash
curl http://localhost:3001/api/health
```

Login test (use MD5 hash of password):
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"root\",\"password\":\"12345678\"}"
```

SOAP status check:
```bash
curl http://localhost:3001/api/soap/status
```

## Step 5: Start the Angular Frontend

```powershell
cd D:\EDC-Projects\ElectronicDataCaptureReal
npm start
```

The frontend will be available at: http://localhost:4200

## Troubleshooting

### Database Connection Issues
- Verify LibreClinica Docker is running
- Check PostgreSQL is accessible: `psql -h localhost -U clinica -d libreclinica`
- Verify credentials in .env match Docker compose settings

### SOAP API Issues
- Verify LibreClinica web app is running at http://localhost:8080/LibreClinica
- Check SOAP endpoints are available
- Verify SOAP username/password in .env

### Port Conflicts
- API (3000): Make sure no other service is using port 3000
- Frontend (4200): Make sure no other Angular app is running
- Database (5432): Check PostgreSQL port
- LibreClinica (8080): Check Tomcat port

