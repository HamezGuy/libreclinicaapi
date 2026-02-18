/**
 * Script 12 — Patient Visits & Forms (Source of Truth Snapshot Test)
 *
 * Validates the full patient visit → form lifecycle:
 *   1. Verify existing scheduled visits for the test patient
 *   2. Schedule additional visits (Baseline, Follow-Up) if not present
 *   3. Fetch visit-forms (template → patient mapping)
 *   4. Create patient form snapshots for each visit
 *   5. Save data to patient form snapshots
 *   6. Verify source-of-truth integrity (template vs patient copies)
 *   7. Repair any missing snapshots and re-verify
 *   8. Edge cases: duplicate snapshot, data on locked form, unscheduled visit
 *
 * This script tests the critical "snapshot" architecture:
 *   study_event_definition → event_definition_crf (SOURCE OF TRUTH)
 *   study_event → event_crf → patient_event_form (PATIENT COPY / SNAPSHOT)
 */

import { apiCall } from '../lib/api-client';
import { logHeader, logPass, logFail, logWarn, logInfo } from '../lib/logger';
import { loadState, updateState } from '../lib/state';

const SCRIPT = '12-patient-visits-forms';

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ─── Phase 1: Verify / Schedule Patient Visits ──────────────────────────────

async function verifyAndScheduleVisits(state: any): Promise<number[]> {
  logInfo('--- Phase 1: Verify / schedule patient visits ---');

  const subjectId = state.subjectId;
  const eventDefIds = state.eventDefinitionIds ?? [];

  // Fetch current events for the patient
  const res = await apiCall({
    method: 'GET',
    url: `/events/subject/${subjectId}`,
    script: SCRIPT,
    step: 'Get patient events',
  });

  if (!res.ok) {
    logFail(SCRIPT, 'Get patient events', `GET /events/subject/${subjectId}`, res.status,
      'Could not fetch patient events', undefined, res.data);
    return state.studyEventIds ?? [];
  }

  const events = (res.data as any).data ?? res.data;
  const eventList = Array.isArray(events) ? events : [];
  const eventIds = eventList
    .map((e: any) => e.studyEventId ?? e.study_event_id)
    .filter(Boolean);

  logPass(SCRIPT, `Patient has ${eventIds.length} existing event(s): [${eventIds.join(', ')}]`);

  // Schedule additional visits if we have event definitions but fewer visits
  const existingEventDefIds = new Set(
    eventList.map((e: any) => e.studyEventDefinitionId ?? e.study_event_definition_id)
  );

  let scheduledNew = 0;
  for (let i = 0; i < Math.min(eventDefIds.length, 3); i++) {
    if (!existingEventDefIds.has(eventDefIds[i])) {
      const labels = ['Screening Visit', 'Baseline Visit', 'Follow-Up Visit'];
      const offsets = [0, 7, 30];
      const schedRes = await apiCall({
        method: 'POST',
        url: '/events/schedule',
        script: SCRIPT,
        step: `Schedule ${labels[i] ?? `Visit ${i}`}`,
        data: {
          studySubjectId: subjectId,
          studyEventDefinitionId: eventDefIds[i],
          startDate: futureDate(offsets[i] ?? i * 14),
          location: 'Boston General Hospital',
        },
      });

      if (schedRes.ok) {
        const d = schedRes.data as any;
        const newId = d.data?.studyEventId ?? d.studyEventId ?? d.data?.study_event_id;
        if (newId) {
          eventIds.push(newId);
          scheduledNew++;
          logPass(SCRIPT, `Scheduled ${labels[i]} (event ID: ${newId})`);
        }
      }
    }
  }

  if (scheduledNew > 0) {
    logPass(SCRIPT, `Scheduled ${scheduledNew} new visit(s)`);
  }

  updateState({ studyEventIds: eventIds });
  return eventIds;
}

// ─── Phase 2: Fetch Visit Forms (Template → Patient Mapping) ────────────────

