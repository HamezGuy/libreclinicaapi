-- Protocol Documents Storage
-- Stores uploaded Clinical Study Protocol PDFs for audit trail and re-processing.
-- Part of the Protocol-to-eCRF AI Pipeline feature.

CREATE TABLE IF NOT EXISTS acc_protocol_documents (
    id              SERIAL PRIMARY KEY,
    study_id        INTEGER REFERENCES study(study_id) ON DELETE SET NULL,
    filename        VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
    file_size       BIGINT NOT NULL,
    checksum_md5    VARCHAR(32),
    storage_path    VARCHAR(1000) NOT NULL,

    -- Pipeline results
    pipeline_status VARCHAR(50) NOT NULL DEFAULT 'uploaded',  -- uploaded, processing, completed, failed
    thread_id       VARCHAR(100),
    total_pages     INTEGER,
    total_forms_generated  INTEGER,
    total_rules_extracted  INTEGER,
    total_conflicts        INTEGER,

    -- The generated bundle JSON (stored for re-import without re-running pipeline)
    generated_bundle JSONB,

    -- Conflict log JSON (for review UI)
    conflict_log    JSONB,

    -- Audit fields (21 CFR Part 11)
    uploaded_by     INTEGER REFERENCES user_account(user_id),
    uploaded_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMP WITH TIME ZONE,
    deleted_at      TIMESTAMP WITH TIME ZONE,
    deleted_by      INTEGER REFERENCES user_account(user_id)
);

CREATE INDEX IF NOT EXISTS idx_acc_protocol_documents_study ON acc_protocol_documents(study_id);
CREATE INDEX IF NOT EXISTS idx_acc_protocol_documents_status ON acc_protocol_documents(pipeline_status);
