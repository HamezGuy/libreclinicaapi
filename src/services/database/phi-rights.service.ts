/**
 * PHI Individual Rights Service
 * 
 * HIPAA Privacy Rule - Individual Rights Management
 * 
 * This service handles:
 * - Right to access PHI (45 CFR 164.524)
 * - Right to request amendment (45 CFR 164.526)
 * - Right to accounting of disclosures (45 CFR 164.528)
 * - Right to request restrictions (45 CFR 164.522)
 * 
 * Response Deadlines:
 * - Access requests: 30 days (one 30-day extension allowed)
 * - Amendment requests: 60 days (one 30-day extension allowed)
 * - Accounting of disclosures: 60 days (one 30-day extension allowed)
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { ApiResponse, PaginatedResponse } from '../../types';

// ============================================================================
// Types
// ============================================================================

export type PhiRequestType = 
  | 'access'              // Request to view/obtain copy of PHI
  | 'amendment'           // Request to correct/amend PHI
  | 'restriction'         // Request to restrict use/disclosure
  | 'disclosure_accounting' // Request for list of disclosures
  | 'data_portability';   // Request for electronic copy

export type PhiRequestStatus = 'pending' | 'in_progress' | 'completed' | 'denied' | 'withdrawn';

export interface PhiAccessRequest {
  id: number;
  requestType: PhiRequestType;
  requestorName: string;
  requestorEmail: string | null;
  requestorPhone: string | null;
  requestorRelationship: string | null;
  subjectId: number | null;
  subjectIdentifier: string | null;
  requestDate: Date;
  requestDetails: string;
  dataRequested: string | null;
  dateRangeStart: Date | null;
  dateRangeEnd: Date | null;
  status: PhiRequestStatus;
  responseDueDate: Date | null;
  responseDate: Date | null;
  responseDetails: string | null;
  denialReason: string | null;
  feeAmount: number | null;
  feePaid: boolean;
  handledBy: number | null;
  handledByUsername: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PhiDisclosure {
  id: number;
  subjectId: number | null;
  subjectIdentifier: string | null;
  disclosureDate: Date;
  disclosedToName: string;
  disclosedToOrganization: string | null;
  disclosedToAddress: string | null;
  disclosurePurpose: string;
  phiDisclosed: string;
  legalBasis: string;
  authorizationId: number | null;
  authorizationDate: Date | null;
  disclosureMethod: string | null;
  disclosedBy: number | null;
  disclosedByUsername: string | null;
  studyId: number | null;
  studyName: string | null;
  createdAt: Date;
}

export interface PhiAmendment {
  id: number;
  requestId: number | null;
  subjectId: number | null;
  subjectIdentifier: string | null;
  originalData: string;
  requestedAmendment: string;
  amendmentStatus: 'pending' | 'approved' | 'denied' | 'partial';
  denialReason: string | null;
  amendedData: string | null;
  amendedInRecord: string | null;
  amendedRecordId: number | null;
  amendmentStatement: string | null;
  amendedBy: number | null;
  amendedByUsername: string | null;
  amendedAt: Date | null;
  notificationSent: boolean;
  notificationSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// PHI Access Requests
// ============================================================================

/**
 * Create a new PHI access/rights request
 */