interface VisitFormInfo {
  studyEventId: number;
  visitName: string;
  forms: any[];
}

async function fetchVisitForms(eventIds: number[]): Promise<VisitFormInfo[]> {
  logInfo('--- Phase 2: Fetch visit-forms for each event ---');

  const results: VisitFormInfo[] = [];

  for (const eventId of eventIds.slice(0, 3)) {
    const res = await apiCall({
      method: 'GET',
      url: `/events/instance/${eventId}/visit-forms`,
      script: SCRIPT,
      step: `Get visit-forms for event ${eventId}`,
    });

    if (res.ok) {
      const d = res.data as any;
      const forms = d.data ?? d.forms ?? d;
      const formList = Array.isArray(forms) ? forms : [];
      const visitName = d.eventName ?? d.visitName ?? `Event ${eventId}`;

      results.push({ studyEventId: eventId, visitName, forms: formList });
      logPass(SCRIPT, `Event ${eventId} (${visitName}): ${formList.length} form(s) assigned`);

      // Log individual form details
      for (const f of formList.slice(0, 5)) {
        const name = f.formName ?? f.crfName ?? f.name ?? `CRF ${f.crfId}`;
        const status = f.completionStatus ?? f.status ?? 'unknown';
        logPass(SCRIPT, `  - ${name} [${status}]`);
      }
    } else {
      logWarn(SCRIPT, `Event ${eventId}`, `Could not fetch visit-forms (${res.status})`);
    }
  }

  return results;
}

// ─── Phase 3: Get / Create Patient Form Snapshots ───────────────────────────

interface SnapshotInfo {
  patientEventFormId: number;
  formName: string;
  studyEventId: number;
}

async function testFormSnapshots(eventIds: number[]): Promise<SnapshotInfo[]> {
  logInfo('--- Phase 3: Patient form snapshots ---');

  const snapshots: SnapshotInfo[] = [];

  for (const eventId of eventIds.slice(0, 3)) {
    // Fetch snapshots
    const res = await apiCall({
      method: 'GET',
      url: `/events/instance/${eventId}/form-snapshots`,
      script: SCRIPT,
      step: `Get form snapshots for event ${eventId}`,
    });

    if (res.ok) {
      const d = res.data as any;
      const snaps = d.data ?? d.snapshots ?? d;
      const snapList = Array.isArray(snaps) ? snaps : [];

      logPass(SCRIPT, `Event ${eventId}: ${snapList.length} form snapshot(s)`);

      for (const snap of snapList) {
        const pefId = snap.patientEventFormId ?? snap.patient_event_form_id ?? snap.id;
        const name = snap.formName ?? snap.form_name ?? snap.crfName ?? `Snapshot ${pefId}`;
        const hasStructure = !!(snap.formStructure ?? snap.form_structure);
        const hasData = !!(snap.formData ?? snap.form_data);
        const isLocked = snap.isLocked ?? snap.is_locked ?? false;
        const isFrozen = snap.isFrozen ?? snap.is_frozen ?? false;

        logPass(SCRIPT, `  - ${name} (ID: ${pefId}) structure=${hasStructure} data=${hasData} locked=${isLocked} frozen=${isFrozen}`);

        if (pefId) {
          snapshots.push({ patientEventFormId: pefId, formName: name, studyEventId: eventId });
        }
      }
    } else {
      logWarn(SCRIPT, `Event ${eventId} snapshots`, `Could not fetch (${res.status})`);
    }
  }

  return snapshots;
}

// ─── Phase 3b: Verify Snapshot Field CONTENT ────────────────────────────────

// Raw DB types that should NEVER appear — if they do, EXTENDED_PROPS parsing failed
const RAW_DB_TYPES = ['DATE', 'ST', 'INT', 'REAL', 'BL', 'FILE', 'BN', 'CODE'];

