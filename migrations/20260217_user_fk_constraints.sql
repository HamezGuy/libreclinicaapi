-- Migration: User FK Constraints
-- Date: 2026-02-17
-- Description:
--   1. Adds FK constraint on user_custom_permissions.user_id -> user_account(user_id)
--   2. Ensures status seed data exists (status_id=1)
--   3. Ensures completion_status seed data exists

-- =============================================
-- 1. Ensure status seed data exists
-- =============================================
INSERT INTO status (status_id, name, description)
VALUES
  (1, 'available', 'Active/available'),
  (2, 'unavailable', 'Unavailable/locked'),
  (3, 'pending', 'Pending'),
  (5, 'removed', 'Removed/deleted'),
  (7, 'auto-removed', 'Auto-removed')
ON CONFLICT (status_id) DO NOTHING;

-- =============================================
-- 2. Ensure completion_status seed data exists
-- =============================================
INSERT INTO completion_status (completion_status_id, status_id, name)
VALUES
  (1, 1, 'not_started'),
  (2, 1, 'initial_data_entry'),
  (3, 1, 'data_entry_started'),
  (4, 1, 'complete'),
  (5, 1, 'signed'),
  (6, 1, 'locked')
ON CONFLICT (completion_status_id) DO NOTHING;

-- =============================================
-- 3. Add FK on user_custom_permissions.user_id
-- =============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_ucp_user_id'
      AND table_name = 'user_custom_permissions'
  ) THEN
    -- Clean up any orphaned records before adding constraint
    DELETE FROM user_custom_permissions
    WHERE user_id NOT IN (SELECT user_id FROM user_account);

    ALTER TABLE user_custom_permissions
    ADD CONSTRAINT fk_ucp_user_id
    FOREIGN KEY (user_id) REFERENCES user_account(user_id) ON DELETE CASCADE;

    RAISE NOTICE 'Added FK constraint fk_ucp_user_id on user_custom_permissions';
  END IF;
END $$;
