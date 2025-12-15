/**
 * PDF Generation Service
 * 
 * 21 CFR Part 11 Compliant PDF Generation for:
 * - Form printing (blank and completed)
 * - Casebook generation (all forms for a subject)
 * - Audit trail export
 * 
 * Uses HTML templates rendered to PDF for flexibility
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import {
  PDFGenerationOptions,
  PrintableForm,
  PrintableSection,
  PrintableField,
  PrintableCasebook,
  PrintableEvent,
  PrintableAuditTrail,
  AuditTrailEntry,
  PDFGenerationResult
} from './pdf.types';

/**
 * Default PDF options
 */
const DEFAULT_OPTIONS: PDFGenerationOptions = {
  pageSize: 'Letter',
  orientation: 'portrait',
  includeHeader: true,
  includeFooter: true,
  includeAuditTrail: false
};

/**
 * Get form data for printing (completed form)
 */
export async function getFormDataForPrint(eventCrfId: number): Promise<PrintableForm | null> {
  logger.info('Getting form data for print', { eventCrfId });

  try {
    // Get form header information
    const headerQuery = `
      SELECT 
        ec.event_crf_id,
        c.crf_id,
        c.name as crf_name,
        cv.name as version_name,
        sed.name as event_name,
        ss.label as subject_label,
        s.name as study_name,
        COALESCE(site.name, s.name) as site_name,
        st.name as status,
        ec.date_completed,
        ec.electronic_signature_status,
        ec.sdv_status,
        u.first_name || ' ' || u.last_name as completed_by,
        CASE 
          WHEN ec.status_id = 6 THEN true
          ELSE false
        END as is_locked
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      INNER JOIN study s ON ss.study_id = s.study_id
      LEFT JOIN study site ON s.parent_study_id = site.study_id
      INNER JOIN status st ON ec.status_id = st.status_id
      LEFT JOIN user_account u ON ec.owner_id = u.user_id
      WHERE ec.event_crf_id = $1
    `;

    const headerResult = await pool.query(headerQuery, [eventCrfId]);

    if (headerResult.rows.length === 0) {
      return null;
    }

    const header = headerResult.rows[0];

    // Get sections
    const sectionsQuery = `
      SELECT DISTINCT
        sec.section_id,
        sec.label as title,
        sec.subtitle,
        sec.instructions,
        sec.ordinal
      FROM section sec
      INNER JOIN item_form_metadata ifm ON sec.section_id = ifm.section_id
      WHERE ifm.crf_version_id = (
        SELECT crf_version_id FROM event_crf WHERE event_crf_id = $1
      )
      ORDER BY sec.ordinal
    `;

    const sectionsResult = await pool.query(sectionsQuery, [eventCrfId]);

    // Get fields with values
    const fieldsQuery = `
      SELECT 
        i.item_id,
        i.name,
        i.description,
        i.units,
        idt.name as data_type,
        ifm.section_id,
        ifm.ordinal,
        ifm.required,
        ifm.left_item_text as placeholder,
        id.value,
        id.status_id as value_status,
        rs.options_text,
        rs.options_values,
        rt.name as response_type,
        -- Check for open queries on this item
        (
          SELECT dn.discrepancy_note_id
          FROM discrepancy_note dn
          INNER JOIN dn_item_data_map dim ON dn.discrepancy_note_id = dim.discrepancy_note_id
          WHERE dim.item_data_id = id.item_data_id
            AND dn.resolution_status_id NOT IN (
              SELECT resolution_status_id FROM resolution_status WHERE name IN ('Closed', 'Not Applicable')
            )
          LIMIT 1
        ) as open_query_id
      FROM item i
      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
      INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
      INNER JOIN item_data_type idt ON i.item_data_type_id = idt.item_data_type_id
      LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id
      LEFT JOIN response_type rt ON rs.response_type_id = rt.response_type_id
      LEFT JOIN item_data id ON i.item_id = id.item_id AND id.event_crf_id = $1
      WHERE ifm.crf_version_id = (
        SELECT crf_version_id FROM event_crf WHERE event_crf_id = $1
      )
        AND igm.crf_version_id = ifm.crf_version_id
      ORDER BY ifm.section_id, ifm.ordinal
    `;

    const fieldsResult = await pool.query(fieldsQuery, [eventCrfId]);

    // Build sections with fields
    const sections: PrintableSection[] = sectionsResult.rows.map(sec => {
      const sectionFields = fieldsResult.rows
        .filter(f => f.section_id === sec.section_id)
        .map(f => {
          // Parse options if present
          let options: { label: string; value: string }[] | undefined;
          if (f.options_text && f.options_values) {
            const labels = f.options_text.split(',');
            const values = f.options_values.split(',');
            options = labels.map((label: string, idx: number) => ({
              label: label.trim(),
              value: values[idx]?.trim() || label.trim()
            }));
          }

          // Format display value
          let displayValue = f.value || '';
          if (options && f.value) {
            const opt = options.find(o => o.value === f.value);
            if (opt) displayValue = opt.label;
          }

          // Determine field status
          let status: 'entered' | 'missing' | 'sdv_verified' | 'queried' = 'entered';
          if (!f.value || f.value === '') {
            status = f.required ? 'missing' : 'entered';
          } else if (f.open_query_id) {
            status = 'queried';
          }

          const field: PrintableField = {
            fieldId: f.item_id,
            name: f.name,
            label: f.description || f.name,
            type: f.response_type || f.data_type || 'text',
            value: f.value,
            displayValue,
            unit: f.units,
            options,
            required: f.required,
            status
          };

          return field;
        });

      return {
        sectionId: sec.section_id,
        title: sec.title || 'Section',
        subtitle: sec.subtitle,
        instructions: sec.instructions,
        fields: sectionFields
      };
    });

    const form: PrintableForm = {
      formId: header.event_crf_id,
      formName: header.crf_name,
      formVersion: header.version_name,
      eventName: header.event_name,
      subjectLabel: header.subject_label,
      studyName: header.study_name,
      siteName: header.site_name,
      sections,
      status: header.status,
      completedDate: header.date_completed,
      completedBy: header.completed_by,
      signatureStatus: header.electronic_signature_status,
      sdvStatus: header.sdv_status,
      lockStatus: header.is_locked
    };

    return form;
  } catch (error: any) {
    logger.error('Error getting form data for print', { error: error.message, eventCrfId });
    throw error;
  }
}