// Known-good CANONICAL frontend field types — output of resolveFieldType().
// Non-canonical aliases (integer→number, group_calculation→calculation, etc.)
// must NOT appear here; their presence would mask a failure to normalize.
const VALID_FIELD_TYPES = [
  'text', 'textarea', 'number', 'decimal', 'date', 'datetime', 'time',
  'radio', 'checkbox', 'select', 'combobox', 'yesno', 'file', 'image', 'signature',
  'table', 'calculation', 'criteria_list', 'question_table', 'inline_group',
  'height', 'weight', 'temperature', 'heart_rate', 'blood_pressure',
  'bmi', 'respiration_rate', 'oxygen_saturation',
  'barcode', 'qrcode', 'section_header', 'static_text',
  'email', 'phone', 'address', 'patient_name', 'patient_id', 'ssn',
  'medical_record_number', 'medication', 'diagnosis', 'procedure', 'lab_result',
  'date_of_birth', 'age', 'bsa', 'egfr', 'sum', 'average',
];

async function verifySnapshotContent(eventIds: number[]): Promise<boolean> {
  logInfo('--- Phase 3b: Verify snapshot field content (types, names, labels) ---');

  let totalChecked = 0;
  let totalFailed = 0;

  for (const eventId of eventIds.slice(0, 3)) {
    const res = await apiCall({
      method: 'GET',
      url: `/events/instance/${eventId}/form-snapshots`,
      script: SCRIPT,
      step: `Verify snapshot content for event ${eventId}`,
    });

    if (!res.ok) continue;

    const snaps = (res.data as any).data ?? res.data;
    const snapList = Array.isArray(snaps) ? snaps : [];

    for (const snap of snapList) {
      const structure = snap.formStructure ?? snap.form_structure;
      const fields = structure?.fields ?? (Array.isArray(structure) ? structure : []);
      const snapName = snap.form_name ?? snap.formName ?? 'Unknown';
      const snapId = snap.patient_event_form_id ?? snap.patientEventFormId;

      if (fields.length === 0) {
        logFail(SCRIPT, `Snapshot ${snapId} content`, `event ${eventId}`, 0,
          `"${snapName}" has 0 fields in form_structure`);
        totalFailed++;
        continue;
      }

      let fieldErrors = 0;

      for (const field of fields) {
        totalChecked++;

        // Check 1: field.type exists and is a valid frontend type
        if (!field.type) {
          logFail(SCRIPT, `Field type missing`, `snapshot ${snapId}`, 0,
            `Field "${field.name ?? field.label ?? '?'}" in "${snapName}" has no type property`);
          fieldErrors++;
        } else if (RAW_DB_TYPES.includes(field.type)) {
          logFail(SCRIPT, `Field has raw DB type`, `snapshot ${snapId}`, 0,
            `Field "${field.name}" in "${snapName}" has raw DB type "${field.type}" — EXTENDED_PROPS parsing failed`);
          fieldErrors++;
        } else if (!VALID_FIELD_TYPES.includes(field.type)) {
          logWarn(SCRIPT, `Field type`, `"${field.name}" in "${snapName}" has unusual type "${field.type}"`);
        }

        // Check 2: field.name is a technical field name, not a display label
        if (!field.name) {
          logFail(SCRIPT, `Field name missing`, `snapshot ${snapId}`, 0,
            `A field in "${snapName}" has no name property`);
          fieldErrors++;
        } else if (field.name.includes(' ') && field.name.length > 20) {
          // Display labels have spaces and are long; technical names are short like "assessment_date"
          logFail(SCRIPT, `Field name looks like display label`, `snapshot ${snapId}`, 0,
            `Field name="${field.name}" in "${snapName}" looks like a display label, not a technical field key`);
          fieldErrors++;
        }

        // Check 3: field.label does NOT contain ---EXTENDED_PROPS---
        const label = field.label ?? '';
        if (label.includes('---EXTENDED_PROPS---')) {
          logFail(SCRIPT, `Label contains raw EXTENDED_PROPS`, `snapshot ${snapId}`, 0,
            `Field "${field.name}" in "${snapName}" has raw ---EXTENDED_PROPS--- in label`);
          fieldErrors++;
        }

        // Check 4: Complex field metadata preserved
        if (field.type === 'table') {
          if (!field.tableColumns || !Array.isArray(field.tableColumns) || field.tableColumns.length === 0) {
            logFail(SCRIPT, `Table field missing columns`, `snapshot ${snapId}`, 0,
              `Table field "${field.name}" in "${snapName}" has no tableColumns`);
            fieldErrors++;
          }
        }
        if (field.type === 'calculation') {
          if (!field.calculationFormula) {
            logFail(SCRIPT, `Calculation field missing formula`, `snapshot ${snapId}`, 0,
              `Calculation field "${field.name}" in "${snapName}" has no calculationFormula`);
            fieldErrors++;
          }
        }
      }

      if (fieldErrors === 0) {
        logPass(SCRIPT, `  "${snapName}" (${fields.length} fields): all types, names, labels valid`);
      } else {
        totalFailed += fieldErrors;
      }
    }
  }

  if (totalFailed > 0) {
    logFail(SCRIPT, 'Snapshot content verification', 'Phase 3b', 0,
      `${totalFailed} field issue(s) found across ${totalChecked} fields checked`);
    return false;
  }

  logPass(SCRIPT, `Snapshot content verified: ${totalChecked} fields checked, all valid`);
  return true;
}

