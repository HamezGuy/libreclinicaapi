/**
 * Study Controller
 * 
 * Handles all study-related API endpoints including:
 * - CRUD operations for studies
 * - Study metadata, forms, sites, events
 * - Study statistics and enrollment data
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as studyService from '../services/hybrid/study.service';
import { logger } from '../config/logger';
import type { ApiResponse, Study, Site } from '@accura-trial/shared-types';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { status, page, limit, search } = req.query;

  logger.info('📋 Study list request', {
    userId: user.userId,
    username: user.userName,
    filters: { status, page, limit, search }
  });

  const result = await studyService.getStudies(user.userId, {
    status: status as string,
    search: search as string,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  });

  logger.info('📋 Study list response', {
    userId: user.userId,
    count: result.data?.length || 0,
    total: result.pagination?.total || 0
  });

  res.json(result as ApiResponse<Study[]>);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await studyService.getStudyById(parseInt(id), user.userId);

  if (!result) {
    res.status(404).json({ success: false, message: 'Study not found' } satisfies ApiResponse);
    return;
  }

  res.json({ success: true, data: result } satisfies ApiResponse<Study>);
});

export const getMetadata = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await studyService.getStudyMetadata(parseInt(id), user.userId, user.username);

  if (!result) {
    res.status(404).json({ success: false, message: 'Study not found' } satisfies ApiResponse);
    return;
  }

  res.json({ success: true, data: result } satisfies ApiResponse);
});

export const getForms = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await studyService.getStudyForms(parseInt(id));

  res.json({ success: true, data: result } satisfies ApiResponse);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  logger.info('📥 Received study creation request', { 
    body: req.body,
    userId: user.userId,
    username: user.username
  });

  const result = await studyService.createStudy(req.body, user.userId);

  logger.info('📤 Study creation result', { result });

  res.status(result.success ? 201 : 400).json(result as ApiResponse<Study>);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await studyService.updateStudy(parseInt(id), req.body, user.userId);

  res.json(result as ApiResponse<Study>);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await studyService.archiveStudy(parseInt(id), user.userId);

  res.json(result as ApiResponse);
});

/**
 * Archive a study (hide from listings, preserve all data)
 */
export const archive = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await studyService.archiveStudy(parseInt(id), user.userId);

  res.json(result as ApiResponse);
});

/**
 * Restore an archived study
 */
export const restore = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await studyService.restoreStudy(parseInt(id), user.userId);

  res.json(result as ApiResponse);
});

/**
 * Get archived studies
 */
export const getArchived = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await studyService.getArchivedStudies(user.userId);

  res.json(result as ApiResponse<Study[]>);
});

/**
 * Get study sites (child studies with parent_study_id = studyId)
 */
export const getSites = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  logger.info('Getting study sites', { studyId: id });

  const rows = await studyService.getStudySites(parseInt(id));

  const sites = rows.map((site: Record<string, unknown>) => ({
    id: String(site.studyId),
    siteNumber: site.uniqueIdentifier,
    siteName: site.name,
    uniqueIdentifier: site.uniqueIdentifier,
    description: (site.summary as string) || '',
    principalInvestigator: (site.principalInvestigator as string) || '',
    status: mapSiteStatus(site.statusId as number),
    address: {
      facility: (site.facilityName as string) || '',
      street: (site.facilityAddress as string) || '',
      city: (site.facilityCity as string) || '',
      state: (site.facilityState as string) || '',
      zip: (site.facilityZip as string) || '',
      country: (site.facilityCountry as string) || ''
    },
    facilityName: (site.facilityName as string) || '',
    facilityAddress: (site.facilityAddress as string) || '',
    facilityCity: (site.facilityCity as string) || '',
    facilityState: (site.facilityState as string) || '',
    facilityZip: (site.facilityZip as string) || '',
    facilityCountry: (site.facilityCountry as string) || '',
    facilityRecruitmentStatus: (site.facilityRecruitmentStatus as string) || '',
    facilityContactName: (site.facilityContactName as string) || '',
    facilityContactDegree: (site.facilityContactDegree as string) || '',
    facilityContactEmail: (site.facilityContactEmail as string) || '',
    facilityContactPhone: (site.facilityContactPhone as string) || '',
    contact: {
      name: (site.facilityContactName as string) || '',
      degree: (site.facilityContactDegree as string) || '',
      email: (site.facilityContactEmail as string) || '',
      phone: (site.facilityContactPhone as string) || ''
    },
    targetEnrollment: (site.expectedTotalEnrollment as number) || 0,
    actualEnrollment: parseInt(String(site.enrolledSubjects)) || 0,
    dateCreated: site.dateCreated
  }));

  const response: ApiResponse<typeof sites> = { success: true, data: sites };
  res.json(response);
});

