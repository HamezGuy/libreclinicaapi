/**
 * Adverse Event Service
 * 
 * Uses EXISTING LibreClinica SOAP APIs for Part 11 compliance:
 * - dataSoap.service.ts for importing AE data (ODM format)
 * - eventSoap.service.ts for scheduling AE events
 * 
 * LibreClinica Models Used:
 * - CRF (admin/CRFBean.java) - AE form template
 * - EventCRF (submit/EventCRFBean.java) - AE form instance
 * - ItemData (submit/ItemDataBean.java) - AE field values
 * - StudyEventDefinition (managestudy/StudyEventDefinitionBean.java) - AE event type
 * 
 * AEs are just CRF forms with specific fields - no special tables needed!
 */

import { getSoapClient } from '../soap/soapClient';
import { logger } from '../../config/logger';
import { pool } from '../../config/database';

// AE Configuration - these OIDs must match LibreClinica CRF setup
// These would typically be configured per-study in production
export interface AEFormConfig {
  eventOID: string;           // Study Event Definition OID for AE visits
  formOID: string;            // CRF OID for AE form
  itemGroupOID: string;       // Item Group OID
  items: {
    term: string;             // AE Term item OID
    meddraCode?: string;      // MedDRA code item OID
    onsetDate: string;        // Onset date item OID
    resolutionDate?: string;  // Resolution date item OID
    severity: string;         // Severity item OID
    isSerious: string;        // Is Serious item OID
    causality?: string;       // Causality assessment item OID
    outcome?: string;         // Outcome item OID
    action?: string;          // Action taken item OID
  };
}

// Default AE form configuration
const DEFAULT_AE_CONFIG: AEFormConfig = {
  eventOID: 'SE_ADVERSEEVENT',
  formOID: 'F_AEFORM_V1',
  itemGroupOID: 'IG_AEFORM_UNGROUPED',
  items: {
    term: 'I_AEFOR_AE_TERM',
    meddraCode: 'I_AEFOR_MEDDRA_CODE',
    onsetDate: 'I_AEFOR_ONSET_DATE',
    resolutionDate: 'I_AEFOR_RESOLUTION_DATE',
    severity: 'I_AEFOR_SEVERITY',
    isSerious: 'I_AEFOR_IS_SERIOUS',
    causality: 'I_AEFOR_CAUSALITY',
    outcome: 'I_AEFOR_OUTCOME',
    action: 'I_AEFOR_ACTION'
  }
};

// Adverse Event data structure
export interface AdverseEvent {
  aeId?: number;              // event_crf_id for existing AEs
  subjectOID: string;         // Subject OID or label
  aeTerm: string;             // Verbatim AE term (required)
  meddraCode?: string;        // MedDRA PT code
  onsetDate: string;          // YYYY-MM-DD (required)
  resolutionDate?: string;    // YYYY-MM-DD
  severity: 'Mild' | 'Moderate' | 'Severe';
  isSerious: boolean;
  seriousnessCriteria?: {
    resultsDeath?: boolean;
    lifeThreatening?: boolean;
    hospitalization?: boolean;
    disability?: boolean;
    congenitalAnomaly?: boolean;
    medicallyImportant?: boolean;
  };
  causalityAssessment?: string;
  outcome?: string;
  actionTaken?: string;
}

export interface AEReportResult {
  success: boolean;
  eventCrfId?: number;
  message?: string;
  errors?: string[];
}

export interface AESummary {
  totalAEs: number;
  seriousAEs: number;
  openAEs: number;
  resolvedAEs: number;
  bySeverity: { severity: string; count: number }[];
  recentAEs: { aeId: number; subjectLabel: string; aeTerm: string; onsetDate: string; isSerious: boolean }[];
}

/**
 * Report a new Adverse Event
 * Uses EXISTING dataSoap.service for Part 11 compliance
 */
