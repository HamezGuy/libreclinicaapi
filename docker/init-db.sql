-- LibreClinica Database Initialization Script
-- Creates additional user for API tests

-- Create clinica user for unit test database (separate from production)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'clinica') THEN
    CREATE USER clinica WITH PASSWORD 'clinica';
  END IF;
END
$$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE libreclinica TO clinica;
