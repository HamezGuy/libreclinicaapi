import dotenv from 'dotenv';

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000'),
    env: process.env.NODE_ENV || 'development',
    apiVersion: process.env.API_VERSION || 'v1'
  },
  
  libreclinica: {
    // LibreClinica Docker container - use existing instance on 8080
    soapUrl: process.env.LIBRECLINICA_SOAP_URL || 'http://localhost:8080/LibreClinica/ws',
    soapUsername: process.env.SOAP_USERNAME || 'root',
    soapPassword: process.env.SOAP_PASSWORD || 'root',
    database: {
      host: process.env.LIBRECLINICA_DB_HOST || 'localhost',
      // LibreClinica Docker database on port 5432
      port: parseInt(process.env.LIBRECLINICA_DB_PORT || '5432'),
      database: process.env.LIBRECLINICA_DB_NAME || 'libreclinica',
      user: process.env.LIBRECLINICA_DB_USER || 'clinica',
      password: process.env.LIBRECLINICA_DB_PASSWORD || 'clinica',
      max: parseInt(process.env.LIBRECLINICA_DB_MAX_CONNECTIONS || '20'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    }
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },
  
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || ''
  },
  
  part11: {
    passwordExpiryDays: parseInt(process.env.PASSWORD_EXPIRY_DAYS || '90'),
    passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '12'),
    passwordRequireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE !== 'false',
    passwordRequireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE !== 'false',
    passwordRequireNumber: process.env.PASSWORD_REQUIRE_NUMBER !== 'false',
    passwordRequireSpecial: process.env.PASSWORD_REQUIRE_SPECIAL !== 'false',
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5'),
    accountLockoutDurationMinutes: parseInt(process.env.ACCOUNT_LOCKOUT_DURATION_MINUTES || '30'),
    sessionTimeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES || '30'),
    requireMfa: process.env.REQUIRE_MFA === 'true',
    auditLogRetentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '2555')
  },
  
  security: {
    httpsOnly: process.env.HTTPS_ONLY === 'true',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(o => o),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100')
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    filePath: process.env.LOG_FILE_PATH || './logs'
  }
};

