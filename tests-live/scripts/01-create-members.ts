/**
 * Script 01 — Create 2 Organization Members
 *
 * Member 1: coordinator (can fill forms, schedule events)
 * Member 2: monitor     (can create queries, perform SDV)
 *
 * If usernames already exist, looks them up from the org member list instead.
 */

import { apiCall } from '../lib/api-client';
import { CONFIG } from '../lib/config';
import { logHeader, logPass, logInfo, logWarn } from '../lib/logger';
import { loadState, updateState } from '../lib/state';

const SCRIPT = '01-create-members';

interface MemberInfo {
  userId?: number;
  username: string;
  role: string;
}

async function getExistingMembers(orgId: number): Promise<MemberInfo[]> {
  const res = await apiCall({
    method: 'GET',
    url: `/organizations/${orgId}/members`,
    script: SCRIPT,
    step: 'Fetch existing org members',
  });
  if (!res.ok) return [];
  const data = (res.data as any).data ?? res.data;
  const list = Array.isArray(data) ? data : (data.members ?? []);
  return list.map((m: any) => ({
    userId: m.userId ?? m.user_id,
    username: m.username ?? m.user_name,
    role: m.role ?? m.roleName,
  }));
}

async function ensureMember(
  orgId: number,
  existingMembers: MemberInfo[],
  config: typeof CONFIG.MEMBER1,
  statePrefix: string,
  label: string,
): Promise<boolean> {
  // Check if a member with this role already exists
  const existing = existingMembers.find(
    (m) => m.username === config.username || m.role === config.role,
  );

  if (existing) {
    updateState({
      [`${statePrefix}UserId`]: existing.userId,
      [`${statePrefix}Username`]: existing.username,
    });
    logPass(SCRIPT, `${label}: found existing ${existing.role} "${existing.username}" (ID: ${existing.userId})`);
    return true;
  }

  // Try to create
  const res = await apiCall({
    method: 'POST',
    url: `/organizations/${orgId}/members`,
    script: SCRIPT,
    step: `Create ${label}`,
    quiet: true,
    data: {
      firstName: config.firstName,
      lastName: config.lastName,
      email: config.email,
      username: config.username,
      password: config.password,
      role: config.role,
      phone: '+1-555-020' + (statePrefix === 'member1' ? '1' : '2'),
    },
  });

  if (res.ok) {
    const d = res.data as any;
    const userId = d.data?.userId ?? d.userId;
    updateState({
      [`${statePrefix}UserId`]: userId,
      [`${statePrefix}Username`]: config.username,
    });
    logPass(SCRIPT, `${label}: created "${config.username}" (ID: ${userId})`);
    return true;
  }

  // If it failed because username exists, the member may be in a different org
  // Just store the username for reference
  const errMsg = typeof res.data === 'object' ? (res.data as any).message : '';
  if (/already|exists|duplicate/i.test(errMsg)) {
    updateState({ [`${statePrefix}Username`]: config.username });
    logWarn(SCRIPT, label, `"${config.username}" exists globally — stored username for later use`);
    return true;
  }

  return false;
}

async function run(): Promise<boolean> {
  logHeader('01 — Create Organization Members');

  const state = loadState();
  if (!state.orgId) {
    logInfo('No orgId in state — run script 00 first');
    return false;
  }

  // Fetch existing members to avoid duplicate creation attempts
  logInfo(`Checking existing members for org ${state.orgId}...`);
  const existing = await getExistingMembers(state.orgId);
  if (existing.length > 0) {
    logInfo(`Found ${existing.length} existing member(s): ${existing.map((m) => `${m.username}(${m.role})`).join(', ')}`);
  }

  const ok1 = await ensureMember(state.orgId, existing, CONFIG.MEMBER1, 'member1', 'Coordinator');
  const ok2 = await ensureMember(state.orgId, existing, CONFIG.MEMBER2, 'member2', 'Monitor');

  return ok1 && ok2;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
