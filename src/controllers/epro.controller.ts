/**
 * ePRO (Electronic Patient-Reported Outcomes) Controller
 *
 * Handles HTTP request parsing, response formatting, and Part 11 auditing.
 * Delegates all database operations to epro.service.
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import {
  Part11EventTypes,
  recordPart11Audit,
  Part11Request,
  formatPart11Timestamp,
} from '../middleware/part11.middleware';
import { logger } from '../config/logger';
import * as eproService from '../services/database/epro.service';
import type { ApiResponse } from '@accura-trial/shared-types';

// ============================================================================
// Dashboard
// ============================================================================

export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const stats = await eproService.getDashboardStats();

  const response: ApiResponse<{ stats: eproService.DashboardStats }> = {
    success: true,
    data: { stats },
  };
  res.json(response);
});

// ============================================================================
// Instruments
// ============================================================================

export const listInstruments = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query;

  const instruments = await eproService.listInstruments({
    status: status as string | undefined,
  });

  res.json({ success: true, data: instruments } as ApiResponse);
});

export const createInstrument = asyncHandler(async (req: Part11Request, res: Response) => {
  const { name, shortName, description, content, category, estimatedMinutes, languageCode } = req.body;
  const userId = req.user?.userId;
  const userName = req.user?.userName;

  const instrument = await eproService.createInstrument({
    name, shortName, description, content, category, estimatedMinutes, languageCode,
  });

  await recordPart11Audit(
    userId,
    userName,
    Part11EventTypes.PRO_INSTRUMENT_CREATED,
    'acc_pro_instrument',
    instrument.instrumentId,
    name,
    null,
    { name, category: category || 'general', estimatedMinutes: estimatedMinutes || 10 },
    'PRO instrument created',
    { ipAddress: req.ip }
  );

  res.json({ success: true, data: instrument } as ApiResponse);
});

export const getInstrument = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const instrument = await eproService.getInstrumentById(id);

  if (!instrument) {
    return res.status(404).json({ success: false, message: 'Instrument not found' });
  }

  res.json({ success: true, data: instrument } as ApiResponse);
});

// ============================================================================
// Assignments
// ============================================================================

export const listAssignments = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, status, subjectId } = req.query;

  const assignments = await eproService.listAssignments({
    studyId: studyId as string | undefined,
    status: status as string | undefined,
    subjectId: subjectId as string | undefined,
  });

  const data = assignments.map(row => ({
    assignmentId: row.assignmentId,
    subjectId: row.studySubjectId,
    subjectLabel: row.subjectLabel,
    instrumentId: row.instrumentId,
    instrumentName: row.instrumentName,
    status: row.status,
    scheduledDate: row.scheduledDate,
    completedAt: row.completedAt,
    notes: row.notes,
  }));

  res.json({ success: true, data } as ApiResponse);
});

export const createAssignment = asyncHandler(async (req: Part11Request, res: Response) => {
  const { subjectId, instrumentId, dueDate } = req.body;
  const userId = req.user?.userId;
  const userName = req.user?.userName;

  const assignment = await eproService.createAssignment({
    subjectId, instrumentId, dueDate, userId,
  });

  await recordPart11Audit(
    userId,
    userName,
    Part11EventTypes.PRO_ASSIGNMENT_CREATED,
    'acc_pro_assignment',
    assignment.assignmentId,
    `Assignment for subject ${subjectId}`,
    null,
    { subjectId, instrumentId, dueDate, status: 'pending' },
    'PRO assignment created',
    { ipAddress: req.ip }
  );

  res.json({ success: true, data: assignment } as ApiResponse);
});

export const sendAssignmentReminder = asyncHandler(async (req: Part11Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.userId;
  const userName = req.user?.userName;

  const assignment = await eproService.getAssignmentWithPatient(id);

  if (!assignment) {
    return res.status(404).json({ success: false, message: 'Assignment not found' });
  }

  if (!assignment.patientAccountId) {
    return res.status(400).json({
      success: false,
      message: 'No patient account linked to this subject',
    });
  }

  const reminderId = await eproService.createAssignmentReminder(
    id, assignment.patientAccountId, assignment.instrumentName
  );

  await recordPart11Audit(
    userId,
    userName,
    Part11EventTypes.PRO_REMINDER_SENT,
    'acc_pro_reminder',
    reminderId,
    `Reminder for assignment ${id}`,
    null,
    { assignmentId: id, patientAccountId: assignment.patientAccountId, status: 'sent' },
    'PRO reminder sent to patient',
    { ipAddress: req.ip }
  );

  res.json({
    success: true,
    sent: false,
    warning: 'Email/SMS integration not yet configured',
    message: 'Reminder record created but not delivered',
    data: { reminderId },
  });
});

// ============================================================================
// Responses
// ============================================================================

export const submitResponse = asyncHandler(async (req: Part11Request, res: Response) => {
  const { id } = req.params;
  const { responses, startedAt, completedAt } = req.body;
  const userId = req.user?.userId;
  const userName = req.user?.userName;

  const result = await eproService.submitResponse(id, { responses, startedAt, completedAt });

  if (!result) {
    return res.status(404).json({ success: false, message: 'Assignment not found' });
  }

  await recordPart11Audit(
    userId,
    userName,
    Part11EventTypes.PRO_RESPONSE_SUBMITTED,
    'acc_pro_response',
    result.responseRow.responseId,
    `PRO Response for assignment ${id}`,
    { status: result.oldStatus },
    {
      status: 'completed',
      responseId: result.responseRow.responseId,
      subjectId: result.responseRow.studySubjectId,
      instrumentId: result.responseRow.instrumentId,
      startedAt,
      completedAt: completedAt || formatPart11Timestamp(),
    },
    'Patient submitted PRO questionnaire response',
    { ipAddress: req.ip }
  );

  res.json({ success: true, data: result.responseRow } as ApiResponse);
});

export const getResponse = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const responseRow = await eproService.getResponseByAssignment(id);

  if (!responseRow) {
    return res.status(404).json({ success: false, message: 'Response not found' });
  }

  res.json({ success: true, data: responseRow } as ApiResponse);
});

// ============================================================================
// Patient Accounts
// ============================================================================

export const listPatients = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, status } = req.query;

  const patients = await eproService.listPatientAccounts({
    studyId: studyId as string | undefined,
    status: status as string | undefined,
  });

  res.json({ success: true, data: patients } as ApiResponse);
});

export const resendActivation = asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    success: true,
    sent: false,
    warning: 'Email/SMS integration not yet configured',
    message: 'Activation email not actually sent',
  });
});

// ============================================================================
// Reminders
// ============================================================================

export const listReminders = asyncHandler(async (req: Request, res: Response) => {
  const { assignmentId, patientAccountId, status, scheduledFrom, scheduledTo } = req.query;

  const reminders = await eproService.listReminders({
    assignmentId: assignmentId as string | undefined,
    patientAccountId: patientAccountId as string | undefined,
    status: status as string | undefined,
    scheduledFrom: scheduledFrom as string | undefined,
    scheduledTo: scheduledTo as string | undefined,
  });

  res.json({ success: true, data: reminders } as ApiResponse);
});

export const getReminder = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const reminder = await eproService.getReminderById(id);

  if (!reminder) {
    return res.status(404).json({ success: false, message: 'Reminder not found' });
  }

  res.json({ success: true, data: reminder } as ApiResponse);
});

export const createReminder = asyncHandler(async (req: Part11Request, res: Response) => {
  const { assignmentId, patientAccountId, reminderType, scheduledFor, messageSubject, messageBody } = req.body;
  const userId = req.user?.userId;
  const userName = req.user?.userName;

  if (!assignmentId || !patientAccountId || !reminderType || !scheduledFor) {
    return res.status(400).json({
      success: false,
      message: 'assignmentId, patientAccountId, reminderType, and scheduledFor are required',
    });
  }

  const reminder = await eproService.createReminder({
    assignmentId, patientAccountId, reminderType, scheduledFor, messageSubject, messageBody,
  });

  await recordPart11Audit(
    userId,
    userName,
    Part11EventTypes.PRO_REMINDER_CREATED || 'PRO_REMINDER_CREATED',
    'acc_pro_reminder',
    reminder.reminderId,
    `Reminder for assignment ${assignmentId}`,
    null,
    { assignmentId, patientAccountId, reminderType, scheduledFor, status: 'pending' },
    'PRO reminder scheduled',
    { ipAddress: req.ip }
  );

  res.json({ success: true, data: reminder } as ApiResponse);
});

export const sendReminder = asyncHandler(async (req: Part11Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.userId;
  const userName = req.user?.userName;

  const reminderStatus = await eproService.getReminderStatus(id);

  if (!reminderStatus) {
    return res.status(404).json({ success: false, message: 'Reminder not found' });
  }

  if (reminderStatus.status === 'sent') {
    return res.status(400).json({ success: false, message: 'Reminder already sent' });
  }

  const patient = await eproService.getPatientContact(reminderStatus.patientAccountId);

  let sent = false;
  let errorMessage: string | null = null;

  const reminder = await eproService.getReminderById(id);
  const reminderType = reminder?.reminderType;

  if (reminderType === 'email' && patient?.email) {
    errorMessage = 'Email integration not yet configured';
  } else if (reminderType === 'sms' && patient?.phone) {
    errorMessage = 'SMS integration not yet configured';
  } else if (reminderType === 'push') {
    errorMessage = 'Push notification integration not yet configured';
  } else {
    errorMessage = `No valid contact method for ${reminderType}`;
  }

  await eproService.updateReminderSent(id, sent, errorMessage);

  await recordPart11Audit(
    userId,
    userName,
    Part11EventTypes.PRO_REMINDER_SENT,
    'acc_pro_reminder',
    parseInt(id as string),
    `Reminder ${id}`,
    { status: reminderStatus.status },
    { status: sent ? 'sent' : 'failed', errorMessage },
    sent ? 'PRO reminder sent successfully' : `PRO reminder failed: ${errorMessage}`,
    { ipAddress: req.ip }
  );

  res.json({
    success: sent,
    sent,
    warning: !sent ? 'Email/SMS integration not yet configured' : undefined,
    message: sent ? 'Reminder sent successfully' : `Failed to send reminder: ${errorMessage}`,
    data: { status: sent ? 'sent' : 'failed' },
  });
});

export const cancelReminder = asyncHandler(async (req: Part11Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.userId;
  const userName = req.user?.userName;

  const result = await eproService.cancelReminder(id);

  if (!result) {
    return res.status(404).json({ success: false, message: 'Reminder not found' });
  }

  if (result.oldStatus !== 'pending') {
    return res.status(400).json({
      success: false,
      message: `Cannot cancel reminder with status: ${result.oldStatus}`,
    });
  }

  await recordPart11Audit(
    userId,
    userName,
    Part11EventTypes.PRO_REMINDER_CANCELLED || 'PRO_REMINDER_CANCELLED',
    'acc_pro_reminder',
    parseInt(id as string),
    `Reminder ${id}`,
    { status: result.oldStatus },
    { status: 'cancelled' },
    'PRO reminder cancelled',
    { ipAddress: req.ip }
  );

  res.json({ success: true, message: 'Reminder cancelled successfully' });
});

export const listPendingDueReminders = asyncHandler(async (_req: Request, res: Response) => {
  const reminders = await eproService.listPendingDueReminders();

  const data = reminders.map(row => ({
    reminderId: row.reminderId,
    assignmentId: row.assignmentId,
    patientAccountId: row.patientAccountId,
    subjectLabel: row.subjectLabel,
    instrumentName: row.instrumentName,
    patientEmail: row.patientEmail,
    patientPhone: row.patientPhone,
    reminderType: row.reminderType,
    scheduledFor: row.scheduledFor,
    messageSubject: row.messageSubject,
    messageBody: row.messageBody,
  }));

  res.json({ success: true, data } as ApiResponse);
});

// ============================================================================
// Schedule Reminders
// ============================================================================

export const scheduleReminders = asyncHandler(async (req: Part11Request, res: Response) => {
  const { id } = req.params;
  const { reminderSchedule } = req.body;

  const assignment = await eproService.getAssignmentForScheduling(id);

  if (!assignment) {
    return res.status(404).json({ success: false, message: 'Assignment not found' });
  }

  if (!assignment.patientAccountId) {
    return res.status(400).json({
      success: false,
      message: 'No patient account linked to this assignment',
    });
  }

  if (!assignment.scheduledDate) {
    return res.status(400).json({
      success: false,
      message: 'Assignment has no scheduled date',
    });
  }

  const reminderIds = await eproService.scheduleRemindersForAssignment(
    id,
    assignment.patientAccountId,
    assignment.scheduledDate,
    reminderSchedule
  );

  res.json({
    success: true,
    message: `${reminderIds.length} reminders scheduled`,
    data: { reminderIds },
  });
});
