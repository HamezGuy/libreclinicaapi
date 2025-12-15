/**
 * Email Worker
 * 
 * Background worker that processes the email queue.
 * Should be run as a separate process or scheduled task.
 */

import { logger } from '../../config/logger';
import { processEmailQueue, getQueueStatus } from './email.service';
import { pool } from '../../config/database';

// Worker configuration
const BATCH_SIZE = parseInt(process.env.EMAIL_BATCH_SIZE || '10');
const PROCESS_INTERVAL_MS = parseInt(process.env.EMAIL_PROCESS_INTERVAL || '30000'); // 30 seconds
const DIGEST_HOUR = parseInt(process.env.EMAIL_DIGEST_HOUR || '8'); // 8 AM

let isProcessing = false;
let workerInterval: NodeJS.Timeout | null = null;
let digestInterval: NodeJS.Timeout | null = null;

/**
 * Start the email worker
 */
export function startEmailWorker(): void {
  logger.info('Starting email worker', { 
    batchSize: BATCH_SIZE, 
    intervalMs: PROCESS_INTERVAL_MS 
  });

  // Process queue immediately on start
  processQueue();

  // Set up interval for processing
  workerInterval = setInterval(processQueue, PROCESS_INTERVAL_MS);

  // Set up daily digest processing
  scheduleDailyDigest();

  logger.info('Email worker started');
}

/**
 * Stop the email worker
 */
export function stopEmailWorker(): void {
  logger.info('Stopping email worker');

  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }

  if (digestInterval) {
    clearInterval(digestInterval);
    digestInterval = null;
  }

  logger.info('Email worker stopped');
}

/**
 * Process the queue
 */
async function processQueue(): Promise<void> {
  if (isProcessing) {
    logger.debug('Email queue already being processed, skipping');
    return;
  }

  isProcessing = true;

  try {
    const status = await getQueueStatus();
    
    if (status.pending === 0) {
      logger.debug('No pending emails in queue');
      return;
    }

    logger.info('Processing email queue', { pending: status.pending });
    
    const result = await processEmailQueue(BATCH_SIZE);
    
    logger.info('Email queue processing complete', {
      processed: result.processed,
      sent: result.sent,
      failed: result.failed
    });
  } catch (error: any) {
    logger.error('Error in email worker', { error: error.message });
  } finally {
    isProcessing = false;
  }
}

/**
 * Schedule daily digest processing
 */
function scheduleDailyDigest(): void {
  // Calculate ms until next digest time
  const now = new Date();
  const nextDigest = new Date(now);
  nextDigest.setHours(DIGEST_HOUR, 0, 0, 0);
  
  if (nextDigest <= now) {
    nextDigest.setDate(nextDigest.getDate() + 1);
  }

  const msUntilDigest = nextDigest.getTime() - now.getTime();
  
  logger.info('Scheduling daily digest', { 
    nextDigest: nextDigest.toISOString(),
    msUntilDigest 
  });

  // Schedule first digest
  setTimeout(() => {
    processDigest();
    
    // Then schedule daily
    digestInterval = setInterval(processDigest, 24 * 60 * 60 * 1000);
  }, msUntilDigest);
}

/**
 * Process and send daily digest emails
 */
async function processDigest(): Promise<void> {
  logger.info('Processing daily digest emails');

  try {
    // Get users who have digest enabled
    const usersResult = await pool.query(`
      SELECT DISTINCT np.user_id
      FROM acc_notification_preference np
      WHERE np.digest_enabled = true
    `);

    for (const row of usersResult.rows) {
      await sendDigestToUser(row.user_id);
    }

    logger.info('Daily digest processing complete', { 
      usersProcessed: usersResult.rows.length 
    });
  } catch (error: any) {
    logger.error('Error processing daily digest', { error: error.message });
  }
}

/**
 * Send digest to a specific user
 */
