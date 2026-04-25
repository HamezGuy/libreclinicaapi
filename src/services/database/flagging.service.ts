/**
 * Flagging Service
 *
 * CRUD against LibreClinica native tables: event_crf_flag, item_data_flag
 */

import { pool } from '../../config/database';

interface CrfFlag {
  eventCrfFlagId: number;
  eventCrfId: number;
  flagType: string;
  comment: string;
  userId: number;
  createdAt: string;
}

interface ItemFlag {
  itemDataFlagId: number;
  itemDataId: number;
  flagType: string;
  comment: string;
  userId: number;
  createdAt: string;
}

function toCrfFlag(row: any): CrfFlag {
  return {
    eventCrfFlagId: row.eventCrfFlagId,
    eventCrfId: row.eventCrfId,
    flagType: row.flagType,
    comment: row.comment,
    userId: row.userId,
    createdAt: row.createdAt,
  };
}

function toItemFlag(row: any): ItemFlag {
  return {
    itemDataFlagId: row.itemDataFlagId,
    itemDataId: row.itemDataId,
    flagType: row.flagType,
    comment: row.comment,
    userId: row.userId,
    createdAt: row.createdAt,
  };
}

export async function getCrfFlags(eventCrfId: number): Promise<CrfFlag[]> {
  const result = await pool.query(
    `SELECT * FROM event_crf_flag WHERE event_crf_id = $1 ORDER BY created_at DESC`,
    [eventCrfId],
  );
  return result.rows.map(toCrfFlag);
}

export async function createCrfFlag(
  eventCrfId: number,
  flagType: string,
  comment: string,
  userId: number,
): Promise<CrfFlag> {
  const result = await pool.query(
    `INSERT INTO event_crf_flag (event_crf_id, flag_type, comment, user_id, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [eventCrfId, flagType || 'review', comment || '', userId],
  );
  return toCrfFlag(result.rows[0]);
}

export async function getItemFlags(itemDataId: number): Promise<ItemFlag[]> {
  const result = await pool.query(
    `SELECT * FROM item_data_flag WHERE item_data_id = $1 ORDER BY created_at DESC`,
    [itemDataId],
  );
  return result.rows.map(toItemFlag);
}

export async function createItemFlag(
  itemDataId: number,
  flagType: string,
  comment: string,
  userId: number,
): Promise<ItemFlag> {
  const result = await pool.query(
    `INSERT INTO item_data_flag (item_data_id, flag_type, comment, user_id, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [itemDataId, flagType || 'review', comment || '', userId],
  );
  return toItemFlag(result.rows[0]);
}
