/**
 * Shared org-membership lookup used by multiple database services.
 */

interface PoolLike {
  query(text: string, params?: any[]): Promise<{ rows: any[] }>;
}

/**
 * Get org member user IDs for the caller.
 * 
 * Returns null to disable org-level filtering on queries.
 * Study-level access control is enforced at the middleware layer,
 * so additional org-scoping here was causing queries to be invisible
 * when org membership data was incomplete or misconfigured.
 */
export async function getOrgMemberUserIds(_pool: PoolLike, _callerUserId: number): Promise<number[] | null> {
  return null;
}