export const createPhiRequest = async (
  request: Omit<PhiAccessRequest, 'id' | 'status' | 'responseDueDate' | 'responseDate' | 'responseDetails' | 'denialReason' | 'handledBy' | 'handledByUsername' | 'completedAt' | 'createdAt' | 'updatedAt'>,
  userId?: number,
  username?: string
): Promise<ApiResponse<PhiAccessRequest>> => {
  logger.info('Creating PHI request', { requestType: request.requestType, requestorName: request.requestorName });

  try {
    // Calculate due date based on request type
    let dueDays = 30; // Default for access requests
    if (request.requestType === 'amendment' || request.requestType === 'disclosure_accounting') {
      dueDays = 60;
    }

    const query = `
      INSERT INTO phi_access_requests (
        request_type, requestor_name, requestor_email, requestor_phone,
        requestor_relationship, subject_id, subject_identifier,
        request_date, request_details, data_requested,
        date_range_start, date_range_end, status,
        response_due_date, fee_amount, fee_paid,
        handled_by, handled_by_username, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11,
        'pending', NOW() + INTERVAL '${dueDays} days',
        $12, $13, $14, $15, NOW(), NOW()
      )
      RETURNING *
    `;

    const result = await pool.query(query, [
      request.requestType,
      request.requestorName,
      request.requestorEmail,
      request.requestorPhone,
      request.requestorRelationship,
      request.subjectId,
      request.subjectIdentifier,
      request.requestDetails,
      request.dataRequested,
      request.dateRangeStart,
      request.dateRangeEnd,
      request.feeAmount,
      request.feePaid || false,
      userId,
      username
    ]);

    const row = result.rows[0];
    return {
      success: true,
      data: mapPhiRequestRow(row)
    };

  } catch (error: any) {
    logger.error('Error creating PHI request', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get PHI requests with filtering
 */
export const getPhiRequests = async (
  options: {
    status?: PhiRequestStatus;
    requestType?: PhiRequestType;
    page?: number;
    pageSize?: number;
    overdue?: boolean;
  } = {}
): Promise<PaginatedResponse<PhiAccessRequest>> => {
  logger.info('Getting PHI requests', options);

  try {
    let query = `
      SELECT 
        r.*,
        u.user_name as handled_by_name
      FROM phi_access_requests r
      LEFT JOIN user_account u ON r.handled_by = u.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options.status) {
      params.push(options.status);
      query += ` AND r.status = $${params.length}`;
    }

    if (options.requestType) {
      params.push(options.requestType);
      query += ` AND r.request_type = $${params.length}`;
    }

    if (options.overdue) {
      query += ` AND r.response_due_date < NOW() AND r.status NOT IN ('completed', 'denied', 'withdrawn')`;
    }

    // Get total count
    const countQuery = query.replace('r.*,\n        u.user_name as handled_by_name', 'COUNT(*) as total');
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // Add pagination
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const offset = (page - 1) * pageSize;

    query += ` ORDER BY r.request_date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(pageSize, offset);

    const result = await pool.query(query, params);

    return {
      success: true,
      data: result.rows.map(mapPhiRequestRow),
      pagination: {
        page,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    };

  } catch (error: any) {
    logger.error('Error getting PHI requests', { error: error.message });
    return { success: false, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  }
};

/**
 * Update PHI request status
 */
export const updatePhiRequestStatus = async (
  requestId: number,
  update: {
    status: PhiRequestStatus;
    responseDetails?: string;
    denialReason?: string;
  },
  userId: number,
  username: string
): Promise<ApiResponse<PhiAccessRequest>> => {
  logger.info('Updating PHI request status', { requestId, status: update.status });

  try {
    const query = `
      UPDATE phi_access_requests
      SET 
        status = $1,
        response_details = COALESCE($2, response_details),
        denial_reason = $3,
        response_date = CASE WHEN $1 IN ('completed', 'denied') THEN NOW() ELSE response_date END,
        completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
        handled_by = $4,
        handled_by_username = $5,
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `;

    const result = await pool.query(query, [
      update.status,
      update.responseDetails,
      update.denialReason,
      userId,
      username,
      requestId
    ]);

    if (result.rows.length === 0) {
      return { success: false, message: 'PHI request not found' };
    }

    return { success: true, data: mapPhiRequestRow(result.rows[0]) };

  } catch (error: any) {
    logger.error('Error updating PHI request', { error: error.message, requestId });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// PHI Disclosure Logging
// ============================================================================

/**
 * Log a PHI disclosure (for accounting of disclosures)
 */
export const logPhiDisclosure = async (
  disclosure: Omit<PhiDisclosure, 'id' | 'createdAt'>,
  userId: number,
  username: string
): Promise<ApiResponse<PhiDisclosure>> => {
  logger.info('Logging PHI disclosure', { 
    subjectId: disclosure.subjectId,
    disclosedTo: disclosure.disclosedToName,
    purpose: disclosure.disclosurePurpose 
  });

  try {
    const query = `
      INSERT INTO phi_disclosure_log (
        subject_id, subject_identifier, disclosure_date,
        disclosed_to_name, disclosed_to_organization, disclosed_to_address,
        disclosure_purpose, phi_disclosed, legal_basis,
        authorization_id, authorization_date, disclosure_method,
        disclosed_by, disclosed_by_username,
        study_id, study_name, created_at
      ) VALUES (
        $1, $2, COALESCE($3, NOW()),
        $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, NOW()
      )
      RETURNING *
    `;

    const result = await pool.query(query, [
      disclosure.subjectId,
      disclosure.subjectIdentifier,
      disclosure.disclosureDate,
      disclosure.disclosedToName,
      disclosure.disclosedToOrganization,
      disclosure.disclosedToAddress,
      disclosure.disclosurePurpose,
      disclosure.phiDisclosed,
      disclosure.legalBasis,
      disclosure.authorizationId,
      disclosure.authorizationDate,
      disclosure.disclosureMethod,
      userId,
      username,
      disclosure.studyId,
      disclosure.studyName
    ]);

    return { success: true, data: mapDisclosureRow(result.rows[0]) };

  } catch (error: any) {
    logger.error('Error logging PHI disclosure', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get disclosure accounting for a subject
 */
export const getDisclosureAccounting = async (
  options: {
    subjectId?: number;
    subjectIdentifier?: string;
    startDate?: Date;
    endDate?: Date;
  }
): Promise<ApiResponse<PhiDisclosure[]>> => {
  logger.info('Getting disclosure accounting', options);

  try {
    let query = `
      SELECT * FROM phi_disclosure_log
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options.subjectId) {
      params.push(options.subjectId);
      query += ` AND subject_id = $${params.length}`;
    }

    if (options.subjectIdentifier) {
      params.push(options.subjectIdentifier);
      query += ` AND subject_identifier = $${params.length}`;
    }

    if (options.startDate) {
      params.push(options.startDate);
      query += ` AND disclosure_date >= $${params.length}`;
    }

    if (options.endDate) {
      params.push(options.endDate);
      query += ` AND disclosure_date <= $${params.length}`;
    }

    // HIPAA requires 6 years of disclosure history
    if (!options.startDate) {
      query += ` AND disclosure_date >= NOW() - INTERVAL '6 years'`;
    }

    query += ` ORDER BY disclosure_date DESC`;

    const result = await pool.query(query, params);

    return {
      success: true,
      data: result.rows.map(mapDisclosureRow)
    };

  } catch (error: any) {
    logger.error('Error getting disclosure accounting', { error: error.message });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// PHI Amendments
// ============================================================================

/**
 * Create PHI amendment request
 */
export const createPhiAmendment = async (
  amendment: Omit<PhiAmendment, 'id' | 'amendmentStatus' | 'denialReason' | 'amendedData' | 'amendedBy' | 'amendedByUsername' | 'amendedAt' | 'notificationSent' | 'notificationSentAt' | 'createdAt' | 'updatedAt'>
): Promise<ApiResponse<PhiAmendment>> => {
  logger.info('Creating PHI amendment', { requestId: amendment.requestId });

  try {
    const query = `
      INSERT INTO phi_amendments (
        request_id, subject_id, subject_identifier,
        original_data, requested_amendment, amendment_status,
        amended_in_record, amended_record_id, amendment_statement,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'pending', $6, $7, $8, NOW(), NOW()
      )
      RETURNING *
    `;

    const result = await pool.query(query, [
      amendment.requestId,
      amendment.subjectId,
      amendment.subjectIdentifier,
      amendment.originalData,
      amendment.requestedAmendment,
      amendment.amendedInRecord,
      amendment.amendedRecordId,
      amendment.amendmentStatement
    ]);

    return { success: true, data: mapAmendmentRow(result.rows[0]) };

  } catch (error: any) {
    logger.error('Error creating PHI amendment', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Process PHI amendment (approve or deny)
 */
export const processPhiAmendment = async (
  amendmentId: number,
  decision: {
    status: 'approved' | 'denied' | 'partial';
    amendedData?: string;
    denialReason?: string;
  },
  userId: number,
  username: string
): Promise<ApiResponse<PhiAmendment>> => {
  logger.info('Processing PHI amendment', { amendmentId, status: decision.status });

  try {
    const query = `
      UPDATE phi_amendments
      SET 
        amendment_status = $1,
        amended_data = $2,
        denial_reason = $3,
        amended_by = $4,
        amended_by_username = $5,
        amended_at = NOW(),
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `;

    const result = await pool.query(query, [
      decision.status,
      decision.amendedData,
      decision.denialReason,
      userId,
      username,
      amendmentId
    ]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Amendment not found' };
    }

    return { success: true, data: mapAmendmentRow(result.rows[0]) };

  } catch (error: any) {
    logger.error('Error processing PHI amendment', { error: error.message, amendmentId });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// Dashboard / Reporting
// ============================================================================

/**
 * Get PHI rights dashboard summary
 */
export const getPhiRightsDashboard = async (): Promise<ApiResponse<{
  pendingRequests: number;
  overdueRequests: number;
  thisMonthRequests: number;
  disclosuresThisMonth: number;
  pendingAmendments: number;
  requestsByType: { type: string; count: number }[];
}>> => {
  logger.info('Getting PHI rights dashboard');

  try {
    const queries = await Promise.all([
      // Pending requests
      pool.query(`SELECT COUNT(*) as count FROM phi_access_requests WHERE status = 'pending'`),
      
      // Overdue requests
      pool.query(`
        SELECT COUNT(*) as count FROM phi_access_requests 
        WHERE response_due_date < NOW() AND status NOT IN ('completed', 'denied', 'withdrawn')
      `),
      
      // This month's requests
      pool.query(`
        SELECT COUNT(*) as count FROM phi_access_requests 
        WHERE request_date >= DATE_TRUNC('month', NOW())
      `),
      
      // Disclosures this month
      pool.query(`
        SELECT COUNT(*) as count FROM phi_disclosure_log 
        WHERE disclosure_date >= DATE_TRUNC('month', NOW())
      `),
      
      // Pending amendments
      pool.query(`SELECT COUNT(*) as count FROM phi_amendments WHERE amendment_status = 'pending'`),
      
      // Requests by type
      pool.query(`
        SELECT request_type as type, COUNT(*) as count 
        FROM phi_access_requests 
        GROUP BY request_type
      `)
    ]);

    return {
      success: true,
      data: {
        pendingRequests: parseInt(queries[0].rows[0].count, 10),
        overdueRequests: parseInt(queries[1].rows[0].count, 10),
        thisMonthRequests: parseInt(queries[2].rows[0].count, 10),
        disclosuresThisMonth: parseInt(queries[3].rows[0].count, 10),
        pendingAmendments: parseInt(queries[4].rows[0].count, 10),
        requestsByType: queries[5].rows.map(r => ({ type: r.type, count: parseInt(r.count, 10) }))
      }
    };

  } catch (error: any) {
    logger.error('Error getting PHI rights dashboard', { error: error.message });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

function mapPhiRequestRow(row: any): PhiAccessRequest {
  return {
    id: row.id,
    requestType: row.request_type,
    requestorName: row.requestor_name,
    requestorEmail: row.requestor_email,
    requestorPhone: row.requestor_phone,
    requestorRelationship: row.requestor_relationship,
    subjectId: row.subject_id,
    subjectIdentifier: row.subject_identifier,
    requestDate: row.request_date,
    requestDetails: row.request_details,
    dataRequested: row.data_requested,
    dateRangeStart: row.date_range_start,
    dateRangeEnd: row.date_range_end,
    status: row.status,
    responseDueDate: row.response_due_date,
    responseDate: row.response_date,
    responseDetails: row.response_details,
    denialReason: row.denial_reason,
    feeAmount: row.fee_amount ? parseFloat(row.fee_amount) : null,
    feePaid: row.fee_paid,
    handledBy: row.handled_by,
    handledByUsername: row.handled_by_username || row.handled_by_name,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDisclosureRow(row: any): PhiDisclosure {
  return {
    id: row.id,
    subjectId: row.subject_id,
    subjectIdentifier: row.subject_identifier,
    disclosureDate: row.disclosure_date,
    disclosedToName: row.disclosed_to_name,
    disclosedToOrganization: row.disclosed_to_organization,
    disclosedToAddress: row.disclosed_to_address,
    disclosurePurpose: row.disclosure_purpose,
    phiDisclosed: row.phi_disclosed,
    legalBasis: row.legal_basis,
    authorizationId: row.authorization_id,
    authorizationDate: row.authorization_date,
    disclosureMethod: row.disclosure_method,
    disclosedBy: row.disclosed_by,
    disclosedByUsername: row.disclosed_by_username,
    studyId: row.study_id,
    studyName: row.study_name,
    createdAt: row.created_at
  };
}

function mapAmendmentRow(row: any): PhiAmendment {
  return {
    id: row.id,
    requestId: row.request_id,
    subjectId: row.subject_id,
    subjectIdentifier: row.subject_identifier,
    originalData: row.original_data,
    requestedAmendment: row.requested_amendment,
    amendmentStatus: row.amendment_status,
    denialReason: row.denial_reason,
    amendedData: row.amended_data,
    amendedInRecord: row.amended_in_record,
    amendedRecordId: row.amended_record_id,
    amendmentStatement: row.amendment_statement,
    amendedBy: row.amended_by,
    amendedByUsername: row.amended_by_username,
    amendedAt: row.amended_at,
    notificationSent: row.notification_sent,
    notificationSentAt: row.notification_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

