/**
 * Script 08 — Setup Workflow Configuration
 *
 * Configures workflow settings for the 2 workflow eCRFs:
 *   - Workflow eCRF 1: SDV required, e-signature required, queries to monitor
 *   - Workflow eCRF 2: SDV required, DDE required, queries to monitor
 *
 * Only the workflow eCRFs get workflow config — not the base or validation copies.
 */

import { apiCall } from '../lib/api-client';
import { CONFIG } from '../lib/config';
import { logHeader, logPass, logInfo } from '../lib/logger';
import { loadState } from '../lib/state';

const SCRIPT = '08-setup-workflows';

async function run(): Promise<boolean> {
  logHeader('08 — Setup Workflow Configuration');

  const state = loadState();

  if (!state.workflowCrf1Id || !state.workflowCrf2Id) {
    logInfo('Workflow CRF IDs missing — run script 05 first');
    return false;
  }

  // Determine query route target: the monitor member we created
  const queryRouteUser = state.member2Username || CONFIG.MEMBER2.username;
  logInfo(`Query routing target: ${queryRouteUser}`);

  let success = true;

  // Workflow eCRF 1 — SDV + Signature, queries to monitor
  logInfo(`Configuring Workflow eCRF 1 (CRF ${state.workflowCrf1Id})...`);
  const r1 = await apiCall({
    method: 'PUT',
    url: `/forms/workflow-config/${state.workflowCrf1Id}`,
    script: SCRIPT,
    step: 'Configure Workflow eCRF 1',
    data: {
      requiresSDV: true,
      requiresSignature: true,
      requiresDDE: false,
      queryRouteToUsers: [queryRouteUser],
      studyId: state.studyId || null,
    },
  });

  if (r1.ok) {
    logPass(SCRIPT, `Workflow eCRF 1: SDV=true, Signature=true, QueryRoute=[${queryRouteUser}]`);
  } else {
    success = false;
  }

  // Workflow eCRF 2 — SDV + DDE, queries to monitor
  logInfo(`Configuring Workflow eCRF 2 (CRF ${state.workflowCrf2Id})...`);
  const r2 = await apiCall({
    method: 'PUT',
    url: `/forms/workflow-config/${state.workflowCrf2Id}`,
    script: SCRIPT,
    step: 'Configure Workflow eCRF 2',
    data: {
      requiresSDV: true,
      requiresSignature: false,
      requiresDDE: true,
      queryRouteToUsers: [queryRouteUser],
      studyId: state.studyId || null,
    },
  });

  if (r2.ok) {
    logPass(SCRIPT, `Workflow eCRF 2: SDV=true, DDE=true, QueryRoute=[${queryRouteUser}]`);
  } else {
    success = false;
  }

  // Verify by reading back the config
  logInfo('Verifying workflow configs...');
  const verify1 = await apiCall({
    method: 'GET',
    url: `/forms/workflow-config/${state.workflowCrf1Id}`,
    script: SCRIPT,
    step: 'Verify Workflow eCRF 1 config',
    params: { studyId: state.studyId },
  });

  if (verify1.ok) {
    const cfg = (verify1.data as any).data ?? verify1.data;
    logPass(SCRIPT, `Verified eCRF 1: SDV=${cfg.requiresSDV}, Sig=${cfg.requiresSignature}, Routes=${JSON.stringify(cfg.queryRouteToUsers)}`);
  }

  const verify2 = await apiCall({
    method: 'GET',
    url: `/forms/workflow-config/${state.workflowCrf2Id}`,
    script: SCRIPT,
    step: 'Verify Workflow eCRF 2 config',
    params: { studyId: state.studyId },
  });

  if (verify2.ok) {
    const cfg = (verify2.data as any).data ?? verify2.data;
    logPass(SCRIPT, `Verified eCRF 2: SDV=${cfg.requiresSDV}, DDE=${cfg.requiresDDE}, Routes=${JSON.stringify(cfg.queryRouteToUsers)}`);
  }

  return success;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