/**
 * Get blank form data for printing (template only)
 */
export async function getBlankFormDataForPrint(crfVersionId: number): Promise<PrintableForm | null> {
  logger.info('Getting blank form data for print', { crfVersionId });

  try {
    // Get form header information
    const headerQuery = `
      SELECT 
        cv.crf_version_id,
        c.crf_id,
        c.name as crf_name,
        cv.name as version_name,
        s.name as study_name
      FROM crf_version cv
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      LEFT JOIN study s ON c.source_study_id = s.study_id
      WHERE cv.crf_version_id = $1
    `;

    const headerResult = await pool.query(headerQuery, [crfVersionId]);

    if (headerResult.rows.length === 0) {
      return null;
    }

    const header = headerResult.rows[0];

    // Get sections
    const sectionsQuery = `
      SELECT 
        sec.section_id,
        sec.label as title,
        sec.subtitle,
        sec.instructions,
        sec.ordinal
      FROM section sec
      WHERE sec.crf_version_id = $1
      ORDER BY sec.ordinal
    `;

    const sectionsResult = await pool.query(sectionsQuery, [crfVersionId]);

    // Get fields
    const fieldsQuery = `
      SELECT 
        i.item_id,
        i.name,
        i.description,
        i.units,
        idt.name as data_type,
        ifm.section_id,
        ifm.ordinal,
        ifm.required,
        ifm.left_item_text as placeholder,
        ifm.default_value,
        rs.options_text,
        rs.options_values,
        rt.name as response_type
      FROM item i
      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
      INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
      INNER JOIN item_data_type idt ON i.item_data_type_id = idt.item_data_type_id
      LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id
      LEFT JOIN response_type rt ON rs.response_type_id = rt.response_type_id
      WHERE ifm.crf_version_id = $1
        AND igm.crf_version_id = ifm.crf_version_id
      ORDER BY ifm.section_id, ifm.ordinal
    `;

    const fieldsResult = await pool.query(fieldsQuery, [crfVersionId]);

    // Build sections with fields
    const sections: PrintableSection[] = sectionsResult.rows.map(sec => {
      const sectionFields = fieldsResult.rows
        .filter(f => f.section_id === sec.section_id)
        .map(f => {
          // Parse options if present
          let options: { label: string; value: string }[] | undefined;
          if (f.options_text && f.options_values) {
            const labels = f.options_text.split(',');
            const values = f.options_values.split(',');
            options = labels.map((label: string, idx: number) => ({
              label: label.trim(),
              value: values[idx]?.trim() || label.trim()
            }));
          }

          const field: PrintableField = {
            fieldId: f.item_id,
            name: f.name,
            label: f.description || f.name,
            type: f.response_type || f.data_type || 'text',
            value: f.default_value || '',
            displayValue: f.default_value || '',
            unit: f.units,
            options,
            required: f.required
          };

          return field;
        });

      return {
        sectionId: sec.section_id,
        title: sec.title || 'Section',
        subtitle: sec.subtitle,
        instructions: sec.instructions,
        fields: sectionFields
      };
    });

    const form: PrintableForm = {
      formId: header.crf_version_id,
      formName: header.crf_name,
      formVersion: header.version_name,
      eventName: 'Blank Form Template',
      subjectLabel: '________________',
      studyName: header.study_name || 'Study',
      siteName: '________________',
      sections,
      status: 'BLANK TEMPLATE'
    };

    return form;
  } catch (error: any) {
    logger.error('Error getting blank form data for print', { error: error.message, crfVersionId });
    throw error;
  }
}

