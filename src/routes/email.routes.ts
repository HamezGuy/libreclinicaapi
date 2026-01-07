/**
 * Email Routes
 * 
 * API endpoints for email management and notification preferences.
 * Uses LibreClinica database for user preferences and audit logging.
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Full audit trail for template changes and email operations
 * - §11.10(k): UTC timestamps for all email events
 * - Template versioning for change tracking
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../config/logger';
import {
  listTemplates,
  getTemplate,
  queueEmail,
  queueDirectEmail,
  processEmailQueue,
  getQueueStatus,
  cancelEmail,
  retryEmail,
  getUserPreferences,
  updatePreference
} from '../services/email/email.service';
import { UpdatePreferenceRequest, NotificationType } from '../services/email/email.types';
import { pool } from '../config/database';
import {
  Part11EventTypes,
  recordPart11Audit,
  Part11Request,
  formatPart11Timestamp
} from '../middleware/part11.middleware';

const router = Router();

/**
 * Require admin role middleware
 */
const requireAdmin = async (req: Request, res: Response, next: Function) => {
  const user = (req as any).user;
  
  if (!user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  // Check if user is admin (role = 'admin' or user_type_id = 1 or 0)
  if (user.role !== 'admin' && user.userType !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }

  next();
};

// ============================================================================
// Template Routes (Admin Only)
// ============================================================================

/**
 * GET /api/email/templates
 * List all email templates
 */
router.get('/templates', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const templates = await listTemplates();
    res.json({ success: true, data: templates });
  } catch (error: any) {
    logger.error('Error listing templates', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to list templates' });
  }
});

/**
 * GET /api/email/templates/:name
 * Get a specific template by name
 */
router.get('/templates/:name', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const template = await getTemplate(req.params.name);
    
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    
    res.json({ success: true, data: template });
  } catch (error: any) {
    logger.error('Error getting template', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get template' });
  }
});

/**
 * PUT /api/email/templates/:id
 * Update an email template
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Records old and new values for template changes
 * - Template versioning provides change history
 */
router.put('/templates/:id', authMiddleware, requireAdmin, async (req: Part11Request, res: Response) => {
  try {
    const templateId = parseInt(req.params.id);
    const { subject, htmlBody, textBody, description } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get old values before update
    const oldResult = await pool.query(
      'SELECT template_name, subject, version FROM acc_email_template WHERE template_id = $1',
      [templateId]
    );
    const oldData = oldResult.rows[0];

    // Update template in database (increment version for audit trail)
    const query = `
      UPDATE acc_email_template
      SET subject = COALESCE($1, subject),
          html_body = COALESCE($2, html_body),
          text_body = COALESCE($3, text_body),
          description = COALESCE($4, description),
          version = version + 1,
          date_updated = CURRENT_TIMESTAMP
      WHERE template_id = $5
      RETURNING *
    `;

    const result = await pool.query(query, [
      subject,
      htmlBody,
      textBody,
      description,
      templateId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const newData = result.rows[0];

    // Part 11 Audit: Record template update (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.EMAIL_TEMPLATE_UPDATED,
      'acc_email_template',
      templateId,
      oldData?.template_name || `Template ${templateId}`,
      { subject: oldData?.subject, version: oldData?.version },
      { subject: newData.subject, version: newData.version },
      'Email template updated',
      { ipAddress: req.ip }
    );

    logger.info('Email template updated with Part 11 audit', { 
      templateId, 
      userId,
      oldVersion: oldData?.version,
      newVersion: newData.version 
    });

    res.json({ success: true, data: newData });
  } catch (error: any) {
    logger.error('Error updating template', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to update template' });
  }
});

// ============================================================================
// Queue Routes (Admin Only)
// ============================================================================

/**
 * GET /api/email/queue
 * Get email queue status and recent entries
 */
router.get('/queue', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const status = await getQueueStatus();
    const limit = parseInt(req.query.limit as string) || 50;
    const statusFilter = req.query.status as string;

    // Get recent queue entries
    let query = `
      SELECT 
        queue_id, recipient_email, subject, status, 
        priority, attempts, last_attempt, sent_at, 
        error_message, study_id, entity_type, entity_id,
        date_created, scheduled_for
      FROM acc_email_queue
    `;
    
    const params: any[] = [];
    if (statusFilter) {
      query += ' WHERE status = $1';
      params.push(statusFilter);
    }
    
    query += ' ORDER BY date_created DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await pool.query(query, params);

    res.json({ 
      success: true, 
      data: {
        status,
        entries: result.rows
      }
    });
  } catch (error: any) {
    logger.error('Error getting queue', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get queue' });
  }
});

/**
 * POST /api/email/queue/process
 * Manually trigger queue processing
 */
router.post('/queue/process', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const batchSize = parseInt(req.body.batchSize) || 10;
    const result = await processEmailQueue(batchSize);
    
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Error processing queue', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to process queue' });
  }
});

/**
 * POST /api/email/queue/:id/retry
 * Retry a failed email
 */
router.post('/queue/:id/retry', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const queueId = parseInt(req.params.id);
    const success = await retryEmail(queueId);
    
    if (!success) {
      return res.status(404).json({ 
        success: false, 
        message: 'Email not found or not in failed status' 
      });
    }
    
    res.json({ success: true, message: 'Email queued for retry' });
  } catch (error: any) {
    logger.error('Error retrying email', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to retry email' });
  }
});

/**
 * DELETE /api/email/queue/:id
 * Cancel a pending email
 */
router.delete('/queue/:id', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const queueId = parseInt(req.params.id);
    const success = await cancelEmail(queueId);
    
    if (!success) {
      return res.status(404).json({ 
        success: false, 
        message: 'Email not found or not in pending status' 
      });
    }
    
    res.json({ success: true, message: 'Email cancelled' });
  } catch (error: any) {
    logger.error('Error cancelling email', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to cancel email' });
  }
});

