-- =============================================================================
-- Training Records for 21 CFR Part 11 §11.10(i) Compliance
-- Tracks user training completion and competency verification
-- 
-- HIPAA §164.308(a)(5) - Security awareness training
-- 21 CFR Part 11 §11.10(i) - Training documentation
-- =============================================================================

-- Training courses/modules table
CREATE TABLE IF NOT EXISTS training_courses (
    id SERIAL PRIMARY KEY,
    course_code VARCHAR(50) NOT NULL UNIQUE,
    course_name VARCHAR(200) NOT NULL,
    description TEXT,
    version VARCHAR(20) DEFAULT '1.0',
    duration_minutes INTEGER,
    passing_score INTEGER DEFAULT 80, -- Percentage required to pass
    required_for_roles TEXT[], -- Array of role names that require this course
    regulatory_reference VARCHAR(200), -- e.g., '21 CFR 11.10(i)', 'HIPAA'
    active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES user_account(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User training completion records
CREATE TABLE IF NOT EXISTS training_records (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES user_account(user_id),
    course_id INTEGER NOT NULL REFERENCES training_courses(id),
    status VARCHAR(20) NOT NULL DEFAULT 'not_started'
        CHECK (status IN ('not_started', 'in_progress', 'completed', 'expired')),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    score INTEGER, -- Percentage score if quiz taken
    attempts INTEGER DEFAULT 0,
    certificate_number VARCHAR(100),
    expiration_date TIMESTAMP WITH TIME ZONE,
    verified_by INTEGER REFERENCES user_account(user_id),
    verified_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, course_id) -- One record per user per course
);

-- Training quiz questions for competency assessments
CREATE TABLE IF NOT EXISTS training_quiz_questions (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES training_courses(id),
    question_text TEXT NOT NULL,
    question_type VARCHAR(20) DEFAULT 'multiple_choice'
        CHECK (question_type IN ('multiple_choice', 'true_false', 'multi_select')),
    options JSONB NOT NULL, -- Array of {text: string, isCorrect: boolean}
    explanation TEXT, -- Shown after answering
    order_index INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Quiz attempt records for audit trail
CREATE TABLE IF NOT EXISTS training_quiz_attempts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES user_account(user_id),
    course_id INTEGER NOT NULL REFERENCES training_courses(id),
    attempt_number INTEGER NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    answers JSONB, -- Array of {questionId, selectedOptions, correct}
    score INTEGER, -- Percentage
    passed BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default training courses for clinical trials
INSERT INTO training_courses (course_code, course_name, description, duration_minutes, regulatory_reference, required_for_roles)
VALUES 
    ('GCP-001', 'Good Clinical Practice (GCP) Fundamentals', 
     'Introduction to ICH E6(R2) Good Clinical Practice guidelines for clinical trials', 
     120, 'ICH E6(R2)', 
     ARRAY['clinical_research_coordinator', 'investigator', 'study_director', 'monitor']),
    
    ('PART11-001', '21 CFR Part 11 Electronic Records & Signatures', 
     'Understanding FDA requirements for electronic records and electronic signatures', 
     60, '21 CFR Part 11', 
     ARRAY['clinical_research_coordinator', 'investigator', 'data_specialist', 'study_director']),
    
    ('HIPAA-001', 'HIPAA Privacy and Security Training', 
     'Protecting patient health information in clinical research settings', 
     90, 'HIPAA §164.308(a)(5)', 
     ARRAY['clinical_research_coordinator', 'investigator', 'study_director', 'data_specialist', 'data_entry']),
    
    ('EDC-001', 'EDC System User Training', 
     'How to use the ElectronicDataCaptureReal system for data entry and management', 
     45, NULL, 
     ARRAY['clinical_research_coordinator', 'investigator', 'data_entry', 'monitor']),
    
    ('AE-001', 'Adverse Event Recognition and Reporting', 
     'Identifying, documenting, and reporting adverse events in clinical trials', 
     60, 'ICH E6(R2) §4.11', 
     ARRAY['clinical_research_coordinator', 'investigator']),
    
    ('SDV-001', 'Source Document Verification Training', 
     'Best practices for verifying CRF data against source documents', 
     45, 'ICH E6(R2) §5.18.4', 
     ARRAY['monitor']),
    
    ('ESIG-001', 'Electronic Signature Certification', 
     'Understanding the legal implications of electronic signatures', 
     30, '21 CFR Part 11 §11.100', 
     ARRAY['clinical_research_coordinator', 'investigator', 'study_director', 'monitor'])
ON CONFLICT (course_code) DO NOTHING;

-- Insert sample quiz questions for Part 11 course
INSERT INTO training_quiz_questions (course_id, question_text, question_type, options, explanation, order_index)
SELECT 
    tc.id,
    q.question_text,
    'multiple_choice',
    q.options::jsonb,
    q.explanation,
    q.order_index
FROM training_courses tc
CROSS JOIN (VALUES
    ('What are the two components required for a non-biometric electronic signature?',
     '[{"text": "Username and password", "isCorrect": true}, {"text": "Email and phone number", "isCorrect": false}, {"text": "Name and date of birth", "isCorrect": false}, {"text": "Employee ID and department", "isCorrect": false}]',
     '21 CFR Part 11 §11.200(a) requires at least two distinct identification components.',
     1),
    ('What information must be displayed with an electronic signature?',
     '[{"text": "Printed name, date/time, and meaning of signature", "isCorrect": true}, {"text": "Only the username", "isCorrect": false}, {"text": "IP address and browser type", "isCorrect": false}, {"text": "Password hash", "isCorrect": false}]',
     '21 CFR Part 11 §11.50 requires signature manifestations including name, date/time, and meaning.',
     2),
    ('How long must audit trails be retained?',
     '[{"text": "Throughout the record retention period", "isCorrect": true}, {"text": "30 days", "isCorrect": false}, {"text": "1 year", "isCorrect": false}, {"text": "Until the study ends", "isCorrect": false}]',
     '21 CFR Part 11 §11.10(e) requires audit trails for the entire retention period.',
     3),
    ('What is required before an individual can use electronic signatures?',
     '[{"text": "Identity verification", "isCorrect": true}, {"text": "Manager approval only", "isCorrect": false}, {"text": "IT department registration", "isCorrect": false}, {"text": "Nothing special is required", "isCorrect": false}]',
     '21 CFR Part 11 §11.100(b) requires identity verification before signature authority is granted.',
     4),
    ('What must happen when an authorized user leaves the organization?',
     '[{"text": "Their access must be promptly revoked", "isCorrect": true}, {"text": "Their signature can be transferred to a colleague", "isCorrect": false}, {"text": "Their records should be deleted", "isCorrect": false}, {"text": "Nothing needs to change", "isCorrect": false}]',
     '21 CFR Part 11 §11.300 requires controls to prevent unauthorized use of credentials.',
     5)
) AS q(question_text, options, explanation, order_index)
WHERE tc.course_code = 'PART11-001'
ON CONFLICT DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_training_records_user ON training_records(user_id);
CREATE INDEX IF NOT EXISTS idx_training_records_course ON training_records(course_id);
CREATE INDEX IF NOT EXISTS idx_training_records_status ON training_records(status);
CREATE INDEX IF NOT EXISTS idx_training_records_expiration ON training_records(expiration_date);
CREATE INDEX IF NOT EXISTS idx_training_quiz_attempts_user ON training_quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_training_quiz_questions_course ON training_quiz_questions(course_id);

-- Trigger for updated_at on training_courses
CREATE OR REPLACE FUNCTION update_training_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_training_courses_updated ON training_courses;
CREATE TRIGGER trigger_training_courses_updated
    BEFORE UPDATE ON training_courses
    FOR EACH ROW EXECUTE FUNCTION update_training_updated_at();

DROP TRIGGER IF EXISTS trigger_training_records_updated ON training_records;
CREATE TRIGGER trigger_training_records_updated
    BEFORE UPDATE ON training_records
    FOR EACH ROW EXECUTE FUNCTION update_training_updated_at();

-- Comments for documentation
COMMENT ON TABLE training_courses IS 'Training courses/modules required for compliance - 21 CFR Part 11 §11.10(i)';
COMMENT ON TABLE training_records IS 'User training completion records with certificates and expiration tracking';
COMMENT ON TABLE training_quiz_questions IS 'Quiz questions for competency assessment verification';
COMMENT ON TABLE training_quiz_attempts IS 'Audit trail of all quiz attempts for compliance documentation';

