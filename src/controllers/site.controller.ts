/**
 * Site Controller
 *
 * Thin handlers: parse request, call the service, map to shared-types DTOs, respond.
 * Errors thrown by services bubble up through asyncHandler → errorHandler.
 */

import { Request, Response } from 'express';
import { asyncHandler, BadRequestError, NotFoundError } from '../middleware/errorHandler.middleware';
import * as siteService from '../services/database/site.service';
import type { ApiResponse } from '@accura-trial/shared-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const userId = (req: Request) => ((req as unknown) as { user: { userId: number } }).user.userId;

function statusLabel(statusId: number): string {
  if (statusId === 1) return 'active';
  if (statusId === 6) return 'locked';
  if (statusId === 9) return 'frozen';
  return 'inactive';
}

// ─── List sites for a study ──────────────────────────────────────────────────

export const listByStudy = asyncHandler(async (req: Request, res: Response) => {
  const studyId = parseInt(req.params.studyId);
  const { status } = req.query;

  const rows = await siteService.getSites(studyId, status as string | undefined);

  const sites = rows.map((row: Record<string, unknown>) => ({
    id: row.id as number,
    siteNumber: (row.siteNumber as string) || '',
    siteName: row.siteName as string,
    description: row.description as string | undefined,
    parentStudyId: row.parentStudyId as number,
    parentStudyName: row.parentStudyName as string,
    statusId: row.statusId as number,
    status: statusLabel(row.statusId as number),
    principalInvestigator: row.principalInvestigator as string | undefined,
    facilityName: row.facilityName as string | undefined,
    facilityAddress: row.facilityAddress as string | undefined,
    facilityCity: row.facilityCity as string | undefined,
    facilityState: row.facilityState as string | undefined,
    facilityZip: row.facilityZip as string | undefined,
    facilityCountry: row.facilityCountry as string | undefined,
    facilityRecruitmentStatus: row.facilityRecruitmentStatus as string | undefined,
    contactName: row.contactName as string | undefined,
    contactDegree: row.contactDegree as string | undefined,
    contactEmail: row.contactEmail as string | undefined,
    contactPhone: row.contactPhone as string | undefined,
    expectedTotalEnrollment: row.expectedTotalEnrollment as number | undefined,
    enrolledSubjects: parseInt(row.enrolledSubjects as string) || 0,
    dateCreated: row.dateCreated,
    dateUpdated: row.dateUpdated,
    oid: row.ocOid as string | undefined,
  }));

  const response: ApiResponse<typeof sites> = { success: true, data: sites };
  res.json(response);
});

// ─── Get single site ─────────────────────────────────────────────────────────

export const get = asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.siteId);
  const row = await siteService.getSite(siteId);

  if (!row) throw new NotFoundError('Site not found');

  const site = {
    id: row.studyId as number,
    siteNumber: (row.secondaryIdentifier as string) || '',
    siteName: row.name as string,
    description: row.summary as string | undefined,
    parentStudyId: row.parentStudyId as number,
    parentStudyName: row.parentStudyName as string,
    statusId: row.statusId as number,
    principalInvestigator: row.principalInvestigator as string | undefined,
    facilityName: row.facilityName as string | undefined,
    facilityAddress: row.facilityAddress as string | undefined,
    facilityCity: row.facilityCity as string | undefined,
    facilityState: row.facilityState as string | undefined,
    facilityZip: row.facilityZip as string | undefined,
    facilityCountry: row.facilityCountry as string | undefined,
    expectedTotalEnrollment: row.expectedTotalEnrollment as number | undefined,
    enrolledSubjects: parseInt(row.enrolledSubjects as string) || 0,
    dateCreated: row.dateCreated,
    dateUpdated: row.dateUpdated,
  };

  const response: ApiResponse<typeof site> = { success: true, data: site };
  res.json(response);
});

