-- =============================================================================
-- 21 CFR Part 11 Workflow Fixes Migration
-- Date: January 26, 2026
-- 
-- This migration fixes workflow mismatches and ensures proper state transitions
-- for 21 CFR Part 11 compliance (data start to data lock workflow)
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Update acc_workflow_tasks status constraint to include all valid statuses
-- =============================================================================

-- Drop the old constraint if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'acc_workflow_tasks_status_check'
    ) THEN
        ALTER TABLE acc_workflow_tasks DROP CONSTRAINT acc_workflow_tasks_status_check;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL; -- Ignore if constraint doesn't exist
END $$;

-- Alter the status column to support all workflow statuses (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'acc_workflow_tasks') THEN
        -- Change column type to VARCHAR(30) to accommodate longer status names
        ALTER TABLE acc_workflow_tasks ALTER COLUMN status TYPE VARCHAR(30);
        
        -- Add new constraint with all valid statuses aligned with frontend
        ALTER TABLE acc_workflow_tasks ADD CONSTRAINT acc_workflow_tasks_status_check
            CHECK (status IN (
                'pending',           -- Task created, awaiting action
                'in_progress',       -- Task actively being worked on
                'awaiting_approval', -- Task completed, awaiting approval/signature
                'approved',          -- Task approved by authorized user
                'rejected',          -- Task rejected, requires rework  
                'completed',         -- Task fully completed
                'cancelled',         -- Task cancelled (with audit reason)
                'overdue',           -- Task past due date
                'on_hold'            -- Task temporarily paused
            ));
    END IF;
END $$;

-- =============================================================================
-- 2. Create workflow state transition log table for 21 CFR Part 11 compliance
-- =============================================================================

