-- =============================================================================
-- Workflow Tasks Table
-- Task management for clinical data workflows
-- 
-- Used by workflow.controller.ts and workflow.service.ts
-- =============================================================================

CREATE TABLE IF NOT EXISTS acc_workflow_tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL DEFAULT 'custom'
        CHECK (type IN ('data_entry', 'review', 'approval', 'signature', 'sdv', 'query', 'custom')),
    priority VARCHAR(20) NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    -- Status values aligned with frontend WorkflowStatus type for consistency
    -- pending, in_progress, awaiting_approval, approved, rejected, completed, cancelled, overdue, on_hold
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'awaiting_approval', 'approved', 'rejected', 'completed', 'cancelled', 'overdue', 'on_hold')),
    assigned_to TEXT[] DEFAULT ARRAY[]::TEXT[],
    due_date TIMESTAMP WITH TIME ZONE,
    study_id INTEGER REFERENCES study(study_id),
    entity_type VARCHAR(50),
    entity_id INTEGER,
    event_crf_id INTEGER REFERENCES event_crf(event_crf_id),
    requires_approval BOOLEAN DEFAULT false,
    requires_signature BOOLEAN DEFAULT false,
    created_by INTEGER REFERENCES user_account(user_id),
    created_by_username VARCHAR(100),
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by INTEGER REFERENCES user_account(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_status ON acc_workflow_tasks(status);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_priority ON acc_workflow_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_study ON acc_workflow_tasks(study_id);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_type ON acc_workflow_tasks(type);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_due_date ON acc_workflow_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_assigned ON acc_workflow_tasks USING GIN(assigned_to);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_created_at ON acc_workflow_tasks(created_at DESC);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_workflow_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_workflow_tasks_updated ON acc_workflow_tasks;
CREATE TRIGGER trigger_workflow_tasks_updated
    BEFORE UPDATE ON acc_workflow_tasks
    FOR EACH ROW EXECUTE FUNCTION update_workflow_tasks_updated_at();

-- Comments
COMMENT ON TABLE acc_workflow_tasks IS 'Task management for clinical data workflows';
COMMENT ON COLUMN acc_workflow_tasks.type IS 'Type of workflow: data_entry, review, approval, signature, sdv, query, custom';
COMMENT ON COLUMN acc_workflow_tasks.priority IS 'Task priority: low, medium, high, critical';
COMMENT ON COLUMN acc_workflow_tasks.status IS 'Task status: pending, in_progress, awaiting_approval, approved, rejected, completed, cancelled, overdue, on_hold';
COMMENT ON COLUMN acc_workflow_tasks.assigned_to IS 'Array of user IDs or usernames assigned to this task';

