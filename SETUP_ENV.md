# Environment Setup for LibreClinica API

## Step 1: Create .env File

Create a `.env` file in the `libreclinica-api` directory with the following content:

```env
# LibreClinica REST API Configuration
NODE_ENV=development
PORT=3000

# Database Connection
LIBRECLINICA_DB_HOST=localhost
LIBRECLINICA_DB_PORT=5432
LIBRECLINICA_DB_NAME=libreclinica
LIBRECLINICA_DB_USER=clinica
LIBRECLINICA_DB_PASSWORD=clinica
LIBRECLINICA_DB_SSL=false
LIBRECLINICA_DB_MAX_CONNECTIONS=20

# SOAP Web Services
LIBRECLINICA_SOAP_URL=http://localhost:8080/LibreClinica/ws
SOAP_USERNAME=root
SOAP_PASSWORD=root
LIBRECLINICA_SOAP_TIMEOUT=30000

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

## Step 2: Verify LibreClinica is Running

Make sure LibreClinica Docker container is running:

```powershell
cd D:\EDC-Projects\LibreClinica-Setup\LibreClinica
docker compose up -d
```

Check if it's accessible:
- Web UI: http://localhost:8080/LibreClinica
- Database: localhost:5432
- SOAP API: http://localhost:8080/LibreClinica/ws

## Step 3: Start the API Server

```powershell
cd D:\EDC-Projects\libreclinica-api
npm run dev
```

The API will be available at: http://localhost:3000

## Step 4: Test the API

Health check:
```bash
curl http://localhost:3000/health
```

Login test:
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"root\",\"password\":\"root\"}"
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