/**
 * Get casebook data for printing (all forms for a subject)
 */
export async function getCasebookDataForPrint(
  studySubjectId: number,
  username: string
): Promise<PrintableCasebook | null> {
  logger.info('Getting casebook data for print', { studySubjectId });

  try {
    // Get subject header
    const subjectQuery = `
      SELECT 
        ss.study_subject_id,
        ss.label as subject_label,
        ss.enrollment_date,
        st.name as status,
        s.name as study_name,
        COALESCE(site.name, s.name) as site_name
      FROM study_subject ss
      INNER JOIN study s ON ss.study_id = s.study_id
      LEFT JOIN study site ON s.parent_study_id IS NOT NULL AND site.study_id = s.parent_study_id
      INNER JOIN status st ON ss.status_id = st.status_id
      WHERE ss.study_subject_id = $1
    `;

    const subjectResult = await pool.query(subjectQuery, [studySubjectId]);

    if (subjectResult.rows.length === 0) {
      return null;
    }

    const subject = subjectResult.rows[0];

    // Get all events for this subject
    const eventsQuery = `
      SELECT 
        se.study_event_id,
        sed.name as event_name,
        se.date_started,
        sest.name as status
      FROM study_event se
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN subject_event_status sest ON se.subject_event_status_id = sest.subject_event_status_id
      WHERE se.study_subject_id = $1
      ORDER BY sed.ordinal, se.sample_ordinal
    `;

    const eventsResult = await pool.query(eventsQuery, [studySubjectId]);

    // Get all event_crfs for each event
    const eventCrfsQuery = `
      SELECT 
        ec.event_crf_id,
        ec.study_event_id
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      WHERE se.study_subject_id = $1
      ORDER BY ec.study_event_id, ec.event_crf_id
    `;

    const eventCrfsResult = await pool.query(eventCrfsQuery, [studySubjectId]);

    // Build events with forms
    const events: PrintableEvent[] = [];

    for (const event of eventsResult.rows) {
      const eventCrfs = eventCrfsResult.rows.filter(ec => ec.study_event_id === event.study_event_id);
      const forms: PrintableForm[] = [];

      for (const eventCrf of eventCrfs) {
        const formData = await getFormDataForPrint(eventCrf.event_crf_id);
        if (formData) {
          forms.push(formData);
        }
      }

      events.push({
        eventId: event.study_event_id,
        eventName: event.event_name,
        eventDate: event.date_started,
        status: event.status,
        forms
      });
    }

    const casebook: PrintableCasebook = {
      studySubjectId: subject.study_subject_id,
      subjectLabel: subject.subject_label,
      studyName: subject.study_name,
      siteName: subject.site_name,
      enrollmentDate: subject.enrollment_date,
      status: subject.status,
      events,
      generatedAt: new Date(),
      generatedBy: username
    };

    return casebook;
  } catch (error: any) {
    logger.error('Error getting casebook data for print', { error: error.message, studySubjectId });
    throw error;
  }
}

