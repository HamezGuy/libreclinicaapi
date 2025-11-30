# SOAP vs REST API Architecture

## Part 11 Compliance Strategy

**Key Principle**: Use SOAP for all compliant operations, REST API only wraps SOAP calls.

---

## Available LibreClinica SOAP Operations (9 Total)

| # | Service | Operation | WSDL Element | Status |
|---|---------|-----------|--------------|--------|
| 1 | `study` | List All Studies | `listAllRequest` | ✅ Implemented |
| 2 | `study` | Get Study Metadata | `getMetadataRequest` | ✅ Implemented |
| 3 | `studySubject` | Create Subject | `createRequest` | ✅ Implemented |
| 4 | `studySubject` | Check Subject Exists | `isStudySubjectRequest` | ✅ Implemented |
| 5 | `studySubject` | List Subjects | `listAllByStudyRequest` | ✅ Implemented |
| 6 | `event` | Schedule Event | `scheduleRequest` | ✅ Implemented |
| 7 | `data` | Import Data (ODM) | `importRequest` | ✅ Implemented |
| 8 | `studyEventDefinition` | List Definitions | `listAllRequest` | ❌ Not implemented |
| 9 | `crf` | Image Repository | N/A | ❌ Not implemented |

---

## Responsibility Matrix

### ✅ SOAP-ONLY Operations (Part 11 Compliant)

These operations MUST go through SOAP for compliance:

| Operation | REST Endpoint | SOAP Service | SOAP Method | Notes |
|-----------|---------------|--------------|-------------|-------|
| **List Studies** | `GET /api/studies` | `study` | `listAll` | Official source |
| **Get Study Metadata** | `GET /api/studies/:id/metadata` | `study` | `getMetadata` | ODM format |
| **Create Subject** | `POST /api/subjects` | `studySubject` | `create` | Validated enrollment |
| **Check Subject Exists** | Internal | `studySubject` | `isStudySubject` | Pre-validation |
| **List Subjects** | `GET /api/subjects` | `studySubject` | `listAllByStudy` | Official source |
| **Schedule Event** | `POST /api/events/schedule` | `event` | `schedule` | With audit trail |
| **Save CRF Data** | `POST /api/forms/save` | `data` | `import` | ODM with e-sig |

### ⚠️ DATABASE-ONLY Operations (No SOAP Alternative)

These operations have NO SOAP support, use direct database:

| Operation | REST Endpoint | Why No SOAP |
|-----------|---------------|-------------|
| Authentication | `POST /api/auth/*` | No SOAP auth service |
| User Management | `GET/POST /api/users/*` | No SOAP user service |
| Queries/DNs | `GET/POST /api/queries/*` | No SOAP query service |
| SDV | `GET/PUT /api/sdv/*` | No SOAP SDV service |
| Data Locks | `GET/POST /api/data-locks/*` | No SOAP lock service |
| Randomization | `GET/POST /api/randomization/*` | No SOAP randomization |
| Dashboard Stats | `GET /api/dashboard/*` | Aggregations only |
| Audit Log Query | `GET /api/audit/*` | Read-only |

### 🔄 HYBRID Operations (SOAP Primary + DB Enrichment)

These use SOAP as primary source, DB for statistics enrichment:

| Operation | SOAP Provides | DB Adds |
|-----------|---------------|---------|
| List Studies | Study list, OIDs, status | Enrollment counts, completion % |
| List Subjects | Subject list, labels | Progress tracking, form status |
| Get Subject | Subject data | Events, forms, queries count |

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         REST API Layer                               │
│                   (Express.js - Port 3001)                           │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐
│ SOAP Services │  │ Hybrid Services│  │ Database-Only Services │
│ (Part 11)     │  │ (SOAP + DB)    │  │ (No SOAP alternative)  │
│               │  │                │  │                        │
│ • study       │  │ • study.svc    │  │ • auth.service         │
│ • studySubject│  │ • subject.svc  │  │ • user.service         │
│ • event       │  │ • event.svc    │  │ • query.service        │
│ • data        │  │ • form.svc     │  │ • sdv.service          │
└───────┬───────┘  └───────┬───────┘  │ • dashboard.service    │
        │                  │          │ • audit.service        │
        │                  │          │ • data-locks.service   │
        │                  │          │ • randomization.svc    │
        ▼                  │          └───────────┬────────────┘
┌───────────────┐          │                      │
│ LibreClinica  │          │                      │
│ SOAP Endpoints│◄─────────┘                      │
│ (Port 8090)   │                                 │
└───────┬───────┘                                 │
        │                                         │
        ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     PostgreSQL Database                              │
│                        (Port 5434)                                   │
│                                                                      │
│  Both SOAP operations and direct queries write to the same DB       │
│  SOAP ensures proper validation and audit trails                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Service Implementation Pattern

### SOAP-Primary Service (Recommended)

```typescript
// Hybrid service pattern - SOAP first, DB fallback
export const getStudies = async (userId, filters, username) => {
  // 1. Try SOAP first (Part 11 compliant)
  if (config.libreclinica.soapEnabled && username) {
    try {
      const soapResult = await studySoap.listStudies(userId, username);
      if (soapResult.success) {
        // 2. Enrich with DB stats (enrollment counts, etc.)
        return enrichWithStats(soapResult.data);
      }
    } catch (error) {
      logger.warn('SOAP failed, falling back to DB');
    }
  }
  
  // 3. Fallback to database if SOAP unavailable
  return getFromDatabase(userId, filters);
};
```

---

## Configuration

### Enable SOAP (Production/Compliant Mode)

```bash
LIBRECLINICA_SOAP_URL=http://localhost:8090/libreclinica-ws/ws
SOAP_USERNAME=root
SOAP_PASSWORD=25d55ad283aa400af464c76d713c07ad  # MD5 hash!
DISABLE_SOAP=false
```

### Disable SOAP (Development/Offline Mode)

```bash
DISABLE_SOAP=true
# All operations fall back to direct database access
# WARNING: Not Part 11 compliant!
```

---

## Part 11 Compliance Notes

### What SOAP Provides:
1. **Audit Trails** - All write operations logged in LibreClinica
2. **Validation** - Data validated before persistence
3. **Electronic Signatures** - E-sig support in ODM format
4. **User Attribution** - All changes linked to authenticated user

### What Database-Only Lacks:
1. ❌ No built-in audit for queries/SDV/locks
2. ❌ No validation layer
3. ❌ Must implement audit manually
4. ⚠️ Use only for operations without SOAP alternative

---

## Summary

| Source | Operations Count | Compliance |
|--------|-----------------|------------|
| SOAP Only | 7 operations | ✅ Part 11 Ready |
| Database Only | 8+ services | ⚠️ Manual audit needed |
| Hybrid | 4 services | ✅ SOAP primary |

**Total SOAP Operations Available**: 9 (7 implemented, 2 pending)

**Recommendation**: Always use SOAP when available. The REST API should be a thin wrapper that passes requests to SOAP services.

