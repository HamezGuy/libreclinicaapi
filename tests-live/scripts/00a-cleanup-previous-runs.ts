/**
 * Script 00a — Clean Up Previous Test Runs
 *
 * Removes ALL data created by previous test suite runs so each new run
 * starts from a clean slate. Cleanup order matters for FK dependencies:
 *   1. Subjects/Patients (cascades events, event_crfs, snapshots)
 *   2. Validation rules (explicit delete, don't rely on cascade)
 *   3. Studies (cascades event_definitions, sites)
 *   4. eCRFs / Forms
 *
 * This script runs BEFORE registration/login, so it uses a fresh login.
 */

import { apiCall } from '../lib/api-client';
import { CONFIG } from '../lib/config';
import { logHeader, logPass, logInfo, logWarn } from '../lib/logger';
import { loadState, updateState, saveState } from '../lib/state';

const SCRIPT = '00a-cleanup';

function emailToUsername(email: string): string {
  return email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
}

async function loginAs(email: string): Promise<boolean> {
  const username = emailToUsername(email);
  const res = await apiCall({
    method: 'POST',
    url: '/auth/login',
    noAuth: true,
    script: SCRIPT,
    step: `Login as ${username}`,
    quiet: true,
    data: { username, password: CONFIG.ADMIN_PASSWORD },
  });
  if (res.ok && (res.data as any).accessToken) {
    const d = res.data as any;
    updateState({
      adminUsername: username,
      adminEmail: email,
      adminUserId: d.user?.userId,
      accessToken: d.accessToken,
      refreshToken: d.refreshToken,
      orgId: d.organizations?.[0]?.organizationId
        ? parseInt(d.organizations[0].organizationId)
        : undefined,
      orgName: d.organizations?.[0]?.organizationName,
    });
    return true;
  }
  return false;
}

// ── Delete subjects for each test study (cascades events, event_crfs, snapshots) ──

async function cleanupSubjects(): Promise<void> {
  logInfo('Cleaning up old test subjects...');

  const listRes = await apiCall({
    method: 'GET',
    url: '/studies',
    script: SCRIPT,
    step: 'List studies for subject cleanup',
    params: { limit: 100 },
    quiet: true,
  });
  if (!listRes.ok) return;

  const data = (listRes.data as any).data ?? (listRes.data as any).studies ?? listRes.data;
  const studies = Array.isArray(data) ? data : (data?.studies ?? []);

  let deleted = 0;
  for (const study of studies) {
    const name = study.name ?? study.studyName ?? '';
    const studyId = study.studyId ?? study.study_id ?? study.id;
    if (!name.includes('Automated E2E Test Study') && !name.includes('Test Study')) continue;

    // Get subjects for this study
    const subRes = await apiCall({
      method: 'GET',
      url: '/subjects',
      script: SCRIPT,
      step: `List subjects for study ${studyId}`,
      params: { studyId, limit: 100 },
      quiet: true,
    });
    if (!subRes.ok) continue;

    const subjects = (subRes.data as any).data ?? subRes.data;
    const subjectList = Array.isArray(subjects) ? subjects : (subjects?.subjects ?? []);

    for (const sub of subjectList) {
      const subId = sub.studySubjectId ?? sub.study_subject_id ?? sub.id;
      if (!subId) continue;

      const delRes = await apiCall({
        method: 'DELETE',
        url: `/subjects/${subId}`,
        script: SCRIPT,
        step: `Delete subject ${subId}`,
        quiet: true,
      });
      if (delRes.ok) deleted++;
    }
  }
  logPass(SCRIPT, `Deleted ${deleted} old test subject(s)`);
}

// ── Delete validation rules explicitly (don't rely on cascade) ──