// ─── Phase 4: Save Data to Patient Form Snapshots ───────────────────────────

async function saveSnapshotData(snapshots: SnapshotInfo[]): Promise<void> {
  logInfo('--- Phase 4: Save data to patient form snapshots ---');

  if (snapshots.length === 0) {
    logWarn(SCRIPT, 'Save snapshot data', 'No snapshots available to write data to');
    return;
  }

  // Use form-specific test data so we only write fields that exist on each form
  const generalAssessmentData: Record<string, any> = {
    assessment_date: todayStr(),
    pain_level: '4',
    has_allergies: 'no',
    reported_symptoms: ['headache', 'fatigue'],
    heart_rate: 72,
    blood_pressure: '118/76',
    temperature: 36.5,
    treatment_response: 'PR',
    clinical_notes: 'Patient is stable. No adverse events.',
    next_visit_date: futureDate(14),
  };

  const labResultsData: Record<string, any> = {
    patient_height: 175,
    patient_weight: 72,
    specimen_notes: 'Blood draw completed without complications.',
  };

  let saved = 0;
  let failed = 0;

  for (const snap of snapshots.slice(0, 5)) {
    // Pick the right test data based on form name
    const name = (snap.formName || '').toLowerCase();
    const testFormData = name.includes('lab') || name.includes('procedure')
      ? labResultsData
      : generalAssessmentData;

    const res = await apiCall({
      method: 'PUT',
      url: `/events/patient-form/${snap.patientEventFormId}/data`,
      script: SCRIPT,
      step: `Save data to snapshot ${snap.patientEventFormId} (${snap.formName})`,
      data: { formData: testFormData },
    });

    if (res.ok) {
      saved++;
      logPass(SCRIPT, `Saved data to "${snap.formName}" (ID: ${snap.patientEventFormId})`);
    } else {
      failed++;
      logWarn(SCRIPT, `Save to ${snap.formName}`, `Failed (${res.status}) — may be locked or frozen`);
    }
  }

  logPass(SCRIPT, `Snapshot data save: ${saved} succeeded, ${failed} failed`);

  // Phase 4b: Immediately verify data roundtrip (before edge cases overwrite)
  if (saved > 0 && snapshots.length > 0) {
    logInfo('--- Phase 4b: Verify data roundtrip (re-fetch saved data) ---');
    const firstSnap = snapshots[0];
    const rtRes = await apiCall({
      method: 'GET',
      url: `/events/instance/${firstSnap.studyEventId}/form-snapshots`,
      script: SCRIPT,
      step: 'Re-fetch snapshot to verify data persisted',
    });

    if (rtRes.ok) {
      const snaps = (rtRes.data as any).data ?? rtRes.data;
      const snapList = Array.isArray(snaps) ? snaps : [];
      const target = snapList.find(
        (s: any) => (s.patientEventFormId ?? s.patient_event_form_id) === firstSnap.patientEventFormId
      );

      if (target) {
        const data = target.formData ?? target.form_data;
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          // Verify specific values roundtripped correctly
          const checks = [
            { key: 'assessment_date', expected: todayStr() },
            { key: 'pain_level', expected: '4' },
            { key: 'heart_rate', expected: 72 },
          ];
          let roundtripOk = true;
          for (const check of checks) {
            const actual = data[check.key];
            if (actual === undefined) {
              logFail(SCRIPT, `Data roundtrip: ${check.key}`, `snapshot ${firstSnap.patientEventFormId}`, 0,
                `Key "${check.key}" missing from saved form_data`);
              roundtripOk = false;
            } else if (String(actual) !== String(check.expected)) {
              logFail(SCRIPT, `Data roundtrip: ${check.key}`, `snapshot ${firstSnap.patientEventFormId}`, 0,
                `Expected "${check.expected}" but got "${actual}"`);
              roundtripOk = false;
            }
          }
          if (roundtripOk) {
            logPass(SCRIPT, `Data roundtrip verified: ${Object.keys(data).length} fields persisted correctly`);
          }
        } else {
          logFail(SCRIPT, 'Data roundtrip', `snapshot ${firstSnap.patientEventFormId}`, 0,
            'form_data is empty after save — data did not persist');
        }
      } else {
        logFail(SCRIPT, 'Data roundtrip', `event ${firstSnap.studyEventId}`, 0,
          'Could not find snapshot after re-fetch');
      }
    }
  }
}