/**
 * Get audit trail for printing
 */
export async function getAuditTrailForPrint(
  entityType: string,
  entityId: number,
  username: string
): Promise<PrintableAuditTrail | null> {
  logger.info('Getting audit trail for print', { entityType, entityId });

  try {
    // Build entity name
    let entityName = '';
    if (entityType === 'event_crf') {
      const nameQuery = `
        SELECT c.name as crf_name, ss.label as subject_label
        FROM event_crf ec
        INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        INNER JOIN crf c ON cv.crf_id = c.crf_id
        INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
        INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
        WHERE ec.event_crf_id = $1
      `;
      const nameResult = await pool.query(nameQuery, [entityId]);
      if (nameResult.rows.length > 0) {
        entityName = `${nameResult.rows[0].crf_name} - ${nameResult.rows[0].subject_label}`;
      }
    } else if (entityType === 'study_subject') {
      const nameQuery = `
        SELECT ss.label as subject_label, s.name as study_name
        FROM study_subject ss
        INNER JOIN study s ON ss.study_id = s.study_id
        WHERE ss.study_subject_id = $1
      `;
      const nameResult = await pool.query(nameQuery, [entityId]);
      if (nameResult.rows.length > 0) {
        entityName = `${nameResult.rows[0].subject_label} - ${nameResult.rows[0].study_name}`;
      }
    }

    // Get audit entries
    const auditQuery = `
      SELECT 
        ale.audit_id,
        ale.audit_date,
        alet.name as action,
        ale.audit_table as entity_type,
        ale.entity_id,
        ale.old_value,
        ale.new_value,
        ale.reason_for_change,
        u.user_name as username,
        u.first_name || ' ' || u.last_name as user_full_name
      FROM audit_log_event ale
      INNER JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      WHERE ale.audit_table = $1 AND ale.entity_id = $2
      ORDER BY ale.audit_date DESC
    `;

    const auditResult = await pool.query(auditQuery, [entityType, entityId]);

    const entries: AuditTrailEntry[] = auditResult.rows.map(row => ({
      auditId: row.audit_id,
      auditDate: row.audit_date,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      oldValue: row.old_value,
      newValue: row.new_value,
      username: row.username,
      userFullName: row.user_full_name,
      reasonForChange: row.reason_for_change
    }));

    return {
      entityType,
      entityId,
      entityName,
      entries,
      generatedAt: new Date(),
      generatedBy: username
    };
  } catch (error: any) {
    logger.error('Error getting audit trail for print', { error: error.message, entityType, entityId });
    throw error;
  }
}

/**
 * Generate HTML for form PDF
 */
