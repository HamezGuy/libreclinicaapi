# 21 CFR Part 11 Compliance Guide

## Overview

This document describes the 21 CFR Part 11 compliance features implemented in the LibreClinica API, focusing on the SQL fallback mechanism when SOAP services are unavailable.

## Compliance Summary

| Requirement | Section | Status | Implementation |
|------------|---------|--------|----------------|
| Audit Trails | §11.10(e) | ✅ Compliant | `audit_log_event` table with SHA-256 hash chain |
| Time Stamps | §11.10(k) | ✅ Compliant | UTC ISO 8601 timestamps |
| Electronic Signatures | §11.50 | ✅ **FULLY COMPLIANT** | All data modifications require e-signature |
| Password Controls | §11.300 | ✅ Compliant | Min length, expiry, lockout, bcrypt upgrade |
| Access Controls | §11.10(d) | ✅ Compliant | Role-based + User ID in all operations |
| Data Integrity | §11.10(a) | ✅ Compliant | SHA-256 hash chain for tamper detection |
| Data in Transit | §11.10(a) | ✅ Configurable | SSL/TLS for PostgreSQL |
| Data at Rest | §11.10(a) | ✅ Implemented | AES-256-GCM field encryption + volume encryption |

---

## Audit Trail Implementation (§11.10(e))

### Features

1. **Who** - User ID recorded for every action
2. **What** - Action type (create, update, delete, view)
3. **When** - UTC timestamp in ISO 8601 format
4. **Old Value** - Previous state before change
5. **New Value** - New state after change
6. **Reason for Change** - Optional justification field
7. **Hash Chain** - Cryptographic SHA-256 chain for tamper detection

### Hash Chain Integrity

Each audit record includes:
- `integrityHash`: SHA-256 hash of the current record + previous hash
- `previousHash`: Hash of the immediately preceding record

This creates an unbreakable chain where any modification is detectable.

### Verification

```typescript
import { verifyAuditChainIntegrity } from './middleware/part11.middleware';

// Verify audit integrity for study subjects
const result = await verifyAuditChainIntegrity('study_subject', 1000);

if (!result.verified) {
  console.error('AUDIT TAMPERING DETECTED!', result.violations);
}
```

---

## Electronic Signatures (§11.50)

### Requirements Met

1. **Unique to Individual** - Password tied to user account
2. **Linked to Record** - Signature associated with specific entity
3. **Meaning Captured** - `signatureMeaning` field records intent
4. **Non-repudiation** - IP address and timestamp recorded

### Usage

```typescript
import { requireSignatureFor, SignatureMeanings } from './middleware/part11.middleware';

// Require e-signature with specific meaning
router.post('/save-form', 
  requireSignatureFor(SignatureMeanings.FORM_DATA_SAVE),
  async (req, res) => {
    // Action proceeds only if signature verified
  }
);
```

### Operations Requiring Electronic Signature

All data modifications now require electronic signature per §11.50:

| Category | Operation | Signature Meaning |
|----------|-----------|-------------------|
| **Forms** | Save data | "I attest that this data entry is accurate and complete" |
| | Update data | "I authorize this change to existing data" |
| | Create template | "I authorize the creation of this case report form" |
| | Delete template | "I authorize the removal of this form template" |
| **Studies** | Create | "I authorize the creation of this clinical study" |
| | Update | "I authorize modifications to this study configuration" |
| | Delete | "I authorize the removal of this study" |
| **Subjects** | Enroll | "I confirm this subject meets enrollment criteria" |
| | Update | "I authorize modifications to subject information" |
| | Withdraw | "I authorize withdrawal of this subject from the study" |
| **Events** | Create | "I authorize the creation of this study event definition" |
| | Schedule | "I confirm scheduling of this study event" |
| | Assign CRF | "I authorize assignment of this form to the study event" |
| **Queries** | Create | "I am raising this data query for resolution" |
| | Respond | "I am providing this response to the query" |
| | Close | "I confirm this query is resolved and authorize closure" |
| **SDV** | Verify | "I verify the accuracy of this information" |
| | Unverify | "I authorize removal of SDV verification" |
| **Data Locks** | Lock | "I authorize locking this form from further edits" |
| | Unlock | "I authorize unlocking this form for editing" |
| **Randomization** | Randomize | "I confirm this subject meets randomization criteria" |
| | Unblind | "I authorize unblinding of treatment assignment" |
| **Consent** | Record | "I confirm informed consent has been obtained" |
| | Withdraw | "I confirm withdrawal of consent for this subject" |
| | Activate version | "I authorize activation of this consent document version" |
| **Validation Rules** | Create/Update/Delete | "I authorize this change to validation rules" |

### Frontend Implementation

The frontend must prompt for password when `requiresSignature: true` is returned:

```typescript
async function saveFormData(data: FormData) {
  const response = await api.post('/forms/save', data);
  
  if (response.requiresSignature) {
    // Show password dialog with signature meaning
    const password = await showSignatureDialog(response.signatureMeaning);
    
    // Retry with password
    return api.post('/forms/save', { ...data, password });
  }
  
  return response;
}
```

---

## Password Controls (§11.300)

### Configuration

Set via environment variables:

```env
PASSWORD_MIN_LENGTH=12
PASSWORD_REQUIRE_UPPERCASE=true
PASSWORD_REQUIRE_LOWERCASE=true
PASSWORD_REQUIRE_NUMBER=true
PASSWORD_REQUIRE_SPECIAL=true
PASSWORD_EXPIRY_DAYS=90
MAX_LOGIN_ATTEMPTS=5
ACCOUNT_LOCKOUT_DURATION_MINUTES=30
```

### Features

