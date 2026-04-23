/**
 * Query Mutations — status changes, responses, signatures, resolution workflow
 */

import { pool } from '../../../config/database';
import { logger } from '../../../config/logger';
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
} from '../../../middleware/errorHandler.middleware';
import { verifyAndUpgrade } from '../../../utils/password.util';
import * as notificationService from '../notification.service';
import * as emailTriggers from '../../email/notification-triggers';
import {
  updateFormQueryCounts,
  resolveEventCrfIdsForQuery,
  getQueryParticipants,
  applyCorrectionToItemData,
} from './query-helpers';

/**
 * Add response to query
 */
export const addQueryResponse = async (
  parentQueryId: number,
  data: {
    description: string;
    detailedNotes?: string;
    newStatusId?: number;
    correctedValue?: any;
    correctionReason?: string;
  },
  userId: number
): Promise<{ success: true; responseId: number; message: string; correctionApplied?: boolean; correctionDeferred?: boolean }> => {
  logger.info('Adding query response', { parentQueryId, userId });

  const safeDescription = (data.description || '').trim();
  if (!safeDescription) {
    throw new BadRequestError('Response text is required');
  }

  const client = await pool.connect();
  let txStarted = false;

  try {
    await client.query('BEGIN');
    txStarted = true;

    await client.query('SELECT pg_advisory_xact_lock($1)', [parentQueryId]);

    const parentResult = await client.query(
      `SELECT * FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [parentQueryId]
    );

    if (parentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new NotFoundError('Query not found');
    }

    const parent = parentResult.rows[0];
    const oldStatusId = parent.resolutionStatusId;
    const newStatusId = data.newStatusId || 2;

    const insertQuery = `
      INSERT INTO discrepancy_note (
        parent_dn_id, description, detailed_notes,
        discrepancy_note_type_id, resolution_status_id,
        study_id, entity_type, owner_id, date_created
      ) VALUES (
        $1, $2, $3, 3, $4, $5, $6, $7, NOW()
      )
      RETURNING discrepancy_note_id
    `;

    const insertResult = await client.query(insertQuery, [
      parentQueryId, safeDescription, data.detailedNotes || '',
      newStatusId, parent.studyId, parent.entityType, userId
    ]);

    const responseId = insertResult.rows[0].discrepancyNoteId;

    if (newStatusId !== oldStatusId) {
      await client.query(`
        UPDATE discrepancy_note SET resolution_status_id = $1 WHERE discrepancy_note_id = $2
      `, [newStatusId, parentQueryId]);
    }

    // ── PING-PONG ASSIGNMENT ──
    if (newStatusId !== 4) {
      const currentAssignee = parent.assignedUserId;
      const queryOwner = parent.ownerId;

      if (userId === currentAssignee && queryOwner && queryOwner !== userId) {
        await client.query(`
          UPDATE discrepancy_note SET assigned_user_id = $1 WHERE discrepancy_note_id = $2
        `, [queryOwner, parentQueryId]);
        logger.info('Ping-pong: reassigned query from responder to owner', {
          queryId: parentQueryId, from: currentAssignee, to: queryOwner
        });
      } else if (userId === queryOwner && currentAssignee && currentAssignee !== userId) {
        logger.info('Owner responded — assignee unchanged', {
          queryId: parentQueryId, assignee: currentAssignee
        });
      } else if (!currentAssignee && queryOwner && queryOwner !== userId) {
        await client.query(`
          UPDATE discrepancy_note SET assigned_user_id = $1 WHERE discrepancy_note_id = $2
        `, [queryOwner, parentQueryId]);
      }
    }

    const statusNames: Record<number, string> = {
      1: 'New', 2: 'Updated', 3: 'Resolution Proposed', 4: 'Closed', 5: 'Not Applicable'
    };
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Query Response',
        $3, $4, $5,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%updated%' LIMIT 1)
      )
    `, [
      userId, parentQueryId,
      `Status: ${statusNames[oldStatusId] || oldStatusId}`,
      `Status: ${statusNames[newStatusId] || newStatusId}, Response: ${safeDescription.substring(0, 200)}`,
      'Query response added'
    ]);

    // ── DATA CORRECTION ──
    let correctionApplied = false;
    let correctionDeferred = false;

    if (data.correctedValue !== undefined && data.correctedValue !== null && data.correctedValue !== '') {
      logger.info('Data correction requested', { 
        parentQueryId, correctedValueType: typeof data.correctedValue,
        correctedValuePreview: JSON.stringify(data.correctedValue).substring(0, 100)
      });

      const correctedSerialized = typeof data.correctedValue === 'object'
        ? JSON.stringify(data.correctedValue) : String(data.correctedValue);
      const correctionReason = data.correctionReason || 'Query resolution data correction';

      if (newStatusId === 3) {
        await client.query(`
          UPDATE discrepancy_note
          SET pending_correction_value   = $1,
              pending_correction_reason  = $2,
              pending_correction_user_id = $3
          WHERE discrepancy_note_id = $4
        `, [correctedSerialized, correctionReason, userId, parentQueryId]);

        correctionDeferred = true;
        logger.info('Data correction deferred — stored as pending (awaiting approval)', {
          queryId: parentQueryId, userId
        });

        await client.query(`
          INSERT INTO audit_log_event (
            audit_date, audit_table, user_id, entity_id, entity_name,
            old_value, new_value, reason_for_change,
            audit_log_event_type_id
          ) VALUES (
            NOW(), 'discrepancy_note', $1, $2, 'Pending Data Correction Proposed',
            'No correction', $3, $4,
            COALESCE(
              (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%updated%' LIMIT 1),
              1
            )
          )
        `, [
          userId, parentQueryId,
          `Pending correction: ${correctedSerialized.substring(0, 200)}`,
          correctionReason
        ]);
      } else {
        try {
          const linkedData = await client.query(`
            SELECT dim.item_data_id, dim.column_name, dim.cell_target,
                   id.value AS old_value, id.event_crf_id,
                   i.name AS field_name, i.item_id, i.description AS item_description,
                   i.item_data_type_id,
                   rs.options_text, rs.options_values,
                   rt.name AS response_type_name
            FROM dn_item_data_map dim
            INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
            INNER JOIN item i ON id.item_id = i.item_id
            LEFT JOIN event_crf ec ON id.event_crf_id = ec.event_crf_id
            LEFT JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = ec.crf_version_id
            LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id
            LEFT JOIN response_type rt ON rs.response_type_id = rt.response_type_id
            WHERE dim.discrepancy_note_id = $1
            LIMIT 1
          `, [parentQueryId]);

          if (linkedData.rows.length > 0) {
            correctionApplied = await applyCorrectionToItemData(
              client, parentQueryId, linkedData.rows[0], data.correctedValue, correctionReason, userId
            );
          } else {
            logger.warn('correctedValue provided but no linked item_data found for query', {
              queryId: parentQueryId
            });
          }
        } catch (correctionErr: any) {
          logger.error('Data correction failed — rolling back', { error: correctionErr.message });
          throw correctionErr;
        }
      }
    }

    const ecIdsResp = await resolveEventCrfIdsForQuery(client, parentQueryId);
    for (const ecId of ecIdsResp) {
      await updateFormQueryCounts(client, ecId);
    }

    await client.query('COMMIT');

    logger.info('Query response added successfully', {
      responseId, parentQueryId, newStatusId, correctionApplied, correctionDeferred
    });

    let responderName = 'A user';
    try {
      const responderResult = await pool.query(
        `SELECT first_name, last_name FROM user_account WHERE user_id = $1`, [userId]
      );
      if (responderResult.rows[0]) {
        responderName = `${responderResult.rows[0].firstName} ${responderResult.rows[0].lastName}`.trim();
      }
    } catch { /* ignore */ }

    try {
      const participants = await getQueryParticipants(parentQueryId);

      if (newStatusId === 4) {
        for (const uid of participants) {
          if (uid !== userId) {
            await notificationService.notifyQueryClosed(uid, safeDescription, parentQueryId, responderName, parent.studyId);
          }
        }
      } else if (newStatusId === 3) {
        for (const uid of participants) {
          if (uid !== userId) {
            await notificationService.notifyResolutionProposed(uid, safeDescription, parentQueryId, responderName, parent.studyId);
          }
        }
      } else {
        for (const uid of participants) {
          if (uid !== userId) {
            await notificationService.notifyQueryResponse(uid, safeDescription, parentQueryId, responderName, parent.studyId);
          }
        }
      }
    } catch (notifErr: any) {
      logger.warn('Failed to send query response notification', { error: notifErr.message });
    }

    try {
      if (newStatusId === 4) {
        emailTriggers.triggerQueryClosed(
          parentQueryId, parent.studyId, userId,
          (await getQueryParticipants(parentQueryId)).filter(uid => uid !== userId)
        ).catch(e => logger.warn('Email trigger failed for query closed', { error: e.message }));
      } else {
        emailTriggers.triggerQueryResponse(
          parentQueryId, parent.studyId, userId,
          parent.ownerId || userId,
          safeDescription
        ).catch(e => logger.warn('Email trigger failed for query response', { error: e.message }));
      }
    } catch (emailErr: any) {
      logger.warn('Failed to queue query response email', { error: emailErr.message });
    }

    return {
      success: true, responseId,
      message: correctionDeferred
        ? 'Response added — data correction saved as pending (will be applied upon approval)'
        : correctionApplied
          ? 'Response added and data correction applied'
          : 'Response added successfully',
      correctionApplied,
      correctionDeferred
    };
  } catch (error: any) {
    if (txStarted) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in addQueryResponse', { rbErr: rbErr.message })
      );
    }
    logger.error('Add query response error', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Update query status with full audit trail
 */
export const updateQueryStatus = async (
  queryId: number,
  statusId: number,
  userId: number,
  options?: { reason?: string; signature?: boolean }
): Promise<{ success: true; message: string }> => {
  logger.info('Updating query status', { queryId, statusId, userId, options });

  const client = await pool.connect();
  let txStarted = false;

  try {
    await client.query('BEGIN');
    txStarted = true;
    await client.query('SELECT pg_advisory_xact_lock($1)', [queryId]);

    const currentResult = await client.query(
      `SELECT resolution_status_id, description FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [queryId]
    );

    if (currentResult.rows.length === 0) {
      throw new NotFoundError('Query not found');
    }

    const oldStatusId = currentResult.rows[0].resolutionStatusId;
    const queryDescription = currentResult.rows[0].description;

    const statusNames: Record<number, string> = {
      1: 'New', 2: 'Updated', 3: 'Resolution Proposed', 4: 'Closed', 5: 'Not Applicable'
    };

    await client.query(`
      UPDATE discrepancy_note SET resolution_status_id = $1 WHERE discrepancy_note_id = $2
    `, [statusId, queryId]);

    let actionName = 'Query status changed';
    if (statusId === 4) {
      actionName = options?.signature ? 'Query closed with signature' : 'Query closed';
    } else if (statusId === 1 && oldStatusId === 4) {
      actionName = 'Query reopened';
    } else if (statusId === 3) {
      actionName = 'Resolution proposed';
    }

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, $3,
        $4, $5, $6,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%updated%' LIMIT 1)
      )
    `, [
      userId, queryId, actionName,
      `Status: ${statusNames[oldStatusId] || oldStatusId}`,
      `Status: ${statusNames[statusId] || statusId}${options?.signature ? ' (Signed)' : ''}`,
      options?.reason || `Status changed from ${statusNames[oldStatusId]} to ${statusNames[statusId]}`
    ]);

    const ecIds = await resolveEventCrfIdsForQuery(client, queryId);
    for (const ecId of ecIds) {
      await updateFormQueryCounts(client, ecId);
    }

    await client.query('COMMIT');

    logger.info('Query status updated successfully', { queryId, oldStatusId, newStatusId: statusId });

    try {
      let userName = 'A user';
      const userRow = await pool.query(
        `SELECT first_name, last_name FROM user_account WHERE user_id = $1`, [userId]
      );
      if (userRow.rows[0]) {
        userName = `${userRow.rows[0].firstName} ${userRow.rows[0].lastName}`.trim();
      }

      const qInfo = await pool.query(
        `SELECT study_id, description FROM discrepancy_note WHERE discrepancy_note_id = $1`, [queryId]
      );
      const studyId = qInfo.rows[0]?.studyId;
      const description = qInfo.rows[0]?.description || 'Query';
      const participants = await getQueryParticipants(queryId);

      if (statusId === 4) {
        for (const uid of participants) {
          if (uid !== userId) {
            await notificationService.notifyQueryClosed(uid, description, queryId, userName, studyId);
          }
        }
      } else if (statusId === 1 && oldStatusId === 4) {
        for (const uid of participants) {
          if (uid !== userId) {
            await notificationService.createNotification({
              userId: uid, type: 'query_reopened',
              title: `Query reopened by ${userName}`,
              message: description.substring(0, 200),
              entityType: 'discrepancy_note', entityId: queryId, studyId,
            });
          }
        }
      } else if (statusId === 3) {
        for (const uid of participants) {
          if (uid !== userId) {
            await notificationService.notifyResolutionProposed(uid, description, queryId, userName, studyId);
          }
        }
      }
    } catch (notifErr: any) {
      logger.warn('Failed to send status change notification', { error: notifErr.message });
    }

    return { success: true, message: `Query ${actionName.toLowerCase()} successfully` };
  } catch (error: any) {
    if (txStarted) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in updateQueryStatus', { rbErr: rbErr.message })
      );
    }
    logger.error('Update query status error', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Reassign query to another user
 */
export const reassignQuery = async (
  queryId: number,
  assignedUserId: number,
  userId: number
): Promise<{ success: true; message: string }> => {
  logger.info('Reassigning query', { queryId, assignedUserId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [queryId]);

    const currentQuery = await client.query(
      'SELECT assigned_user_id FROM discrepancy_note WHERE discrepancy_note_id = $1',
      [queryId]
    );

    if (currentQuery.rows.length === 0) {
      throw new NotFoundError('Query not found');
    }

    const oldAssignedUserId = currentQuery.rows[0].assignedUserId;

    await client.query(`
      UPDATE discrepancy_note SET assigned_user_id = $1 WHERE discrepancy_note_id = $2
    `, [assignedUserId, queryId]);

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, old_value, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Query Reassigned', $3::text, $4::text,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Query Updated' LIMIT 1)
      )
    `, [userId, queryId, oldAssignedUserId, assignedUserId]);

    await client.query('COMMIT');

    try {
      const descResult = await pool.query(
        `SELECT description, study_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [queryId]
      );
      const desc = descResult.rows[0]?.description || 'Query reassigned to you';
      const studyId = descResult.rows[0]?.studyId;
      await notificationService.notifyQueryAssigned(assignedUserId, desc, queryId, studyId);
    } catch (notifErr: any) {
      logger.warn('Failed to send reassignment notification', { error: notifErr.message });
    }

    return { success: true, message: 'Query reassigned successfully' };
  } catch (error: any) {
    await client.query('ROLLBACK').catch((rbErr: any) =>
      logger.warn('ROLLBACK failed in reassignQuery', { rbErr: rbErr.message })
    );
    logger.error('Reassign query error', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Close query with electronic signature (password verification)
 * 21 CFR Part 11 compliant
 */
export const closeQueryWithSignature = async (
  queryId: number,
  userId: number,
  data: { password: string; reason: string; meaning?: string }
): Promise<{ success: true; message: string }> => {
  logger.info('Closing query with signature', { queryId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let userResult;
    try {
      userResult = await client.query(
        `SELECT u.passwd, u.user_name, u.first_name, u.last_name, uae.bcrypt_passwd
         FROM user_account u
         LEFT JOIN user_account_extended uae ON u.user_id = uae.user_id
         WHERE u.user_id = $1`,
        [userId]
      );
    } catch {
      userResult = await client.query(
        `SELECT passwd, user_name, first_name, last_name FROM user_account WHERE user_id = $1`,
        [userId]
      );
    }

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = userResult.rows[0];

    const verification = await verifyAndUpgrade(data.password, user.passwd, user.bcryptPasswd || null);

    if (!verification.valid) {
      logger.warn('Invalid password for query signature', { queryId, userId });
      throw new ForbiddenError('Invalid password. Electronic signature verification failed.');
    }

    if (verification.shouldUpdateDatabase && verification.upgradedBcryptHash) {
      try {
        await client.query(`
          INSERT INTO user_account_extended (user_id, bcrypt_passwd, passwd_upgraded_at, password_version)
          VALUES ($1, $2, NOW(), 2)
          ON CONFLICT (user_id) DO UPDATE SET bcrypt_passwd = $2, passwd_upgraded_at = NOW(), password_version = 2
        `, [userId, verification.upgradedBcryptHash]);
      } catch { /* non-blocking */ }
    }

    const result = await closeQueryWithSignatureVerified(queryId, userId, {
      reason: data.reason, meaning: data.meaning
    }, client, user);

    await client.query('COMMIT');
    return result;
  } catch (error: any) {
    await client.query('ROLLBACK').catch((rbErr: any) =>
      logger.warn('ROLLBACK failed in closeQueryWithSignature', { rbErr: rbErr.message })
    );
    logger.error('Close query with signature error', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Close query with verified electronic signature
 * 21 CFR Part 11 compliant
 */
export const closeQueryWithSignatureVerified = async (
  queryId: number,
  userId: number,
  data: { reason: string; meaning?: string },
  existingClient?: any,
  existingUser?: any
): Promise<{ success: true; message: string }> => {
  logger.info('Closing query with verified signature', { queryId, userId });

  const client = existingClient || await pool.connect();
  const needsRelease = !existingClient;

  try {
    if (!existingClient) {
      await client.query('BEGIN');
    }

    let user = existingUser;
    if (!user) {
      const userResult = await client.query(
        `SELECT user_name, first_name, last_name FROM user_account WHERE user_id = $1`,
        [userId]
      );
      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }
      user = userResult.rows[0];
    }

    const queryResult = await client.query(
      `SELECT resolution_status_id, description FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [queryId]
    );

    if (queryResult.rows.length === 0) {
      throw new Error('Query not found');
    }

    const oldStatusId = queryResult.rows[0].resolutionStatusId;

    if (oldStatusId === 4) {
      if (!existingClient) {
        await client.query('COMMIT');
      }
      return { success: true as const, message: 'Query is already closed' };
    }

    await client.query(`
      UPDATE discrepancy_note SET resolution_status_id = 4 WHERE discrepancy_note_id = $1
    `, [queryId]);

    await client.query(`
      INSERT INTO discrepancy_note (
        parent_dn_id, description, detailed_notes,
        discrepancy_note_type_id, resolution_status_id,
        study_id, entity_type, owner_id, date_created
      )
      SELECT $1, $2, $3, 3, 4, study_id, entity_type, $4, NOW()
      FROM discrepancy_note WHERE discrepancy_note_id = $1
    `, [queryId, `[SIGNED] ${data.reason}`, data.meaning || 'Electronic signature applied', userId]);

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Query Closed with Electronic Signature',
        $3, $4, $5,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%complete%password%' LIMIT 1)
      )
    `, [
      userId, queryId,
      `Status: ${oldStatusId}`,
      `Status: Closed (Signed by ${user.firstName} ${user.lastName})`,
      `${data.reason}. Signature meaning: ${data.meaning || 'Query resolved'}`
    ]);

    const ecIds = await resolveEventCrfIdsForQuery(client, queryId);
    for (const ecId of ecIds) {
      await updateFormQueryCounts(client, ecId);
    }

    if (!existingClient) {
      await client.query('COMMIT');
    }

    logger.info('Query closed with signature successfully', { queryId, userId, userName: user.userName });

    try {
      const taskTableCheck = await pool.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_workflow_tasks') as exists`
      );
      if (taskTableCheck.rows[0].exists) {
        await pool.query(`
          UPDATE acc_workflow_tasks
          SET status = 'completed', completed_by = $1, date_completed = NOW(), date_updated = NOW(),
              metadata = metadata || $2
          WHERE entity_type = 'discrepancy_note' AND entity_id = $3 AND status IN ('pending', 'in_progress')
        `, [userId, JSON.stringify({ closedWithSignature: true, closedBy: userId }), queryId]);
      }
    } catch (taskErr: any) {
      logger.warn('Failed to complete workflow task on query close', { queryId, error: taskErr.message });
    }

    try {
      const closerName = `${user.firstName} ${user.lastName}`.trim();
      const participants = await getQueryParticipants(queryId);
      const qStudy = await pool.query(
        `SELECT study_id, description FROM discrepancy_note WHERE discrepancy_note_id = $1`, [queryId]
      );
      const studyId = qStudy.rows[0]?.studyId;
      const description = qStudy.rows[0]?.description || 'Query';

      for (const uid of participants) {
        if (uid !== userId) {
          await notificationService.notifyQueryClosed(uid, description, queryId, closerName, studyId);
        }
      }
    } catch (notifErr: any) {
      logger.warn('Failed to send signed closure notification', { error: notifErr.message });
    }

    return { success: true, message: 'Query closed with electronic signature successfully' };
  } catch (error: any) {
    if (!existingClient) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in closeQueryWithSignatureVerified', { rbErr: rbErr.message })
      );
    }
    logger.error('Close query with signature error', { error: error.message });
    throw error;
  } finally {
    if (needsRelease) {
      client.release();
    }
  }
};

/**
 * Accept a proposed resolution.
 */
export const acceptResolution = async (
  queryId: number,
  userId: number,
  data: { reason?: string; meaning?: string }
): Promise<{ success: true; message: string }> => {
  logger.info('Accepting proposed resolution', { queryId, userId });

  const client = await pool.connect();
  let txStarted = false;
  try {
    await client.query('BEGIN');
    txStarted = true;
    await client.query('SELECT pg_advisory_xact_lock($1)', [queryId]);

    const qResult = await client.query(
      `SELECT resolution_status_id, description, study_id, owner_id, assigned_user_id,
              pending_correction_value, pending_correction_reason, pending_correction_user_id
       FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [queryId]
    );
    if (qResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new NotFoundError('Query not found');
    }
    const q = qResult.rows[0];
    if (q.resolutionStatusId !== 3) {
      await client.query('ROLLBACK');
      throw new ConflictError('Query is not in "Resolution Proposed" status. Only proposed resolutions can be accepted.');
    }

    const reason = (data.reason || 'Resolution accepted').trim();
    const meaning = data.meaning || 'I have reviewed the proposed resolution and confirm it is acceptable';

    await client.query(`
      INSERT INTO discrepancy_note (
        parent_dn_id, description, detailed_notes,
        discrepancy_note_type_id, resolution_status_id,
        study_id, entity_type, owner_id, date_created
      )
      SELECT $1, $2, $3, 3, 4, study_id, entity_type, $4, NOW()
      FROM discrepancy_note WHERE discrepancy_note_id = $1
    `, [queryId, `[ACCEPTED] ${reason}`, meaning, userId]);

    await client.query(
      `UPDATE discrepancy_note SET resolution_status_id = 4 WHERE discrepancy_note_id = $1`,
      [queryId]
    );

    const userResult = await client.query(
      `SELECT first_name, last_name, user_name FROM user_account WHERE user_id = $1`, [userId]
    );
    const userName = userResult.rows[0]
      ? `${userResult.rows[0].firstName} ${userResult.rows[0].lastName}`.trim()
      : 'Unknown';

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change, audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Resolution Accepted',
        'Status: Resolution Proposed', $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%complete%' LIMIT 1)
      )
    `, [userId, queryId, `Status: Closed (Accepted by ${userName})`, reason]);

    let correctionApplied = false;
    if (q.pendingCorrectionValue) {
      logger.info('Applying pending correction on resolution acceptance', { queryId });
      try {
        let correctedValue: any;
        try { correctedValue = JSON.parse(q.pendingCorrectionValue); }
        catch { correctedValue = q.pendingCorrectionValue; }

        const linkedData = await client.query(`
          SELECT dim.item_data_id, dim.column_name, dim.cell_target,
                 id.value AS old_value, id.event_crf_id,
                 i.name AS field_name, i.item_id, i.description AS item_description,
                 i.item_data_type_id,
                 rs.options_text, rs.options_values,
                 rt.name AS response_type_name
          FROM dn_item_data_map dim
          INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
          INNER JOIN item i ON id.item_id = i.item_id
          LEFT JOIN event_crf ec ON id.event_crf_id = ec.event_crf_id
          LEFT JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = ec.crf_version_id
          LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id
          LEFT JOIN response_type rt ON rs.response_type_id = rt.response_type_id
          WHERE dim.discrepancy_note_id = $1
          LIMIT 1
        `, [queryId]);

        if (linkedData.rows.length > 0) {
          correctionApplied = await applyCorrectionToItemData(
            client, queryId, linkedData.rows[0], correctedValue,
            (q.pendingCorrectionReason || 'Approved query correction') + ` [Accepted by ${userName}]`,
            userId
          );
        } else {
          logger.warn('Pending correction exists but no linked item_data found', { queryId });
        }
      } catch (corrErr: any) {
        logger.error('Failed to apply pending correction on accept — rolling back', { error: corrErr.message });
        throw corrErr;
      }

      await client.query(`
        UPDATE discrepancy_note
        SET pending_correction_value = NULL,
            pending_correction_reason = NULL,
            pending_correction_user_id = NULL
        WHERE discrepancy_note_id = $1
      `, [queryId]);
    }

    const ecIdsAccept = await resolveEventCrfIdsForQuery(client, queryId);
    for (const ecId of ecIdsAccept) {
      await updateFormQueryCounts(client, ecId);
    }

    await client.query('COMMIT');

    try {
      const taskTableCheck = await pool.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_workflow_tasks') as exists`
      );
      if (taskTableCheck.rows[0].exists) {
        await pool.query(`
          UPDATE acc_workflow_tasks
          SET status = 'completed', completed_by = $1, date_completed = NOW(), date_updated = NOW(),
              metadata = metadata || $2
          WHERE entity_type = 'discrepancy_note' AND entity_id = $3 AND status IN ('pending', 'in_progress')
        `, [userId, JSON.stringify({ resolutionAccepted: true, acceptedBy: userId }), queryId]);
      }
    } catch (taskErr: any) {
      logger.warn('Failed to complete workflow task on resolution accept', { queryId, error: taskErr.message });
    }

    try {
      const participants = await getQueryParticipants(queryId);
      for (const uid of participants) {
        if (uid !== userId) {
          await notificationService.notifyQueryClosed(uid, q.description, queryId, userName, q.studyId);
        }
      }
    } catch { /* non-blocking */ }

    return { success: true, message: correctionApplied
      ? 'Resolution accepted — query closed and data correction applied'
      : 'Resolution accepted — query closed' };
  } catch (error: any) {
    if (txStarted) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in acceptResolution', { rbErr: rbErr.message })
      );
    }
    logger.error('Accept resolution error', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Reject a proposed resolution.
 */
export const rejectResolution = async (
  queryId: number,
  userId: number,
  data: { reason: string }
): Promise<{ success: true; message: string }> => {
  logger.info('Rejecting proposed resolution', { queryId, userId });

  if (!data.reason?.trim()) {
    throw new BadRequestError('A reason is required when rejecting a resolution');
  }

  const client = await pool.connect();
  let txStarted = false;
  try {
    await client.query('BEGIN');
    txStarted = true;
    await client.query('SELECT pg_advisory_xact_lock($1)', [queryId]);

    const qResult = await client.query(
      `SELECT resolution_status_id, description, study_id, owner_id, assigned_user_id
       FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [queryId]
    );
    if (qResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new NotFoundError('Query not found');
    }
    const q = qResult.rows[0];
    if (q.resolutionStatusId !== 3) {
      await client.query('ROLLBACK');
      throw new ConflictError('Query is not in "Resolution Proposed" status. Only proposed resolutions can be rejected.');
    }

    const reason = data.reason.trim();

    await client.query(`
      INSERT INTO discrepancy_note (
        parent_dn_id, description, detailed_notes,
        discrepancy_note_type_id, resolution_status_id,
        study_id, entity_type, owner_id, date_created
      )
      SELECT $1, $2, $3, 3, 1, study_id, entity_type, $4, NOW()
      FROM discrepancy_note WHERE discrepancy_note_id = $1
    `, [queryId, `[REJECTED] ${reason}`, 'Resolution rejected — please re-investigate', userId]);

    await client.query(
      `UPDATE discrepancy_note
       SET resolution_status_id = 1,
           pending_correction_value = NULL,
           pending_correction_reason = NULL,
           pending_correction_user_id = NULL
       WHERE discrepancy_note_id = $1`,
      [queryId]
    );

    const userResult = await client.query(
      `SELECT first_name, last_name, user_name FROM user_account WHERE user_id = $1`, [userId]
    );
    const userName = userResult.rows[0]
      ? `${userResult.rows[0].firstName} ${userResult.rows[0].lastName}`.trim()
      : 'Unknown';

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change, audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Resolution Rejected',
        'Status: Resolution Proposed', $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%updated%' LIMIT 1)
      )
    `, [userId, queryId, `Status: New (Rejected by ${userName})`, reason]);

    const ecIdsReject = await resolveEventCrfIdsForQuery(client, queryId);
    for (const ecId of ecIdsReject) {
      await updateFormQueryCounts(client, ecId);
    }

    await client.query('COMMIT');

    try {
      const participants = await getQueryParticipants(queryId);
      for (const uid of participants) {
        if (uid !== userId) {
          await notificationService.notifyResolutionRejected(uid, q.description, queryId, userName, reason, q.studyId);
        }
      }
    } catch { /* non-blocking */ }

    return { success: true, message: 'Resolution rejected — query returned to New status for re-investigation' };
  } catch (error: any) {
    if (txStarted) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in rejectResolution', { rbErr: rbErr.message })
      );
    }
    logger.error('Reject resolution error', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Reopen a closed query. Sets status back to New (1) and logs an audit event.
 */
export const reopenQuery = async (
  queryId: number,
  userId: number,
  reason: string
): Promise<{ success: true; message: string }> => {
  logger.info('Reopening query', { queryId, userId, reason });

  const result = await pool.query(
    `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
    [queryId]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('Query not found');
  }
  const currentStatusId = result.rows[0].resolutionStatusId;
  if (currentStatusId !== 4 && currentStatusId !== 5) {
    throw new ConflictError(
      'Only closed or not-applicable queries can be reopened. Current status is not eligible for reopen.'
    );
  }

  return updateQueryStatus(queryId, 1, userId, { reason: reason || 'Query reopened' });
};

/**
 * Re-query: takes an answered query (Updated or Resolution Proposed)
 * and sends it back to the respondent with a new message.
 */
export const requeryQuery = async (
  queryId: number,
  userId: number,
  data: { description: string; detailedNotes?: string }
): Promise<{ success: true; message: string }> => {
  logger.info('Re-querying', { queryId, userId });

  const client = await pool.connect();
  let txStarted = false;
  try {
    await client.query('BEGIN');
    txStarted = true;
    await client.query('SELECT pg_advisory_xact_lock($1)', [queryId]);

    const qResult = await client.query(
      `SELECT resolution_status_id, description, study_id, assigned_user_id, owner_id
       FROM discrepancy_note WHERE discrepancy_note_id = $1 AND parent_dn_id IS NULL`,
      [queryId]
    );
    if (qResult.rows.length === 0) {
      throw new NotFoundError('Query not found');
    }
    const q = qResult.rows[0];

    if (q.resolutionStatusId !== 2 && q.resolutionStatusId !== 3) {
      throw new ConflictError(
        'Re-query is only available for queries in "Updated" or "Resolution Proposed" status. ' +
        'Use "Reopen" for closed queries.'
      );
    }

    await client.query(`
      INSERT INTO discrepancy_note (
        parent_dn_id, description, detailed_notes,
        discrepancy_note_type_id, resolution_status_id,
        study_id, entity_type, owner_id, date_created
      )
      SELECT $1, $2, $3, 3, 1, study_id, entity_type, $4, NOW()
      FROM discrepancy_note WHERE discrepancy_note_id = $1
    `, [queryId, `[RE-QUERY] ${data.description}`, data.detailedNotes || '', userId]);

    await client.query(
      `UPDATE discrepancy_note SET resolution_status_id = 1 WHERE discrepancy_note_id = $1`,
      [queryId]
    );

    const userResult = await client.query(
      `SELECT first_name, last_name FROM user_account WHERE user_id = $1`, [userId]
    );
    const userName = userResult.rows.length > 0
      ? `${userResult.rows[0].firstName} ${userResult.rows[0].lastName}`.trim()
      : 'Unknown';

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change, audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Re-Query Issued',
        $3, 'Status: New (Re-queried)', $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%update%' LIMIT 1)
      )
    `, [
      userId, queryId,
      `Status: ${q.resolutionStatusId === 3 ? 'Resolution Proposed' : 'Updated'}`,
      `Re-queried by ${userName}: ${data.description}`
    ]);

    const ecIdsRequery = await resolveEventCrfIdsForQuery(client, queryId);
    for (const ecId of ecIdsRequery) {
      await updateFormQueryCounts(client, ecId);
    }

    await client.query('COMMIT');

    try {
      if (q.assignedUserId && q.assignedUserId !== userId) {
        await notificationService.notifyQueryAssigned(
          q.assignedUserId, `[RE-QUERY] ${data.description}`, queryId, q.studyId
        );
      }
    } catch { /* non-blocking */ }

    return { success: true, message: 'Query returned for further clarification' };
  } catch (error: any) {
    if (txStarted) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in requeryQuery', { rbErr: rbErr.message })
      );
    }
    logger.error('Re-query error', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
};
