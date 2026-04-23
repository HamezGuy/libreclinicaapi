/**
 * Repair stale table_cell_target column IDs on Hematology validation rules.
 *
 * When a question_table is re-saved the frontend may regenerate answer-column
 * IDs (the "ans_xxxx" strings). Validation rules created before the re-save
 * still reference the OLD IDs, so the test/evaluation engine skips them with
 *   "column "ans_xyz" no longer exists on this table."
 *
 * This script:
 *   1. Reads the live column structure from item.description for item_id 2597
 *      (Hematology table).
 *   2. Reads every validation rule whose table_cell_target references item 2597.
 *   3. For each rule, matches the stored rowId to a question row, finds the
 *      FIRST numeric answer column in that row (the "Result" column), and
 *      patches the table_cell_target with the current column ID.
 *   4. Prints a dry-run report; pass --apply to commit the changes.
 *
 * Usage (from libreclinicaapi/):
 *   npx tsx scripts/repair-hematology-rule-targets.ts          # dry-run
 *   npx tsx scripts/repair-hematology-rule-targets.ts --apply  # commit
 */
/* eslint-disable no-console */

import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.LIBRECLINICA_DB_HOST || 'postgres',
  port: parseInt(process.env.LIBRECLINICA_DB_PORT || '5432'),
  database: process.env.LIBRECLINICA_DB_NAME || 'libreclinica',
  user: process.env.LIBRECLINICA_DB_USER || 'libreclinica',
  password: process.env.LIBRECLINICA_DB_PASSWORD || 'libreclinica',
});

const HEMATOLOGY_ITEM_ID = 2597;
const APPLY = process.argv.includes('--apply');

interface QuestionRow {
  id: string;
  question: string;
  answerColumns: { id: string; header: string; type: string }[];
}

async function main() {
  const client = await pool.connect();
  try {
    // ── 1. Read current table structure ──────────────────────────────
    const itemResult = await client.query(
      `SELECT description FROM item WHERE item_id = $1`,
      [HEMATOLOGY_ITEM_ID]
    );
    if (itemResult.rowCount === 0) {
      console.error(`ERROR: item_id ${HEMATOLOGY_ITEM_ID} not found`);
      process.exit(1);
    }

    let extProps: any;
    try {
      extProps = JSON.parse(itemResult.rows[0].description);
    } catch {
      console.error('ERROR: item.description is not valid JSON');
      process.exit(1);
    }

    const questionRows: QuestionRow[] = extProps.questionRows || [];
    if (questionRows.length === 0) {
      console.error('ERROR: no questionRows found in item.description');
      process.exit(1);
    }

    console.log(`\n=== Current Hematology Table Structure (item ${HEMATOLOGY_ITEM_ID}) ===\n`);
    const rowToResultColId = new Map<string, string>();

    for (const row of questionRows) {
      const resultCol = row.answerColumns?.find(
        c => c.type === 'number' || c.type === 'decimal' || c.type === 'integer'
      ) || row.answerColumns?.[0];

      if (resultCol) {
        rowToResultColId.set(row.id, resultCol.id);
      }
      console.log(
        `  row_id=${row.id}  question="${row.question}"  ` +
        `result_col_id=${resultCol?.id ?? '(none)'}  ` +
        `cols=[${(row.answerColumns || []).map(c => c.id).join(', ')}]`
      );
    }

    // ── 2. Read affected validation rules ────────────────────────────
    const rulesResult = await client.query(`
      SELECT validation_rule_id, name, table_cell_target
      FROM validation_rules
      WHERE table_cell_target IS NOT NULL
        AND (
          table_cell_target->>'tableItemId' = $1::text
          OR (item_id = $1 AND table_cell_target->>'tableItemId' IS NULL)
        )
      ORDER BY validation_rule_id
    `, [String(HEMATOLOGY_ITEM_ID)]);

    if (rulesResult.rowCount === 0) {
      console.log('\nNo validation rules found targeting Hematology table.');
      process.exit(0);
    }

    console.log(`\n=== Validation Rules Targeting Hematology (${rulesResult.rowCount} rules) ===\n`);

    const updates: { ruleId: number; ruleName: string; oldColId: string; newColId: string; target: any }[] = [];
    const skipped: { ruleId: number; ruleName: string; reason: string }[] = [];

    for (const rule of rulesResult.rows) {
      const target = rule.table_cell_target;
      const ruleId = rule.validation_rule_id;
      const ruleName = rule.name || `#${ruleId}`;
      const oldColId = target.columnId;
      const rowId = target.rowId;

      const currentColId = rowToResultColId.get(rowId);

      if (!currentColId) {
        skipped.push({ ruleId, ruleName, reason: `rowId "${rowId}" not found in current table` });
        continue;
      }

      if (oldColId === currentColId) {
        console.log(`  [OK]  Rule ${ruleId} "${ruleName}" — column ID already correct (${oldColId})`);
        continue;
      }

      updates.push({ ruleId, ruleName, oldColId, newColId: currentColId, target });
      console.log(
        `  [FIX] Rule ${ruleId} "${ruleName}" — ` +
        `columnId: "${oldColId}" → "${currentColId}" (row=${rowId})`
      );
    }

    for (const s of skipped) {
      console.log(`  [SKIP] Rule ${s.ruleId} "${s.ruleName}" — ${s.reason}`);
    }

    if (updates.length === 0) {
      console.log('\nAll rules already have correct column IDs. Nothing to do.');
      process.exit(0);
    }

    console.log(`\n${updates.length} rule(s) need updating.`);

    // ── 3. Apply updates ─────────────────────────────────────────────
    if (!APPLY) {
      console.log('\nDRY RUN — re-run with --apply to commit changes.');
      process.exit(0);
    }

    console.log('\nApplying updates...\n');
    await client.query('BEGIN');

    for (const u of updates) {
      const newTarget = { ...u.target, columnId: u.newColId };
      const displayParts = (newTarget.displayPath || '').split(' → ');
      if (displayParts.length >= 2) {
        displayParts[displayParts.length - 1] = `Column: ${u.newColId}`;
        newTarget.displayPath = displayParts.join(' → ');
      }

      await client.query(
        `UPDATE validation_rules
            SET table_cell_target = $1,
                date_updated = CURRENT_TIMESTAMP
          WHERE validation_rule_id = $2`,
        [JSON.stringify(newTarget), u.ruleId]
      );
      console.log(`  Updated rule ${u.ruleId} "${u.ruleName}"`);
    }

    await client.query('COMMIT');
    console.log(`\nDone. ${updates.length} rule(s) repaired.`);
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FATAL:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