// ─── Create site ─────────────────────────────────────────────────────────────

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { parentStudyId, siteName } = req.body;
  if (!parentStudyId || !siteName) {
    throw new BadRequestError('parentStudyId and siteName are required');
  }

  const created = await siteService.createSite(req.body, userId(req));
  if (!created) throw new BadRequestError('Parent study not found');

  const response: ApiResponse<{ siteId: number }> = { success: true, data: { siteId: created.studyId } };
  res.status(201).json(response);
});

// ─── Update site ─────────────────────────────────────────────────────────────

export const update = asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.siteId);
  await siteService.updateSite(siteId, req.body, userId(req));

  const response: ApiResponse = { success: true, message: 'Site updated' };
  res.json(response);
});

// ─── Update site status ──────────────────────────────────────────────────────

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.siteId);
  const { statusId } = req.body;
  await siteService.updateSiteStatus(siteId, statusId, userId(req));

  const response: ApiResponse = { success: true, message: 'Site status updated' };
  res.json(response);
});

// ─── Site patients ───────────────────────────────────────────────────────────

export const listPatients = asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.siteId);
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const status = req.query.status as string | undefined;

  const { rows, total } = await siteService.getSitePatients(siteId, page, limit, status);

  const patients = rows.map((r: Record<string, unknown>) => ({
    studySubjectId: r.studySubjectId as number,
    label: r.label as string,
    secondaryLabel: r.secondaryLabel as string | undefined,
    enrollmentDate: r.enrollmentDate,
    statusId: r.statusId as number,
    gender: r.gender as string | undefined,
  }));

  res.json({ success: true, data: patients, total });
});

// ─── Transfer patient ────────────────────────────────────────────────────────

export const transfer = asyncHandler(async (req: Request, res: Response) => {
  const { studySubjectId, toSiteId, reason } = req.body;
  if (!studySubjectId || !toSiteId || !reason) {
    throw new BadRequestError('studySubjectId, toSiteId, and reason are required');
  }

  await siteService.transferPatient(req.body, userId(req));

  const response: ApiResponse = { success: true, message: 'Patient transferred successfully' };
  res.json(response);
});

// ─── Site staff ──────────────────────────────────────────────────────────────

export const listStaff = asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.siteId);
  const rows = await siteService.getSiteStaff(siteId);

  const staff = rows.map((r: Record<string, unknown>) => ({
    userId: r.userId as number,
    username: r.username as string,
    firstName: r.firstName as string,
    lastName: r.lastName as string,
    email: r.email as string,
    role: r.role as string,
    isPrimary: r.role === 'investigator',
  }));

  const response: ApiResponse<typeof staff> = { success: true, data: staff };
  res.json(response);
});

export const assignStaff = asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.siteId);
  const { username, userId: staffUserId, role } = req.body;

  let staffUsername = username as string | undefined;
  if (!staffUsername && staffUserId) {
    staffUsername = await siteService.resolveStaffUsername(staffUserId) ?? undefined;
  }

  if (!staffUsername || !role) {
    throw new BadRequestError('username/userId and role are required');
  }

  await siteService.assignStaffToSite(siteId, staffUsername, role, userId(req));

  const response: ApiResponse = { success: true, message: 'Staff assigned to site' };
  res.json(response);
});

export const removeStaff = asyncHandler(async (req: Request, res: Response) => {
  const { siteId, username } = req.params;
  await siteService.removeStaffFromSite(parseInt(siteId), username, userId(req));

  const response: ApiResponse = { success: true, message: 'Staff removed from site' };
  res.json(response);
});

// ─── Study-level site stats ──────────────────────────────────────────────────

export const stats = asyncHandler(async (req: Request, res: Response) => {
  const studyId = parseInt(req.params.studyId);
  const row = await siteService.getSiteStats(studyId);

  const totalSites = parseInt(row.totalSites as string) || 0;
  const activeSites = parseInt(row.activeSites as string) || 0;
  const totalSubjects = parseInt(row.totalSubjects as string) || 0;
  const targetEnrollment = parseInt(row.targetEnrollment as string) || 0;

  const data = {
    totalSites,
    activeSites,
    totalSubjects,
    targetEnrollment,
    averageEnrollment: activeSites > 0 ? Math.round(totalSubjects / activeSites) : 0,
  };

  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});