// ─── Phase 5: Verify Source of Truth Integrity ──────────────────────────────

async function verifyIntegrity(subjectId: number): Promise<boolean> {
  logInfo('--- Phase 5: Verify source-of-truth integrity ---');

  const res = await apiCall({
    method: 'GET',
    url: `/events/verify/subject/${subjectId}`,
    script: SCRIPT,
    step: 'Verify patient form integrity',
  });

  if (!res.ok) {
    logFail(SCRIPT, 'Integrity check', `GET /events/verify/subject/${subjectId}`, res.status,
      `Could not verify integrity (${res.status})`);
    return false;
  }

  const d = res.data as any;
  const inner = d.data ?? d;
  const missingCount = inner.missingSnapshots ?? inner.missing ?? inner.missingCount ?? 0;
  const extraCount = inner.extraSnapshots ?? inner.extra ?? inner.extraCount ?? 0;
  const totalEvents = inner.totalEvents ?? inner.eventsChecked ?? '?';
  const totalForms = inner.totalForms ?? inner.formsChecked ?? '?';

  // Treat as valid if explicitly valid OR if no mismatches found
  const isValid = inner.valid ?? inner.isValid ?? (missingCount === 0 && extraCount === 0);

  if (isValid) {
    logPass(SCRIPT, `Integrity VALID: ${totalEvents} events, ${totalForms} forms — 0 missing, 0 extra snapshots`);
  } else {
    logFail(SCRIPT, 'Integrity check', `verify/subject/${subjectId}`, 0,
      `MISMATCHES: ${missingCount} missing, ${extraCount} extra snapshot(s)`);
  }

  // Log per-event detail if available
  const details = d.details ?? d.data?.details ?? d.events ?? d.data?.events;
  if (Array.isArray(details)) {
    for (const evt of details.slice(0, 5)) {
      const eventName = evt.eventName ?? evt.visitName ?? `Event ${evt.studyEventId}`;
      const expectedForms = evt.expectedForms ?? evt.templateForms ?? '?';
      const actualForms = evt.actualForms ?? evt.patientForms ?? '?';
      const match = evt.match ?? evt.isValid ?? (expectedForms === actualForms);
      logPass(SCRIPT, `  ${eventName}: expected=${expectedForms} actual=${actualForms} ${match ? 'OK' : 'MISMATCH'}`);
    }
  }

  return !!isValid;
}

