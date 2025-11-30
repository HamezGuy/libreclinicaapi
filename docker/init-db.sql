-- LibreClinica Database Initialization Script
-- Creates additional user for API access

-- Create clinica user for API tests (libreclinica is already created as POSTGRES_USER)
CREATE USER clinica WITH PASSWORD 'clinica';

-- Grant all privileges on the database to both users
GRANT ALL PRIVILEGES ON DATABASE libreclinica TO clinica;

-- Make users superusers for initial setup
ALTER USER libreclinica WITH SUPERUSER;
ALTER USER clinica WITH SUPERUSER;
