DO $$
DECLARE
  diab_study_id INTEGER;
  card_study_id INTEGER;
  diab_arm_class_id INTEGER;
  card_arm_class_id INTEGER;
  diab_grp_treatment INTEGER;
  diab_grp_placebo INTEGER;
  card_grp_low INTEGER;
  card_grp_high INTEGER;
  card_grp_placebo INTEGER;
  subj_id INTEGER;
  i INTEGER;
BEGIN
  -- Create studies with required oc_oid
  INSERT INTO study (name, unique_identifier, oc_oid, status_id, owner_id, date_created, protocol_type, summary)
  VALUES ('Phase III Diabetes Trial', 'DIAB-001', 'S_DIAB001', 1, 1, CURRENT_DATE, 'interventional',
          'Randomized double-blind placebo-controlled Phase III trial');

  INSERT INTO study (name, unique_identifier, oc_oid, status_id, owner_id, date_created, protocol_type, summary)
  VALUES ('Cardiology Outcomes Study', 'CARD-002', 'S_CARD002', 1, 1, CURRENT_DATE, 'interventional',
          'Multi-center cardiovascular outcomes trial');

  SELECT study_id INTO diab_study_id FROM study WHERE unique_identifier = 'DIAB-001';
  SELECT study_id INTO card_study_id FROM study WHERE unique_identifier = 'CARD-002';

  RAISE NOTICE 'Diabetes study ID: %, Cardiology study ID: %', diab_study_id, card_study_id;

  -- Create study group classes (type 1 = Arm)
  INSERT INTO study_group_class (name, study_id, owner_id, date_created, group_class_type_id, status_id, subject_assignment)
  VALUES ('Treatment Arms', diab_study_id, 1, CURRENT_DATE, 1, 1, 'Randomized');
  INSERT INTO study_group_class (name, study_id, owner_id, date_created, group_class_type_id, status_id, subject_assignment)
  VALUES ('Treatment Arms', card_study_id, 1, CURRENT_DATE, 1, 1, 'Randomized');

  SELECT study_group_class_id INTO diab_arm_class_id FROM study_group_class WHERE study_id = diab_study_id LIMIT 1;
  SELECT study_group_class_id INTO card_arm_class_id FROM study_group_class WHERE study_id = card_study_id LIMIT 1;

  RAISE NOTICE 'Diab arm class: %, Card arm class: %', diab_arm_class_id, card_arm_class_id;

  -- Create study groups for Diabetes (2 arms: Treatment vs Placebo)
  INSERT INTO study_group (name, description, study_group_class_id)
  VALUES ('Active Treatment', 'Metformin 500mg BID', diab_arm_class_id);
  INSERT INTO study_group (name, description, study_group_class_id)
  VALUES ('Placebo', 'Matching placebo BID', diab_arm_class_id);

  -- Create study groups for Cardiology (3 arms: Low vs High vs Placebo)
  INSERT INTO study_group (name, description, study_group_class_id)
  VALUES ('Low Dose', 'Atorvastatin 10mg QD', card_arm_class_id);
  INSERT INTO study_group (name, description, study_group_class_id)
  VALUES ('High Dose', 'Atorvastatin 80mg QD', card_arm_class_id);
  INSERT INTO study_group (name, description, study_group_class_id)
  VALUES ('Placebo Control', 'Matching placebo QD', card_arm_class_id);

  SELECT study_group_id INTO diab_grp_treatment FROM study_group WHERE name = 'Active Treatment' AND study_group_class_id = diab_arm_class_id;
  SELECT study_group_id INTO diab_grp_placebo FROM study_group WHERE name = 'Placebo' AND study_group_class_id = diab_arm_class_id;
  SELECT study_group_id INTO card_grp_low FROM study_group WHERE name = 'Low Dose' AND study_group_class_id = card_arm_class_id;
  SELECT study_group_id INTO card_grp_high FROM study_group WHERE name = 'High Dose' AND study_group_class_id = card_arm_class_id;
  SELECT study_group_id INTO card_grp_placebo FROM study_group WHERE name = 'Placebo Control' AND study_group_class_id = card_arm_class_id;

  RAISE NOTICE 'Diab groups: treatment=%, placebo=%', diab_grp_treatment, diab_grp_placebo;
  RAISE NOTICE 'Card groups: low=%, high=%, placebo=%', card_grp_low, card_grp_high, card_grp_placebo;

  -- Create 20 subjects for Diabetes trial
  FOR i IN 1..20 LOOP
    INSERT INTO subject (status_id, date_of_birth, gender, unique_identifier, date_created, owner_id, dob_collected)
    VALUES (1,
            ('1960-01-01'::date + make_interval(days => i * 365)),
            CASE WHEN i % 2 = 0 THEN 'm' ELSE 'f' END,
            'SUBJ-DIAB-' || LPAD(i::text, 3, '0'), CURRENT_TIMESTAMP, 1, true);

    SELECT subject_id INTO subj_id FROM subject WHERE unique_identifier = 'SUBJ-DIAB-' || LPAD(i::text, 3, '0');

    INSERT INTO study_subject (label, subject_id, study_id, status_id, enrollment_date, date_created, owner_id, oc_oid)
    VALUES ('DIAB-' || LPAD(i::text, 3, '0'), subj_id, diab_study_id, 1, CURRENT_DATE, CURRENT_TIMESTAMP, 1,
            'SS_DIAB' || LPAD(i::text, 4, '0'));
  END LOOP;

  -- Create 15 subjects for Cardiology trial
  FOR i IN 1..15 LOOP
    INSERT INTO subject (status_id, date_of_birth, gender, unique_identifier, date_created, owner_id, dob_collected)
    VALUES (1,
            ('1955-06-15'::date + make_interval(days => i * 300)),
            CASE WHEN i % 3 = 0 THEN 'm' ELSE 'f' END,
            'SUBJ-CARD-' || LPAD(i::text, 3, '0'), CURRENT_TIMESTAMP, 1, true);

    SELECT subject_id INTO subj_id FROM subject WHERE unique_identifier = 'SUBJ-CARD-' || LPAD(i::text, 3, '0');

    INSERT INTO study_subject (label, subject_id, study_id, status_id, enrollment_date, date_created, owner_id, oc_oid)
    VALUES ('CARD-' || LPAD(i::text, 3, '0'), subj_id, card_study_id, 1, CURRENT_DATE, CURRENT_TIMESTAMP, 1,
            'SS_CARD' || LPAD(i::text, 4, '0'));
  END LOOP;

  RAISE NOTICE 'Test data population complete!';
END $$;
