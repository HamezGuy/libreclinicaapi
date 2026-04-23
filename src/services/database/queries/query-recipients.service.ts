/**
 * Query Recipients — assignment resolution (preview who will receive a query)
 */

import { pool } from '../../../config/database';
import { logger } from '../../../config/logger';
import { resolveAllQueryAssignees } from '../workflow-config.provider';

export const resolveQueryRecipients = async (
  eventCrfId?: number,
  studyId?: number
): Promise<{ recipients: { userId: number; userName: string; fullName: string; roleName: string; source: string }[] }> => {
  try {
    const assignees = await resolveAllQueryAssignees(undefined, studyId, eventCrfId);
    const allIds = [
      ...(assignees.primaryUserId ? [assignees.primaryUserId] : []),
      ...assignees.additionalUserIds
    ];

    if (allIds.length === 0) {
      return { recipients: [] };
    }

    const queryParams: any[] = [allIds];
    let studyFilter = '';
    if (studyId) {
      queryParams.push(parseInt(String(studyId)));
      studyFilter = `AND sur2.study_id = $${queryParams.length}`;
    }

    const userResult = await pool.query(`
      SELECT ua.user_id, ua.user_name, ua.first_name, ua.last_name,
             COALESCE(uae.platform_role, sur.role_name, 'unknown') as role_name
      FROM user_account ua
      LEFT JOIN user_account_extended uae ON ua.user_id = uae.user_id
      LEFT JOIN LATERAL (
        SELECT sur2.role_name FROM study_user_role sur2
        WHERE sur2.user_name = ua.user_name AND sur2.status_id = 1
        ${studyFilter}
        LIMIT 1
      ) sur ON true
      WHERE ua.user_id = ANY($1)
    `, queryParams);

    const recipients = userResult.rows.map((r: any) => ({
      userId: r.userId,
      userName: r.userName,
      fullName: `${r.firstName} ${r.lastName}`.trim(),
      roleName: r.roleName || 'unknown',
      source: r.userId === assignees.primaryUserId ? 'primary' : 'additional'
    }));

    return { recipients };
  } catch (error: any) {
    logger.warn('resolveQueryRecipients failed', { error: error.message });
    return { recipients: [] };
  }
};
