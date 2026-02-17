SELECT jsonb_pretty(form_structure->'fields'->0) as first_field FROM patient_event_form WHERE patient_event_form_id = 138;
