# LibreClinica Native REST API Endpoints

## Overview

LibreClinica Core (port 8080) already provides its own REST APIs. Our API layer (port 3001) should:
1. **Proxy** to LibreClinica native APIs where appropriate
2. **Extend** with features LibreClinica doesn't provide
3. **NOT duplicate** functionality that LibreClinica already handles

## LibreClinica Native REST Endpoints

Based on the LibreClinica source code analysis:

### 1. Metadata API (`/rest/metadata`)
```
GET /rest/metadata/xml/view/{studyOID}           - Get study metadata as ODM XML
GET /rest/metadata/json/view/{studyOID}          - Get study metadata as JSON
GET /rest/metadata/html/print/{studyOID}/{eventOID}/{formVersionOID}  - Print form HTML
GET /rest/metadata/pdf/print/{studyOID}/{eventOID}/{formVersionOID}   - Generate form PDF
```

### 2. Clinical Data API (`/rest/clinicaldata`)
```
GET /rest/clinicaldata/json/view/{studyOID}/{subjectId}/{eventOID}/{formVersionOID}  - Get form data as JSON
GET /rest/clinicaldata/xml/view/{studyOID}/{subjectId}/{eventOID}/{formVersionOID}   - Get form data as ODM XML
GET /rest/clinicaldata/html/print/{studyOID}/{subjectId}/{eventOID}/{formVersionOID} - Print form with data
```

### 3. OpenRosa API (`/rest/openrosa`) - ODK Compatible
```
GET  /rest/openrosa/{studyOID}/formList         - List available forms
GET  /rest/openrosa/{studyOID}/manifest         - Form manifest
GET  /rest/openrosa/{studyOID}/formXml          - Get form XML definition
GET  /rest/openrosa/{studyOID}/downloadMedia    - Download media files
POST /rest/openrosa/{studyOID}/submission       - Submit form data
GET  /rest/openrosa/{studyOID}/getSchedule      - Get study schedule
```

### 4. System API (`/auth/api/v1/system`)
```
POST /auth/api/v1/system/systemstatus           - Get system status
GET  /auth/api/v1/system/config                 - Get system configuration
```

### 5. User API (`/userinfo`)
```
GET /userinfo/study/{studyOid}/crc              - Get CRC user info
```

### 6. SOAP Web Services (`/ws/*`)
```
/ws/studySubject/v1  - Subject enrollment
/ws/study/v1         - Study metadata
/ws/event/v1         - Event management
/ws/crf/v1           - CRF data import
```

## What Our API Should Do

### PROXY to LibreClinica (Don't Duplicate)

| Our Endpoint | Should Proxy To | Why |
|--------------|-----------------|-----|
| `GET /api/studies/:id/metadata` | `GET /rest/metadata/json/view/{studyOID}` | LibreClinica already provides this |
| `GET /api/forms/:id/print` | `GET /rest/metadata/pdf/print/...` | LibreClinica generates PDFs natively |
| `GET /api/forms/:id/data` | `GET /rest/clinicaldata/json/view/...` | Native data extraction |

### EXTEND LibreClinica (Our Added Value)

| Our Endpoint | What We Add |
|--------------|-------------|
| `POST /api/auth/login` | JWT authentication layer |
| `GET /api/dashboard/*` | Aggregated statistics, charts |
| `GET /api/audit/*` | Combined audit view (login + data) |
| `POST /api/wounds/*` | WoundScanner iOS integration |
| `POST /api/ai/*` | AI features |
| `GET /api/sdv/*` | Enhanced SDV workflow |
| `GET /api/queries/*` | Enhanced query management |

### Database Direct (Faster Queries)

| Our Endpoint | Why Direct DB |
|--------------|---------------|
| `GET /api/subjects` | Faster than SOAP for listing |
| `GET /api/dashboard/stats` | Complex aggregations |
| `GET /api/audit/recent` | Combined table queries |

## Implementation Strategy

### Option 1: Proxy Routes (Recommended)

Create proxy routes that forward to LibreClinica's native APIs:

```typescript
// routes/proxy.routes.ts
router.get('/studies/:studyOid/metadata', async (req, res) => {
  const libreClinicaUrl = `${LIBRECLINICA_BASE}/rest/metadata/json/view/${req.params.studyOid}`;
  const response = await axios.get(libreClinicaUrl, { headers: getAuthHeaders() });
  res.json(response.data);
});
```

### Option 2: Direct Database (Current Approach)

Keep using direct database access for reads, but understand that:
- We're bypassing LibreClinica's business logic
- We must ensure schema compatibility
- Audit trail is handled separately

## Audit Trail Correction

### CORRECT Audit Tables

| Table | Purpose | Columns |
|-------|---------|---------|
| `audit_user_login` | Login/logout tracking | id, user_name, user_account_id, audit_date, login_attempt_date, **login_status**, details, version |
| `audit_log_event` | Data changes | audit_id, audit_date, audit_table, user_id, entity_id, entity_name, old_value, new_value, **audit_log_event_type_id**, reason_for_change, study_id, event_crf_id, study_event_id |
| `audit_log_event_type` | Event type lookup | audit_log_event_type_id, name |

### Login Status Values
- `0` = Failed login
- `1` = Successful login
- `2` = Logout

## Summary

| Responsibility | Handler |
|---------------|---------|
| Study metadata | LibreClinica REST API (`/rest/metadata`) |
| Clinical data | LibreClinica REST API (`/rest/clinicaldata`) |
| Form submissions | LibreClinica SOAP (`/ws/crf/v1`) or OpenRosa API |
| Subject enrollment | LibreClinica SOAP (`/ws/studySubject/v1`) |
| Authentication | Our API (JWT) |
| Dashboard aggregation | Our API (Database) |
| Audit trail queries | Our API (Combined tables) |
| WoundScanner | Our API (Extended feature) |
| AI features | Our API (Extended feature) |

