-- Fix all sequences to be higher than current max values
SELECT setval('audit_log_event_audit_id_seq', COALESCE((SELECT MAX(audit_id) FROM audit_log_event), 1) + 100);
SELECT setval('audit_user_login_id_seq', COALESCE((SELECT MAX(id) FROM audit_user_login), 1) + 100);

