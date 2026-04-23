/**
 * Query Service (Hybrid)
 * 
 * Discrepancy Note (Query) management combining SOAP and Database
 * - Use Database for reading queries
 * - Use SOAP for creating/updating queries (GxP compliant)
 *
 * This file re-exports all query functions from focused sub-modules.
 * External imports (controllers, routes) that reference
 * '../services/database/query.service' continue to work unchanged.
 */

export * from './queries';

// Re-export the default object for any callers using `import queryService from '...'`
import {
  getQueries, getQueryById, createQuery, addQueryResponse,
  updateQueryStatus, closeQueryWithSignature, closeQueryWithSignatureVerified,
  acceptResolution, rejectResolution, getQueryAuditTrail,
  getQueryStats, getQueryTypes, getResolutionStatuses,
  getFormQueries, getFieldQueries, getQueriesByField, getFormFieldQueryCounts,
  reassignQuery, getQueryCountByStatus, getQueryCountByType,
  getQueryThread, getOverdueQueries, getMyAssignedQueries,
  reopenQuery, bulkUpdateStatus, bulkCloseQueries, bulkReassignQueries,
  getQueryCountsBySubject, getFormQueryStatusByEvent,
  resolveQueryRecipients, requeryQuery
} from './queries';

export default {
  getQueries,
  getQueryById,
  createQuery,
  addQueryResponse,
  updateQueryStatus,
  closeQueryWithSignature,
  closeQueryWithSignatureVerified,
  acceptResolution,
  rejectResolution,
  getQueryAuditTrail,
  getQueryStats,
  getQueryTypes,
  getResolutionStatuses,
  getFormQueries,
  getFieldQueries,
  getQueriesByField,
  getFormFieldQueryCounts,
  reassignQuery,
  getQueryCountByStatus,
  getQueryCountByType,
  getQueryThread,
  getOverdueQueries,
  getMyAssignedQueries,
  reopenQuery,
  bulkUpdateStatus,
  bulkCloseQueries,
  bulkReassignQueries,
  getQueryCountsBySubject,
  getFormQueryStatusByEvent,
  resolveQueryRecipients,
  requeryQuery
};
