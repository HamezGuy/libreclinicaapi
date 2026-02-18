/**
 * Script 09 — Create Patient (Enroll Subject)
 *
 * Creates a patient with full demographics and assigns to the study.
 * Also schedules the first visit (Screening) automatically.
 */

import { apiCall } from '../lib/api-client';
import { logHeader, logPass, logFail, logInfo } from '../lib/logger';
import { loadState, updateState } from '../lib/state';

const SCRIPT = '09-create-patient';

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

async function run(): Promise<boolean> {
  logHeader('09 — Create Patient');

  const state = loadState();

  if (!state.studyId) {
    logInfo('No studyId in state — run script 06 first');
    return false;
  }

  const firstEventDefId = state.eventDefinitionIds?.[0];
  if (!firstEventDefId) {
    logInfo('No eventDefinitionIds in state — study may not have visits');
  }

  // Use a clear, readable patient ID
  const subjectLabel = 'SUBJ-001';
  logInfo(`Creating patient: ${subjectLabel}`);

  const payload: any = {
    studyId: state.studyId,
    studySubjectId: subjectLabel,
    secondaryId: 'MRN-00001',
    enrollmentDate: todayStr(),
    screeningDate: todayStr(),
    gender: 'm',
    dateOfBirth: '1985-06-15',
    personId: `PID-${Date.now()}`,
    timeZone: 'America/New_York',
  };

  // Schedule the first visit (Screening) automatically if we have the event def ID
  if (firstEventDefId) {
    payload.scheduleEvent = {
      studyEventDefinitionId: firstEventDefId,
      location: 'Boston General Hospital',
      startDate: todayStr(),
    };
  }

  logInfo(`Creating subject "${subjectLabel}" in study ${state.studyId}...`);

  const res = await apiCall({
    method: 'POST',
    url: '/subjects',
    script: SCRIPT,
    step: 'Create patient',
    data: payload,
  });

  if (!res.ok) return false;

  const d = res.data as any;
  const subjectId =
    d.data?.studySubjectId ??
    d.data?.study_subject_id ??
    d.studySubjectId ??
    d.study_subject_id ??
    d.data?.subjectId ??
    d.subjectId ??
    d.data?.id;

  if (!subjectId) {
    logFail(SCRIPT, 'Extract subjectId', 'POST /subjects', res.status,
      'Response OK but could not extract subject ID from response', undefined, d);
    return false;
  }

  updateState({
    subjectId: typeof subjectId === 'number' ? subjectId : parseInt(subjectId, 10),
    studySubjectId: subjectLabel,
  });

  logPass(SCRIPT, `Patient created: "${subjectLabel}" (ID: ${subjectId})`);
  logPass(SCRIPT, `Gender: M, DOB: 1985-06-15`);

  if (firstEventDefId) {
    logPass(SCRIPT, `Screening Visit scheduled for ${todayStr()}`);
  }

  // Fetch subject events to capture study_event IDs
  logInfo('Fetching patient events...');
  const eventsRes = await apiCall({
    method: 'GET',
    url: `/events/subject/${subjectId}`,
    script: SCRIPT,
    step: 'Get patient events',
  });

  if (eventsRes.ok) {
    const events = (eventsRes.data as any).data ?? eventsRes.data;
    const eventList = Array.isArray(events) ? events : [];
    const eventIds = eventList.map((e: any) => e.studyEventId ?? e.study_event_id).filter(Boolean);
    if (eventIds.length) {
      updateState({ studyEventIds: eventIds });
      logPass(SCRIPT, `Patient has ${eventIds.length} scheduled event(s): [${eventIds.join(', ')}]`);
    }
  }

  return true;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