async function sendDigestToUser(userId: number): Promise<void> {
  try {
    // Get user email
    const userResult = await pool.query(
      'SELECT email, first_name FROM user_account WHERE user_id = $1',
      [userId]
    );

    if (!userResult.rows[0]?.email) {
      return;
    }

    const { email, first_name } = userResult.rows[0];

    // Get digest-eligible notifications from the last 24 hours
    const digestData = await getDigestData(userId);

    if (!digestData.hasContent) {
      logger.debug('No digest content for user', { userId });
      return;
    }

    // Send digest email
    const { queueEmail } = await import('./email.service');
    
    await queueEmail({
      templateName: 'daily_digest',
      recipientEmail: email,
      recipientUserId: userId,
      priority: 8, // Lower priority
      variables: {
        firstName: first_name,
        ...digestData
      }
    });

    logger.info('Digest email queued for user', { userId, email });
  } catch (error: any) {
    logger.error('Error sending digest to user', { error: error.message, userId });
  }
}

/**
 * Get digest data for a user
 */
async function getDigestData(userId: number): Promise<{
  hasContent: boolean;
  queryCount: number;
  formCount: number;
  subjectCount: number;
  summaryItems: Array<{ type: string; description: string; time: string }>;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 1);

  try {
    // Get user's study assignments
    const studiesResult = await pool.query(`
      SELECT DISTINCT study_id FROM study_user_role
      WHERE user_id = $1 AND status_id = 1
    `, [userId]);

    const studyIds = studiesResult.rows.map(r => r.study_id);
    
    if (studyIds.length === 0) {
      return {
        hasContent: false,
        queryCount: 0,
        formCount: 0,
        subjectCount: 0,
        summaryItems: []
      };
    }

    // Get recent queries
    const queriesResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM discrepancy_note dn
      JOIN event_crf ec ON dn.event_crf_id = ec.event_crf_id
      JOIN study_event se ON ec.study_event_id = se.study_event_id
      JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ss.study_id = ANY($1)
        AND dn.date_created >= $2
    `, [studyIds, cutoff]);

    // Get recent form submissions
    const formsResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM event_crf ec
      JOIN study_event se ON ec.study_event_id = se.study_event_id
      JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ss.study_id = ANY($1)
        AND ec.date_completed >= $2
    `, [studyIds, cutoff]);

    // Get recent enrollments
    const subjectsResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM study_subject
      WHERE study_id = ANY($1)
        AND date_created >= $2
    `, [studyIds, cutoff]);

    const queryCount = parseInt(queriesResult.rows[0]?.count || '0');
    const formCount = parseInt(formsResult.rows[0]?.count || '0');
    const subjectCount = parseInt(subjectsResult.rows[0]?.count || '0');

    return {
      hasContent: queryCount > 0 || formCount > 0 || subjectCount > 0,
      queryCount,
      formCount,
      subjectCount,
      summaryItems: [
        ...(queryCount > 0 ? [{ 
          type: 'queries', 
          description: `${queryCount} new ${queryCount === 1 ? 'query' : 'queries'}`,
          time: 'Last 24 hours'
        }] : []),
        ...(formCount > 0 ? [{ 
          type: 'forms', 
          description: `${formCount} ${formCount === 1 ? 'form' : 'forms'} completed`,
          time: 'Last 24 hours'
        }] : []),
        ...(subjectCount > 0 ? [{ 
          type: 'subjects', 
          description: `${subjectCount} new ${subjectCount === 1 ? 'subject' : 'subjects'} enrolled`,
          time: 'Last 24 hours'
        }] : [])
      ]
    };
  } catch (error: any) {
    logger.error('Error getting digest data', { error: error.message, userId });
    return {
      hasContent: false,
      queryCount: 0,
      formCount: 0,
      subjectCount: 0,
      summaryItems: []
    };
  }
}

/**
 * Force process queue immediately (for testing/admin)
 */
export async function forceProcessQueue(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  errors: string[];
}> {
  return await processEmailQueue(BATCH_SIZE);
}

/**
 * Force send digest (for testing/admin)
 */
export async function forceSendDigest(userId?: number): Promise<void> {
  if (userId) {
    await sendDigestToUser(userId);
  } else {
    await processDigest();
  }
}

export default {
  startEmailWorker,
  stopEmailWorker,
  forceProcessQueue,
  forceSendDigest
};