export const reportAdverseEvent = async (
  studyOID: string,
  ae: AdverseEvent,
  userId: number,
  username: string,
  aeConfig: AEFormConfig = DEFAULT_AE_CONFIG
): Promise<AEReportResult> => {
  logger.info('Reporting adverse event via SOAP', {
    studyOID,
    subjectOID: ae.subjectOID,
    aeTerm: ae.aeTerm,
    isSerious: ae.isSerious,
    username
  });

  try {
    const soapClient = getSoapClient();

    // Step 1: Schedule the AE event for this subject using EXISTING eventSoap
    // LibreClinica will create the study_event record
    const scheduleResponse = await soapClient.executeRequest({
      serviceName: 'event',
      methodName: 'schedule',
      parameters: {
        studyRef: { identifier: studyOID },
        studySubjectRef: { label: ae.subjectOID },
        eventDefinitionRef: { identifier: aeConfig.eventOID },
        startDate: ae.onsetDate,
        location: 'API'
      },
      userId,
      username
    });

    // Event might already be scheduled - that's OK, continue
    if (!scheduleResponse.success) {
      logger.warn('Event schedule returned non-success', { 
        response: scheduleResponse,
        continuing: true 
      });
    }

    // Step 2: Build ODM XML for AE data (matching ImportItemDataBean structure)
    const odmXml = buildAEOdmXml(studyOID, ae, aeConfig);

    // Step 3: Import via SOAP using EXISTING data endpoint
    // This creates audit trail, validates data, runs rules
    const importResponse = await soapClient.executeRequest({
      serviceName: 'data',
      methodName: 'import',
      parameters: {
        odm: odmXml
      },
      userId,
      username
    });

    if (!importResponse.success) {
      logger.error('AE import failed', { error: importResponse.error });
      return {
        success: false,
        message: importResponse.error || 'Failed to import adverse event',
        errors: [importResponse.error || 'Import failed']
      };
    }

    logger.info('Adverse event reported successfully', {
      subjectOID: ae.subjectOID,
      aeTerm: ae.aeTerm,
      isSerious: ae.isSerious
    });

    return {
      success: true,
      message: ae.isSerious 
        ? 'Serious Adverse Event (SAE) reported successfully' 
        : 'Adverse Event reported successfully'
    };

  } catch (error: any) {
    logger.error('Error reporting adverse event', { 
      error: error.message,
      subjectOID: ae.subjectOID 
    });
    return {
      success: false,
      message: `Failed to report adverse event: ${error.message}`,
      errors: [error.message]
    };
  }
};

/**
 * Build ODM XML for AE data
 * Matches LibreClinica's expected import format
 */