export function generateFormHtml(form: PrintableForm, options: PDFGenerationOptions): string {
  const styles = getPdfStyles();
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${form.formName} - ${form.subjectLabel}</title>
  <style>${styles}</style>
</head>
<body>
`;

  // Add watermark if specified
  if (options.watermark) {
    html += `<div class="watermark">${options.watermark}</div>`;
  }

  // Header
  if (options.includeHeader) {
    html += `
    <div class="header">
      <div class="header-row">
        <div class="header-left">
          <strong>${form.studyName}</strong><br>
          Site: ${form.siteName}
        </div>
        <div class="header-right">
          <strong>Subject: ${form.subjectLabel}</strong><br>
          Event: ${form.eventName}
        </div>
      </div>
      <h1>${form.formName}</h1>
      <div class="form-info">
        <span>Version: ${form.formVersion}</span>
        <span>Status: ${form.status}</span>
        ${form.completedDate ? `<span>Completed: ${new Date(form.completedDate).toLocaleDateString()}</span>` : ''}
        ${form.completedBy ? `<span>By: ${form.completedBy}</span>` : ''}
      </div>
      <div class="status-indicators">
        ${form.signatureStatus ? '<span class="badge badge-signed">✓ Signed</span>' : ''}
        ${form.sdvStatus ? '<span class="badge badge-sdv">✓ SDV</span>' : ''}
        ${form.lockStatus ? '<span class="badge badge-locked">🔒 Locked</span>' : ''}
      </div>
    </div>
    `;
  }

  // Sections
  for (const section of form.sections) {
    html += `
    <div class="section">
      <h2 class="section-title">${section.title}</h2>
      ${section.subtitle ? `<p class="section-subtitle">${section.subtitle}</p>` : ''}
      ${section.instructions ? `<p class="section-instructions">${section.instructions}</p>` : ''}
      
      <table class="fields-table">
        <thead>
          <tr>
            <th style="width: 40%">Field</th>
            <th style="width: 50%">Value</th>
            <th style="width: 10%">Unit</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const field of section.fields) {
      const requiredMark = field.required ? '<span class="required">*</span>' : '';
      const statusClass = field.status === 'missing' ? 'field-missing' : 
                          field.status === 'queried' ? 'field-queried' : '';
      
      let valueDisplay = field.displayValue || field.value || '';
      
      // Handle different field types
      if (field.type === 'checkbox' && field.options) {
        valueDisplay = field.options
          .filter(o => field.value?.includes(o.value))
          .map(o => `☑ ${o.label}`)
          .join(', ') || '☐ (none selected)';
      } else if (field.type === 'radio' && field.options) {
        const selected = field.options.find(o => o.value === field.value);
        valueDisplay = selected ? `○ ${selected.label}` : '';
      } else if (!valueDisplay && form.status === 'BLANK TEMPLATE') {
        valueDisplay = '________________________';
      }

      html += `
        <tr class="${statusClass}">
          <td>${field.label}${requiredMark}</td>
          <td>${valueDisplay}</td>
          <td>${field.unit || ''}</td>
        </tr>
      `;
    }

    html += `
        </tbody>
      </table>
    </div>
    `;
  }

  // Footer
  if (options.includeFooter) {
    html += `
    <div class="footer">
      <div class="footer-left">
        Printed: ${new Date().toLocaleString()}
      </div>
      <div class="footer-right">
        Page <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>
    </div>
    `;
  }

  html += `
</body>
</html>
`;

  return html;
}

/**
 * Generate HTML for casebook PDF
 */
