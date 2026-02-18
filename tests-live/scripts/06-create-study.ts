/**
 * Script 06 — Create Study with Sites, Visits, and eCRF Assignments
 *
 * Creates a fully populated study with:
 *  - All identification, classification, regulatory, eligibility fields filled
 *  - PI = admin account we created
 *  - 2 sites (Main Hospital, Satellite Clinic)
 *  - 3 visits (Screening Day 0, Baseline Day 7, Follow-Up Day 30)
 *  - ALL 6 eCRFs assigned to every visit
 */

import { apiCall } from '../lib/api-client';
import { logHeader, logPass, logFail, logInfo, logWarn } from '../lib/logger';
import { loadState, updateState } from '../lib/state';

const SCRIPT = '06-create-study';

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

async function run(): Promise<boolean> {
  logHeader('06 — Create Study');

  const state = loadState();

  // Verify all 6 CRF IDs exist
  const crfIds = [
    state.baseCrf1Id, state.baseCrf2Id,
    state.validationCrf1Id, state.validationCrf2Id,
    state.workflowCrf1Id, state.workflowCrf2Id,
  ];
  const missingCrfs = crfIds.filter((id) => !id);
  if (missingCrfs.length > 0) {
    logInfo(`Missing ${missingCrfs.length} CRF IDs in state — run scripts 03-05 first`);
    return false;
  }

  if (!state.adminUsername) {
    logInfo('No adminUsername in state — run script 00 first');
    return false;
  }

  // Build CRF assignments array for each visit (all 6 eCRFs)
  const buildCrfAssignments = () =>
    crfIds.map((crfId, idx) => ({
      crfId: crfId!,
      required: true,
      doubleEntry: false,
      electronicSignature: false,
      hideCrf: false,
      ordinal: idx + 1,
    }));

  const studyPayload = {
    // ── Identification ────────────────────────────────────────────
    name: 'Automated E2E Test Study',
    uniqueIdentifier: `E2E-TEST-${Date.now().toString(36).toUpperCase()}`,
    officialTitle: 'A Multi-Center, Randomized, Double-Blind Study to Evaluate EDC Platform Functionality',
    secondaryIdentifier: 'EDC-FUNC-001',
    summary: 'End-to-end automated test study created by the live test suite to verify organization setup, form creation, validation rules, workflow configuration, patient enrollment, and data entry.',
    studyAcronym: 'E2E-TEST',

    // ── Team ──────────────────────────────────────────────────────
    principalInvestigator: state.adminUsername,
    sponsor: 'AccuraTrial Test Organization',
    collaborators: 'EDC QA Team, AccuraTrial Engineering',

    // ── Classification ────────────────────────────────────────────
    phase: 'II',
    protocolType: 'interventional',
    expectedTotalEnrollment: 50,
    datePlannedStart: todayStr(),
    datePlannedEnd: futureDate(365),

    // ── Facility ──────────────────────────────────────────────────
    facilityName: 'AccuraTrial Research Center',
    facilityAddress: '123 Clinical Research Blvd, Suite 400',
    facilityCity: 'Boston',
    facilityState: 'Massachusetts',
    facilityZip: '02115',
    facilityCountry: 'United States',
    facilityRecruitmentStatus: 'Recruiting',
    facilityContactName: 'James Admin',
    facilityContactDegree: 'MD, PhD',
    facilityContactPhone: '+1-555-0100',
    facilityContactEmail: state.adminEmail,

    // ── Protocol ──────────────────────────────────────────────────
    protocolDescription: 'This protocol evaluates the complete EDC workflow including multi-form data entry, validation rule enforcement, workflow-driven query generation, and source data verification.',
    protocolDateVerification: todayStr(),
    protocolVersion: '1.0',
    protocolAmendmentNumber: '0',
    conditions: 'Functional Testing',
    keywords: 'EDC, clinical trial, validation, workflow, e2e test',
    interventions: 'Standard clinical data capture workflow',

    // ── Regulatory ────────────────────────────────────────────────
    therapeuticArea: 'General Medicine',
    indication: 'Platform Validation',
    nctNumber: 'NCT00000000',
    irbNumber: 'IRB-TEST-2026-001',
    regulatoryAuthority: 'FDA',

    // ── Eligibility ───────────────────────────────────────────────
    eligibility: 'Adults aged 18-75 with confirmed diagnosis',
    gender: 'both',
    ageMin: '18',
    ageMax: '75',
    healthyVolunteerAccepted: true,

    // ── Study Design ──────────────────────────────────────────────
    purpose: 'Treatment',
    allocation: 'Randomized',
    masking: 'Double-Blind',
    control: 'Placebo',
    assignment: 'Parallel',
    endpoint: 'Efficacy',
    duration: '12 months',

    // ── Sites ─────────────────────────────────────────────────────
    sites: [
      {
        name: 'Main Hospital Site',
        uniqueIdentifier: 'SITE-MAIN-001',
        summary: 'Primary research site with full lab and imaging facilities',
        principalInvestigator: state.adminUsername,
        expectedTotalEnrollment: 30,
        facilityName: 'Boston General Hospital',
        facilityAddress: '100 Main St',
        facilityCity: 'Boston',
        facilityState: 'MA',
        facilityZip: '02115',
        facilityCountry: 'United States',
        facilityRecruitmentStatus: 'Recruiting',
      },
      {
        name: 'Satellite Clinic Site',
        uniqueIdentifier: 'SITE-SAT-001',
        summary: 'Community clinic for routine follow-up visits',
        principalInvestigator: state.adminUsername,
        expectedTotalEnrollment: 20,
        facilityName: 'Cambridge Community Clinic',
        facilityAddress: '55 Research Drive',
        facilityCity: 'Cambridge',
        facilityState: 'MA',
        facilityZip: '02139',
        facilityCountry: 'United States',
        facilityRecruitmentStatus: 'Not yet recruiting',
      },
    ],

    // ── Event Definitions (Visits) ────────────────────────────────
    eventDefinitions: [
      {
        name: 'Screening Visit',
        description: 'Initial screening and eligibility assessment',
        category: 'Study Event',
        type: 'scheduled',
        ordinal: 1,
        repeating: false,
        scheduleDay: 0,
        minDay: -3,
        maxDay: 3,
        crfAssignments: buildCrfAssignments(),
      },
      {
        name: 'Baseline Visit',
        description: 'Baseline measurements and treatment initiation',
        category: 'Study Event',
        type: 'scheduled',
        ordinal: 2,
        repeating: false,
        scheduleDay: 7,
        minDay: 5,
        maxDay: 10,
        crfAssignments: buildCrfAssignments(),
      },
      {
        name: 'Follow-Up Visit',
        description: '30-day follow-up assessment and safety evaluation',
        category: 'Study Event',
        type: 'scheduled',
        ordinal: 3,
        repeating: false,
        scheduleDay: 30,
        minDay: 25,
        maxDay: 35,
        crfAssignments: buildCrfAssignments(),
      },
    ],
  };

  logInfo('Creating study with 2 sites, 3 visits, 6 eCRFs per visit...');

  const res = await apiCall({
    method: 'POST',
    url: '/studies',
    script: SCRIPT,
    step: 'Create study',
    data: studyPayload,
  });

  if (!res.ok) return false;

  const d = res.data as any;
  const studyId = d.studyId ?? d.data?.studyId ?? d.data?.study_id ?? d.id;

  if (!studyId) {
    logFail(SCRIPT, 'Extract studyId', 'POST /studies', res.status,
      'Response OK but no studyId found', undefined, d);
    return false;
  }

  updateState({ studyId, studyOid: d.oid ?? d.data?.oid });
  logPass(SCRIPT, `Study created: ID ${studyId}`);

  // Fetch study details to capture site IDs and event definition IDs
  logInfo('Fetching study details to capture nested IDs...');

  const detailRes = await apiCall({
    method: 'GET',
    url: `/studies/${studyId}`,
    script: SCRIPT,
    step: 'Fetch study details',
  });

  if (!detailRes.ok) {
    logFail(SCRIPT, 'Fetch study details', `GET /studies/${studyId}`, detailRes.status,
      `Study created but details fetch failed — likely a database schema issue (${typeof detailRes.data === 'object' ? (detailRes.data as any).message : detailRes.data})`,
      undefined, detailRes.data);
    return false;
  }

  const detail = (detailRes.data as any).data ?? detailRes.data;

  // Extract site IDs
  const sites = detail.sites ?? [];
  const siteIds = sites.map((s: any) => s.siteId ?? s.site_id ?? s.id ?? s.studyId ?? s.study_id).filter(Boolean);
  if (siteIds.length) {
    updateState({ siteIds });
    logPass(SCRIPT, `Sites created: ${siteIds.length} (IDs: ${siteIds.join(', ')})`);
  }

  // Extract event definition IDs — these are required for downstream scripts
  const events = detail.eventDefinitions ?? [];
  const eventDefIds = events.map((e: any) => e.studyEventDefinitionId ?? e.study_event_definition_id).filter(Boolean);
  if (eventDefIds.length === 0) {
    logFail(SCRIPT, 'Extract event definitions', `GET /studies/${studyId}`, detailRes.status,
      'Study details returned OK but no event definitions found — study may have been created without visits',
      undefined, detail);
    return false;
  }

  updateState({ eventDefinitionIds: eventDefIds });
  logPass(SCRIPT, `Visits created: ${eventDefIds.length} (IDs: ${eventDefIds.join(', ')})`);
  for (const ev of events) {
    const crfs = ev.crfAssignments ?? [];
    logPass(SCRIPT, `  Visit "${ev.name}": ${crfs.length} CRFs assigned`);
  }

  return true;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
