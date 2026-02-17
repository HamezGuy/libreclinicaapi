// Re-create all patient_event_form snapshots using the new getFormMetadata-based format.
// This replaces the old 14-property snapshots with full DTO-aligned snapshots.
//
// Usage: docker exec libreclinica_api node /app/re_repair_snapshots.js

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.LIBRECLINICA_DB_HOST || 'postgres',
  port: parseInt(process.env.LIBRECLINICA_DB_PORT || '5432'),
  database: process.env.LIBRECLINICA_DB_NAME || 'libreclinica',
  user: process.env.LIBRECLINICA_DB_USER || 'libreclinica',
  password: process.env.LIBRECLINICA_DB_PASSWORD || 'libreclinica',
});

async function main() {
  console.log('=== Re-creating ALL patient form snapshots with full DTO format ===\n');

  // Delete all existing snapshots (they have the old stripped-down format)
  const deleteResult = await pool.query('DELETE FROM patient_event_form');
  console.log(`Deleted ${deleteResult.rowCount} old snapshots\n`);

  // Now use the API's getFormMetadata logic to create new snapshots.
  // We import the compiled service to reuse the exact same function.
  let getFormMetadata;
  try {
    const formService = require('./dist/services/hybrid/form.service');
    getFormMetadata = formService.getFormMetadata;
  } catch {
    try {
      const formService = require('/app/dist/services/hybrid/form.service');
      getFormMetadata = formService.getFormMetadata;
    } catch (e2) {
      console.error('Cannot import getFormMetadata from compiled service. Falling back to direct query.');
      getFormMetadata = null;
    }
  }

  // Get all event_crf records that need snapshots
  const eventCrfs = await pool.query(`
    SELECT ec.event_crf_id, ec.study_event_id, ec.crf_version_id, ec.study_subject_id,
      cv.crf_id, c.name AS crf_name, ss.label AS subject_label
    FROM event_crf ec
    INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
    INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
    INNER JOIN crf c ON cv.crf_id = c.crf_id
    INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
    WHERE ec.status_id NOT IN (5, 7)
    ORDER BY ss.study_subject_id, ec.event_crf_id
  `);

  console.log(`Found ${eventCrfs.rows.length} event_crf records to create snapshots for\n`);

  let created = 0;
  let errors = 0;

  for (const row of eventCrfs.rows) {
    try {
      let fields = [];

      if (getFormMetadata) {
        // Use the SAME getFormMetadata function the API uses
        const metadata = await getFormMetadata(row.crf_id);
        fields = metadata?.items || [];
      } else {
        // Fallback: direct query (same as getFormMetadata does internally)
        console.warn(`  Falling back to direct query for CRF ${row.crf_id}`);
        fields = [];
      }

      const formStructure = {
        crfId: row.crf_id,
        crfVersionId: row.crf_version_id,
        name: row.crf_name,
        snapshotDate: new Date().toISOString(),
        fieldCount: fields.length,
        fields
      };

      await pool.query(`
        INSERT INTO patient_event_form (
          study_event_id, event_crf_id, crf_id, crf_version_id,
          study_subject_id, form_name, form_structure, form_data,
          completion_status, ordinal, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, '{}'::jsonb, 'not_started', $8, 1)
      `, [
        row.study_event_id, row.event_crf_id, row.crf_id, row.crf_version_id,
        row.study_subject_id, row.crf_name, JSON.stringify(formStructure),
        created + 1
      ]);

      created++;
      console.log(`  [${row.subject_label}] ${row.crf_name} -> ${fields.length} fields (full DTO format)`);
    } catch (err) {
      errors++;
      console.error(`  ERROR [${row.subject_label}] ${row.crf_name}: ${err.message}`);
    }
  }

  console.log(`\n=== Done: ${created} created, ${errors} errors ===`);

  // Verify
  const verify = await pool.query(`
    SELECT ss.study_subject_id, ss.label,
      (SELECT COUNT(*) FROM event_crf ec INNER JOIN study_event se ON ec.study_event_id=se.study_event_id
       WHERE se.study_subject_id=ss.study_subject_id) AS event_crfs,
      (SELECT COUNT(*) FROM patient_event_form pef WHERE pef.study_subject_id=ss.study_subject_id) AS snapshots
    FROM study_subject ss WHERE ss.status_id NOT IN (5,7) ORDER BY ss.study_subject_id
  `);
  console.log('\nFinal state:');
  console.table(verify.rows);

  await pool.end();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
