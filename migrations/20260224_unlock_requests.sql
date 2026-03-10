-- Migration: Unlock Request Workflow
-- Creates the acc_unlock_request table which tracks requests from study staff
-- to unlock a locked eCRF instance for data correction.
--
-- Workflow:
--   1. Any authenticated user submits an unlock request (with reason + priority)
--   2. Admin/Data Manager reviews and either approves or rejects
--   3. On approval, the event_crf record is automatically unlocked
--   4. Full audit trail is maintained via audit_log_event

CREATE TABLE IF NOT EXISTS acc_unlock_request (
  unlock_request_id   SERIAL PRIMARY KEY,
  event_crf_id        INTEGER NOT NULL REFERENCES event_crf(event_crf_id) ON DELETE CASCADE,
  study_subject_id    INTEGER REFERENCES study_subject(study_subject_id) ON DELETE SET NULL,
  study_id            INTEGER REFERENCES study(study_id) ON DELETE SET NULL,
  requested_by_id     INTEGER NOT NULL REFERENCES user_account(user_id),
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason              TEXT NOT NULL,
  priority            VARCHAR(20) NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by_id      INTEGER REFERENCES user_account(user_id),
  reviewed_at         TIMESTAMPTZ,
  review_notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_unlock_request_event_crf  ON acc_unlock_request(event_crf_id);
CREATE INDEX IF NOT EXISTS idx_unlock_request_status      ON acc_unlock_request(status);
CREATE INDEX IF NOT EXISTS idx_unlock_request_study       ON acc_unlock_request(study_id);
CREATE INDEX IF NOT EXISTS idx_unlock_request_requested_by ON acc_unlock_request(requested_by_id);
