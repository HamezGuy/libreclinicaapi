/**
 * Script 02 — Login as Admin
 *
 * Authenticates with the admin credentials and stores the JWT token in state.
 * This refreshes the token even if one was obtained during registration.
 */

import { apiCall } from '../lib/api-client';
import { CONFIG } from '../lib/config';
import { logHeader, logPass, logFail, logInfo } from '../lib/logger';
import { loadState, updateState } from '../lib/state';

const SCRIPT = '02-login-admin';

async function run(): Promise<boolean> {
  logHeader('02 — Login as Admin');

  const state = loadState();
  if (!state.adminUsername) {
    logInfo('No adminUsername in state — run script 00 first');
    return false;
  }

  logInfo(`Logging in as: ${state.adminUsername}`);

  const res = await apiCall({
    method: 'POST',
    url: '/auth/login',
    noAuth: true,
    script: SCRIPT,
    step: 'Admin login',
    data: {
      username: state.adminUsername,
      password: CONFIG.ADMIN_PASSWORD,
    },
  });

  if (!res.ok) return false;

  const d = res.data as any;
  const token = d.accessToken;
  const refresh = d.refreshToken;
  const user = d.user;

  if (!token) {
    logFail(SCRIPT, 'Extract token', 'POST /auth/login', res.status,
      'Response OK but no accessToken found in body', undefined, d);
    return false;
  }

  updateState({
    accessToken: token,
    refreshToken: refresh,
    adminUserId: user?.userId ?? state.adminUserId,
    adminEmail: state.adminEmail ?? user?.email,
  });

  logPass(SCRIPT, `Logged in as ${state.adminUsername} (userId: ${user?.userId})`);
  logPass(SCRIPT, `Token expires in ${d.expiresIn ?? '?'}s`);

  if (d.organizations?.length) {
    logPass(SCRIPT, `Organizations: ${d.organizations.map((o: any) => o.organizationName).join(', ')}`);
  }

  return true;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