// ─── Phase 6: Repair Missing Snapshots & Re-Verify ─────────────────────────

async function repairAndReVerify(subjectId: number): Promise<boolean> {
  logInfo('--- Phase 6: Refresh & repair snapshots, then re-verify ---');
  let ok = true;

  // Step 1: Refresh ALL snapshots — this MUST succeed
  const refreshRes = await apiCall({
    method: 'POST',
    url: `/events/verify/subject/${subjectId}/refresh-snapshots`,
    script: SCRIPT,
    step: 'Refresh all snapshots',
  });

  if (refreshRes.ok) {
    const d = refreshRes.data as any;
    const refreshed = d.data?.refreshed ?? d.refreshed ?? 0;
    const deleted = d.data?.deleted ?? d.deleted ?? 0;
    logPass(SCRIPT, `Snapshot refresh: deleted ${deleted} old, created ${refreshed} fresh snapshot(s)`);
  } else {
    logFail(SCRIPT, 'Refresh all snapshots', `POST /events/verify/subject/${subjectId}/refresh-snapshots`,
      refreshRes.status, `Refresh endpoint failed (${refreshRes.status}) — backend may not be deployed`);
    ok = false;
  }

  // Step 2: Repair any remaining missing snapshots — this MUST succeed
  const repairRes = await apiCall({
    method: 'POST',
    url: `/events/verify/subject/${subjectId}/repair`,
    script: SCRIPT,
    step: 'Repair missing snapshots',
  });

  if (repairRes.ok) {
    const d = repairRes.data as any;
    const repaired = d.repairedCount ?? d.data?.repairedCount ?? d.repaired ?? d.data?.repaired ?? 0;
    logPass(SCRIPT, `Repair complete: ${repaired} additional snapshot(s) created`);
  } else {
    logFail(SCRIPT, 'Repair missing snapshots', `POST /events/verify/subject/${subjectId}/repair`,
      repairRes.status, `Repair endpoint failed (${repairRes.status})`);
    ok = false;
  }

  // Re-verify after refresh + repair — this MUST pass
  logInfo('Re-verifying integrity after refresh + repair...');
  const valid = await verifyIntegrity(subjectId);
  if (valid) {
    logPass(SCRIPT, 'Post-repair integrity check: PASSED');
  } else {
    logFail(SCRIPT, 'Post-repair integrity', 'verify', 0,
      'Integrity check FAILED after refresh + repair — snapshots still broken');
    ok = false;
  }

  return ok;
}

// ─── Phase 7: Edge Cases ────────────────────────────────────────────────────