/**
 * Get study events/phases (study_event_definition)
 */
export const getEvents = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  logger.info('Getting study events', { studyId: id });

  const rows = await studyService.getStudyEventDefinitions(parseInt(id));

  const events = rows.map((event: Record<string, unknown>) => ({
    id: String(event.studyEventDefinitionId),
    oid: event.ocOid,
    name: event.name,
    description: (event.description as string) || '',
    type: (event.type as string) || 'scheduled',
    repeating: event.repeating || false,
    category: (event.category as string) || '',
    order: event.ordinal,
    status: event.statusName,
    formCount: parseInt(String(event.formCount)) || 0,
    scheduleDay: event.scheduleDay,
    minDay: event.minDay,
    maxDay: event.maxDay,
    referenceEventId: event.referenceEventId
  }));

  const response: ApiResponse<typeof events> = { success: true, data: events };
  res.json(response);
});

/**
 * Get study statistics
 */
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  logger.info('Getting study statistics', { studyId: id });

  const stats = await studyService.getStudyStats(parseInt(id));

  if (!stats) {
    const notFound: ApiResponse<null> = { success: false, message: 'Study not found' };
    res.status(404).json(notFound);
    return;
  }

  const data = {
    enrollment: {
      target: parseInt(String(stats.targetEnrollment)) || 0,
      actual: parseInt(String(stats.totalSubjects)) || 0,
      active: parseInt(String(stats.activeSubjects)) || 0,
      completed: parseInt(String(stats.completedSubjects)) || 0,
      percentage: (stats.targetEnrollment as number) > 0
        ? Math.round(((stats.totalSubjects as number) / (stats.targetEnrollment as number)) * 100)
        : 0
    },
    queries: {
      total: parseInt(String(stats.totalQueries)) || 0,
      open: parseInt(String(stats.openQueries)) || 0,
      closed: (parseInt(String(stats.totalQueries)) || 0) - (parseInt(String(stats.openQueries)) || 0)
    },
    sites: parseInt(String(stats.siteCount)) || 0,
    events: parseInt(String(stats.eventCount)) || 0,
    forms: parseInt(String(stats.formCount)) || 0
  };

  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

/**
 * Get study users with roles
 */
export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  logger.info('Getting study users', { studyId: id });

  const rows = await studyService.getStudyUsers(parseInt(id));

  const users = rows.map((user: Record<string, unknown>) => ({
    userId: user.userId,
    username: user.userName,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: (user.phone as string) || '',
    role: user.roleName,
    assignedDate: user.dateCreated,
    status: user.statusName
  }));

  const response: ApiResponse<typeof users> = { success: true, data: users };
  res.json(response);
});

/**
 * Helper function to map LibreClinica status ID to frontend site status
 */
function mapSiteStatus(statusId: number): string {
  const statusMap: Record<number, string> = {
    1: 'active',      // available
    2: 'pending',     // pending
    3: 'frozen',      // frozen
    4: 'locked',      // locked
    5: 'completed'    // complete
  };
  return statusMap[statusId] || 'pending';
}

export default { 
  list, 
  get, 
  getMetadata, 
  getForms, 
  getSites, 
  getEvents, 
  getStats, 
  getUsers, 
  create, 
  update, 
  remove,
  archive,
  restore,
  getArchived
};