export function generateCasebookHtml(casebook: PrintableCasebook, options: PDFGenerationOptions): string {
  const styles = getPdfStyles();
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Casebook - ${casebook.subjectLabel}</title>
  <style>${styles}</style>
</head>
<body>
`;

  if (options.watermark) {
    html += `<div class="watermark">${options.watermark}</div>`;
  }

  // Cover page
  html += `
  <div class="cover-page">
    <h1>Patient Casebook</h1>
    <div class="cover-info">
      <p><strong>Subject ID:</strong> ${casebook.subjectLabel}</p>
      <p><strong>Study:</strong> ${casebook.studyName}</p>
      <p><strong>Site:</strong> ${casebook.siteName}</p>
      <p><strong>Enrollment Date:</strong> ${new Date(casebook.enrollmentDate).toLocaleDateString()}</p>
      <p><strong>Status:</strong> ${casebook.status}</p>
    </div>
    <div class="generated-info">
      <p>Generated: ${new Date(casebook.generatedAt).toLocaleString()}</p>
      <p>By: ${casebook.generatedBy}</p>
    </div>
  </div>
  <div class="page-break"></div>
  `;

  // Table of contents
  html += `
  <div class="toc">
    <h2>Table of Contents</h2>
    <ul>
  `;

  for (const event of casebook.events) {
    html += `<li>${event.eventName} (${event.forms.length} forms)</li>`;
  }

  html += `
    </ul>
  </div>
  <div class="page-break"></div>
  `;

  // Each event
  for (const event of casebook.events) {
    html += `
    <div class="event-section">
      <h2>${event.eventName}</h2>
      <p class="event-info">
        Date: ${event.eventDate ? new Date(event.eventDate).toLocaleDateString() : 'Not scheduled'}
        | Status: ${event.status}
      </p>
    `;

    for (const form of event.forms) {
      // Generate form HTML (simplified for casebook)
      html += generateFormHtml(form, { ...options, includeHeader: false, includeFooter: false });
    }

    html += `
    </div>
    <div class="page-break"></div>
    `;
  }

  html += `
</body>
</html>
`;

  return html;
}

/**
 * Generate HTML for audit trail PDF
 */
export function generateAuditTrailHtml(auditTrail: PrintableAuditTrail, options: PDFGenerationOptions): string {
  const styles = getPdfStyles();
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Audit Trail - ${auditTrail.entityName}</title>
  <style>${styles}</style>
</head>
<body>
  <div class="header">
    <h1>Audit Trail Report</h1>
    <div class="audit-info">
      <p><strong>Entity Type:</strong> ${auditTrail.entityType}</p>
      <p><strong>Entity:</strong> ${auditTrail.entityName}</p>
      <p><strong>Generated:</strong> ${new Date(auditTrail.generatedAt).toLocaleString()}</p>
      <p><strong>Generated By:</strong> ${auditTrail.generatedBy}</p>
    </div>
  </div>

  <table class="audit-table">
    <thead>
      <tr>
        <th>Date/Time</th>
        <th>Action</th>
        <th>User</th>
        <th>Old Value</th>
        <th>New Value</th>
        <th>Reason</th>
      </tr>
    </thead>
    <tbody>
`;

  for (const entry of auditTrail.entries) {
    html += `
      <tr>
        <td>${new Date(entry.auditDate).toLocaleString()}</td>
        <td>${entry.action}</td>
        <td>${entry.userFullName || entry.username}</td>
        <td>${truncateValue(entry.oldValue)}</td>
        <td>${truncateValue(entry.newValue)}</td>
        <td>${entry.reasonForChange || '-'}</td>
      </tr>
    `;
  }

  html += `
    </tbody>
  </table>

  <div class="footer">
    <p>Total entries: ${auditTrail.entries.length}</p>
    <p>21 CFR Part 11 Compliant Audit Trail</p>
  </div>
</body>
</html>
`;

  return html;
}

/**
 * Helper to truncate long values
 */
function truncateValue(value?: string, maxLength: number = 50): string {
  if (!value) return '-';
  if (value.length <= maxLength) return value;
  return value.substring(0, maxLength) + '...';
}

/**
 * Get CSS styles for PDF
 */