CREATE TABLE IF NOT EXISTS acc_workflow_transitions (
    id SERIAL PRIMARY KEY,
    workflow_task_id INTEGER REFERENCES acc_workflow_tasks(id) ON DELETE CASCADE,
    from_status VARCHAR(30) NOT NULL,
    to_status VARCHAR(30) NOT NULL,
    transition_reason TEXT,
    user_id INTEGER REFERENCES user_account(user_id),
    username VARCHAR(100),
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_fingerprint VARCHAR(255),
    transition_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wf_transitions_task ON acc_workflow_transitions(workflow_task_id);
CREATE INDEX IF NOT EXISTS idx_wf_transitions_user ON acc_workflow_transitions(user_id);
CREATE INDEX IF NOT EXISTS idx_wf_transitions_time ON acc_workflow_transitions(transition_at DESC);

COMMENT ON TABLE acc_workflow_transitions IS '21 CFR Part 11 §11.10(e) - Audit trail for workflow state transitions';

-- =============================================================================
-- 3. Create workflow transition rules table (defines allowed state changes)
-- =============================================================================

CREATE TABLE IF NOT EXISTS acc_workflow_transition_rules (
    id SERIAL PRIMARY KEY,
    from_status VARCHAR(30) NOT NULL,
    to_status VARCHAR(30) NOT NULL,
    workflow_type VARCHAR(50), -- NULL means applies to all types
    requires_reason BOOLEAN DEFAULT false,
    requires_signature BOOLEAN DEFAULT false,
    requires_approval BOOLEAN DEFAULT false,
    required_role VARCHAR(100), -- NULL means any authenticated user
    description TEXT,
    UNIQUE(from_status, to_status, workflow_type)
);

COMMENT ON TABLE acc_workflow_transition_rules IS '21 CFR Part 11 §11.10(f) - Operational checks for permitted sequencing';

-- Insert default transition rules for 21 CFR Part 11 compliant workflow
INSERT INTO acc_workflow_transition_rules (from_status, to_status, requires_reason, requires_signature, description)
VALUES 
    -- From pending
    ('pending', 'in_progress', false, false, 'Start working on task'),
    ('pending', 'cancelled', true, false, 'Cancel pending task with reason'),
    ('pending', 'on_hold', true, false, 'Put task on hold'),
    
    -- From in_progress
    ('in_progress', 'awaiting_approval', false, false, 'Submit for approval'),
    ('in_progress', 'completed', false, false, 'Complete task without approval'),
    ('in_progress', 'cancelled', true, false, 'Cancel in-progress task'),
    ('in_progress', 'on_hold', true, false, 'Put task on hold'),
    ('in_progress', 'pending', true, false, 'Return to pending'),
    
    -- From awaiting_approval
    ('awaiting_approval', 'approved', true, true, 'Approve with signature'),
    ('awaiting_approval', 'rejected', true, false, 'Reject with reason'),
    ('awaiting_approval', 'in_progress', true, false, 'Return for rework'),
    
    -- From approved
    ('approved', 'completed', false, false, 'Mark approved task as completed'),
    
    -- From rejected
    ('rejected', 'in_progress', false, false, 'Start rework after rejection'),
    ('rejected', 'cancelled', true, false, 'Cancel rejected task'),
    
    -- From on_hold
    ('on_hold', 'pending', false, false, 'Resume task from hold'),
    ('on_hold', 'in_progress', false, false, 'Resume work on task'),
    ('on_hold', 'cancelled', true, false, 'Cancel held task'),
    
    -- From overdue (special status - can resume or cancel)
    ('overdue', 'in_progress', true, false, 'Resume overdue task with explanation'),
    ('overdue', 'cancelled', true, false, 'Cancel overdue task'),
    ('overdue', 'on_hold', true, false, 'Put overdue task on hold')
ON CONFLICT (from_status, to_status, workflow_type) DO NOTHING;

-- =============================================================================
-- 4. Create function to validate workflow transitions
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_workflow_transition(
    p_task_id INTEGER,
    p_new_status VARCHAR(30),
    p_user_id INTEGER,
    p_reason TEXT DEFAULT NULL
) RETURNS TABLE(
    valid BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    v_current_status VARCHAR(30);
    v_task_type VARCHAR(50);
    v_requires_reason BOOLEAN;
    v_requires_signature BOOLEAN;
BEGIN
    -- Get current task status and type
    SELECT status, type INTO v_current_status, v_task_type
    FROM acc_workflow_tasks
    WHERE id = p_task_id;
    
    IF v_current_status IS NULL THEN
        RETURN QUERY SELECT false, 'Task not found'::TEXT;
        RETURN;
    END IF;
    
    -- Same status is always allowed (no-op)
    IF v_current_status = p_new_status THEN
        RETURN QUERY SELECT true, NULL::TEXT;
        RETURN;
    END IF;
    
    -- Check if transition is allowed
    SELECT requires_reason, requires_signature 
    INTO v_requires_reason, v_requires_signature
    FROM acc_workflow_transition_rules
    WHERE from_status = v_current_status 
      AND to_status = p_new_status
      AND (workflow_type IS NULL OR workflow_type = v_task_type);
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 
            format('Transition from %s to %s is not allowed', v_current_status, p_new_status)::TEXT;
        RETURN;
    END IF;
    
    -- Check if reason is required but not provided
    IF v_requires_reason AND (p_reason IS NULL OR p_reason = '') THEN
        RETURN QUERY SELECT false, 
            format('Transition from %s to %s requires a reason', v_current_status, p_new_status)::TEXT;
        RETURN;
    END IF;
    
    -- All checks passed
    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_workflow_transition IS '21 CFR Part 11 §11.10(f) - Validates permitted sequencing of workflow steps';

-- =============================================================================
-- 5. Create trigger to log workflow transitions automatically
-- =============================================================================

CREATE OR REPLACE FUNCTION log_workflow_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- Only log if status actually changed
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO acc_workflow_transitions (
            workflow_task_id,
            from_status,
            to_status,
            user_id,
            username,
            transition_at
        ) VALUES (
            NEW.id,
            COALESCE(OLD.status, 'new'),
            NEW.status,
            NEW.completed_by, -- Use completed_by as the user who made the change
            NEW.created_by_username,
            NOW()
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on acc_workflow_tasks if table exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'acc_workflow_tasks') THEN
        DROP TRIGGER IF EXISTS trigger_log_workflow_transition ON acc_workflow_tasks;
        CREATE TRIGGER trigger_log_workflow_transition
            AFTER UPDATE ON acc_workflow_tasks
            FOR EACH ROW EXECUTE FUNCTION log_workflow_transition();
    END IF;
END $$;

-- =============================================================================
-- 6. Create EDC workflow status mapping view
-- =============================================================================

CREATE OR REPLACE VIEW v_edc_workflow_status AS
SELECT 
    wt.id as task_id,
    wt.title,
    wt.type as workflow_type,
    wt.status,
    wt.priority,
    wt.study_id,
    wt.event_crf_id,
    ec.status_id as crf_status_id,
    s.name as crf_status_name,
    ec.sdv_status,
    ec.completion_status_id,
    cs.name as completion_status_name,
    wt.created_at,
    wt.due_date,
    wt.completed_at,
    CASE 
        WHEN wt.status = 'completed' THEN 'Complete'
        WHEN wt.status = 'cancelled' THEN 'Cancelled'
        WHEN wt.due_date < NOW() AND wt.status NOT IN ('completed', 'cancelled') THEN 'Overdue'
        WHEN wt.status = 'awaiting_approval' THEN 'Pending Approval'
        WHEN wt.status = 'in_progress' THEN 'In Progress'
        ELSE 'Pending'
    END as display_status
FROM acc_workflow_tasks wt
LEFT JOIN event_crf ec ON wt.event_crf_id = ec.event_crf_id
LEFT JOIN status s ON ec.status_id = s.status_id
LEFT JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id;

COMMENT ON VIEW v_edc_workflow_status IS 'Combined view of workflow task status and CRF status for EDC dashboard';

-- =============================================================================
-- 7. Add indexes for efficient workflow queries
-- =============================================================================

-- Composite index for common workflow filters
CREATE INDEX IF NOT EXISTS idx_wf_tasks_study_status_type 
    ON acc_workflow_tasks(study_id, status, type);

-- Index for due date calculations
CREATE INDEX IF NOT EXISTS idx_wf_tasks_due_status 
    ON acc_workflow_tasks(due_date, status) 
    WHERE status NOT IN ('completed', 'cancelled');

-- Index for event_crf relationship
CREATE INDEX IF NOT EXISTS idx_wf_tasks_event_crf 
    ON acc_workflow_tasks(event_crf_id) 
    WHERE event_crf_id IS NOT NULL;

COMMIT;

-- =============================================================================
-- ROLLBACK SCRIPT (for reference)
-- =============================================================================
-- DROP VIEW IF EXISTS v_edc_workflow_status;
-- DROP TRIGGER IF EXISTS trigger_log_workflow_transition ON acc_workflow_tasks;
-- DROP FUNCTION IF EXISTS log_workflow_transition();
-- DROP FUNCTION IF EXISTS validate_workflow_transition(INTEGER, VARCHAR, INTEGER, TEXT);
-- DROP TABLE IF EXISTS acc_workflow_transition_rules;
-- DROP TABLE IF EXISTS acc_workflow_transitions;

