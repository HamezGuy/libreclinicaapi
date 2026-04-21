import dotenv from 'dotenv';

dotenv.config();

export const config = {
  server: {
    // Port configuration:
    // - Local development: 3000 (default)
    // - Web deployments: 3001 (set PORT=3001 in environment)
    port: parseInt(process.env.PORT || '3000'),
    env: process.env.NODE_ENV || 'development',
    apiVersion: process.env.API_VERSION || 'v1'
  },
  
  // Demo mode - allows any credentials to login (for testing/demos)
  demoMode: process.env.DEMO_MODE === 'true',
  
  libreclinica: {
    // ==========================================================================
    // LibreClinica Integration Configuration
    // ==========================================================================
    // 
    // ARCHITECTURE: This API acts as an intermediary between the Angular frontend
    // and LibreClinica. We use LibreClinica's established channels:
    //
    // 1. SOAP Services (PRIMARY for GxP compliance):
    //    - Study Subject management
    //    - Event scheduling
    //    - Data import/export
    //    URL: http://localhost:8090/libreclinica-ws/ws/{service}/v1
    //
    // 2. Direct Database (for operations not exposed via SOAP):
    //    - User authentication (LibreClinica's user_account table)
    //    - Study metadata queries
    //    - Audit log access
    //    - Discrepancy notes/workflows
    //
    // DATABASE: We connect to the SAME database that LibreClinica uses.
    // There is only ONE production database - the one created by the 
    // LibreClinica Tomcat application. Port 5434 maps to this database.
    // (Port 5433 is ONLY for isolated unit tests - not used in production)
    // ==========================================================================
    
    // SOAP Configuration
    soapUrl: process.env.LIBRECLINICA_SOAP_URL || 'http://localhost:8090/libreclinica-ws/ws',
    soapUsername: process.env.SOAP_USERNAME || 'root',
    // IMPORTANT: Password must be MD5 hash for WS-Security!
    // Default "12345678" -> MD5: "25d55ad283aa400af464c76d713c07ad"
    soapPassword: process.env.SOAP_PASSWORD || '25d55ad283aa400af464c76d713c07ad',
    // Enable SOAP by default for GxP compliance (set DISABLE_SOAP=true to use direct DB only)
    soapEnabled: process.env.DISABLE_SOAP !== 'true',
    
    // Database Configuration - connects to LibreClinica's PostgreSQL database
    database: {
      host: process.env.LIBRECLINICA_DB_HOST || 'localhost',
      // Port 5432 = unified docker-compose (edc-postgres container)
      // Port 5434 = standalone API docker-compose (libreclinica-postgres container)
      // Port 5433 = Test database for unit tests only (api-test-db container) - DO NOT USE IN PROD
      port: parseInt(process.env.LIBRECLINICA_DB_PORT || '5432'),
      database: process.env.LIBRECLINICA_DB_NAME || 'libreclinica',
      user: process.env.LIBRECLINICA_DB_USER || 'postgres',
      password: process.env.LIBRECLINICA_DB_PASSWORD || 'password',
      max: parseInt(process.env.LIBRECLINICA_DB_MAX_CONNECTIONS || '20'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: parseInt(process.env.LIBRECLINICA_DB_CONNECTION_TIMEOUT || '10000'),
      // 21 CFR Part 11 §11.10(a) - SSL/TLS for data in transit
      ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
        ca: process.env.DB_SSL_CA || undefined,
        cert: process.env.DB_SSL_CERT || undefined,
        key: process.env.DB_SSL_KEY || undefined
      } : false
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
  },
  
  woundScanner: {
    appDomain: process.env.WOUND_SCANNER_APP_DOMAIN || 'yourapp.com',
    urlScheme: process.env.WOUND_SCANNER_URL_SCHEME || 'woundscanner',
    captureTokenExpiry: process.env.CAPTURE_TOKEN_EXPIRY || '15m',
    s3Bucket: process.env.WOUND_IMAGES_S3_BUCKET || '',
    s3Region: process.env.WOUND_IMAGES_S3_REGION || 'us-east-1',
    enableAuditChain: process.env.WOUND_ENABLE_AUDIT_CHAIN !== 'false'
  },
  
  // 21 CFR Part 11 §11.10(a) - Data-at-Rest Encryption
  encryption: {
    // Master encryption key - MUST be set in production!
    // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    masterKey: process.env.ENCRYPTION_MASTER_KEY || 'change-me-in-production',
    // Salt for key derivation - should be unique per deployment
    salt: process.env.ENCRYPTION_SALT || 'libreclinica-default-salt-change-me',
    // Enable field-level encryption for PHI/PII
    enableFieldEncryption: process.env.ENABLE_FIELD_ENCRYPTION === 'true',
    // List of tables to encrypt (comma-separated)
    encryptedTables: (process.env.ENCRYPTED_TABLES || 'item_data,study_subject').split(',')
  },

  /**
   * AI Validation-Rule Compiler — POST /api/validation-rules/compile
   *
   * Architecture:
   *   - Frontend sends a plain-English description + the CRF's field
   *     catalogue. Backend runs the description through an LLM with
   *     constrained JSON output, then 4 deterministic gates
   *     (registry preference, schema validation, re2 sandbox, self-test
   *     loop) before returning structured rule suggestions.
   *   - Suggestions are NEVER auto-saved. The frontend modal lets the
   *     user accept each one through the existing saveRule() flow,
   *     which pops the e-signature modal.
   *
   * Kill-switch: AI_COMPILER_ENABLED=false returns 503 from /compile.
   * Provider switch: AI_COMPILER_PROVIDER ∈ { openai | gemini | mock }.
   *   - 'mock' is the same shape as the frontend MockRuleSuggestionProvider;
   *     useful for local dev / failover / running the test suite without
   *     burning tokens.
   * Defaults below are SAFE: feature off, mock provider, no API key.
   */
  ai: {
    enabled: process.env.AI_COMPILER_ENABLED === 'true',
    provider: (process.env.AI_COMPILER_PROVIDER || 'mock') as 'openai' | 'gemini' | 'mock',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-2024-11-20',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
    // Keep determinism high for rule generation; we want reproducibility.
    temperature: parseFloat(process.env.AI_COMPILER_TEMPERATURE || '0'),
    // Per-request hard ceilings. The orchestrator returns 400 / strips
    // anything outside these to keep token cost and abuse predictable.
    timeoutMs: parseInt(process.env.AI_COMPILER_TIMEOUT_MS || '60000'),
    maxFields: parseInt(process.env.AI_COMPILER_MAX_FIELDS || '500'),
    maxDescriptionChars: parseInt(process.env.AI_COMPILER_MAX_DESCRIPTION_CHARS || '8000'),
    maxRulesHardCap: parseInt(process.env.AI_COMPILER_MAX_RULES_HARD_CAP || '20'),
  }
};

