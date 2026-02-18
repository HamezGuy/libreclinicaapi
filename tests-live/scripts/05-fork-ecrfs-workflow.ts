/**
 * Script 05 — Create Workflow eCRF Copies
 *
 * Same strategy as script 04: try fork, fall back to creating independent forms.
 */

import { apiCall } from '../lib/api-client';
import { logHeader, logPass, logWarn, logInfo } from '../lib/logger';
import { loadState, updateState } from '../lib/state';

const SCRIPT = '05-fork-ecrfs-workflow';

import { ECRF1_FIELDS, ECRF2_FIELDS } from './03-create-base-ecrfs';

async function forkOrCreate(
  sourceId: number,
  newName: string,
  description: string,
  fields: any[],
  stepLabel: string,
): Promise<{ crfId: number; versionId?: number } | null> {
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
  logHeader('05 — Fork/Create eCRFs for Workflow');

  const state = loadState();
  if (!state.baseCrf1Id || !state.baseCrf2Id) {
    logInfo('Base CRF IDs missing — run script 03 first');
    return false;
  }

  const w1 = await forkOrCreate(
    state.baseCrf1Id,
    'General Assessment Form - Workflow',
    'Workflow testing copy. Has SDV, e-signature requirements, and query routing configured.',
    ECRF1_FIELDS,
    'Workflow eCRF 1',
  );
  if (w1) {
    updateState({ workflowCrf1Id: w1.crfId, workflowCrf1VersionId: w1.versionId });
  }

  const w2 = await forkOrCreate(
    state.baseCrf2Id,
    'Lab Results & Procedures Form - Workflow',
    'Workflow testing copy. Has SDV, DDE requirements, and query routing configured.',
    ECRF2_FIELDS,
    'Workflow eCRF 2',
  );
  if (w2) {
    updateState({ workflowCrf2Id: w2.crfId, workflowCrf2VersionId: w2.versionId });
  }

  return !!(w1 && w2);
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