- Minimum password length enforcement
- Character complexity requirements
- Password expiration tracking
- Account lockout after failed attempts
- Progressive lockout durations

---

## Data Encryption

### In Transit (SSL/TLS)

Configure SSL for database connections:

```env
# Enable SSL for PostgreSQL
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true

# Optional: Custom certificates
DB_SSL_CA=/path/to/ca.crt
DB_SSL_CERT=/path/to/client.crt
DB_SSL_KEY=/path/to/client.key
```

### At Rest (Application Level - AES-256-GCM)

Field-level encryption is available for sensitive PHI/PII data:

```env
# Enable field-level encryption
ENABLE_FIELD_ENCRYPTION=true

# Master encryption key (MUST change in production!)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ENCRYPTION_MASTER_KEY=your-secure-key-here

# Salt for key derivation (unique per deployment)
ENCRYPTION_SALT=your-unique-salt-here
```

**Features:**
- AES-256-GCM authenticated encryption
- Unique IV per encryption operation
- Automatic encryption on form data save
- Transparent decryption on data retrieval
- Hash chain for tamper detection

### At Rest (Infrastructure Level)

Additionally, volume-level encryption should be configured:

#### PostgreSQL Options

1. **Transparent Data Encryption (TDE)**
   - PostgreSQL Enterprise or pgcrypto extension
   - Encrypts data files on disk

2. **Volume-Level Encryption**
   - AWS EBS encryption
   - Azure Disk Encryption
   - LUKS for on-premises

3. **Column-Level Encryption**
   - Use pgcrypto for sensitive columns
   - Example: `SELECT pgp_sym_encrypt(data, 'key')`

#### Recommended Setup (AWS)

```yaml
# AWS RDS PostgreSQL with encryption
Resources:
  Database:
    Type: AWS::RDS::DBInstance
    Properties:
      StorageEncrypted: true
      KmsKeyId: !Ref EncryptionKey
      Engine: postgres
      # Enable SSL connections
      EnableCloudwatchLogsExports:
        - postgresql
```

#### Recommended Setup (Azure)

```yaml
# Azure Database for PostgreSQL
resource "azurerm_postgresql_flexible_server" "db" {
  storage_mb                   = 32768
  ssl_enforcement_enabled      = true
  infrastructure_encryption_enabled = true
}
```

---

## SOAP vs SQL Fallback

### Primary: SOAP Services

SOAP is the preferred method for GxP compliance because:
- Built-in audit trail in LibreClinica core
- Validated transaction handling
- Standard ODM format

### Fallback: Direct SQL

When SOAP is unavailable, direct SQL is used with:
- ✅ All audit trail fields populated
- ✅ Hash chain integrity maintained
- ✅ Same timestamp precision
- ✅ User ID attribution
- ✅ Old/new value tracking

### SOAP Priority

```
Request → Try SOAP → Success? → Use SOAP result
                  ↓ Failure
             SQL Fallback with full audit
```

---

## Validation Checklist

### Before Production

- [ ] SSL/TLS enabled for all database connections
- [ ] Password policy configured per organizational SOP
- [ ] Audit log retention period set (default: 7 years)
- [ ] Volume/disk encryption enabled
- [ ] Backup encryption enabled
- [ ] Run audit chain verification on schedule

### Regular Maintenance

```bash
# Weekly audit chain verification
npm run verify-audit-chain

# Monthly compliance report
npm run generate-part11-report
```

---

## Compliance Implementation Details

### 1. Data-at-Rest Encryption ✅ IMPLEMENTED

**Implementation**: 
- Field-level: AES-256-GCM encryption for sensitive form data
- Infrastructure: Volume encryption (AWS EBS, Azure Disk, or LUKS)

**Configuration**:
```env
ENABLE_FIELD_ENCRYPTION=true
ENCRYPTION_MASTER_KEY=<your-secure-key>
ENCRYPTION_SALT=<your-unique-salt>
```

**Encrypted Fields**:
- Form data values (item_data.value)
- Subject identifiers (when configured)
- Audit log sensitive data

### 2. MD5 Password Compatibility ✅ MITIGATED

**Legacy Constraint**: LibreClinica SOAP WS-Security requires MD5 password hashes.

**Mitigation Implemented**:
1. ✅ **Dual-Hash Storage**: Passwords stored as both MD5 (for SOAP) and bcrypt (for API)
2. ✅ **Automatic Upgrade**: On login, MD5 passwords transparently upgrade to bcrypt
3. ✅ **Extended User Table**: `user_account_extended` stores secure bcrypt hashes
4. ✅ **Strong Password Policy**: Compensates for MD5 weakness with complexity requirements
5. ✅ **Account Lockout**: Prevents brute-force attacks against MD5 hashes

**Password Hash Migration Flow**:
```
User Login → Verify against bcrypt (if available) → Success
           ↓ No bcrypt hash
           Verify against MD5 → Success → Upgrade to bcrypt
           ↓                            ↓
           Store bcrypt in user_account_extended
```

**Database Schema Extension**:
```sql
CREATE TABLE user_account_extended (
  user_id INTEGER PRIMARY KEY REFERENCES user_account(user_id),
  bcrypt_passwd VARCHAR(255),        -- Secure bcrypt hash
  passwd_upgraded_at TIMESTAMP,       -- When upgraded from MD5
  password_version INTEGER DEFAULT 2  -- 1=MD5 only, 2=bcrypt
);
```

---

## References

- [FDA 21 CFR Part 11](https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfcfr/CFRSearch.cfm?CFRPart=11)
- [FDA Guidance for Industry: Part 11 Scope and Application](https://www.fda.gov/media/75414/download)
- [LibreClinica Documentation](https://github.com/libreclinica/libreclinica)

