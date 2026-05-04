const blocklist = new Map<string, number>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [token, expiresAt] of blocklist) {
    if (expiresAt < now) blocklist.delete(token);
  }
}, CLEANUP_INTERVAL_MS);

export function blockToken(token: string, expiresAtMs: number): void {
  blocklist.set(token, expiresAtMs);
}

export function isTokenBlocked(token: string): boolean {
  return blocklist.has(token);
}

const activeSessions = new Map<number, { token: string; loginTime: number; ip: string }>();

export function registerSession(userId: number, token: string, ip: string): void {
  activeSessions.set(userId, { token, loginTime: Date.now(), ip });
}

export function getActiveSession(userId: number): { token: string; loginTime: number; ip: string } | undefined {
  return activeSessions.get(userId);
}

export function clearSession(userId: number): void {
  activeSessions.delete(userId);
}

/**
 * Revoke all active sessions for a user (§11.300(c)).
 * Blocks the user's current token and clears their session record.
 * Returns true if an active session was found and revoked.
 */
export function revokeAllUserSessions(userId: number): boolean {
  const session = activeSessions.get(userId);
  if (session) {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    blockToken(session.token, Date.now() + ONE_DAY_MS);
    activeSessions.delete(userId);
    return true;
  }
  activeSessions.delete(userId);
  return false;
}

export function blockAllUserTokens(userId: number): void {
  const session = activeSessions.get(userId);
  if (session) {
    blockToken(session.token, Date.now() + 24 * 60 * 60 * 1000);
    activeSessions.delete(userId);
  }
}
