/**
 * eConsent Service
 * 
 * Electronic consent management with 21 CFR Part 11 compliance.
 * Integrates with esignature.service.ts for signature verification.
 * 
 * Features:
 * - Consent document and version management
 * - Subject consent capture and tracking
 * - Re-consent workflow
 * - Consent withdrawal
 * - Dashboard and reporting
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import {
  ConsentDocument,
  ConsentDocumentCreate,
  ConsentVersion,
  ConsentVersionCreate,
  SubjectConsent,
  SubjectConsentCreate,
  ReconsentRequest,
  ReconsentRequestCreate,
  ConsentDashboard,
  ConsentContent
} from './consent.types';

// ============================================================================
// Document Management
// ============================================================================

/**
 * Create a new consent document
 */
export async function createConsentDocument(doc: ConsentDocumentCreate): Promise<ConsentDocument> {
  logger.info('Creating consent document', { studyId: doc.studyId, name: doc.name });

  const query = `
    INSERT INTO acc_consent_document (
      study_id, name, description, document_type, language_code,
      status, requires_witness, requires_lar, age_of_majority, 
      min_reading_time, owner_id, date_created, date_updated
    ) VALUES (
      $1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, 
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    RETURNING *
  `;

  const result = await pool.query(query, [
    doc.studyId,
    doc.name,
    doc.description || null,
    doc.documentType || 'main',
    doc.languageCode || 'en',
    doc.requiresWitness || false,
    doc.requiresLAR || false,
    doc.ageOfMajority || 18,
    doc.minReadingTime || 60,
    doc.createdBy
  ]);

  return mapRowToDocument(result.rows[0]);
}

/**
 * Get consent document by ID
 */
export async function getConsentDocument(documentId: number): Promise<ConsentDocument | null> {
  const query = `
    SELECT d.*, 
           CONCAT(u.first_name, ' ', u.last_name) as owner_name
    FROM acc_consent_document d
    LEFT JOIN user_account u ON d.owner_id = u.user_id
    WHERE d.document_id = $1
  `;

  const result = await pool.query(query, [documentId]);
  
  if (result.rows.length === 0) return null;

  const doc = mapRowToDocument(result.rows[0]);
  
  // Get active version if exists
  const activeVersion = await getActiveVersion(documentId);
  if (activeVersion) {
    doc.activeVersion = activeVersion;
  }

  return doc;
}

/**
 * List consent documents for a study
 */
export async function listConsentDocuments(studyId: number): Promise<ConsentDocument[]> {
  const query = `
    SELECT d.*, 
           CONCAT(u.first_name, ' ', u.last_name) as owner_name
    FROM acc_consent_document d
    LEFT JOIN user_account u ON d.owner_id = u.user_id
    WHERE d.study_id = $1
    ORDER BY d.document_type, d.name
  `;

  const result = await pool.query(query, [studyId]);
  return result.rows.map(mapRowToDocument);
}

/**
 * Update consent document
 */
export async function updateConsentDocument(
  documentId: number,
  updates: Partial<ConsentDocumentCreate>
): Promise<ConsentDocument | null> {
  const setClause: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClause.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    setClause.push(`description = $${paramIndex++}`);
    values.push(updates.description);
  }
  if (updates.requiresWitness !== undefined) {
    setClause.push(`requires_witness = $${paramIndex++}`);
    values.push(updates.requiresWitness);
  }
  if (updates.requiresLAR !== undefined) {
    setClause.push(`requires_lar = $${paramIndex++}`);
    values.push(updates.requiresLAR);
  }
  if (updates.minReadingTime !== undefined) {
    setClause.push(`min_reading_time = $${paramIndex++}`);
    values.push(updates.minReadingTime);
  }

  if (setClause.length === 0) {
    return getConsentDocument(documentId);
  }

  setClause.push('date_updated = CURRENT_TIMESTAMP');
  values.push(documentId);

  const query = `
    UPDATE acc_consent_document
    SET ${setClause.join(', ')}
    WHERE document_id = $${paramIndex}
    RETURNING *
  `;

  const result = await pool.query(query, values);
  return result.rows.length > 0 ? mapRowToDocument(result.rows[0]) : null;
}

// ============================================================================
// Version Management
// ============================================================================

/**
 * Create a new consent version
 */
