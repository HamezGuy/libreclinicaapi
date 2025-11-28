#!/bin/bash

# LibreClinica API - Database Migration Script
# Runs all pending migrations

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🗄️  Running Database Migrations...${NC}\n"

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
elif [ -f .env.production ]; then
    export $(cat .env.production | grep -v '^#' | xargs)
fi

# Database connection settings
DB_HOST=${LIBRECLINICA_DB_HOST:-localhost}
DB_PORT=${LIBRECLINICA_DB_PORT:-5432}
DB_NAME=${LIBRECLINICA_DB_NAME:-libreclinica}
DB_USER=${LIBRECLINICA_DB_USER:-clinica}

# Migrations directory
MIGRATIONS_DIR="$(dirname "$0")/../migrations"

# Check if migrations directory exists
if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo -e "${YELLOW}⚠${NC} No migrations directory found at $MIGRATIONS_DIR"
    exit 0
fi

# Run each migration file
for migration in "$MIGRATIONS_DIR"/*.sql; do
    if [ -f "$migration" ]; then
        MIGRATION_NAME=$(basename "$migration")
        echo -e "${YELLOW}Running migration: $MIGRATION_NAME${NC}"
        
        PGPASSWORD=$LIBRECLINICA_DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$migration" 2>&1 || {
            echo -e "${RED}✗ Migration failed: $MIGRATION_NAME${NC}"
            exit 1
        }
        
        echo -e "${GREEN}✓ Completed: $MIGRATION_NAME${NC}\n"
    fi
done

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ All migrations completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}\n"

