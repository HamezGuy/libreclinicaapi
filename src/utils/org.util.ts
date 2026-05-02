/**
 * Shared org-membership lookup used by multiple database services.
 *
 * Returns the user IDs of every active member in the caller's organization(s).
 * When a caller belongs to org 58, this returns [10, 12, 15, …] — every
 * user in that org.  Query/task/SDV listing functions use this to scope
 * results: "show me items owned by anyone in my org, OR assigned to me."
 *
 * Returns `null` only when the caller has no active org membership at all
 * (e.g. a sysadmin with no org, or a freshly created user before invite).
 * Callers that get `null` should fall back to no org filter (show all
 * accessible data) or restrict to the caller's own userId.
 *
 * IMPORTANT: The database layer auto-camelizes column names.
 *   organization_id → organizationId
 *   user_id         → userId
 * Always access row properties as camelCase.
 */

interface PoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function getOrgMemberUserIds(pool: PoolLike, callerUserId: number): Promise<number[] | null> {
  try {
    const orgResult = await pool.query(
      `SELECT organization_id
       FROM acc_organization_member
       WHERE user_id = $1 AND status = 'active'`,
      [callerUserId]
    );

    if (orgResult.rows.length === 0) return null;

    const orgIds = orgResult.rows.map(r => r.organizationId as number);

    const membersResult = await pool.query(
      `SELECT DISTINCT user_id
       FROM acc_organization_member
       WHERE organization_id = ANY($1::int[]) AND status = 'active'`,
      [orgIds]
    );

    return membersResult.rows.map(r => r.userId as number);
  } catch {
    return null;
  }
}
