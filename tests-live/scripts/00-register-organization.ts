/**
 * Script 00 — Register Organization + Admin User
 *
 * Tries jamesgui111, then 222, then 333 if the email/username is already taken.
 * If ALL emails are taken (previous runs), falls back to logging in with the
 * last known email and populates state from the login response.
 */

import { apiCall } from '../lib/api-client';
import { CONFIG } from '../lib/config';
import { logHeader, logPass, logFail, logInfo, logWarn } from '../lib/logger';
import { updateState } from '../lib/state';

const SCRIPT = '00-register-organization';

function emailToUsername(email: string): string {
  return email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
}

async function tryLogin(email: string): Promise<boolean> {
  const username = emailToUsername(email);
  logInfo(`Attempting login with existing account: ${username}`);

  const res = await apiCall({
    method: 'POST',
    url: '/auth/login',
    noAuth: true,
    script: SCRIPT,
    step: `Login fallback (${username})`,
    data: { username, password: CONFIG.ADMIN_PASSWORD },
  });

  if (!res.ok) return false;

  const d = res.data as any;
  const token = d.accessToken;
  const user = d.user;
  const orgs = d.organizations ?? [];

  if (!token) return false;

  updateState({
    orgId: orgs[0]?.organizationId ? parseInt(orgs[0].organizationId) : undefined,
    orgName: orgs[0]?.organizationName,
    adminUserId: user?.userId,
    adminUsername: username,
    adminEmail: email,
    accessToken: token,
    refreshToken: d.refreshToken,
  });

  logPass(SCRIPT, `Logged into existing account: ${username} (userId: ${user?.userId})`);
  if (orgs.length) logPass(SCRIPT, `Organization: ${orgs[0]?.organizationName} (ID: ${orgs[0]?.organizationId})`);
  return true;
}

async function run(): Promise<boolean> {
  logHeader('00 — Register Organization');

  const emails = CONFIG.ADMIN_EMAILS;
  let orgCounter = 1;
  let lastTriedEmail = emails[0];

  for (const email of emails) {
    lastTriedEmail = email;
    const username = emailToUsername(email);
    const orgName = `${CONFIG.ORG_BASE_NAME} ${orgCounter}`;

    logInfo(`Attempting registration with ${email} / ${username} / "${orgName}"`);

    const res = await apiCall({
      method: 'POST',
      url: '/organizations/register',
      noAuth: true,
      script: SCRIPT,
      step: `Register org with ${email}`,
      quiet: true,
      data: {
        organizationDetails: {
          name: orgName,
          type: CONFIG.ORG_TYPE,
          email: email,
          phone: '+1-555-0100',
          website: 'https://accuratrials.com',
          street: '123 Clinical Research Blvd',
          city: 'Boston',
          state: 'MA',
          postalCode: '02115',
          country: 'US',
        },
        adminDetails: {
          firstName: 'James',
          lastName: 'Admin',
          email: email,
          username: username,
          phone: '+1-555-0101',
          professionalTitle: 'Principal Investigator',
          credentials: 'MD, PhD',
          password: CONFIG.ADMIN_PASSWORD,
        },
        termsAccepted: {
          acceptTerms: true,
          acceptPrivacy: true,
          acceptCompliance: true,
        },
      },
    });

    if (res.ok) {
      const d = res.data as any;
      const orgId = d.data?.organizationId ?? d.organizationId;
      const userId = d.data?.userId ?? d.userId;
      const token = d.data?.accessToken ?? d.accessToken;
      const refresh = d.data?.refreshToken ?? d.refreshToken;

      updateState({
        orgId,
        orgName,
        adminUserId: userId,
        adminUsername: username,
        adminEmail: email,
        accessToken: token,
        refreshToken: refresh,
      });

      logPass(SCRIPT, `Organization registered: "${orgName}" (ID: ${orgId})`);
      logPass(SCRIPT, `Admin user created: ${username} (ID: ${userId})`);
      if (token) logPass(SCRIPT, 'Access token saved to state');
      return true;
    }

    const errMsg = typeof res.data === 'object' ? (res.data as any).message : String(res.data);
    if (res.status === 409 || /already|exists|duplicate|taken/i.test(errMsg || '')) {
      logInfo(`${email} already exists, trying next...`);
      orgCounter++;
      continue;
    }

    logInfo(`Registration failed (${res.status}), trying next email...`);
    orgCounter++;
  }

  // All emails exhausted — try logging in with each email (reverse order = most recent)
  logWarn(SCRIPT, 'Registration', 'All emails taken. Attempting login with existing accounts...');
  for (const email of [...emails].reverse()) {
    if (await tryLogin(email)) return true;
  }

  logFail(SCRIPT, 'All emails exhausted', 'POST /organizations/register', 0,
    'Could not register or login with any of the configured emails');
  return false;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
