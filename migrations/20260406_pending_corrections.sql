-- Migration: Add pending correction columns to discrepancy_note
-- Purpose: Corrections proposed via query responses should NOT be applied immediately.
--          They must be stored as "pending" and only applied when a Monitor/DM/Admin
--          accepts the resolution. If rejected, the pending correction is discarded.

ALTER TABLE discrepancy_note
  ADD COLUMN IF NOT EXISTS pending_correction_value  TEXT,
  ADD COLUMN IF NOT EXISTS pending_correction_reason TEXT,
  ADD COLUMN IF NOT EXISTS pending_correction_user_id INTEGER REFERENCES user_account(user_id);
