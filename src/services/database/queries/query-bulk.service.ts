/**
 * Query Bulk Operations — bulk status changes, closures, and reassignments
 */

import { logger } from '../../../config/logger';
import { updateQueryStatus } from './query-mutations.service';
import { reassignQuery } from './query-mutations.service';

/**
 * Bulk update status for multiple queries.
 * Each query is updated independently so a single failure doesn't block the rest.
 * All failures are collected and reported in the return value.
 */
export const bulkUpdateStatus = async (
  queryIds: number[],
  statusId: number,
  userId: number,
  reason?: string
): Promise<{ success: boolean; updated: number; failed: number; errors: string[] }> => {
  logger.info('Bulk updating query statuses', { count: queryIds.length, statusId, userId });
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const qid of queryIds) {
    try {
      await updateQueryStatus(qid, statusId, userId, { reason });
      updated++;
    } catch (e: any) {
      failed++;
      errors.push(`Query ${qid}: ${e.message}`);
    }
  }

  return { success: failed === 0, updated, failed, errors };
};

/**
 * Bulk close queries with a shared reason.
 * Each query is closed independently so a single failure doesn't block the rest.
 */
export const bulkCloseQueries = async (
  queryIds: number[],
  userId: number,
  reason: string
): Promise<{ success: boolean; closed: number; failed: number; errors: string[] }> => {
  if (!reason || reason.trim().length === 0) {
    return { success: false, closed: 0, failed: queryIds.length, errors: ['Reason is required to bulk close queries'] };
  }
  logger.info('Bulk closing queries', { count: queryIds.length, userId });
  let closed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const qid of queryIds) {
    try {
      await updateQueryStatus(qid, 4, userId, { reason, signature: false });
      closed++;
    } catch (e: any) {
      failed++;
      errors.push(`Query ${qid}: ${e.message}`);
    }
  }

  return { success: failed === 0, closed, failed, errors };
};

/**
 * Bulk reassign queries to a new user.
 * Each query is reassigned independently so a single failure doesn't block the rest.
 */
export const bulkReassignQueries = async (
  queryIds: number[],
  newAssignedUserId: number,
  userId: number,
  reason?: string
): Promise<{ success: boolean; reassigned: number; failed: number; errors: string[] }> => {
  logger.info('Bulk reassigning queries', { count: queryIds.length, newAssignedUserId, userId });
  let reassigned = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const qid of queryIds) {
    try {
      await reassignQuery(qid, newAssignedUserId, userId);
      reassigned++;
    } catch (e: any) {
      failed++;
      errors.push(`Query ${qid}: ${e.message}`);
    }
  }

  return { success: failed === 0, reassigned, failed, errors };
};