// ============================================================================
// User Preference Routes
// ============================================================================

/**
 * GET /api/email/preferences
 * Get current user's notification preferences
 */
router.get('/preferences', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const preferences = await getUserPreferences(userId);
    
    // Return preferences grouped by notification type
    const grouped: Record<string, any> = {};
    
    for (const pref of preferences) {
      if (!grouped[pref.notificationType]) {
        grouped[pref.notificationType] = {
          global: null,
          studies: {}
        };
      }
      
      if (pref.studyId) {
        grouped[pref.notificationType].studies[pref.studyId] = pref;
      } else {
        grouped[pref.notificationType].global = pref;
      }
    }
    
    res.json({ success: true, data: grouped });
  } catch (error: any) {
    logger.error('Error getting preferences', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get preferences' });
  }
});

/**
 * PUT /api/email/preferences
 * Update user notification preferences
 */
router.put('/preferences', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const { notificationType, studyId, emailEnabled, digestEnabled, inAppEnabled } = req.body;

    if (!notificationType) {
      return res.status(400).json({ 
        success: false, 
        message: 'notificationType is required' 
      });
    }

    const request: UpdatePreferenceRequest = {
      userId,
      notificationType: notificationType as NotificationType,
      studyId: studyId || undefined,
      emailEnabled,
      digestEnabled,
      inAppEnabled
    };

    const success = await updatePreference(request);
    
    if (!success) {
      return res.status(500).json({ success: false, message: 'Failed to update preference' });
    }
    
    res.json({ success: true, message: 'Preference updated' });
  } catch (error: any) {
    logger.error('Error updating preferences', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to update preferences' });
  }
});

/**
 * PUT /api/email/preferences/bulk
 * Bulk update multiple preferences
 */
router.put('/preferences/bulk', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { preferences } = req.body;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    if (!Array.isArray(preferences)) {
      return res.status(400).json({ 
        success: false, 
        message: 'preferences must be an array' 
      });
    }

    let updated = 0;
    let failed = 0;

    for (const pref of preferences) {
      const request: UpdatePreferenceRequest = {
        userId,
        notificationType: pref.notificationType,
        studyId: pref.studyId || undefined,
        emailEnabled: pref.emailEnabled,
        digestEnabled: pref.digestEnabled,
        inAppEnabled: pref.inAppEnabled
      };

      const success = await updatePreference(request);
      if (success) {
        updated++;
      } else {
        failed++;
      }
    }

    res.json({ 
      success: true, 
      data: { updated, failed } 
    });
  } catch (error: any) {
    logger.error('Error bulk updating preferences', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to update preferences' });
  }
});

// ============================================================================
// Test Email Route (Admin Only)
// ============================================================================

/**
 * POST /api/email/test
 * Send a test email
 */
router.post('/test', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { recipientEmail, templateName, variables } = req.body;
    const userId = (req as any).user?.userId;

    if (!recipientEmail) {
      return res.status(400).json({ 
        success: false, 
        message: 'recipientEmail is required' 
      });
    }

    let queueId: number | null;

    if (templateName) {
      // Send using template
      queueId = await queueEmail({
        templateName,
        recipientEmail,
        recipientUserId: userId,
        variables: variables || {},
        priority: 1 // High priority for test emails
      });
    } else {
      // Send direct test email
      queueId = await queueDirectEmail({
        recipientEmail,
        recipientUserId: userId,
        subject: 'Test Email from AccuraTrials EDC',
        htmlBody: '<h1>Test Email</h1><p>This is a test email from AccuraTrials EDC.</p><p>If you received this email, the email system is working correctly.</p>',
        textBody: 'Test Email\n\nThis is a test email from AccuraTrials EDC.\n\nIf you received this email, the email system is working correctly.',
        priority: 1
      });
    }

    if (!queueId) {
      return res.status(500).json({ success: false, message: 'Failed to queue test email' });
    }

    // Process immediately for test
    await processEmailQueue(1);

    res.json({ 
      success: true, 
      message: 'Test email queued and processing', 
      data: { queueId } 
    });
  } catch (error: any) {
    logger.error('Error sending test email', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to send test email' });
  }
});

// ============================================================================
// Notification Types Reference
// ============================================================================

/**
 * GET /api/email/notification-types
 * List available notification types
 */
router.get('/notification-types', authMiddleware, async (req: Request, res: Response) => {
  const notificationTypes = [
    { key: 'query_opened', label: 'New Query Assigned', description: 'When a query is assigned to you' },
    { key: 'query_response', label: 'Query Response', description: 'When a query you created receives a response' },
    { key: 'query_closed', label: 'Query Closed', description: 'When a query is closed' },
    { key: 'signature_required', label: 'Signature Required', description: 'When your signature is required on a form' },
    { key: 'form_submitted', label: 'Form Submitted', description: 'When a form is submitted for review' },
    { key: 'sdv_complete', label: 'SDV Complete', description: 'When SDV is completed on a form' },
    { key: 'subject_enrolled', label: 'Subject Enrolled', description: 'When a new subject is enrolled' },
    { key: 'visit_overdue', label: 'Visit Overdue', description: 'When a scheduled visit is overdue' },
    { key: 'protocol_deviation', label: 'Protocol Deviation', description: 'When a protocol deviation is detected' },
    { key: 'study_lock', label: 'Study Lock/Unlock', description: 'When a study is locked or unlocked' },
    { key: 'role_assigned', label: 'Role Assigned', description: 'When you are assigned a new role' }
  ];

  res.json({ success: true, data: notificationTypes });
});

export default router;

