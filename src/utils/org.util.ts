/**
 * Shared org-membership lookup used by multiple database services.
 */

interface PoolLike {
  query(text: string, params?: any[]): Promise<{ rows: any[] }>;
}

/**
 * Get org member user IDs for the caller.
 * Returns [callerUserId] if the caller has no org membership (only see own data).
 */
export async function getOrgMemberUserIds(pool: PoolLike, callerUserId: number): Promise<number[] | null> {
  const orgCheck = await pool.query(
    `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
    [callerUserId]
  );
  const callerOrgIds = orgCheck.rows.map((r: any) => r.organization_id);
  if (callerOrgIds.length === 0) return [callerUserId];

  const memberCheck = await pool.query(
    `SELECT DISTINCT user_id FROM acc_organization_member WHERE organization_id = ANY($1::int[]) AND status = 'active'`,
    [callerOrgIds]
  );
  return memberCheck.rows.map((r: any) => r.user_id);
}