export async function createConsentVersion(version: ConsentVersionCreate): Promise<ConsentVersion> {
  logger.info('Creating consent version', { 
    documentId: version.documentId, 
    versionNumber: version.versionNumber 
  });

  const query = `
    INSERT INTO acc_consent_version (
      document_id, version_number, version_name, content, pdf_template,
      effective_date, expiration_date, irb_approval_date, irb_approval_number,
      change_summary, status, created_by, date_created, date_updated
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    RETURNING *
  `;

  const result = await pool.query(query, [
    version.documentId,
    version.versionNumber,
    version.versionName || null,
    JSON.stringify(version.content),
    version.pdfTemplate || null,
    version.effectiveDate,
    version.expirationDate || null,
    version.irbApprovalDate || null,
    version.irbApprovalNumber || null,
    version.changeSummary || null,
    version.createdBy
  ]);

  return mapRowToVersion(result.rows[0]);
}

/**
 * Get consent version by ID
 */
export async function getConsentVersion(versionId: number): Promise<ConsentVersion | null> {
  const query = `
    SELECT v.*,
           CONCAT(u.first_name, ' ', u.last_name) as approved_by_name
    FROM acc_consent_version v
    LEFT JOIN user_account u ON v.approved_by = u.user_id
    WHERE v.version_id = $1
  `;

  const result = await pool.query(query, [versionId]);
  return result.rows.length > 0 ? mapRowToVersion(result.rows[0]) : null;
}

/**
 * Get active version for a document
 */
export async function getActiveVersion(documentId: number): Promise<ConsentVersion | null> {
  const query = `
    SELECT v.*,
           CONCAT(u.first_name, ' ', u.last_name) as approved_by_name
    FROM acc_consent_version v
    LEFT JOIN user_account u ON v.approved_by = u.user_id
    WHERE v.document_id = $1 
      AND v.status = 'active'
      AND (v.expiration_date IS NULL OR v.expiration_date > CURRENT_DATE)
    ORDER BY v.effective_date DESC
    LIMIT 1
  `;

  const result = await pool.query(query, [documentId]);
  return result.rows.length > 0 ? mapRowToVersion(result.rows[0]) : null;
}

/**
 * List all versions for a consent document
 */
export async function listConsentVersions(documentId: number): Promise<ConsentVersion[]> {
  const query = `
    SELECT v.*,
           CONCAT(u.first_name, ' ', u.last_name) as approved_by_name
    FROM acc_consent_version v
    LEFT JOIN user_account u ON v.approved_by = u.user_id
    WHERE v.document_id = $1
    ORDER BY v.date_created DESC
  `;

  const result = await pool.query(query, [documentId]);
  return result.rows.map(mapRowToVersion);
}

/**
 * Activate a consent version
 */
