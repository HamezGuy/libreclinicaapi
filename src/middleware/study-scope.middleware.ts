import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { logger } from '../config/logger';
import { AuthRequest } from './auth.middleware';

type EntityType = 'eventCrf' | 'studySubject' | 'studyEvent' | 'workflowTask';

const ENTITY_QUERIES: Record<EntityType, string> = {
  eventCrf: `
    SELECT ss.study_id
    FROM event_crf ec
    JOIN study_event se ON ec.study_event_id = se.study_event_id
    JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
    WHERE ec.event_crf_id = $1
  `,
  studySubject: `
    SELECT study_id FROM study_subject WHERE study_subject_id = $1
  `,
  studyEvent: `
    SELECT ss.study_id
    FROM study_event se
    JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
    WHERE se.study_event_id = $1
  `,
  workflowTask: `
    SELECT study_id FROM acc_workflow_tasks WHERE task_id = $1
  `,
};

function isAdminUser(user: AuthRequest['user']): boolean {
  if (!user) return false;
  const userType = (user.userType || '').toLowerCase();
  const role = (user.role || '').toLowerCase();
  return (
    userType === 'sysadmin' ||
    userType.includes('admin') ||
    role === 'admin' ||
    role === 'system_administrator'
  );
}

/**
 * Middleware factory that resolves a study ID from an entity ID and verifies
 * the authenticated user has access to that study via req.user.studyIds.
 *
 * @param entityType - The entity type used to select the resolution query.
 * @param paramName  - The request parameter name that holds the entity ID.
 *                     Looked up in req.params first, then req.body.
 */
export const requireEntityStudyAccess = (entityType: EntityType, paramName: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthRequest;

    if (!authReq.user) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    if (isAdminUser(authReq.user)) {
      next();
      return;
    }

    const entityId = req.params[paramName] || req.body?.[paramName];

    if (!entityId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Missing required parameter: ${paramName}`,
        },
      });
      return;
    }

    const numericId = Number(entityId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Invalid ${paramName}: must be a positive integer`,
        },
      });
      return;
    }

    try {
      const sql = ENTITY_QUERIES[entityType];
      const result = await pool.query(sql, [numericId]);

      if (result.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `${entityType} with ${paramName} ${numericId} not found`,
          },
        });
        return;
      }

      const studyId: number = result.rows[0].studyId;
      const userStudyIds = authReq.user.studyIds || [];

      if (!userStudyIds.includes(studyId)) {
        logger.warn('Entity study access denied', {
          userId: authReq.user.userId,
          entityType,
          entityId: numericId,
          studyId,
          userStudyIds,
          path: req.path,
        });

        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'No access to the study that owns this resource' },
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Entity study access check failed', {
        error: (error as Error).message,
        entityType,
        entityId: numericId,
        userId: authReq.user.userId,
      });

      res.status(500).json({
        success: false,
        error: { code: 'ERROR', message: 'Failed to verify study access for this resource' },
      });
    }
  };
};
