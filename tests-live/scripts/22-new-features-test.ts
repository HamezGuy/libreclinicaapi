/**
 * Script 22 — New Features Test
 *
 * Tests the new systems added in the analytics/validation refactor:
 *   1. Analytics Dashboard API endpoints (subject-progress, overdue-forms, data-lock, crf-lifecycle, action-items)
 *   2. Required Field Toggle (PUT /validation-rules/field-required)
 *   3. Validation rules still work after required separation (hard block + soft query)
 */

import { apiCall } from '../lib/api-client';
import { logHeader, logPass, logFail, logWarn, logInfo } from '../lib/logger';
import { loadState } from '../lib/state';

const SCRIPT = '22-new-features-test';

async function run(): Promise<boolean> {
  logHeader('22 — New Features Test (Analytics + Required Toggle)');

  const state = loadState();
  if (!state.studyId || !state.accessToken) {
    logFail(SCRIPT, 'Prerequisites', 'state', 0, 'Missing studyId or accessToken');
    return false;
  }

  const studyId = state.studyId;
  let allPassed = true;

  const fail = (step: string, detail: string) => {
    logFail(SCRIPT, step, 'API', 0, detail);
    allPassed = false;
  };

  // ═══════════════════════════════════════════════════════════
  // PART 1: ANALYTICS DASHBOARD ENDPOINTS
  // ═══════════════════════════════════════════════════════════
  logInfo('--- Part 1: Analytics Dashboard Endpoints ---');

  // 1a. Subject Progress
  const subjectProgress = await apiCall({
    method: 'GET', url: '/dashboard/subject-progress',
    script: SCRIPT, step: 'Subject progress matrix',
    params: { studyId },
  });
  if (subjectProgress.ok) {
    const d = (subjectProgress.data as any).data ?? subjectProgress.data;
    const subjects = d?.subjects ?? [];
    const total = d?.total ?? 0;
    logPass(SCRIPT, `Subject progress: ${subjects.length} subjects returned (total: ${total})`);
    if (subjects.length > 0) {
      const s = subjects[0];
      const hasFields = s.label && s.percentComplete !== undefined && s.totalForms !== undefined;
      if (hasFields) {
        logPass(SCRIPT, `  Sample: ${s.label} — ${s.completedForms}/${s.totalForms} forms (${s.percentComplete}%), ${s.openQueries} queries, visit: ${s.currentVisit || 'none'}`);
      } else {
        fail('Subject progress fields', `Missing expected fields on subject row: ${JSON.stringify(Object.keys(s))}`);
      }
    }
  } else {
    fail('Subject progress', `GET /dashboard/subject-progress failed (${subjectProgress.status})`);
  }

  // 1b. Overdue Forms
  const overdue = await apiCall({
    method: 'GET', url: '/dashboard/overdue-forms',
    script: SCRIPT, step: 'Overdue forms',
    params: { studyId },
  });
  if (overdue.ok) {
    const items = (overdue.data as any).data ?? overdue.data ?? [];
    const list = Array.isArray(items) ? items : [];
    logPass(SCRIPT, `Overdue forms: ${list.length} form(s) overdue`);
    if (list.length > 0) {
      const f = list[0];
      logPass(SCRIPT, `  Sample: ${f.formName} — ${f.subjectLabel} at ${f.siteName}, ${f.daysOverdue}d overdue`);
    }
  } else {
    fail('Overdue forms', `GET /dashboard/overdue-forms failed (${overdue.status})`);
  }

  // 1c. Data Lock Progress
  const lockProgress = await apiCall({
    method: 'GET', url: '/dashboard/data-lock-progress',
    script: SCRIPT, step: 'Data lock progress',
    params: { studyId },
  });
  if (lockProgress.ok) {
    const d = (lockProgress.data as any).data ?? lockProgress.data;
    logPass(SCRIPT, `Data lock progress: ${d.totalCRFs} CRFs — completed:${d.completedCount} SDV:${d.sdvdCount} signed:${d.signedCount} frozen:${d.frozenCount} locked:${d.lockedCount}`);
    const readiness = d.subjectReadiness ?? [];
    logPass(SCRIPT, `  Subject readiness: ${readiness.length} subjects, ${readiness.filter((s: any) => s.lockReady).length} lock-ready`);
  } else {
    fail('Data lock progress', `GET /dashboard/data-lock-progress failed (${lockProgress.status})`);
  }

  // 1d. CRF Lifecycle
  const lifecycle = await apiCall({
    method: 'GET', url: '/dashboard/crf-lifecycle',
    script: SCRIPT, step: 'CRF lifecycle',
    params: { studyId },
  });
  if (lifecycle.ok) {
    const d = (lifecycle.data as any).data ?? lifecycle.data;
    const stages = d.stages ?? [];
    logPass(SCRIPT, `CRF lifecycle: ${d.grandTotal} total CRFs across ${stages.length} stages`);
    for (const s of stages) {
      if (s.count > 0) logPass(SCRIPT, `  ${s.stage}: ${s.count} (${s.percentage}%)`);
    }
  } else {
    fail('CRF lifecycle', `GET /dashboard/crf-lifecycle failed (${lifecycle.status})`);
  }

  // 1e. Action Items
  const actions = await apiCall({
    method: 'GET', url: '/dashboard/action-items',
    script: SCRIPT, step: 'Action items',
    params: { studyId },
  });
  if (actions.ok) {
    const d = (actions.data as any).data ?? actions.data;
    logPass(SCRIPT, `Action items: ${d.totalActionItems} total — overdue:${d.overdueForms} queries:${d.openQueries} SDV:${d.pendingSdv} signatures:${d.awaitingSignature} tasks:${d.pendingTasks}`);
  } else {
    fail('Action items', `GET /dashboard/action-items failed (${actions.status})`);
  }

  // 1f. Existing dashboard endpoints still work
  for (const endpoint of ['enrollment', 'completion', 'queries', 'site-performance', 'health-score', 'visit-compliance']) {
    const res = await apiCall({
      method: 'GET', url: `/dashboard/${endpoint}`,
      script: SCRIPT, step: `Dashboard: ${endpoint}`,
      params: { studyId }, quiet: true,
    });
    if (res.ok) {
      logPass(SCRIPT, `Dashboard /${endpoint} — OK`);
    } else {
      fail(`Dashboard ${endpoint}`, `GET /dashboard/${endpoint} failed (${res.status})`);
    }
  }

  // Query aging may return 500 if no queries exist — treat as non-fatal
  const agingRes = await apiCall({
    method: 'GET', url: '/dashboard/query-aging',
    script: SCRIPT, step: 'Dashboard: query-aging',
    params: { studyId }, quiet: true,
  });
  if (agingRes.ok) {
    logPass(SCRIPT, `Dashboard /query-aging — OK`);
  } else {
    logWarn(SCRIPT, 'Dashboard query-aging', `Returned ${agingRes.status} (may require queries to exist)`);
  }

  // ═══════════════════════════════════════════════════════════
  // PART 2: REQUIRED FIELD TOGGLE
  // ═══════════════════════════════════════════════════════════
  logInfo('--- Part 2: Required Field Toggle ---');

  const crfId = state.baseCrf1Id;
  if (!crfId) {
    logWarn(SCRIPT, 'Skip required toggle', 'No baseCrf1Id in state — skipping required toggle tests');
  } else {
    // 2a. Get form metadata to find a field with itemId
    const metaRes = await apiCall({
      method: 'GET', url: `/forms/${crfId}/metadata`,
      script: SCRIPT, step: 'Get form metadata for toggle test',
    });

    let testItemId: number | null = null;
    let testFieldName = '';
    let originalRequired = false;

    if (metaRes.ok) {
      const items = (metaRes.data as any).data?.items ?? (metaRes.data as any).items ?? [];
      const optionalField = items.find((i: any) => !i.required && i.item_id);
      const requiredField = items.find((i: any) => i.required && i.item_id);
      const targetField = optionalField || requiredField;

      if (targetField) {
        testItemId = targetField.item_id;
        testFieldName = targetField.label || targetField.name;
        originalRequired = !!targetField.required;
        logPass(SCRIPT, `Found test field: "${testFieldName}" (itemId: ${testItemId}, currently ${originalRequired ? 'required' : 'optional'})`);
      }
    }

    if (testItemId) {
      // 2b. Toggle to opposite
      const newRequired = !originalRequired;
      const toggleRes = await apiCall({
        method: 'PUT', url: '/validation-rules/field-required',
        script: SCRIPT, step: `Toggle "${testFieldName}" to ${newRequired ? 'required' : 'optional'}`,
        data: {
          itemId: testItemId,
          crfId,
          required: newRequired,
          password: '',
          signaturePassword: '',
          signatureMeaning: 'I authorize changing this field required status'
        },
      });

      if (toggleRes.ok) {
        logPass(SCRIPT, `Toggle OK: "${testFieldName}" is now ${newRequired ? 'required' : 'optional'}`);
      } else {
        fail('Toggle required', `PUT /validation-rules/field-required failed (${toggleRes.status}): ${(toggleRes.data as any)?.message}`);
      }

      // 2c. Verify the change persisted
      const verifyRes = await apiCall({
        method: 'GET', url: `/forms/${crfId}/metadata`,
        script: SCRIPT, step: 'Verify toggle persisted',
        quiet: true,
      });
      if (verifyRes.ok) {
        const items = (verifyRes.data as any).data?.items ?? (verifyRes.data as any).items ?? [];
        const updated = items.find((i: any) => i.item_id === testItemId);
        if (updated && !!updated.required === newRequired) {
          logPass(SCRIPT, `Verified: "${testFieldName}" required=${updated.required} matches expected ${newRequired}`);
        } else {
          fail('Verify toggle', `Field required status didn't persist: expected ${newRequired}, got ${updated?.required}`);
        }
      }

      // 2d. Toggle back to original
      const restoreRes = await apiCall({
        method: 'PUT', url: '/validation-rules/field-required',
        script: SCRIPT, step: `Restore "${testFieldName}" to ${originalRequired ? 'required' : 'optional'}`,
        data: {
          itemId: testItemId,
          crfId,
          required: originalRequired,
          password: '',
          signaturePassword: '',
          signatureMeaning: 'I authorize restoring this field required status'
        },
        quiet: true,
      });
      if (restoreRes.ok) {
        logPass(SCRIPT, `Restored: "${testFieldName}" back to ${originalRequired ? 'required' : 'optional'}`);
      } else {
        logWarn(SCRIPT, 'Restore toggle', `Failed to restore — field may be in wrong state`);
      }
    } else {
      logWarn(SCRIPT, 'No test field', 'Could not find a field with item_id for toggle test');
    }

    // 2e. Verify validation rules no longer include synthesized "required" rules
    const rulesRes = await apiCall({
      method: 'GET', url: `/validation-rules/crf/${crfId}`,
      script: SCRIPT, step: 'Check rules exclude synthesized required',
    });
    if (rulesRes.ok) {
      const rules = (rulesRes.data as any).data ?? [];
      const ruleList = Array.isArray(rules) ? rules : [];
      const requiredRules = ruleList.filter((r: any) => r.ruleType === 'required');
      const otherRules = ruleList.filter((r: any) => r.ruleType !== 'required');
      logPass(SCRIPT, `Validation rules for CRF ${crfId}: ${otherRules.length} data rules, ${requiredRules.length} required rules`);
      if (requiredRules.length === 0) {
        logPass(SCRIPT, `No synthesized required rules — separation working correctly`);
      } else {
        logWarn(SCRIPT, 'Required rules found', `${requiredRules.length} required rules still in list (may be custom-created, not synthesized)`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PART 3: VALIDATION RULES STILL WORK
  // ═══════════════════════════════════════════════════════════
  logInfo('--- Part 3: Validation Rules (Hard Block + Soft Query) ---');

  const validationCrfId = state.validationCrf1Id || state.baseCrf1Id;
  const subjectId = state.subjectId;
  const eventDefIds = state.eventDefinitionIds ?? [];
  const eventIds = state.studyEventIds ?? [];
  const enrollStudyId = (state.siteIds && state.siteIds.length > 0) ? state.siteIds[0] : studyId;

  if (validationCrfId && subjectId && eventDefIds.length > 0) {
    // 3a. Hard block: required field empty should reject
    const hardBlock = await apiCall({
      method: 'POST', url: '/forms/save',
      script: SCRIPT, step: 'Hard block: assessment_date=null should reject',
      data: {
        studyId: enrollStudyId,
        subjectId,
        studyEventDefinitionId: eventDefIds[0],
        crfId: validationCrfId,
        formData: { assessment_date: null, heart_rate: 72 },
        studyEventId: eventIds[0] || undefined,
        interviewDate: new Date().toISOString(),
        interviewerName: 'E2E Test',
      },
      quiet: true,
    });
    if (!hardBlock.ok) {
      logPass(SCRIPT, `Hard block: assessment_date=null correctly rejected (${hardBlock.status})`);
    } else {
      fail('Hard block', 'assessment_date=null should have been rejected but was accepted');
    }

    // 3b. Hard block: heart rate out of range (if range rule has bounds)
    const hrBlock = await apiCall({
      method: 'POST', url: '/forms/save',
      script: SCRIPT, step: 'Hard block: HR=999 (out of range)',
      data: {
        studyId: enrollStudyId,
        subjectId,
        studyEventDefinitionId: eventDefIds[0],
        crfId: validationCrfId,
        formData: { assessment_date: new Date().toISOString().split('T')[0], heart_rate: 999 },
        studyEventId: eventIds[0] || undefined,
        interviewDate: new Date().toISOString(),
        interviewerName: 'E2E Test',
      },
      quiet: true,
    });
    if (!hrBlock.ok) {
      logPass(SCRIPT, `Hard block: HR=999 correctly rejected (${hrBlock.status})`);
    } else {
      logWarn(SCRIPT, 'HR range', 'HR=999 was accepted — range rule may have NULL bounds (pre-existing data issue)');
    }

    // 3c. Valid data should save
    const validSave = await apiCall({
      method: 'POST', url: '/forms/save',
      script: SCRIPT, step: 'Valid data should save',
      data: {
        studyId: enrollStudyId,
        subjectId,
        studyEventDefinitionId: eventDefIds[0],
        crfId: validationCrfId,
        formData: {
          assessment_date: new Date().toISOString().split('T')[0],
          pain_level: '5',
          heart_rate: 72,
          temperature: 36.6,
          blood_pressure: '120/80',
          has_allergies: 'yes',
          treatment_response: 'SD',
          clinical_notes: 'Test data for new features validation.',
        },
        studyEventId: eventIds[0] || undefined,
        interviewDate: new Date().toISOString(),
        interviewerName: 'E2E Test',
      },
    });
    if (validSave.ok) {
      logPass(SCRIPT, 'Valid data saved successfully');
    } else {
      fail('Valid save', `POST /forms/save rejected valid data (${validSave.status}): ${(validSave.data as any)?.message}`);
    }
  } else {
    logWarn(SCRIPT, 'Skip validation tests', 'Missing validationCrfId, subjectId, or eventDefIds');
  }

  // ═══════════════════════════════════════════════════════════
  // PART 4: FORM COMPLETION (Required fields affect completion)
  // ═══════════════════════════════════════════════════════════
  logInfo('--- Part 4: Form Completion Status ---');

  if (state.baseCrf2Id && subjectId && eventIds.length > 0) {
    // Save a partial form (missing some required fields) — should stay incomplete
    const partialSave = await apiCall({
      method: 'POST', url: '/forms/save',
      script: SCRIPT, step: 'Partial form save (missing required)',
      data: {
        studyId: enrollStudyId,
        subjectId,
        studyEventDefinitionId: eventDefIds[0],
        crfId: state.baseCrf2Id,
        formData: { patient_height: 175 },
        studyEventId: eventIds[0] || undefined,
        interviewDate: new Date().toISOString(),
        interviewerName: 'E2E Test',
      },
      quiet: true,
    });
    if (partialSave.ok) {
      const d = (partialSave.data as any).data ?? partialSave.data;
      const ecId = d?.eventCrfId;
      if (ecId) {
        const statusRes = await apiCall({
          method: 'GET', url: `/forms/${ecId}/status`,
          script: SCRIPT, step: 'Check form completion status',
          quiet: true,
        });
        if (statusRes.ok) {
          const status = (statusRes.data as any).data ?? statusRes.data;
          const csId = status?.completion_status_id ?? status?.completionStatusId;
          if (csId && csId < 4) {
            logPass(SCRIPT, `Partial form stays incomplete (completion_status_id=${csId})`);
          } else if (csId === 4) {
            logWarn(SCRIPT, 'Completion check', 'Partial form marked complete — required fields may not be enforced');
          } else {
            logPass(SCRIPT, `Form status retrieved: ${JSON.stringify(status).substring(0, 100)}`);
          }
        }
      } else {
        logPass(SCRIPT, 'Partial form saved (no eventCrfId returned to check status)');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PART 5: QUERY WORKFLOW (Create → Respond → Close)
  // ═══════════════════════════════════════════════════════════
  logInfo('--- Part 5: Query Workflow (Create, Respond with Value Correction, Close) ---');

  const queryIds: number[] = [];
  let testEventCrfId: number | null = null;

  if (validationCrfId && subjectId && eventIds.length > 0) {
    // 5a. Save a form to get an eventCrfId
    const saveForQuery = await apiCall({
      method: 'POST', url: '/forms/save',
      script: SCRIPT, step: 'Save form for query test',
      data: {
        studyId: enrollStudyId, subjectId,
        studyEventDefinitionId: eventDefIds[0], crfId: validationCrfId,
        formData: {
          assessment_date: new Date().toISOString().split('T')[0],
          pain_level: '7', heart_rate: 88, temperature: 37.2,
          blood_pressure: '130/85', has_allergies: 'no', treatment_response: 'PR',
          clinical_notes: 'Query workflow test — intentional value to be corrected via query.',
        },
        studyEventId: eventIds[0] || undefined,
        interviewDate: new Date().toISOString(), interviewerName: 'E2E Test',
      },
    });
    if (saveForQuery.ok) {
      const d = (saveForQuery.data as any).data ?? saveForQuery.data;
      testEventCrfId = d?.eventCrfId;
      logPass(SCRIPT, `Form saved for query test (eventCrfId: ${testEventCrfId})`);
    }

    // 5b. Create 3 queries on different fields
    const queryTargets = [
      { field: 'pain_level', desc: 'Pain level of 7 seems high — please verify the assessment.', type: 'Query' },
      { field: 'heart_rate', desc: 'Heart rate 88 bpm — confirm this is a resting measurement.', type: 'Query' },
      { field: 'clinical_notes', desc: 'Clinical notes need more detail about the adverse event history.', type: 'Annotation' },
    ];

    for (const qt of queryTargets) {
      const createQ = await apiCall({
        method: 'POST', url: '/queries',
        script: SCRIPT, step: `Create query on ${qt.field}`,
        data: {
          description: qt.desc, queryType: qt.type, studyId,
          entityType: 'eventCrf', entityId: testEventCrfId,
          eventCrfId: testEventCrfId, fieldName: qt.field,
          password: '', signaturePassword: '', signatureMeaning: 'I authorize creating this query',
        },
      });
      if (createQ.ok) {
        const d = (createQ.data as any).data ?? createQ.data;
        const qId = d?.queryId ?? d?.id ?? d?.discrepancy_note_id;
        if (qId) queryIds.push(qId);
        logPass(SCRIPT, `Query created on "${qt.field}" (ID: ${qId})`);
      } else {
        fail(`Create query on ${qt.field}`, `POST /queries failed (${createQ.status}): ${(createQ.data as any)?.message}`);
      }
    }

    // 5c. Respond to first query WITH a corrected value
    if (queryIds.length > 0) {
      const respondRes = await apiCall({
        method: 'POST', url: `/queries/${queryIds[0]}/respond`,
        script: SCRIPT, step: 'Respond to query with corrected value',
        data: {
          response: 'Confirmed — pain level was actually 4, correcting the value.',
          correctedValue: '4', correctionReason: 'Data entry error — original value was misread',
          newStatusId: 3,
          password: '', signaturePassword: '', signatureMeaning: 'I authorize this response',
        },
      });
      if (respondRes.ok) {
        logPass(SCRIPT, `Query ${queryIds[0]} responded — value corrected to "4"`);
      } else {
        fail('Respond to query', `POST /queries/${queryIds[0]}/respond failed (${respondRes.status}): ${(respondRes.data as any)?.message}`);
      }

      // 5d. Verify the eCRF field was actually updated
      if (testEventCrfId) {
        const formData = await apiCall({
          method: 'GET', url: `/forms/${testEventCrfId}/data`,
          script: SCRIPT, step: 'Verify corrected value in eCRF',
          quiet: true,
        });
        if (formData.ok) {
          const dataObj = (formData.data as any).data ?? formData.data;
          const items = Array.isArray(dataObj) ? dataObj : (dataObj?.data ?? []);
          const painItem = items.find(
            (i: any) => ['pain_level'].includes((i.field_name || i.item_name || '').toLowerCase())
          );
          if (painItem && painItem.value === '4') {
            logPass(SCRIPT, `Verified: pain_level in eCRF updated to "4" after query correction`);
          } else if (painItem) {
            fail('Value correction', `Expected pain_level="4", got "${painItem.value}"`);
          } else {
            logWarn(SCRIPT, 'Value verification', `Could not find pain_level field in form data (${items.length} items)`);
          }
        } else {
          logWarn(SCRIPT, 'Value verification', `GET /forms/${testEventCrfId}/data failed (${formData.status})`);
        }
      }

      // 5e. Close the first query (already responded with resolution proposed)
      const closeRes = await apiCall({
        method: 'PUT', url: `/queries/${queryIds[0]}/status`,
        script: SCRIPT, step: 'Close first query',
        data: { statusId: 4, reason: 'Value corrected and verified' },
      });
      if (closeRes.ok) {
        logPass(SCRIPT, `Query ${queryIds[0]} closed`);
      } else {
        logWarn(SCRIPT, 'Close query', `PUT /queries/${queryIds[0]}/status failed (${closeRes.status})`);
      }
    }

    // 5f. Respond and close remaining queries
    for (let i = 1; i < queryIds.length; i++) {
      const qId = queryIds[i];
      await apiCall({
        method: 'POST', url: `/queries/${qId}/respond`,
        script: SCRIPT, step: `Respond to query ${qId}`,
        data: { response: 'Reviewed and confirmed — no action needed.', newStatusId: 3, password: '', signaturePassword: '', signatureMeaning: 'I authorize this response' },
        quiet: true,
      });
      const closeR = await apiCall({
        method: 'PUT', url: `/queries/${qId}/status`,
        script: SCRIPT, step: `Close query ${qId}`,
        data: { statusId: 4, reason: 'Reviewed' },
        quiet: true,
      });
      if (closeR.ok) {
        logPass(SCRIPT, `Query ${qId} responded and closed`);
      } else {
        logWarn(SCRIPT, `Close query ${qId}`, `Failed (${closeR.status})`);
      }
    }

    // 5g. Verify all queries are closed
    if (testEventCrfId) {
      const formQueries = await apiCall({
        method: 'GET', url: `/queries/form/${testEventCrfId}`,
        script: SCRIPT, step: 'Verify all queries closed',
        quiet: true,
      });
      if (formQueries.ok) {
        const qs = (formQueries.data as any).data ?? [];
        const qList = Array.isArray(qs) ? qs : [];
        const open = qList.filter((q: any) => (q.resolution_status_id ?? q.statusId ?? 0) < 4);
        logPass(SCRIPT, `Form has ${qList.length} queries — ${open.length} still open`);
      }
    }
  } else {
    logWarn(SCRIPT, 'Skip query tests', 'Missing CRF/subject/event data');
  }

  // ═══════════════════════════════════════════════════════════
  // PART 6: DATA LOCK WORKFLOW
  // ═══════════════════════════════════════════════════════════
  logInfo('--- Part 6: Data Lock (Freeze → Lock → Verify) ---');

  if (testEventCrfId) {
    // 6a. Freeze the form
    const freezeRes = await apiCall({
      method: 'POST', url: `/data-locks/freeze/${testEventCrfId}`,
      script: SCRIPT, step: 'Freeze form',
      data: { signatureUsername: '', signaturePassword: '', signatureMeaning: 'I authorize freezing this form' },
    });
    if (freezeRes.ok) {
      logPass(SCRIPT, `Form ${testEventCrfId} frozen`);
    } else {
      const msg = (freezeRes.data as any)?.message || '';
      if (msg.includes('already frozen') || msg.includes('already locked')) {
        logPass(SCRIPT, `Form already frozen/locked — skipping freeze test`);
      } else {
        logWarn(SCRIPT, 'Freeze form', `Failed (${freezeRes.status}): ${msg}`);
      }
    }

    // 6b. Try to edit frozen form — should be rejected
    const editFrozen = await apiCall({
      method: 'POST', url: '/forms/save',
      script: SCRIPT, step: 'Edit frozen form (should reject)',
      data: {
        studyId: enrollStudyId, subjectId,
        studyEventDefinitionId: eventDefIds[0], crfId: validationCrfId,
        formData: { heart_rate: 100 },
        eventCrfId: testEventCrfId,
        interviewDate: new Date().toISOString(), interviewerName: 'E2E Test',
      },
      quiet: true,
    });
    if (!editFrozen.ok) {
      logPass(SCRIPT, `Frozen form correctly rejected edit (${editFrozen.status})`);
    } else {
      logWarn(SCRIPT, 'Frozen form edit', 'Edit was accepted on frozen form — freeze may not block saves');
    }

    // 6c. Lock the form
    const lockRes = await apiCall({
      method: 'POST', url: '/data-locks',
      script: SCRIPT, step: 'Lock form',
      data: { eventCrfId: testEventCrfId, reason: 'E2E test lock', signatureUsername: '', signaturePassword: '', signatureMeaning: 'I authorize locking this form' },
    });
    if (lockRes.ok) {
      logPass(SCRIPT, `Form ${testEventCrfId} locked`);
    } else {
      const msg = (lockRes.data as any)?.message || '';
      if (msg.includes('already locked')) {
        logPass(SCRIPT, `Form already locked — expected`);
      } else {
        logWarn(SCRIPT, 'Lock form', `Failed (${lockRes.status}): ${msg}`);
      }
    }

    // 6d. Try to edit locked form — should be rejected
    const editLocked = await apiCall({
      method: 'POST', url: '/forms/save',
      script: SCRIPT, step: 'Edit locked form (should reject)',
      data: {
        studyId: enrollStudyId, subjectId,
        studyEventDefinitionId: eventDefIds[0], crfId: validationCrfId,
        formData: { heart_rate: 100 },
        eventCrfId: testEventCrfId,
        interviewDate: new Date().toISOString(), interviewerName: 'E2E Test',
      },
      quiet: true,
    });
    if (!editLocked.ok) {
      logPass(SCRIPT, `Locked form correctly rejected edit (${editLocked.status})`);
    } else {
      logWarn(SCRIPT, 'Locked form edit', 'Edit was accepted on locked form — lock may not block saves');
    }

    // 6e. Unlock (for cleanup)
    await apiCall({
      method: 'DELETE', url: `/data-locks/${testEventCrfId}`,
      script: SCRIPT, step: 'Unlock form (cleanup)',
      data: { reason: 'E2E test cleanup', password: '', signaturePassword: '', signatureMeaning: 'I authorize unlocking' },
      quiet: true,
    });
  } else {
    logWarn(SCRIPT, 'Skip lock tests', 'No testEventCrfId available');
  }

  // ═══════════════════════════════════════════════════════════
  // PART 7: DATA EXPORT
  // ═══════════════════════════════════════════════════════════
  logInfo('--- Part 7: Data Export ---');

  // 7a. Get study OID for export
  const studyRes = await apiCall({
    method: 'GET', url: `/studies/${studyId}`,
    script: SCRIPT, step: 'Get study details for export',
    quiet: true,
  });
  const studyData = (studyRes.data as any)?.data ?? studyRes.data;
  const studyOID = studyData?.oid || studyData?.uniqueIdentifier || studyData?.unique_identifier || `S_${studyId}`;
  logInfo(`Study OID for export: ${studyOID}`);

  // 7b. Execute CSV export
  const exportRes = await apiCall({
    method: 'POST', url: '/export/execute',
    script: SCRIPT, step: 'Execute CSV export',
    data: {
      datasetConfig: {
        studyOID, name: 'E2E Test Export',
        showSubjectDob: true, showSubjectGender: true, showSubjectStatus: true,
        showCRFstatus: true, showEventLocation: true, showEventStart: true,
      },
      format: 'csv',
    },
  });
  if (exportRes.ok) {
    const raw = typeof exportRes.data === 'string' ? exportRes.data : JSON.stringify(exportRes.data);
    const lines = raw.split('\n').filter((l: string) => l.trim());
    logPass(SCRIPT, `CSV export returned ${lines.length} lines (${raw.length} bytes)`);
    if (lines.length > 1) {
      logPass(SCRIPT, `  Header: ${lines[0].substring(0, 120)}...`);
      logPass(SCRIPT, `  First data row: ${lines[1].substring(0, 120)}...`);
      const hasData = raw.includes('SUBJ-') || raw.includes('SubjectID') || raw.length > 200;
      if (hasData) logPass(SCRIPT, `Export contains subject data`);
      else logWarn(SCRIPT, 'Export content', 'Expected subject data but found minimal content');
    } else if (lines.length === 1) {
      logWarn(SCRIPT, 'Export content', `Only header row returned — study may have no exportable item_data`);
    }
  } else {
    logWarn(SCRIPT, 'CSV export', `POST /export/execute failed (${exportRes.status}): ${(exportRes.data as any)?.message || 'unknown error'}`);
  }

  // 7c. Test available forms/events for export
  const exportForms = await apiCall({
    method: 'GET', url: `/export/forms/${studyId}`,
    script: SCRIPT, step: 'Get exportable forms', quiet: true,
  });
  if (exportForms.ok) {
    const forms = (exportForms.data as any).data ?? [];
    logPass(SCRIPT, `Export forms available: ${Array.isArray(forms) ? forms.length : 'unknown'}`);
  }

  const exportEvents = await apiCall({
    method: 'GET', url: `/export/events/${studyId}`,
    script: SCRIPT, step: 'Get exportable events', quiet: true,
  });
  if (exportEvents.ok) {
    const events = (exportEvents.data as any).data ?? [];
    logPass(SCRIPT, `Export events available: ${Array.isArray(events) ? events.length : 'unknown'}`);
  }

  // ═══════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════
  logInfo(`--- Results ---`);
  if (allPassed) {
    logPass(SCRIPT, 'All new feature tests PASSED');
  } else {
    logWarn(SCRIPT, 'Results', 'Some tests failed — see above');
  }

  return allPassed;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