function buildAEOdmXml(
  studyOID: string, 
  ae: AdverseEvent, 
  config: AEFormConfig
): string {
  const timestamp = new Date().toISOString();
  const items = config.items;

  let itemDataXml = `
            <ItemData ItemOID="${items.term}" Value="${escapeXml(ae.aeTerm)}"/>
            <ItemData ItemOID="${items.onsetDate}" Value="${ae.onsetDate}"/>
            <ItemData ItemOID="${items.severity}" Value="${ae.severity}"/>
            <ItemData ItemOID="${items.isSerious}" Value="${ae.isSerious ? 'Yes' : 'No'}"/>`;

  if (ae.meddraCode && items.meddraCode) {
    itemDataXml += `
            <ItemData ItemOID="${items.meddraCode}" Value="${escapeXml(ae.meddraCode)}"/>`;
  }
  if (ae.resolutionDate && items.resolutionDate) {
    itemDataXml += `
            <ItemData ItemOID="${items.resolutionDate}" Value="${ae.resolutionDate}"/>`;
  }
  if (ae.causalityAssessment && items.causality) {
    itemDataXml += `
            <ItemData ItemOID="${items.causality}" Value="${escapeXml(ae.causalityAssessment)}"/>`;
  }
  if (ae.outcome && items.outcome) {
    itemDataXml += `
            <ItemData ItemOID="${items.outcome}" Value="${escapeXml(ae.outcome)}"/>`;
  }
  if (ae.actionTaken && items.action) {
    itemDataXml += `
            <ItemData ItemOID="${items.action}" Value="${escapeXml(ae.actionTaken)}"/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     xmlns:OpenClinica="http://www.openclinica.org/ns/odm_ext_v130/v3.1"
     ODMVersion="1.3"
     FileType="Transactional"
     FileOID="AE-${Date.now()}"
     CreationDateTime="${timestamp}">
  <ClinicalData StudyOID="${escapeXml(studyOID)}" MetaDataVersionOID="v1.0.0">
    <SubjectData SubjectKey="${escapeXml(ae.subjectOID)}">
      <StudyEventData StudyEventOID="${config.eventOID}" StudyEventRepeatKey="1">
        <FormData FormOID="${config.formOID}">
          <ItemGroupData ItemGroupOID="${config.itemGroupOID}" ItemGroupRepeatKey="1" TransactionType="Insert">${itemDataXml}
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
</ODM>`;
}

/**
 * Get AE Summary for dashboard
 * READ-ONLY summary queries - counts only, no clinical values exposed
 */
export const getAESummary = async (studyId: number): Promise<AESummary> => {
  logger.info('Getting AE summary', { studyId });

  try {
    // Query for AE counts - READ ONLY, just counts
    // This is acceptable for dashboards as we're not exposing clinical values
    const summaryQuery = `
      SELECT 
        COUNT(DISTINCT ec.event_crf_id) as total_aes,
        COUNT(DISTINCT CASE 
          WHEN EXISTS (
            SELECT 1 FROM item_data id2 
            INNER JOIN item i2 ON id2.item_id = i2.item_id
            WHERE id2.event_crf_id = ec.event_crf_id 
            AND i2.name ILIKE '%serious%' 
            AND id2.value IN ('Yes', 'true', '1')
          ) THEN ec.event_crf_id 
        END) as serious_aes
      FROM event_crf ec
      INNER JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      WHERE ss.study_id = $1
        AND (c.name ILIKE '%adverse%' OR c.name ILIKE '%AE%' OR c.name ILIKE '%safety%')
        AND ec.status_id NOT IN (5, 7)
    `;

    const result = await pool.query(summaryQuery, [studyId]);
    const row = result.rows[0] || {};

    // Get severity breakdown
    const severityQuery = `
      SELECT 
        COALESCE(id.value, 'Unknown') as severity,
        COUNT(DISTINCT ec.event_crf_id) as count
      FROM event_crf ec
      INNER JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      LEFT JOIN item_data id ON ec.event_crf_id = id.event_crf_id
      LEFT JOIN item i ON id.item_id = i.item_id AND i.name ILIKE '%severity%'
      WHERE ss.study_id = $1
        AND (c.name ILIKE '%adverse%' OR c.name ILIKE '%AE%')
      GROUP BY COALESCE(id.value, 'Unknown')
    `;

    const severityResult = await pool.query(severityQuery, [studyId]);

    // Get recent AEs (limited info for list)
    const recentQuery = `
      SELECT 
        ec.event_crf_id as ae_id,
        ss.label as subject_label,
        COALESCE(id_term.value, 'Unknown') as ae_term,
        COALESCE(id_onset.value, '') as onset_date,
        CASE WHEN id_serious.value IN ('Yes', 'true', '1') THEN true ELSE false END as is_serious
      FROM event_crf ec
      INNER JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      LEFT JOIN item_data id_term ON ec.event_crf_id = id_term.event_crf_id
        AND id_term.item_id = (SELECT item_id FROM item WHERE name ILIKE '%ae%term%' LIMIT 1)
      LEFT JOIN item_data id_onset ON ec.event_crf_id = id_onset.event_crf_id
        AND id_onset.item_id = (SELECT item_id FROM item WHERE name ILIKE '%onset%' LIMIT 1)
      LEFT JOIN item_data id_serious ON ec.event_crf_id = id_serious.event_crf_id
        AND id_serious.item_id = (SELECT item_id FROM item WHERE name ILIKE '%serious%' LIMIT 1)
      WHERE ss.study_id = $1
        AND (c.name ILIKE '%adverse%' OR c.name ILIKE '%AE%')
      ORDER BY ec.date_created DESC
      LIMIT 10
    `;

    const recentResult = await pool.query(recentQuery, [studyId]);

    return {
      totalAEs: parseInt(row.total_aes) || 0,
      seriousAEs: parseInt(row.serious_aes) || 0,
      openAEs: 0, // Would need outcome field query
      resolvedAEs: 0,
      bySeverity: severityResult.rows.map(r => ({
        severity: r.severity,
        count: parseInt(r.count) || 0
      })),
      recentAEs: recentResult.rows.map(r => ({
        aeId: r.ae_id,
        subjectLabel: r.subject_label,
        aeTerm: r.ae_term,
        onsetDate: r.onset_date,
        isSerious: r.is_serious
      }))
    };

  } catch (error: any) {
    logger.error('Error getting AE summary', { error: error.message, studyId });
    return {
      totalAEs: 0,
      seriousAEs: 0,
      openAEs: 0,
      resolvedAEs: 0,
      bySeverity: [],
      recentAEs: []
    };
  }
};

/**
 * Get AEs for a specific subject
 */
export const getSubjectAEs = async (
  studyId: number,
  subjectId: number
): Promise<{ aeId: number; aeTerm: string; onsetDate: string; severity: string; isSerious: boolean; status: string }[]> => {
  try {
    const query = `
      SELECT 
        ec.event_crf_id as ae_id,
        COALESCE(id_term.value, 'Unknown') as ae_term,
        COALESCE(id_onset.value, '') as onset_date,
        COALESCE(id_sev.value, 'Unknown') as severity,
        CASE WHEN id_serious.value IN ('Yes', 'true', '1') THEN true ELSE false END as is_serious,
        COALESCE(st.name, 'Unknown') as status
      FROM event_crf ec
      INNER JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      LEFT JOIN status st ON ec.status_id = st.status_id
      LEFT JOIN item_data id_term ON ec.event_crf_id = id_term.event_crf_id
        AND id_term.item_id = (SELECT item_id FROM item WHERE name ILIKE '%ae%term%' LIMIT 1)
      LEFT JOIN item_data id_onset ON ec.event_crf_id = id_onset.event_crf_id
        AND id_onset.item_id = (SELECT item_id FROM item WHERE name ILIKE '%onset%' LIMIT 1)
      LEFT JOIN item_data id_sev ON ec.event_crf_id = id_sev.event_crf_id
        AND id_sev.item_id = (SELECT item_id FROM item WHERE name ILIKE '%severity%' LIMIT 1)
      LEFT JOIN item_data id_serious ON ec.event_crf_id = id_serious.event_crf_id
        AND id_serious.item_id = (SELECT item_id FROM item WHERE name ILIKE '%serious%' LIMIT 1)
      WHERE ss.study_id = $1
        AND ss.study_subject_id = $2
        AND (c.name ILIKE '%adverse%' OR c.name ILIKE '%AE%')
      ORDER BY ec.date_created DESC
    `;

    const result = await pool.query(query, [studyId, subjectId]);

    return result.rows.map(row => ({
      aeId: row.ae_id,
      aeTerm: row.ae_term,
      onsetDate: row.onset_date,
      severity: row.severity,
      isSerious: row.is_serious,
      status: row.status
    }));

  } catch (error: any) {
    logger.error('Error getting subject AEs', { error: error.message });
    return [];
  }
};

// Helper
function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Named exports for direct access
export { DEFAULT_AE_CONFIG };

export default {
  reportAdverseEvent,
  getAESummary,
  getSubjectAEs,
  DEFAULT_AE_CONFIG
};

