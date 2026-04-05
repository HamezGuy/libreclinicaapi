/**
 * Restore options, branching rules, and PHI flags for Ashwin's account.
 *
 * What was lost:
 *   - Dropdown/checkbox/radio options in extended properties
 *   - showWhen branching rules in extended properties
 *   - isPhiField flags in extended properties
 *
 * What is still intact (authoritative sources):
 *   - response_set.options_text / options_values (options for select/radio/checkbox)
 *   - item.phi_status (PHI flag)
 *   - scd_item_metadata (branching rules in the SCD table)
 *
 * This script merges the authoritative DB data back into each item's
 * extended properties (item.description) without overwriting any
 * properties that are already correct.
 *
 * Usage: node restore-ashwin-data.js
 * Run from the API container or with proper DB env vars set.
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.LIBRECLINICA_DB_HOST || 'postgres',
  port: parseInt(process.env.LIBRECLINICA_DB_PORT || '5432'),
  database: process.env.LIBRECLINICA_DB_NAME || 'libreclinica',
  user: process.env.LIBRECLINICA_DB_USER || 'libreclinica',
  password: process.env.LIBRECLINICA_DB_PASSWORD || 'libreclinica',
});

const DELIMITER = '---EXTENDED_PROPS---';

function parseExtendedProps(description) {
  if (!description || !description.includes(DELIMITER)) return {};
  try {
    const json = description.split(DELIMITER)[1]?.trim();
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

function stripExtendedProps(description) {
  if (!description) return '';
  const idx = description.indexOf(DELIMITER);
  return idx >= 0 ? description.substring(0, idx).trim() : description;
}

function rebuildDescription(helpText, extendedProps) {
  const cleanProps = { ...extendedProps };
  for (const key of Object.keys(cleanProps)) {
    if (cleanProps[key] === undefined || cleanProps[key] === null) {
      delete cleanProps[key];
    }
  }
  const json = JSON.stringify(cleanProps);
  if (helpText) {
    return `${helpText}\n${DELIMITER}\n${json}`;
  }
  return `${DELIMITER}\n${json}`;
}

async function main() {
  const client = await pool.connect();

  try {
    // Find Ashwin's user account
    const userResult = await client.query(`
      SELECT user_id, user_name, first_name, last_name
      FROM user_account
      WHERE LOWER(user_name) LIKE '%ashwin%'
         OR LOWER(first_name) LIKE '%ashwin%'
         OR LOWER(last_name) LIKE '%ashwin%'
    `);

    if (userResult.rows.length === 0) {
      console.log('No user matching "ashwin" found. Restoring ALL forms instead.');
    } else {
      console.log('Found user(s):', userResult.rows.map(r => `${r.user_name} (${r.first_name} ${r.last_name}, id=${r.user_id})`).join(', '));
    }

    // Get all CRF versions (restore globally since the bug could have affected any form saved)
    const crfVersions = await client.query(`
      SELECT DISTINCT cv.crf_version_id, cv.crf_id, c.name as crf_name
      FROM crf_version cv
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      WHERE c.status_id = 1
      ORDER BY cv.crf_id
    `);

    console.log(`\nProcessing ${crfVersions.rows.length} CRF versions...`);
    let totalItemsFixed = 0;
    let totalOptionsRestored = 0;
    let totalPhiRestored = 0;
    let totalBranchingRestored = 0;

    for (const cv of crfVersions.rows) {
      const crfVersionId = cv.crf_version_id;
      const crfName = cv.crf_name;

      // Get all items for this CRF version with their response_set data and SCD data
      const itemsResult = await client.query(`
        SELECT 
          i.item_id, i.name, i.description, i.phi_status, i.units,
          ifm.item_form_metadata_id, ifm.required,
          rs.options_text, rs.options_values, rs.response_set_id,
          rt.name as response_type
        FROM item i
        INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = $1
        LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id
        LEFT JOIN response_type rt ON rs.response_type_id = rt.response_type_id
        WHERE ifm.show_item = true
        ORDER BY COALESCE(ifm.ordinal, 0)
      `, [crfVersionId]);

      if (itemsResult.rows.length === 0) continue;

      // Get SCD (branching) rules for this CRF version
      const scdResult = await client.query(`
        SELECT 
          scd.scd_item_form_metadata_id AS target_ifm_id,
          scd.control_item_name,
          scd.option_value,
          scd.message,
          target_item.item_id AS target_item_id
        FROM scd_item_metadata scd
        INNER JOIN item_form_metadata target_ifm ON scd.scd_item_form_metadata_id = target_ifm.item_form_metadata_id
        INNER JOIN item target_item ON target_ifm.item_id = target_item.item_id
        WHERE target_ifm.crf_version_id = $1
      `, [crfVersionId]);

      // Build SCD map: target_item_id -> showWhen conditions
      const scdMap = new Map();
      for (const row of scdResult.rows) {
        const conditions = scdMap.get(row.target_item_id) || [];
        let operator = 'equals';
        try {
          const parsed = JSON.parse(row.message || '{}');
          operator = parsed.operator || 'equals';
        } catch { /* not JSON */ }
        conditions.push({
          fieldId: row.control_item_name,
          value: row.option_value || '',
          operator
        });
        scdMap.set(row.target_item_id, conditions);
      }

      let crfFixCount = 0;

      for (const item of itemsResult.rows) {
        const existingExtended = parseExtendedProps(item.description);
        const helpText = stripExtendedProps(item.description);
        let changed = false;

        // 1. Restore options from response_set
        if (item.options_text && item.options_values) {
          const labels = item.options_text.split('\n').filter(s => s.trim());
          const values = item.options_values.split('\n').filter(s => s.trim());
          if (labels.length > 0 && values.length > 0) {
            const optionsFromDb = labels.map((label, idx) => ({
              label: label.trim(),
              value: (values[idx] || label).trim()
            }));

            const existingOptions = existingExtended.options || [];
            const existingStr = JSON.stringify(existingOptions);
            const newStr = JSON.stringify(optionsFromDb);
            if (existingStr !== newStr && optionsFromDb.length > 0) {
              // Only restore if DB has options that extended props don't
              if (!existingOptions.length || existingOptions.length < optionsFromDb.length) {
                existingExtended.options = optionsFromDb;
                changed = true;
                totalOptionsRestored++;
              }
            }
          }
        }

        // 2. Restore PHI flag from item.phi_status
        if (item.phi_status === true && existingExtended.isPhiField !== true) {
          existingExtended.isPhiField = true;
          changed = true;
          totalPhiRestored++;
        }

        // 3. Restore showWhen from SCD table
        const scdConditions = scdMap.get(item.item_id);
        if (scdConditions && scdConditions.length > 0) {
          const existingShowWhen = existingExtended.showWhen || [];
          if (!existingShowWhen.length) {
            existingExtended.showWhen = scdConditions;
            changed = true;
            totalBranchingRestored++;
          }
        }

        if (changed) {
          const newDescription = rebuildDescription(helpText, existingExtended);
          await client.query(`
            UPDATE item SET description = $1, date_updated = NOW()
            WHERE item_id = $2
          `, [newDescription, item.item_id]);
          crfFixCount++;
          totalItemsFixed++;
        }
      }

      if (crfFixCount > 0) {
        console.log(`  [${crfName}] Fixed ${crfFixCount} items`);
      }
    }

    // Also rebuild patient_event_form snapshots for affected forms
    console.log('\nRebuilding patient_event_form snapshots...');
    const snapshotResult = await client.query(`
      SELECT DISTINCT pef.crf_id, pef.crf_version_id, pef.patient_event_form_id
      FROM patient_event_form pef
    `);

    let snapshotsFixed = 0;
    for (const pef of snapshotResult.rows) {
      const itemsResult = await client.query(`
        SELECT i.item_id, i.name, i.description, i.phi_status, i.units, i.oc_oid,
          idt.name as data_type,
          igm.ordinal, ig.name as group_name,
          ifm.required, ifm.left_item_text as label, ifm.show_item,
          rs.options_text, rs.options_values, rt.name as response_type,
          s.label as section_name
        FROM item i
        INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id AND igm.crf_version_id = $1
        INNER JOIN item_group ig ON igm.item_group_id = ig.item_group_id
        INNER JOIN item_data_type idt ON i.item_data_type_id = idt.item_data_type_id
        LEFT JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = $1
        LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id
        LEFT JOIN response_type rt ON rs.response_type_id = rt.response_type_id
        LEFT JOIN section s ON ifm.section_id = s.section_id
        WHERE ifm.show_item = true
        ORDER BY COALESCE(ifm.ordinal, igm.ordinal, 0)
      `, [pef.crf_version_id]);

      if (itemsResult.rows.length === 0) continue;

      const fields = itemsResult.rows.map(item => {
        const extended = parseExtendedProps(item.description);
        const field = {
          id: item.item_id,
          name: item.name,
          label: item.label || item.name,
          type: extended.type || 'text',
          required: item.required === true,
          ordinal: item.ordinal,
          ...extended
        };

        // Ensure options from response_set are included
        if (item.options_text && item.options_values) {
          const labels = item.options_text.split('\n').filter(s => s.trim());
          const values = item.options_values.split('\n').filter(s => s.trim());
          if (labels.length > 0) {
            field.options = labels.map((label, idx) => ({
              label: label.trim(),
              value: (values[idx] || label).trim()
            }));
          }
        }

        if (item.phi_status) field.isPhiField = true;

        return field;
      });

      const snapshot = {
        crfId: pef.crf_id,
        crfVersionId: pef.crf_version_id,
        snapshotDate: new Date().toISOString(),
        fieldCount: fields.length,
        fields
      };

      await client.query(`
        UPDATE patient_event_form SET form_structure = $1::jsonb
        WHERE patient_event_form_id = $2
      `, [JSON.stringify(snapshot), pef.patient_event_form_id]);
      snapshotsFixed++;
    }

    console.log(`\n=== RESTORATION COMPLETE ===`);
    console.log(`Items fixed:           ${totalItemsFixed}`);
    console.log(`Options restored:      ${totalOptionsRestored}`);
    console.log(`PHI flags restored:    ${totalPhiRestored}`);
    console.log(`Branching restored:    ${totalBranchingRestored}`);
    console.log(`Snapshots rebuilt:     ${snapshotsFixed}`);

  } catch (error) {
    console.error('Restoration failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
