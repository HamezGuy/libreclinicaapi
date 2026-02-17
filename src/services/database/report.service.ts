/**
 * Report Service
 * 
 * Generates reports for regulatory compliance
 * RED X Feature: Reports API
 * 
 * Formats: CSV, PDF (future: Excel)
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { ReportRequest } from '../../types';
import { formatDate, toISOTimestamp } from '../../utils/date.util';

/**
 * Generate enrollment report
 */
export const generateEnrollmentReport = async (
  studyId: number,
  startDate: Date,
  endDate: Date,
  format: 'csv' | 'pdf' = 'csv'
): Promise<string> => {
  logger.info('Generating enrollment report', { studyId, format });

  try {
    const query = `
      SELECT 
        ss.label as subject_id,
        ss.secondary_label,
        ss.enrollment_date,
        st.name as status,
        s.gender,
        s.date_of_birth,
        u.user_name as enrolled_by,
        ss.date_created
      FROM study_subject ss
      INNER JOIN subject s ON ss.subject_id = s.subject_id
      INNER JOIN status st ON ss.status_id = st.status_id
      LEFT JOIN user_account u ON ss.owner_id = u.user_id
      WHERE ss.study_id = $1
        AND ss.enrollment_date >= $2
        AND ss.enrollment_date <= $3
      ORDER BY ss.enrollment_date DESC
    `;

    const result = await pool.query(query, [studyId, startDate, endDate]);

    if (format === 'csv') {
      return generateCSV(
        ['Subject ID', 'Secondary ID', 'Enrollment Date', 'Status', 'Gender', 'DOB', 'Enrolled By', 'Created'],
        result.rows.map(r => [
          r.subject_id,
          r.secondary_label || '',
          formatDate(r.enrollment_date),
          r.status,
          r.gender || '',
          formatDate(r.date_of_birth),
          r.enrolled_by,
          toISOTimestamp(r.date_created)
        ])
      );
    }

    // PDF generation would go here (requires additional library)
    return 'PDF generation not implemented yet';
  } catch (error: any) {
    logger.error('Enrollment report error', { error: error.message });
    throw error;
  }
};

/**
 * Generate data completion report
 */
export const generateCompletionReport = async (
  studyId: number,
  format: 'csv' | 'pdf' = 'csv'
): Promise<string> => {
  logger.info('Generating completion report', { studyId, format });

  try {
    const query = `
      SELECT 
        ss.label as subject_id,
        sed.name as event_name,
        c.name as form_name,
        cs.name as completion_status,
        ec.date_created,
        ec.date_updated,
        u.user_name as completed_by
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      INNER JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      LEFT JOIN user_account u ON ec.owner_id = u.user_id
      WHERE ss.study_id = $1
      ORDER BY ss.label, sed.ordinal, c.name
    `;

    const result = await pool.query(query, [studyId]);

    if (format === 'csv') {
      return generateCSV(
        ['Subject ID', 'Event', 'Form', 'Status', 'Created', 'Updated', 'Completed By'],
        result.rows.map(r => [
          r.subject_id,
          r.event_name,
          r.form_name,
          r.completion_status,
          toISOTimestamp(r.date_created),
          toISOTimestamp(r.date_updated),
          r.completed_by || ''
        ])
      );
    }

    return 'PDF generation not implemented yet';
  } catch (error: any) {
    logger.error('Completion report error', { error: error.message });
    throw error;
  }
};

/**
 * Generate query/discrepancy report
 * Note: discrepancy_note does NOT have study_subject_id column
 * Subject info is linked through mapping tables (dn_study_subject_map, etc.)
 */
export const generateQueryReport = async (
  studyId: number,
  format: 'csv' | 'pdf' = 'csv'
): Promise<string> => {
  logger.info('Generating query report', { studyId, format });

  try {
    const query = `
      SELECT 
        dn.discrepancy_note_id,
        ss.label as subject_id,
        dnt.name as query_type,
        dn.description,
        rs.name as status,
        u.user_name as created_by,
        dn.date_created,
        au.user_name as assigned_to,
        (SELECT COUNT(*) FROM discrepancy_note WHERE parent_dn_id = dn.discrepancy_note_id) as response_count
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
      LEFT JOIN dn_study_subject_map dnsm ON dn.discrepancy_note_id = dnsm.discrepancy_note_id
      LEFT JOIN study_subject ss ON dnsm.study_subject_id = ss.study_subject_id
      LEFT JOIN user_account u ON dn.owner_id = u.user_id
      LEFT JOIN user_account au ON dn.assigned_user_id = au.user_id
      WHERE dn.study_id = $1 AND dn.parent_dn_id IS NULL
      ORDER BY dn.date_created DESC
    `;

    const result = await pool.query(query, [studyId]);

    if (format === 'csv') {
      return generateCSV(
        ['Query ID', 'Subject', 'Type', 'Description', 'Status', 'Created By', 'Date', 'Assigned To', 'Responses'],
        result.rows.map(r => [
          r.discrepancy_note_id.toString(),
          r.subject_id || '',
          r.query_type,
          `"${r.description.replace(/"/g, '""')}"`,
          r.status,
          r.created_by,
          toISOTimestamp(r.date_created),
          r.assigned_to || '',
          r.response_count.toString()
        ])
      );
    }

    return 'PDF generation not implemented yet';
  } catch (error: any) {
    logger.error('Query report error', { error: error.message });
    throw error;
  }
};

/**
 * Helper: Generate CSV from data
 */
function generateCSV(headers: string[], rows: string[][]): string {
  let csv = headers.join(',') + '\n';
  
  for (const row of rows) {
    csv += row.join(',') + '\n';
  }

  return csv;
}

export default {
  generateEnrollmentReport,
  generateCompletionReport,
  generateQueryReport
};