export async function activateConsentVersion(
  versionId: number,
  userId: number
): Promise<ConsentVersion> {
  logger.info('Activating consent version', { versionId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get version details
    const versionResult = await client.query(
      'SELECT * FROM acc_consent_version WHERE version_id = $1',
      [versionId]
    );

    if (versionResult.rows.length === 0) {
      throw new Error('Version not found');
    }

    const version = versionResult.rows[0];

    // Supersede any current active version
    await client.query(`
      UPDATE acc_consent_version
      SET status = 'superseded', date_updated = CURRENT_TIMESTAMP
      WHERE document_id = $1 AND status = 'active'
    `, [version.document_id]);

    // Activate this version
    await client.query(`
      UPDATE acc_consent_version
      SET status = 'active', 
          approved_by = $1, 
          approved_at = CURRENT_TIMESTAMP,
          date_updated = CURRENT_TIMESTAMP
      WHERE version_id = $2
    `, [userId, versionId]);

    // Update document status
    await client.query(`
      UPDATE acc_consent_document
      SET status = 'active', date_updated = CURRENT_TIMESTAMP
      WHERE document_id = $1
    `, [version.document_id]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change
      ) VALUES (
        CURRENT_TIMESTAMP, 'acc_consent_version', $1, $2, 'Consent Version',
        'draft', 'active',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1),
        'Version activated'
      )
    `, [userId, versionId]);

    await client.query('COMMIT');

    return (await getConsentVersion(versionId))!;
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error activating version', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// Subject Consent
// ============================================================================

/**
 * Record subject consent
 * 
 * version_id is nullable — when no formal consent document/version has been
 * configured for the study, consent can still be recorded with version_id NULL.
 */
export async function recordConsent(consent: SubjectConsentCreate): Promise<SubjectConsent> {
  logger.info('Recording subject consent', { 
    studySubjectId: consent.studySubjectId, 
    versionId: consent.versionId 
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const effectiveVersionId = (consent.versionId && consent.versionId > 0)
      ? consent.versionId
      : null;

    // Insert consent record with full Part 11 metadata
    const query = `
      INSERT INTO acc_subject_consent (
        study_subject_id, version_id, consent_type, consent_status,
        subject_name, subject_signature_data, subject_signed_at,
        subject_ip_address, subject_user_agent,
        witness_name, witness_relationship, witness_signature_data, witness_signed_at,
        lar_name, lar_relationship, lar_signature_data, lar_signed_at, lar_reason,
        presented_at, time_spent_reading, pages_viewed, acknowledgments_checked,
        questions_asked, consented_by,
        scanned_consent_file_ids, is_scanned_consent,
        subject_signature_id, witness_signature_id, lar_signature_id, investigator_signature_id,
        content_hash, device_info, page_view_records, consent_form_data, template_id,
        date_created, date_updated
      ) VALUES (
        $1, $2, $3, 'consented',
        $4, $5, CURRENT_TIMESTAMP, $6, $7,
        $8, $9, $10, CASE WHEN $8 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END,
        $11, $12, $13, CASE WHEN $11 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END, $14,
        CURRENT_TIMESTAMP, $15, $16, $17, $18, $19,
        $20, $21,
        $22, $23, $24, $25,
        $26, $27, $28, $29, $30,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING consent_id
    `;

    const result = await client.query(query, [
      consent.studySubjectId,
      effectiveVersionId,
      consent.consentType || 'subject',
      consent.subjectName,
      JSON.stringify(consent.subjectSignatureData),
      consent.subjectIpAddress || null,
      consent.subjectUserAgent || null,
      consent.witnessName || null,
      consent.witnessRelationship || null,
      consent.witnessSignatureData ? JSON.stringify(consent.witnessSignatureData) : null,
      consent.larName || null,
      consent.larRelationship || null,
      consent.larSignatureData ? JSON.stringify(consent.larSignatureData) : null,
      consent.larReason || null,
      consent.timeSpentReading,
      JSON.stringify(consent.pagesViewed),
      JSON.stringify(consent.acknowledgementsChecked),
      consent.questionsAsked || null,
      consent.consentedBy,
      consent.scannedConsentFileIds ? JSON.stringify(consent.scannedConsentFileIds) : null,
      consent.isScannedConsent || false,
      consent.subjectSignatureId || null,
      consent.witnessSignatureId || null,
      consent.larSignatureId || null,
      consent.investigatorSignatureId || null,
      consent.contentHash || null,
      consent.deviceInfo ? JSON.stringify(consent.deviceInfo) : null,
      consent.pageViewRecords ? JSON.stringify(consent.pageViewRecords) : null,
      consent.formData ? JSON.stringify(consent.formData) : null,
      consent.templateId || null
    ]);

    const consentId = result.rows[0].consent_id;

    // Link scanned consent files to this consent record
    if (consent.scannedConsentFileIds && consent.scannedConsentFileIds.length > 0) {
      for (const fileId of consent.scannedConsentFileIds) {
        await client.query(`
          UPDATE file_uploads 
          SET consent_id = $1, study_subject_id = $2
          WHERE file_id = $3
        `, [consentId, consent.studySubjectId, fileId]);
      }
    }

    // Log audit event
    const auditReason = consent.isScannedConsent 
      ? 'Subject provided informed consent (scanned physical document)'
      : 'Subject provided informed consent';
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change
      ) VALUES (
        CURRENT_TIMESTAMP, 'acc_subject_consent', $1, $2, 'Subject Consent',
        NULL, 'consented',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Created' LIMIT 1),
        $3
      )
    `, [consent.consentedBy, consent.studySubjectId, auditReason]);

    await client.query('COMMIT');

    // Fire-and-forget: notify study admins/monitors about consent event
    try {
      const { notifyConsentEvent } = await import('../database/notification.service');
      const subjectLabel = `Subject ${consent.studySubjectId}`;
      const studyRow = await pool.query(
        `SELECT ss.study_id FROM study_subject ss WHERE ss.study_subject_id = $1 LIMIT 1`,
        [consent.studySubjectId]
      );
      const studyId = studyRow.rows[0]?.study_id;
      if (studyId) {
        const monitors = await pool.query(
          `SELECT DISTINCT ua.user_id FROM user_account ua
           JOIN study_user_role sur ON sur.user_name = ua.user_name
           WHERE sur.study_id = $1 AND sur.role_name IN ('coordinator', 'monitor', 'director')
           AND ua.user_id != $2`,
          [studyId, consent.consentedBy]
        );
        const monitorIds = monitors.rows.map((r: any) => r.user_id);
        if (monitorIds.length > 0) {
          await notifyConsentEvent(monitorIds, 'recorded', subjectLabel, studyId, consentId);
        }
      }
    } catch (notifError: any) {
      logger.warn('Failed to send consent notification (non-blocking)', { error: notifError.message });
    }

    return (await getSubjectConsentById(consentId))!;
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error recording consent', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get subject consent by ID
 */
export async function getSubjectConsentById(consentId: number): Promise<SubjectConsent | null> {
  const query = `
    SELECT sc.*,
           ss.label as subject_label,
           v.version_number,
           d.name as document_name,
           CONCAT(u.first_name, ' ', u.last_name) as consented_by_name,
           CONCAT(w.first_name, ' ', w.last_name) as withdrawn_by_name
    FROM acc_subject_consent sc
    JOIN study_subject ss ON sc.study_subject_id = ss.study_subject_id
    LEFT JOIN acc_consent_version v ON sc.version_id = v.version_id
    LEFT JOIN acc_consent_document d ON v.document_id = d.document_id
    LEFT JOIN user_account u ON sc.consented_by = u.user_id
    LEFT JOIN user_account w ON sc.withdrawn_by = w.user_id
    WHERE sc.consent_id = $1
  `;

  const result = await pool.query(query, [consentId]);
  return result.rows.length > 0 ? mapRowToSubjectConsent(result.rows[0]) : null;
}

/**
 * Get audit trail for a consent record
 */
export async function getConsentAuditTrail(consentId: number): Promise<any[]> {
  const query = `
    SELECT 
      ale.audit_id,
      ale.audit_date,
      ale.audit_table,
      ale.entity_id,
      ale.entity_name,
      ale.old_value,
      ale.new_value,
      ale.reason_for_change,
      alet.name as event_type,
      CONCAT(u.first_name, ' ', u.last_name) as user_name,
      u.user_name as username
    FROM audit_log_event ale
    LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
    LEFT JOIN user_account u ON ale.user_id = u.user_id
    WHERE ale.audit_table = 'acc_subject_consent'
      AND ale.entity_id = $1
    ORDER BY ale.audit_date DESC
  `;

  const result = await pool.query(query, [consentId]);
  return result.rows.map(row => ({
    auditId: row.audit_id,
    auditDate: row.audit_date,
    table: row.audit_table,
    entityId: row.entity_id,
    entityName: row.entity_name,
    oldValue: row.old_value,
    newValue: row.new_value,
    reasonForChange: row.reason_for_change,
    eventType: row.event_type,
    userName: row.user_name,
    username: row.username
  }));
}

/**
 * Get consent history for a subject
 */
export async function getSubjectConsent(studySubjectId: number): Promise<SubjectConsent[]> {
  const query = `
    SELECT sc.*,
           ss.label as subject_label,
           v.version_number,
           d.name as document_name,
           CONCAT(u.first_name, ' ', u.last_name) as consented_by_name,
           CONCAT(w.first_name, ' ', w.last_name) as withdrawn_by_name
    FROM acc_subject_consent sc
    JOIN study_subject ss ON sc.study_subject_id = ss.study_subject_id
    LEFT JOIN acc_consent_version v ON sc.version_id = v.version_id
    LEFT JOIN acc_consent_document d ON v.document_id = d.document_id
    LEFT JOIN user_account u ON sc.consented_by = u.user_id
    LEFT JOIN user_account w ON sc.withdrawn_by = w.user_id
    WHERE sc.study_subject_id = $1
    ORDER BY sc.date_created DESC
  `;

  const result = await pool.query(query, [studySubjectId]);
  return result.rows.map(mapRowToSubjectConsent);
}

/**
 * Check if subject has valid consent
 */
export async function hasValidConsent(studySubjectId: number): Promise<boolean> {
  const query = `
    SELECT 1 FROM acc_subject_consent sc
    LEFT JOIN acc_consent_version v ON sc.version_id = v.version_id
    WHERE sc.study_subject_id = $1
      AND sc.consent_status = 'consented'
      AND (
        sc.version_id IS NULL
        OR (v.status = 'active' AND (v.expiration_date IS NULL OR v.expiration_date > CURRENT_DATE))
      )
    LIMIT 1
  `;

  const result = await pool.query(query, [studySubjectId]);
  return result.rows.length > 0;
}

/**
 * Withdraw consent
 */
export async function withdrawConsent(
  consentId: number,
  reason: string,
  userId: number
): Promise<SubjectConsent> {
  logger.info('Withdrawing consent', { consentId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get consent details
    const consentResult = await client.query(
      'SELECT * FROM acc_subject_consent WHERE consent_id = $1',
      [consentId]
    );

    if (consentResult.rows.length === 0) {
      throw new Error('Consent not found');
    }

    const consent = consentResult.rows[0];

    if (consent.consent_status === 'withdrawn') {
      throw new Error('Consent already withdrawn');
    }

    // Update consent status
    await client.query(`
      UPDATE acc_subject_consent
      SET consent_status = 'withdrawn',
          withdrawn_at = CURRENT_TIMESTAMP,
          withdrawal_reason = $1,
          withdrawn_by = $2,
          date_updated = CURRENT_TIMESTAMP
      WHERE consent_id = $3
    `, [reason, userId, consentId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change
      ) VALUES (
        CURRENT_TIMESTAMP, 'acc_subject_consent', $1, $2, 'Subject Consent',
        'consented', 'withdrawn',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1),
        $3
      )
    `, [userId, consent.study_subject_id, reason]);

    await client.query('COMMIT');

    return (await getSubjectConsentById(consentId))!;
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error withdrawing consent', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// Re-consent
// ============================================================================

/**
 * Request re-consent for a subject
 */
export async function requestReconsent(request: ReconsentRequestCreate): Promise<ReconsentRequest> {
  logger.info('Requesting re-consent', { 
    studySubjectId: request.studySubjectId, 
    versionId: request.versionId 
  });

  // Get previous consent if exists
  const previousConsentResult = await pool.query(`
    SELECT consent_id FROM acc_subject_consent
    WHERE study_subject_id = $1 AND consent_status = 'consented'
    ORDER BY date_created DESC LIMIT 1
  `, [request.studySubjectId]);

  const previousConsentId = previousConsentResult.rows[0]?.consent_id;

  const query = `
    INSERT INTO acc_reconsent_request (
      version_id, study_subject_id, previous_consent_id,
      reason, due_date, requested_by, requested_at, status, date_updated
    ) VALUES (
      $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, 'pending', CURRENT_TIMESTAMP
    )
    RETURNING request_id
  `;

  const result = await pool.query(query, [
    request.versionId,
    request.studySubjectId,
    previousConsentId || null,
    request.reason,
    request.dueDate || null,
    request.requestedBy
  ]);

  return (await getReconsentRequest(result.rows[0].request_id))!;
}

/**
 * Get re-consent request by ID
 */
export async function getReconsentRequest(requestId: number): Promise<ReconsentRequest | null> {
  const query = `
    SELECT r.*,
           ss.label as subject_label,
           v.version_number,
           pv.version_number as previous_version_number,
           CONCAT(u.first_name, ' ', u.last_name) as requested_by_name
    FROM acc_reconsent_request r
    JOIN study_subject ss ON r.study_subject_id = ss.study_subject_id
    JOIN acc_consent_version v ON r.version_id = v.version_id
    LEFT JOIN acc_subject_consent pc ON r.previous_consent_id = pc.consent_id
    LEFT JOIN acc_consent_version pv ON pc.version_id = pv.version_id
    LEFT JOIN user_account u ON r.requested_by = u.user_id
    WHERE r.request_id = $1
  `;

  const result = await pool.query(query, [requestId]);
  return result.rows.length > 0 ? mapRowToReconsentRequest(result.rows[0]) : null;
}

/**
 * Get pending re-consent requests for a study
 */
export async function getPendingReconsents(studyId: number): Promise<ReconsentRequest[]> {
  const query = `
    SELECT r.*,
           ss.label as subject_label,
           v.version_number,
           pv.version_number as previous_version_number,
           CONCAT(u.first_name, ' ', u.last_name) as requested_by_name
    FROM acc_reconsent_request r
    JOIN study_subject ss ON r.study_subject_id = ss.study_subject_id
    JOIN acc_consent_version v ON r.version_id = v.version_id
    JOIN acc_consent_document d ON v.document_id = d.document_id
    LEFT JOIN acc_subject_consent pc ON r.previous_consent_id = pc.consent_id
    LEFT JOIN acc_consent_version pv ON pc.version_id = pv.version_id
    LEFT JOIN user_account u ON r.requested_by = u.user_id
    WHERE d.study_id = $1 AND r.status = 'pending'
    ORDER BY r.due_date ASC NULLS LAST, r.requested_at ASC
  `;

  const result = await pool.query(query, [studyId]);
  return result.rows.map(mapRowToReconsentRequest);
}

// ============================================================================
// Dashboard
// ============================================================================

/**
 * Get consent dashboard for a study
 */
export async function getConsentDashboard(studyId: number): Promise<ConsentDashboard> {
  // Get stats
  const statsQuery = `
    SELECT 
      (SELECT COUNT(DISTINCT ss.study_subject_id) 
       FROM study_subject ss 
       WHERE ss.study_id IN (SELECT study_id FROM study WHERE study_id = $1 OR parent_study_id = $1)) as total_subjects,
      (SELECT COUNT(DISTINCT sc.study_subject_id) 
       FROM acc_subject_consent sc 
       JOIN study_subject ss ON sc.study_subject_id = ss.study_subject_id
       WHERE ss.study_id IN (SELECT study_id FROM study WHERE study_id = $1 OR parent_study_id = $1)
         AND sc.consent_status = 'consented') as consented,
      (SELECT COUNT(*) 
       FROM acc_reconsent_request r
       JOIN acc_consent_version v ON r.version_id = v.version_id
       JOIN acc_consent_document d ON v.document_id = d.document_id
       WHERE d.study_id = $1 AND r.status = 'pending') as pending_reconsent
  `;

  const statsResult = await pool.query(statsQuery, [studyId]);
  const stats = statsResult.rows[0];

  // Get pending consents
  const pendingQuery = `
    SELECT ss.study_subject_id, ss.label as subject_label, 
           s.name as site_name, ss.date_created as enrolled_at,
           EXTRACT(DAY FROM (CURRENT_TIMESTAMP - ss.date_created)) as days_without_consent
    FROM study_subject ss
    JOIN study s ON ss.study_id = s.study_id
    WHERE ss.study_id IN (SELECT study_id FROM study WHERE study_id = $1 OR parent_study_id = $1)
      AND NOT EXISTS (
        SELECT 1 FROM acc_subject_consent sc
        WHERE sc.study_subject_id = ss.study_subject_id
          AND sc.consent_status = 'consented'
      )
    ORDER BY ss.date_created ASC
    LIMIT 20
  `;

  const pendingResult = await pool.query(pendingQuery, [studyId]);

  // Get pending re-consents
  const reconsentResult = await getPendingReconsents(studyId);

  // Get recent consents
  const recentQuery = `
    SELECT sc.*,
           ss.label as subject_label,
           v.version_number,
           d.name as document_name,
           CONCAT(u.first_name, ' ', u.last_name) as consented_by_name
    FROM acc_subject_consent sc
    JOIN study_subject ss ON sc.study_subject_id = ss.study_subject_id
    LEFT JOIN acc_consent_version v ON sc.version_id = v.version_id
    LEFT JOIN acc_consent_document d ON v.document_id = d.document_id
    LEFT JOIN user_account u ON sc.consented_by = u.user_id
    WHERE ss.study_id IN (SELECT study_id FROM study WHERE study_id = $1 OR parent_study_id = $1)
    ORDER BY sc.date_created DESC
    LIMIT 10
  `;

  const recentResult = await pool.query(recentQuery, [studyId]);

  return {
    stats: {
      totalSubjects: parseInt(stats?.total_subjects || '0'),
      consented: parseInt(stats?.consented || '0'),
      pending: parseInt(stats?.total_subjects || '0') - parseInt(stats?.consented || '0'),
      declined: 0, // Would need additional query
      withdrawn: 0, // Would need additional query
      pendingReconsent: parseInt(stats?.pending_reconsent || '0')
    },
    pendingConsents: pendingResult.rows.map(row => ({
      studySubjectId: row.study_subject_id,
      subjectLabel: row.subject_label,
      siteName: row.site_name,
      enrolledAt: row.enrolled_at,
      daysWithoutConsent: parseInt(row.days_without_consent || '0')
    })),
    pendingReconsents: reconsentResult,
    recentConsents: recentResult.rows.map(mapRowToSubjectConsent),
    documentVersions: []
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function mapRowToDocument(row: any): ConsentDocument {
  return {
    documentId: row.document_id,
    studyId: row.study_id,
    name: row.name,
    description: row.description,
    documentType: row.document_type,
    languageCode: row.language_code,
    status: row.status,
    requiresWitness: row.requires_witness,
    requiresLAR: row.requires_lar,
    ageOfMajority: row.age_of_majority,
    minReadingTime: row.min_reading_time,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated
  };
}

function mapRowToVersion(row: any): ConsentVersion {
  return {
    versionId: row.version_id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    versionName: row.version_name,
    content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
    pdfTemplate: row.pdf_template,
    effectiveDate: row.effective_date,
    expirationDate: row.expiration_date,
    irbApprovalDate: row.irb_approval_date,
    irbApprovalNumber: row.irb_approval_number,
    changeSummary: row.change_summary,
    status: row.status,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at,
    createdBy: row.created_by,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated
  };
}

function mapRowToSubjectConsent(row: any): SubjectConsent {
  return {
    consentId: row.consent_id,
    studySubjectId: row.study_subject_id,
    subjectLabel: row.subject_label,
    versionId: row.version_id,
    versionNumber: row.version_number,
    documentName: row.document_name,
    consentType: row.consent_type,
    consentStatus: row.consent_status,
    subjectName: row.subject_name,
    subjectSignatureData: row.subject_signature_data,
    subjectSignedAt: row.subject_signed_at,
    subjectIpAddress: row.subject_ip_address,
    witnessName: row.witness_name,
    witnessRelationship: row.witness_relationship,
    witnessSignatureData: row.witness_signature_data,
    witnessSignedAt: row.witness_signed_at,
    larName: row.lar_name,
    larRelationship: row.lar_relationship,
    larSignatureData: row.lar_signature_data,
    larSignedAt: row.lar_signed_at,
    larReason: row.lar_reason,
    presentedAt: row.presented_at,
    timeSpentReading: row.time_spent_reading || 0,
    pagesViewed: row.pages_viewed,
    acknowledgementsChecked: row.acknowledgments_checked,
    questionsAsked: row.questions_asked,
    copyEmailedTo: row.copy_emailed_to,
    copyEmailedAt: row.copy_emailed_at,
    pdfFilePath: row.pdf_file_path,
    withdrawnAt: row.withdrawn_at,
    withdrawalReason: row.withdrawal_reason,
    withdrawnByName: row.withdrawn_by_name,
    consentedBy: row.consented_by,
    consentedByName: row.consented_by_name,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated
  };
}

function mapRowToReconsentRequest(row: any): ReconsentRequest {
  return {
    requestId: row.request_id,
    versionId: row.version_id,
    versionNumber: row.version_number,
    studySubjectId: row.study_subject_id,
    subjectLabel: row.subject_label,
    previousConsentId: row.previous_consent_id,
    previousVersionNumber: row.previous_version_number,
    reason: row.reason,
    requestedAt: row.requested_at,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    dueDate: row.due_date,
    completedConsentId: row.completed_consent_id,
    status: row.status,
    waivedBy: row.waived_by,
    waivedReason: row.waived_reason,
    dateUpdated: row.date_updated
  };
}

export default {
  createConsentDocument,
  getConsentDocument,
  listConsentDocuments,
  updateConsentDocument,
  createConsentVersion,
  getConsentVersion,
  getActiveVersion,
  activateConsentVersion,
  recordConsent,
  getSubjectConsentById,
  getSubjectConsent,
  hasValidConsent,
  withdrawConsent,
  requestReconsent,
  getReconsentRequest,
  getPendingReconsents,
  getConsentDashboard
};

