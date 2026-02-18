/**
 * Script 04 — Create Validation eCRF Copies
 *
 * NOTE: The fork endpoint has a known bug (missing crf_id in item_group INSERT).
 * The fix has been applied to form.service.ts but may not be deployed yet.
 *
 * Strategy: Try fork first; if it fails, fall back to creating independent forms
 * with the same field definitions and "- Validation" in the name.
 */

import { apiCall } from '../lib/api-client';
import { logHeader, logPass, logWarn, logInfo } from '../lib/logger';
import { loadState, updateState } from '../lib/state';

const SCRIPT = '04-fork-ecrfs-validation';

// Re-use the field definitions from script 03
import { ECRF1_FIELDS, ECRF2_FIELDS } from './03-create-base-ecrfs';

async function forkOrCreate(
  sourceId: number,
  newName: string,
  description: string,
  fields: any[],
  stepLabel: string,
): Promise<{ crfId: number; versionId?: number } | null> {
  // Attempt fork first
  const forkRes = await apiCall({
    method: 'POST',
    url: `/forms/${sourceId}/fork`,
    script: SCRIPT,
    step: `${stepLabel} (fork)`,
    data: { newName, description },
  });

  if (forkRes.ok) {
    const d = forkRes.data as any;
    const crfId = d.data?.crfId ?? d.crfId ?? d.data?.crf_id ?? d.data?.newCrfId ?? d.newCrfId;
    const versionId = d.data?.crfVersionId ?? d.crfVersionId;
    logPass(SCRIPT, `${stepLabel} — forked successfully (CRF ID: ${crfId})`);
    return { crfId, versionId };
  }

  // Fork failed — fall back to creating a new form
  logWarn(SCRIPT, stepLabel, 'Fork failed (known bug: item_group.crf_id). Creating form from scratch instead.');

  const createRes = await apiCall({
    method: 'POST',
    url: '/forms',
    script: SCRIPT,
    step: `${stepLabel} (create fallback)`,
    data: {
      name: newName,
      description,
      category: 'clinical',
      version: 'v1.0',
      status: 'published',
      fields,
    },
  });

  if (createRes.ok) {
    const d = createRes.data as any;
    const crfId = d.data?.crfId ?? d.crfId ?? d.data?.crf_id;
    const versionId = d.data?.crfVersionId ?? d.crfVersionId;
    logPass(SCRIPT, `${stepLabel} — created as new form (CRF ID: ${crfId})`);
    return { crfId, versionId };
  }

  return null;
}

async function run(): Promise<boolean> {
  logHeader('04 — Fork/Create eCRFs for Validation');

  const state = loadState();
  if (!state.baseCrf1Id || !state.baseCrf2Id) {
    logInfo('Base CRF IDs missing — run script 03 first');
    return false;
  }

  const v1 = await forkOrCreate(
    state.baseCrf1Id,
    'General Assessment Form - Validation',
    'Validation testing copy. Has validation rules for heart rate, pain level, dates, and notes.',
    ECRF1_FIELDS,
    'Validation eCRF 1',
  );
  if (v1) {
    updateState({ validationCrf1Id: v1.crfId, validationCrf1VersionId: v1.versionId });
  }

  const v2 = await forkOrCreate(
    state.baseCrf2Id,
    'Lab Results & Procedures Form - Validation',
    'Validation testing copy. Has validation rules for lab values, BMI range, and required table fields.',
    ECRF2_FIELDS,
    'Validation eCRF 2',
  );
  if (v2) {
    updateState({ validationCrf2Id: v2.crfId, validationCrf2VersionId: v2.versionId });
  }

  return !!(v1 && v2);
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