function getPdfStyles(): string {
  return `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Helvetica', 'Arial', sans-serif;
      font-size: 10pt;
      line-height: 1.4;
      color: #333;
      padding: 20px;
    }
    
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 72pt;
      color: rgba(200, 200, 200, 0.3);
      z-index: -1;
      pointer-events: none;
    }
    
    .header {
      border-bottom: 2px solid #333;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    
    .header-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    
    .header-left, .header-right {
      width: 45%;
    }
    
    .header-right {
      text-align: right;
    }
    
    h1 {
      font-size: 18pt;
      margin: 10px 0;
    }
    
    h2 {
      font-size: 14pt;
      margin: 15px 0 10px 0;
      color: #444;
    }
    
    .form-info {
      font-size: 9pt;
      color: #666;
    }
    
    .form-info span {
      margin-right: 20px;
    }
    
    .status-indicators {
      margin-top: 10px;
    }
    
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 8pt;
      margin-right: 5px;
    }
    
    .badge-signed { background: #d4edda; color: #155724; }
    .badge-sdv { background: #cce5ff; color: #004085; }
    .badge-locked { background: #f8d7da; color: #721c24; }
    
    .section {
      margin: 20px 0;
      page-break-inside: avoid;
    }
    
    .section-title {
      background: #f0f0f0;
      padding: 8px;
      border-left: 4px solid #333;
    }
    
    .section-subtitle {
      font-style: italic;
      margin: 5px 0;
      color: #666;
    }
    
    .section-instructions {
      background: #fff9e6;
      padding: 8px;
      margin: 5px 0;
      border-left: 3px solid #ffc107;
      font-size: 9pt;
    }
    
    .fields-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    
    .fields-table th, .fields-table td {
      border: 1px solid #ddd;
      padding: 6px 8px;
      text-align: left;
    }
    
    .fields-table th {
      background: #f5f5f5;
      font-weight: bold;
    }
    
    .fields-table tr:nth-child(even) {
      background: #fafafa;
    }
    
    .required {
      color: red;
      font-weight: bold;
    }
    
    .field-missing {
      background: #fff3cd !important;
    }
    
    .field-queried {
      background: #f8d7da !important;
    }
    
    .footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 10px 20px;
      border-top: 1px solid #ddd;
      font-size: 8pt;
      color: #666;
      display: flex;
      justify-content: space-between;
    }
    
    .page-break {
      page-break-after: always;
    }
    
    .cover-page {
      text-align: center;
      padding-top: 100px;
    }
    
    .cover-page h1 {
      font-size: 28pt;
      margin-bottom: 50px;
    }
    
    .cover-info {
      font-size: 14pt;
      margin: 30px 0;
    }
    
    .cover-info p {
      margin: 10px 0;
    }
    
    .generated-info {
      margin-top: 100px;
      font-size: 10pt;
      color: #666;
    }
    
    .toc {
      padding: 20px;
    }
    
    .toc ul {
      list-style: none;
      padding-left: 20px;
    }
    
    .toc li {
      padding: 5px 0;
      border-bottom: 1px dotted #ddd;
    }
    
    .event-section {
      margin: 20px 0;
    }
    
    .event-info {
      font-size: 9pt;
      color: #666;
      margin-bottom: 10px;
    }
    
    .audit-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
    }
    
    .audit-table th, .audit-table td {
      border: 1px solid #ddd;
      padding: 4px 6px;
      text-align: left;
    }
    
    .audit-table th {
      background: #f0f0f0;
    }
    
    .audit-info {
      margin-bottom: 20px;
    }
    
    @media print {
      .watermark {
        position: fixed;
      }
      
      .page-break {
        page-break-after: always;
      }
    }
  `;
}

/**
 * Generate PDF from HTML using built-in approach (for environments without puppeteer)
 * Returns HTML that can be rendered by the browser for printing
 */
export async function generateFormPDF(
  eventCrfId: number,
  options: Partial<PDFGenerationOptions> = {},
  userId: number,
  username: string
): Promise<PDFGenerationResult> {
  logger.info('Generating form PDF', { eventCrfId, options, userId });

  try {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    const formData = await getFormDataForPrint(eventCrfId);

    if (!formData) {
      return { success: false, error: 'Form not found' };
    }

    // Determine watermark based on form status
    if (!mergedOptions.watermark) {
      if (formData.lockStatus) {
        mergedOptions.watermark = 'LOCKED';
      } else if (formData.sdvStatus) {
        mergedOptions.watermark = 'SDV_COMPLETE';
      } else if (formData.signatureStatus) {
        mergedOptions.watermark = 'VERIFIED';
      }
    }

    const html = generateFormHtml(formData, mergedOptions);
    const buffer = Buffer.from(html, 'utf-8');

    // Log print event to audit trail
    await logPrintEvent(eventCrfId, 'form', userId, username);

    return {
      success: true,
      buffer,
      filename: `${formData.formName}_${formData.subjectLabel}_${Date.now()}.html`,
      contentType: 'text/html'
    };
  } catch (error: any) {
    logger.error('Error generating form PDF', { error: error.message, eventCrfId });
    return { success: false, error: error.message };
  }
}

/**
 * Generate blank form PDF
 */
