# Backup & Recovery System Configuration

## 21 CFR Part 11 & HIPAA Compliant Backup System

This document describes the configuration for the backup, recovery, retention, and regulatory export system.

## Environment Variables

### Local Backup Configuration

```bash
# Directory for local backup storage
BACKUP_DIR=./backups

# Docker container name for PostgreSQL
BACKUP_CONTAINER=libreclinica-postgres

# Enable backup of IAM database
BACKUP_IAM_DATABASE=true
IAM_DB_NAME=edc_iam_db
IAM_DB_USER=libreclinica
IAM_DB_HOST=localhost
IAM_DB_PORT=5432
```

### Encryption Configuration (HIPAA §164.312(a)(2)(iv))

```bash
# Enable encryption for backup files
BACKUP_ENCRYPTION_ENABLED=true

# Encryption key source: 'env', 'aws-kms', 'azure-keyvault'
BACKUP_ENCRYPTION_KEY_SOURCE=env

# 256-bit encryption key (64 hex characters)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
BACKUP_ENCRYPTION_KEY=<your_64_character_hex_key>

# Key identifier for audit tracking
BACKUP_ENCRYPTION_KEY_ID=primary-backup-key-v1

# Delete unencrypted files after encryption
DELETE_UNENCRYPTED_BACKUPS=true
```

### Cloud Storage Configuration (HIPAA §164.308(a)(7)(ii)(A))

```bash
# Cloud provider: 'aws-s3', 'azure-blob', 'gcp-storage', 'local'
CLOUD_STORAGE_PROVIDER=aws-s3

# AWS S3 Configuration
AWS_S3_BUCKET=your-edc-backups-bucket
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key

# S3 storage class: STANDARD, STANDARD_IA, GLACIER, DEEP_ARCHIVE
S3_STORAGE_CLASS=STANDARD

# Cross-region replication
S3_REPLICATION_ENABLED=true
S3_REPLICATION_REGION=us-west-2
S3_REPLICATION_BUCKET=your-edc-backups-dr-bucket
```

## API Endpoints

### Backup Endpoints (`/api/backup`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/status` | Get backup system status |
| GET | `/config` | Get backup configuration |
| GET | `/list` | List all backups |
| GET | `/:backupId` | Get specific backup details |
| POST | `/trigger` | Trigger manual backup |
| POST | `/scheduler/start` | Start automated scheduler |
| POST | `/scheduler/stop` | Stop automated scheduler |
| POST | `/cleanup` | Run retention cleanup |
| POST | `/:backupId/verify` | Verify backup integrity |
| POST | `/:backupId/restore` | Restore from backup |

### Retention Endpoints (`/api/retention`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/policies` | List retention policies |
| GET | `/policies/:name` | Get specific policy |
| POST | `/policies` | Create/update policy |
| GET | `/legal-holds` | List legal holds |
| POST | `/legal-holds` | Create legal hold |
| POST | `/legal-holds/:id/release` | Release legal hold |
| POST | `/cleanup` | Run automated cleanup |
| POST | `/verify/:backupId` | Verify backup integrity |
| GET | `/statistics` | Get retention statistics |
| GET | `/encryption-status` | Get encryption status |
| GET | `/cloud-status` | Get cloud storage status |

### Regulatory Export Endpoints (`/api/regulatory-export`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/create` | Create export package |
| GET | `/list` | List all exports |
| GET | `/:exportId` | Get export details |
| GET | `/download/:exportId` | Download export file |
| POST | `/:exportId/certify` | Add certification |

## Database Migration

Run the migration to create the required tables:

```bash
# Connect to PostgreSQL and run:
psql -U libreclinica -d libreclinica -f migrations/20250120_backup_retention_catalog.sql
```

This creates:
- `backup_jobs` - Tracks backup operations
- `backup_files` - Tracks individual backup files
- `retention_policies` - Configurable retention policies
- `legal_holds` - Litigation/regulatory holds
- `regulatory_exports` - Export package tracking
- `backup_verification_log` - Verification audit log

## Compliance References

- **21 CFR Part 11 §11.10(c)**: Protection of records
- **21 CFR Part 11 §11.10(e)**: Audit trail
- **HIPAA §164.308(a)(7)(ii)(A)**: Data backup plan
- **HIPAA §164.312(a)(2)(iv)**: Encryption and decryption
- **HIPAA §164.312(b)**: Audit controls
- **HIPAA §164.530(j)**: Retention periods
- **ICH E6(R2)**: Record retention (15 years)

## Quick Start

1. Set environment variables in `.env`
2. Run database migration
3. Start the API
4. Call `POST /api/backup/scheduler/start` to enable automated backups
5. Configure retention policies via `POST /api/retention/policies`
