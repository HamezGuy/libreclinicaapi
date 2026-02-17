// Run snapshot repair for all patients directly (no auth needed)
// Usage: node run_repair.js (from within the API container)

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.LIBRECLINICA_DB_HOST || 'postgres',
  port: parseInt(process.env.LIBRECLINICA_DB_PORT || '5432'),
  database: process.env.LIBRECLINICA_DB_NAME || 'libreclinica',
  user: process.env.LIBRECLINICA_DB_USER || 'libreclinica',
  password: process.env.LIBRECLINICA_DB_PASSWORD || 'libreclinica',
});

async function createSnapshot(client, studyEventId, eventCrfId, crfId, crfVersionId, studySubjectId, formName, ordinal) {
  const itemsQuery = `
    SELECT i.item_id, i.name, i.description, i.units, i.oc_oid, i.phi_status,
      idt.name as data_type, idt.code as data_type_code,
      igm.ordinal, ig.name as group_name,
      ifm.required, ifm.default_value, ifm.left_item_text as label,
      ifm.regexp as validation_pattern, ifm.regexp_error_msg as validation_message,
      ifm.show_item, ifm.column_number,
      rs.options_text, rs.options_values, rt.name as response_type,
      s.label as section_name
    FROM item i
    INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
    INNER JOIN item_group ig ON igm.item_group_id = ig.item_group_id
    INNER JOIN item_data_type idt ON i.item_data_type_id = idt.item_data_type_id
    LEFT JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = $1
    LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id
    LEFT JOIN response_type rt ON rs.response_type_id = rt.response_type_id
    LEFT JOIN section s ON ifm.section_id = s.section_id
    WHERE igm.crf_version_id = $1 AND (ifm.show_item IS DISTINCT FROM false)
    ORDER BY COALESCE(s.ordinal, 0), COALESCE(ifm.ordinal, igm.ordinal)
  `;
  const itemsResult = await client.query(itemsQuery, [crfVersionId]);

  const fields = itemsResult.rows.map(item => {
    const field = {
      itemId: item.item_id,
      name: item.name,
      label: item.label || item.description || item.name,
      dataType: item.data_type_code || item.data_type,
      units: item.units || null,
      required: item.required || false,
      defaultValue: item.default_value || '',
      columnNumber: item.column_number || 1,
      section: item.section_name || 'Default',
      group: item.group_name || 'Ungrouped',
      ordinal: item.ordinal,
      phiStatus: item.phi_status || false
    };
    if (item.validation_pattern) {
      field.validationPattern = item.validation_pattern;
      field.validationMessage = item.validation_message || 'Invalid value';
    }
    if (item.options_text && item.options_values) {
      const dlm = item.options_text.includes('\n') ? '\n' : ',';
      const texts = item.options_text.split(dlm);
      const values = item.options_values.split(dlm);
      field.responseType = item.response_type;
      field.options = texts.map((t, i) => ({ label: t.trim(), value: (values[i] || t).trim() }));
    }
    return field;
  });

  const formStructure = {
    crfId, crfVersionId,
    name: formName,
    snapshotDate: new Date().toISOString(),
    fieldCount: fields.length,
    fields
  };

  const result = await client.query(`
    INSERT INTO patient_event_form (
      study_event_id, event_crf_id, crf_id, crf_version_id,
      study_subject_id, form_name, form_structure, form_data,
      completion_status, ordinal, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, '{}'::jsonb, 'not_started', $8, 1)
    RETURNING patient_event_form_id
  `, [studyEventId, eventCrfId, crfId, crfVersionId, studySubjectId, formName, JSON.stringify(formStructure), ordinal]);

  return { id: result.rows[0].patient_event_form_id, fields: fields.length };
}

async function main() {
  const client = await pool.connect();
  try {
    // Find event_crfs without snapshots
    const missing = await client.query(`
      SELECT ec.event_crf_id, ec.study_event_id, ec.crf_version_id, ec.study_subject_id,
        cv.crf_id, c.name AS crf_name, ss.label AS subject_label
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      LEFT JOIN patient_event_form pef ON pef.event_crf_id = ec.event_crf_id
      WHERE pef.patient_event_form_id IS NULL AND ec.status_id NOT IN (5,7)
      ORDER BY ss.study_subject_id, ec.event_crf_id
    `);

    console.log(`Found ${missing.rows.length} event_crf records without snapshots\n`);

    let repaired = 0;
    await client.query('BEGIN');
    for (const row of missing.rows) {
      try {
        const snap = await createSnapshot(
          client, row.study_event_id, row.event_crf_id,
          row.crf_id, row.crf_version_id, row.study_subject_id,
          row.crf_name, repaired + 1
        );
        repaired++;
        console.log(`  [${row.subject_label}] ${row.crf_name} -> snapshot #${snap.id} (${snap.fields} fields)`);
      } catch (err) {
        console.error(`  ERROR [${row.subject_label}] ${row.crf_name}: ${err.message}`);
      }
    }
    await client.query('COMMIT');

    console.log(`\nRepaired: ${repaired}/${missing.rows.length}`);

    // Verify
    const verify = await client.query(`
      SELECT ss.study_subject_id, ss.label,
        (SELECT COUNT(*) FROM event_crf ec INNER JOIN study_event se ON ec.study_event_id=se.study_event_id
         WHERE se.study_subject_id=ss.study_subject_id) AS event_crfs,
        (SELECT COUNT(*) FROM patient_event_form pef WHERE pef.study_subject_id=ss.study_subject_id) AS snapshots
      FROM study_subject ss WHERE ss.status_id NOT IN (5,7) ORDER BY ss.study_subject_id
    `);
    console.log('\nFinal state:');
    console.table(verify.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