async function cleanupValidationRules(): Promise<void> {
  logInfo('Cleaning up old validation rules...');

  // Get ALL validation rules (study 0 = all studies)
  const res = await apiCall({
    method: 'GET',
    url: '/validation-rules/study/0',
    script: SCRIPT,
    step: 'List all validation rules',
    quiet: true,
  });
  if (!res.ok) return;

  const rules = (res.data as any).data ?? res.data;
  const ruleList = Array.isArray(rules) ? rules : [];

  let deleted = 0;
  for (const rule of ruleList) {
    const ruleId = rule.validationRuleId ?? rule.validation_rule_id ?? rule.id;
    if (!ruleId) continue;

    const delRes = await apiCall({
      method: 'DELETE',
      url: `/validation-rules/${ruleId}`,
      script: SCRIPT,
      step: `Delete rule ${ruleId}`,
      quiet: true,
    });
    if (delRes.ok) deleted++;
  }
  logPass(SCRIPT, `Deleted ${deleted} old validation rule(s)`);
}

// ── Delete studies ──

async function cleanupStudies(): Promise<void> {
  logInfo('Cleaning up old test studies...');

  const listRes = await apiCall({
    method: 'GET',
    url: '/studies',
    script: SCRIPT,
    step: 'List studies',
    params: { limit: 100 },
    quiet: true,
  });
  if (!listRes.ok) return;

  const data = (listRes.data as any).data ?? (listRes.data as any).studies ?? listRes.data;
  const studies = Array.isArray(data) ? data : (data?.studies ?? []);

  let deleted = 0;
  for (const study of studies) {
    const name = study.name ?? study.studyName ?? '';
    const id = study.studyId ?? study.study_id ?? study.id;

    if (name.includes('Automated E2E Test Study') || name.includes('Test Study')) {
      const delRes = await apiCall({
        method: 'DELETE',
        url: `/studies/${id}`,
        script: SCRIPT,
        step: `Delete study ${id}`,
        quiet: true,
      });
      if (delRes.ok) deleted++;
    }
  }
  logPass(SCRIPT, `Deleted/archived ${deleted} old test studies`);
}

// ── Delete forms ──

async function cleanupForms(): Promise<void> {
  logInfo('Cleaning up old test eCRFs...');

  const listRes = await apiCall({
    method: 'GET',
    url: '/forms',
    script: SCRIPT,
    step: 'List forms',
    quiet: true,
  });
  if (!listRes.ok) return;

  const data = (listRes.data as any).data ?? listRes.data;
  const forms = Array.isArray(data) ? data : (data?.forms ?? []);

  const testNames = [
    'General Assessment Form',
    'Lab Results & Procedures Form',
    'Branching Logic Test Form',
  ];

  let deleted = 0;
  for (const form of forms) {
    const name = form.name ?? '';
    const id = form.crfId ?? form.crf_id ?? form.id;

    if (testNames.some((t) => name.includes(t))) {
      const delRes = await apiCall({
        method: 'DELETE',
        url: `/forms/${id}`,
        script: SCRIPT,
        step: `Delete form ${id}`,
        quiet: true,
      });
      if (delRes.ok) deleted++;
    }
  }
  logPass(SCRIPT, `Deleted/archived ${deleted} old test eCRFs`);
}

async function run(): Promise<boolean> {
  logHeader('00a — Clean Up Previous Test Runs');

  // Start with empty state
  saveState({});

  // Clean data from the first and last admin accounts (covers all orgs).
  // Only use two accounts to minimize login attempts and avoid rate limiting.
  const accountsToClean = [CONFIG.ADMIN_EMAILS[0], CONFIG.ADMIN_EMAILS[CONFIG.ADMIN_EMAILS.length - 1]];
  // Deduplicate if there's only one email
  const uniqueAccounts = [...new Set(accountsToClean)];
  let anyLoggedIn = false;

  for (const email of uniqueAccounts) {
    const username = emailToUsername(email);
    const loggedIn = await loginAs(email);
    if (!loggedIn) continue;

    anyLoggedIn = true;
    logPass(SCRIPT, `Cleaning data for ${username}...`);

    await cleanupSubjects();
    await cleanupValidationRules();
    await cleanupStudies();
    await cleanupForms();
  }

  if (!anyLoggedIn) {
    logInfo('No existing account — nothing to clean. Starting fresh.');
  }

  // Reset state so script 00 starts fresh
  saveState({});

  logPass(SCRIPT, 'Cleanup complete — ready for fresh test run');
  return true;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