async function testEdgeCases(state: any, snapshots: SnapshotInfo[]): Promise<void> {
  logInfo('--- Phase 7: Edge cases ---');

  // Edge 1: Attempt to save data to a non-existent snapshot
  logInfo('Edge case 1: Save data to non-existent snapshot ID');
  const fakeRes = await apiCall({
    method: 'PUT',
    url: '/events/patient-form/999999/data',
    script: SCRIPT,
    step: '[EDGE] Save data to non-existent snapshot',
    data: { formData: { test: 'value' } },
    quiet: true,
  });

  if (!fakeRes.ok) {
    logPass(SCRIPT, `[EDGE] Non-existent snapshot correctly rejected (${fakeRes.status})`);
  } else {
    logWarn(SCRIPT, '[EDGE] Non-existent snapshot',
      'Expected 404 but got success — API may upsert or ignore unknown IDs');
  }

  // Edge 2: Save empty data
  if (snapshots.length > 0) {
    logInfo('Edge case 2: Save empty form data to snapshot');
    const emptyRes = await apiCall({
      method: 'PUT',
      url: `/events/patient-form/${snapshots[0].patientEventFormId}/data`,
      script: SCRIPT,
      step: '[EDGE] Save empty form data',
      data: { formData: {} },
    });
    if (emptyRes.ok) {
      logPass(SCRIPT, '[EDGE] Empty form data accepted (overwrites existing)');
    } else {
      logPass(SCRIPT, `[EDGE] Empty form data rejected (${emptyRes.status}) — may require fields`);
    }
  }

  // Edge 3: Test unscheduled visit creation + form snapshot
  logInfo('Edge case 3: Create unscheduled visit and check snapshots');
  const unschedEventDefIds = state.eventDefinitionIds ?? [];
  if (unschedEventDefIds.length > 0) {
    const unschedRes = await apiCall({
      method: 'POST',
      url: '/events/unscheduled',
      script: SCRIPT,
      step: '[EDGE] Create unscheduled visit',
      data: {
        studySubjectId: state.subjectId,
        studyEventDefinitionId: unschedEventDefIds[unschedEventDefIds.length - 1],
        startDate: todayStr(),
        location: 'Emergency Room',
        reason: 'Adverse event follow-up',
      },
    });

    if (unschedRes.ok) {
      const d = unschedRes.data as any;
      const unschedEventId = d.data?.studyEventId ?? d.studyEventId ?? d.data?.study_event_id;
      logPass(SCRIPT, `[EDGE] Unscheduled visit created (event ID: ${unschedEventId})`);

      // Check if snapshots were auto-created
      if (unschedEventId) {
        const snapRes = await apiCall({
          method: 'GET',
          url: `/events/instance/${unschedEventId}/form-snapshots`,
          script: SCRIPT,
          step: '[EDGE] Get snapshots for unscheduled visit',
        });
        if (snapRes.ok) {
          const snaps = (snapRes.data as any).data ?? snapRes.data;
          const snapList = Array.isArray(snaps) ? snaps : [];
          logPass(SCRIPT, `[EDGE] Unscheduled visit has ${snapList.length} form snapshot(s)`);
        }
      }
    } else {
      logWarn(SCRIPT, '[EDGE] Unscheduled visit', `Failed (${unschedRes.status}) — endpoint may not support this`);
    }
  }

  // Edge 4: Fetch visit-forms for non-existent event
  logInfo('Edge case 4: Fetch visit-forms for non-existent event');
  const badEventRes = await apiCall({
    method: 'GET',
    url: '/events/instance/999999/visit-forms',
    script: SCRIPT,
    step: '[EDGE] Visit-forms for non-existent event',
    quiet: true,
  });
  if (!badEventRes.ok) {
    logPass(SCRIPT, `[EDGE] Non-existent event correctly returns error (${badEventRes.status})`);
  } else {
    const forms = (badEventRes.data as any).data ?? badEventRes.data;
    const formList = Array.isArray(forms) ? forms : [];
    if (formList.length === 0) {
      logPass(SCRIPT, '[EDGE] Non-existent event returns empty form list');
    } else {
      logWarn(SCRIPT, '[EDGE] Non-existent event', 'Returned forms — unexpected');
    }
  }

  // Edge 5: Fetch snapshots after data was saved (verify data persisted)
  if (snapshots.length > 0) {
    logInfo('Edge case 5: Re-fetch snapshot to verify persisted data');
    const refetchRes = await apiCall({
      method: 'GET',
      url: `/events/instance/${snapshots[0].studyEventId}/form-snapshots`,
      script: SCRIPT,
      step: '[EDGE] Re-fetch snapshots after data save',
    });
    if (refetchRes.ok) {
      const snaps = (refetchRes.data as any).data ?? refetchRes.data;
      const snapList = Array.isArray(snaps) ? snaps : [];
      const target = snapList.find(
        (s: any) => (s.patientEventFormId ?? s.patient_event_form_id) === snapshots[0].patientEventFormId
      );
      if (target) {
        const data = target.formData ?? target.form_data ?? target.data;
        const hasData = data && typeof data === 'object' && Object.keys(data).length > 0;
        if (hasData) {
          logPass(SCRIPT, `[EDGE] Snapshot ${snapshots[0].patientEventFormId} re-fetched — data persisted: true`);
        } else {
          logWarn(SCRIPT, '[EDGE] Re-fetch data',
            `Snapshot found but formData appears empty (keys: ${data ? Object.keys(data).join(',') : 'none'}) — data may be stored in a different field or cleared by empty save`);
        }
      } else {
        logWarn(SCRIPT, '[EDGE] Re-fetch', 'Snapshot not found in re-fetch');
      }
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function run(): Promise<boolean> {
  logHeader('12 — Patient Visits & Forms (Source of Truth Snapshot Test)');

  const state = loadState();

  if (!state.studyId || !state.subjectId) {
    logFail(SCRIPT, 'Check prerequisites', 'state', 0,
      `Missing studyId (${state.studyId}) or subjectId (${state.subjectId}) — scripts 06 and 09 must pass first`);
    return false;
  }

  logInfo(`Study ID: ${state.studyId}, Subject ID: ${state.subjectId}`);
  logInfo(`Event definitions: [${(state.eventDefinitionIds ?? []).join(', ')}]`);

  // Phase 1: Verify and schedule visits
  const eventIds = await verifyAndScheduleVisits(state);
  if (eventIds.length === 0) {
    logInfo('No events found or created — cannot proceed');
    return false;
  }

  // Phase 2: Fetch visit-forms (template mapping)
  const visitForms = await fetchVisitForms(eventIds);

  // Phase 3: Get / verify form snapshots
  const snapshots = await testFormSnapshots(eventIds);

  // Phase 3b: Verify snapshot CONTENT (field types, names, labels)
  const snapshotContentOk = await verifySnapshotContent(eventIds);

  // Phase 4: Save data to snapshots (includes 4b: data roundtrip verification)
  await saveSnapshotData(snapshots);

  // Phase 5: Verify source-of-truth integrity
  const integrityOk = await verifyIntegrity(state.subjectId);

  // Phase 6: Refresh, repair, and re-verify — MUST succeed
  const repairOk = await repairAndReVerify(state.subjectId);

  // Phase 7: Edge cases
  await testEdgeCases(state, snapshots);

  // ── Final verdict: FAIL the script if any critical phase failed ─────
  let allPassed = true;

  if (!snapshotContentOk) {
    logFail(SCRIPT, 'Snapshot content', 'Phase 3b', 0,
      'Field types, names, or labels are invalid in snapshots');
    allPassed = false;
  }
  if (!integrityOk) {
    logFail(SCRIPT, 'Source-of-truth integrity', 'Phase 5', 0,
      'Patient snapshots do not match study template — missing or extra forms');
    allPassed = false;
  }
  if (!repairOk) {
    logFail(SCRIPT, 'Refresh/repair', 'Phase 6', 0,
      'Snapshot refresh or repair endpoint failed');
    allPassed = false;
  }

  // Summary
  logInfo(`Visit-forms test complete: ${eventIds.length} events, ${snapshots.length} snapshots tested`);
  logInfo(`Snapshot content: ${snapshotContentOk ? 'ALL FIELDS VALID' : 'FIELD ISSUES DETECTED'}`);
  logInfo(`Source-of-truth integrity: ${integrityOk ? 'VALID' : 'FAILED'}`);
  logInfo(`Refresh/repair: ${repairOk ? 'PASSED' : 'FAILED'}`);

  return allPassed;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