export async function generateBlankFormPDF(
  crfVersionId: number,
  options: Partial<PDFGenerationOptions> = {},
  userId: number,
  username: string
): Promise<PDFGenerationResult> {
  logger.info('Generating blank form PDF', { crfVersionId, options, userId });

  try {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options, watermark: 'DRAFT' as const };
    const formData = await getBlankFormDataForPrint(crfVersionId);

    if (!formData) {
      return { success: false, error: 'Form template not found' };
    }

    const html = generateFormHtml(formData, mergedOptions);
    const buffer = Buffer.from(html, 'utf-8');

    // Log print event
    await logPrintEvent(crfVersionId, 'blank_form', userId, username);

    return {
      success: true,
      buffer,
      filename: `${formData.formName}_BLANK_${Date.now()}.html`,
      contentType: 'text/html'
    };
  } catch (error: any) {
    logger.error('Error generating blank form PDF', { error: error.message, crfVersionId });
    return { success: false, error: error.message };
  }
}

/**
 * Generate casebook PDF
 */
export async function generateCasebookPDF(
  studySubjectId: number,
  options: Partial<PDFGenerationOptions> = {},
  userId: number,
  username: string
): Promise<PDFGenerationResult> {
  logger.info('Generating casebook PDF', { studySubjectId, options, userId });

  try {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    const casebookData = await getCasebookDataForPrint(studySubjectId, username);

    if (!casebookData) {
      return { success: false, error: 'Subject not found' };
    }

    const html = generateCasebookHtml(casebookData, mergedOptions);
    const buffer = Buffer.from(html, 'utf-8');

    // Log print event
    await logPrintEvent(studySubjectId, 'casebook', userId, username);

    return {
      success: true,
      buffer,
      filename: `Casebook_${casebookData.subjectLabel}_${Date.now()}.html`,
      contentType: 'text/html'
    };
  } catch (error: any) {
    logger.error('Error generating casebook PDF', { error: error.message, studySubjectId });
    return { success: false, error: error.message };
  }
}

/**
 * Generate audit trail PDF
 */
export async function generateAuditTrailPDF(
  entityType: string,
  entityId: number,
  options: Partial<PDFGenerationOptions> = {},
  userId: number,
  username: string
): Promise<PDFGenerationResult> {
  logger.info('Generating audit trail PDF', { entityType, entityId, options, userId });

  try {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    const auditData = await getAuditTrailForPrint(entityType, entityId, username);

    if (!auditData) {
      return { success: false, error: 'Audit trail not found' };
    }

    const html = generateAuditTrailHtml(auditData, mergedOptions);
    const buffer = Buffer.from(html, 'utf-8');

    // Log print event
    await logPrintEvent(entityId, 'audit_trail', userId, username);

    return {
      success: true,
      buffer,
      filename: `AuditTrail_${entityType}_${entityId}_${Date.now()}.html`,
      contentType: 'text/html'
    };
  } catch (error: any) {
    logger.error('Error generating audit trail PDF', { error: error.message, entityType, entityId });
    return { success: false, error: error.message };
  }
}

/**
 * Log print event to audit trail
 */
async function logPrintEvent(
  entityId: number,
  printType: string,
  userId: number,
  username: string
): Promise<void> {
  try {
    const query = `
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        new_value, audit_log_event_type_id
      ) VALUES (
        CURRENT_TIMESTAMP, $1, $2, $3, 'Document Printed',
        $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%View%' OR name LIKE '%Access%' LIMIT 1)
      )
    `;

    await pool.query(query, [
      printType,
      userId,
      entityId,
      JSON.stringify({
        type: 'print',
        printType,
        timestamp: new Date().toISOString(),
        user: username
      })
    ]);
  } catch (error: any) {
    logger.warn('Failed to log print event', { error: error.message });
  }
}

export default {
  getFormDataForPrint,
  getBlankFormDataForPrint,
  getCasebookDataForPrint,
  getAuditTrailForPrint,
  generateFormPDF,
  generateBlankFormPDF,
  generateCasebookPDF,
  generateAuditTrailPDF,
  generateFormHtml,
  generateCasebookHtml,
  generateAuditTrailHtml
};

