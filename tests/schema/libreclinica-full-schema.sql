--
-- PostgreSQL database dump
--

\restrict YTxmaFFkDkeeLPmIi1QrgYtaBtjcOaueSfngdv3WsgpQW8RiTaGx7txJZHhDS3S

-- Dumped from database version 14.20
-- Dumped by pg_dump version 14.20

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: event_crf_initial_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_crf_initial_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
			pk INTEGER;
			entity_name_value TEXT;
			
        BEGIN
            IF (TG_OP = 'INSERT') THEN
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Status';
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id )
		                    VALUES (pk, '41', now(), NEW.owner_id, 'event_crf', NEW.event_crf_id, entity_name_value,'2', NEW.status_id, NEW.event_crf_id );
				RETURN NULL;
            END IF;
        RETURN NULL;
        END;
        $$;


--
-- Name: event_crf_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_crf_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
			pk INTEGER;
			entity_name_value TEXT;
		BEGIN
			IF (TG_OP = 'UPDATE') THEN
				IF(OLD.status_id <> NEW.status_id) THEN
				/*---------------*/
				/*Event CRF status changed*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Status';

				IF(OLD.status_id = '1' AND NEW.status_id = '2') THEN
				    IF (NEW.electronic_signature_status) THEN
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id,study_event_id, event_crf_version_id )
		                    VALUES (pk, '14', now(), NEW.update_id, 'event_crf', NEW.event_crf_id, entity_name_value, OLD.status_id, NEW.status_id, NEW.event_crf_id, NEW.study_event_id ,NEW.crf_version_id);
		            ELSE
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id ,study_event_id, event_crf_version_id)
		                    VALUES (pk, '8', now(), NEW.update_id, 'event_crf', NEW.event_crf_id, entity_name_value, OLD.status_id, NEW.status_id, NEW.event_crf_id , NEW.study_event_id ,NEW.crf_version_id);
		            END IF;
				ELSIF (OLD.status_id = '1' AND NEW.status_id = '4') THEN
				    IF (NEW.electronic_signature_status) THEN
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id ,study_event_id, event_crf_version_id)
		                    VALUES (pk, '15', now(), NEW.update_id, 'event_crf', NEW.event_crf_id, entity_name_value, OLD.status_id, NEW.status_id, NEW.event_crf_id , NEW.study_event_id ,NEW.crf_version_id);
		            ELSE
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id ,study_event_id, event_crf_version_id)
		                    VALUES (pk, '10', now(), NEW.update_id, 'event_crf', NEW.event_crf_id, entity_name_value, OLD.status_id, NEW.status_id, NEW.event_crf_id , NEW.study_event_id ,NEW.crf_version_id);
		            END IF;
				ELSIF (OLD.status_id = '4' AND NEW.status_id = '2') THEN
		    		IF (NEW.electronic_signature_status) THEN
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id ,study_event_id, event_crf_version_id)
		                    VALUES (pk, '16', now(), NEW.update_id, 'event_crf', NEW.event_crf_id, entity_name_value, OLD.status_id, NEW.status_id, NEW.event_crf_id , NEW.study_event_id ,NEW.crf_version_id);
				    ELSE
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id ,study_event_id, event_crf_version_id)
		                    VALUES (pk, '11', now(), NEW.update_id, 'event_crf', NEW.event_crf_id, entity_name_value, OLD.status_id, NEW.status_id, NEW.event_crf_id , NEW.study_event_id ,NEW.crf_version_id);
				    END IF;
                 				ELSIF ( NEW.status_id = '11') THEN
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id ,study_event_id, event_crf_version_id)
		                    VALUES (pk, '40', now(), NEW.update_id, 'event_crf', NEW.event_crf_id, entity_name_value, OLD.status_id, NEW.status_id, NEW.event_crf_id , NEW.study_event_id ,NEW.crf_version_id);

				END IF;
				/*---------------*/
				END IF;

				IF(OLD.date_interviewed <> NEW.date_interviewed) THEN
				/*---------------*/
				/*Event CRF date interviewed*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Date interviewed';
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id ,study_event_id, event_crf_version_id)
					VALUES (pk, '9', now(), NEW.update_id, 'event_crf', NEW.event_crf_id, entity_name_value, OLD.date_interviewed, NEW.date_interviewed, NEW.event_crf_id , NEW.study_event_id ,NEW.crf_version_id);
				/*---------------*/
				END IF;

				IF((OLD.interviewer_name <> NEW.interviewer_name) AND (OLD.interviewer_name <> '')) THEN
				/*---------------*/
				/*Event CRF interviewer name*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Interviewer Name';
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id ,study_event_id, event_crf_version_id)
					VALUES (pk, '9', now(), NEW.update_id, 'event_crf', NEW.event_crf_id, entity_name_value, OLD.interviewer_name, NEW.interviewer_name, NEW.event_crf_id , NEW.study_event_id ,NEW.crf_version_id);
				/*---------------*/
				END IF;

				IF(OLD.sdv_status <> NEW.sdv_status) THEN
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'EventCRF SDV Status';
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id ,study_event_id, event_crf_version_id)
					VALUES (pk, '32', now(), NEW.sdv_update_id, 'event_crf', NEW.event_crf_id, entity_name_value, (select case when OLD.sdv_status is true then 'TRUE' else 'FALSE' end),
					(select case when NEW.sdv_status is true then 'TRUE' else 'FALSE' end), NEW.event_crf_id , NEW.study_event_id ,NEW.crf_version_id);
				/*---------------*/
				END IF;
			RETURN NULL;  /*return values ignored for 'after' triggers*/
			END IF;
		END;
		$$;


--
-- Name: event_crf_version_change_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_crf_version_change_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
			pk INTEGER;
			crf_old_name TEXT;
			crf_new_name TEXT;
			
		BEGIN
			IF (TG_OP = 'UPDATE') THEN
				IF(OLD.crf_version_id <> NEW.crf_version_id) THEN
				 /*---------------*/

				    SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				   SELECT INTO crf_old_name cf.name FROM crf_version cf WHERE cf.crf_version_id = OLD.crf_version_id;
				    SELECT INTO crf_new_name cf.name FROM crf_version cf WHERE cf.crf_version_id = NEW.crf_version_id;
				    
				    
				    
				    
					INSERT INTO audit_log_event(  
					audit_id, 
					audit_date,  
					audit_table,  
					user_id ,
					entity_id ,
					entity_name ,
					audit_log_event_type_id ,
					old_value ,
					new_value ,
					event_crf_id ,
					study_event_id
					 )
				
					VALUES (
					pk, 
					now(),
					'event_crf',
					NEW.update_id,
					OLD.event_crf_id, 
					'CRF version',
					'33',
					crf_old_name, 
					crf_new_name,
					OLD.event_crf_id,
					OLD.study_event_id
					);
				/*---------------*/
				END IF;
				RETURN NULL;  /*return values ignored for 'after' triggers*/
			END IF;
		RETURN NULL;  /*return values ignored for 'after' triggers*/
		END;
		$$;


--
-- Name: event_definition_crf_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_definition_crf_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
            pk INTEGER;
            se_id INTEGER;
            cv_id INTEGER;
            entity_name_value TEXT;
            BEGIN
                IF (TG_OP = 'UPDATE') THEN
                    IF(OLD.status_id <> NEW.status_id) THEN
                        /*---------------*/
                        /*Event CRF status changed*/
                        SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
                        SELECT INTO entity_name_value 'Status';
                        IF(NEW.status_id = '5') THEN
                            SELECT INTO se_id se.study_event_id FROM study_event se WHERE se.study_event_definition_id = NEW.study_event_definition_id;
                            SELECT INTO cv_id ec.crf_version_id FROM event_crf ec, study_event se WHERE se.study_event_definition_id = NEW.study_event_definition_id and ec.study_event_id = se.study_event_id;

                            INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, study_event_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id, event_crf_version_id)
                                        VALUES (pk, '13',se_id, now(), NEW.update_id, 'event_definition_crf', NEW.event_definition_crf_id, entity_name_value, OLD.status_id, NEW.status_id, NEW.event_definition_crf_id, cv_id);
                        END IF;
                    END IF;
                    RETURN NULL;  /*return values ignored for 'after' triggers*/
                END IF;
            END;
        $$;


--
-- Name: fix_duplicates_in_study_defs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fix_duplicates_in_study_defs() RETURNS void
    LANGUAGE plpgsql
    AS $$DECLARE
		    maxOrdinal INTEGER DEFAULT 1;
		    mviews RECORD;
		    mviews2 RECORD;
		
		    BEGIN
			FOR mviews2 in select ordinal, count(*) as cnt from study_event_definition sed group by ordinal
				LOOP
				IF mviews2.cnt > 1 THEN
		
					FOR mviews in select study_event_definition_id as sid from study_event_definition sed order by sed.study_event_definition_id
						LOOP
						UPDATE study_event_definition set ordinal = maxOrdinal where study_event_definition_id = mviews.sid;
						
						maxOrdinal := maxOrdinal + 1;
			
						END LOOP;
					EXIT;
				END IF;
				END LOOP;
		    END;
		    $$;


--
-- Name: fix_rule_referencing_cross_study(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fix_rule_referencing_cross_study() RETURNS void
    LANGUAGE plpgsql
    AS $$DECLARE
		    
		     newExpressionId INTEGER DEFAULT 0;
		     newRuleId INTEGER DEFAULT 0;
		     mviews RECORD;
		
		    BEGIN
		
		    FOR mviews in select r.rule_expression_id as rrule_expression_id, rs.study_id as rsstudy_id, rsr.rule_id as rsrrule_id, rsr.id as rsrid  from rule_set rs, rule r,rule_set_rule rsr where  rsr.rule_set_id = rs.id and rule_id = r.id and  rs.study_id != r.study_id 
		    LOOP
		        newExpressionId := NEXTVAL('rule_expression_id_seq');
		        newRuleId := NEXTVAL('rule_id_seq');
		        INSERT INTO rule_expression select newExpressionId,value,context,owner_id,date_created,date_updated,update_id,status_id,0 from rule_expression where id = mviews.rrule_expression_id;
		        INSERT INTO rule SELECT newRuleId,name,description,oc_oid,enabled,newExpressionId,owner_id,date_created,date_updated,update_id,status_id,0,mviews.rsstudy_id FROM rule WHERE id = mviews.rsrrule_id ;
		        UPDATE rule_set_rule rsr set rule_id = newRuleId where rsr.id = mviews.rsrid;
		    END LOOP;
		
		    END;
		    $$;


--
-- Name: global_subject_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.global_subject_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
			pk INTEGER;
			entity_name_value TEXT;
		BEGIN
			IF (TG_OP = 'INSERT') THEN
				/*---------------*/
				 /*Subject created*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id)
					VALUES (pk, '5', now(), NEW.owner_id, 'subject', NEW.subject_id);
				RETURN NULL; /*return values ignored for 'after' triggers*/
				/*---------------*/
			ELSIF (TG_OP = 'UPDATE') THEN
				IF(OLD.status_id <> NEW.status_id) THEN
				/*---------------*/
				 /*Subject status changed*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Status';
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
					VALUES (pk, '6', now(), NEW.update_id, 'subject', NEW.subject_id, entity_name_value, OLD.status_id, NEW.status_id);
				/*---------------*/
				END IF;
		
				IF(OLD.unique_identifier <> NEW.unique_identifier) THEN
				/*---------------*/
				/*Subject value changed*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Person ID';
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
					VALUES (pk, '7', now(), NEW.update_id, 'subject', NEW.subject_id, entity_name_value, OLD.unique_identifier, NEW.unique_identifier);
				/*---------------*/
				END IF;
		
				IF(OLD.date_of_birth <> NEW.date_of_birth) THEN
				/*---------------*/
				 /*Subject value changed*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Date of Birth';
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
					VALUES (pk, '7', now(), NEW.update_id, 'subject', NEW.subject_id, entity_name_value, OLD.date_of_birth, NEW.date_of_birth);
				/*---------------*/
				END IF;
		
		        IF(OLD.gender <> NEW.gender) THEN
		   		/*---------------*/
		   		/*Subject value changed*/
		   		SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
		   		SELECT INTO entity_name_value 'Gender';
		   		INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
				VALUES (pk, '7', now(), NEW.update_id, 'subject', NEW.subject_id, entity_name_value, OLD.gender, NEW.gender);
		   		/*---------------*/
		   		END IF;
				
			RETURN NULL;  /*return values ignored for 'after' triggers*/
			END IF;
		END;
		$$;


--
-- Name: item_data_initial_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.item_data_initial_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
            pk INTEGER;
            entity_name_value TEXT;
            std_evnt_id INTEGER;
            crf_version_id INTEGER;
        BEGIN
            IF (TG_OP = 'INSERT' and length(NEW.value)>0) THEN
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value item.name FROM item WHERE item.item_id = NEW.item_id;
		        SELECT INTO std_evnt_id ec.study_event_id FROM event_crf ec WHERE ec.event_crf_id = NEW.event_crf_id;
		        SELECT INTO crf_version_id ec.crf_version_id FROM event_crf ec WHERE ec.event_crf_id = NEW.event_crf_id;
		        INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, reason_for_change, new_value, event_crf_id, study_event_id, event_crf_version_id ,item_data_repeat_key)
		                VALUES (pk, '1', now(), NEW.owner_id, 'item_data', NEW.item_data_id, entity_name_value, 'initial value', NEW.value, NEW.event_crf_id, std_evnt_id, crf_version_id , NEW.ordinal);
				RETURN NULL;
            END IF;
        RETURN NULL;
        END;
        $$;


--
-- Name: item_data_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.item_data_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
            pk INTEGER;
            entity_name_value TEXT;
            status INTEGER;
            std_evnt_id INTEGER;
            crf_version_id INTEGER;
        BEGIN
                SELECT INTO status status_id FROM event_crf WHERE event_crf_id = OLD.event_crf_id;
                SELECT INTO std_evnt_id ec.study_event_id FROM event_crf ec WHERE ec.event_crf_id = OLD.event_crf_id;
                SELECT INTO crf_version_id ec.crf_version_id FROM event_crf ec WHERE ec.event_crf_id = OLD.event_crf_id;
        
            IF (TG_OP = 'DELETE') THEN
                /*---------------*/
                 /*Item data deleted (by deleting an event crf)*/
                SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
                SELECT INTO entity_name_value item.name FROM item WHERE item.item_id = OLD.item_id;
                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, event_crf_id, study_event_id, event_crf_version_id)
                        VALUES (pk, '13', now(), OLD.update_id, 'item_data', OLD.item_data_id, entity_name_value, OLD.value, OLD.event_crf_id, std_evnt_id, crf_version_id);
                RETURN NULL; --return values ignored for 'after' triggers
            ELSIF (TG_OP = 'UPDATE') THEN
        
                IF(OLD.value <> NEW.value and status=11) THEN
                /*---------------*/
                 /*Item data updated*/
                SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
                SELECT INTO entity_name_value item.name FROM item WHERE item.item_id = NEW.item_id;
                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id ,study_event_id, event_crf_version_id,item_data_repeat_key)
                    VALUES (pk, '13', now(), NEW.update_id, 'item_data', NEW.item_data_id, entity_name_value, OLD.value, NEW.value, NEW.event_crf_id ,std_evnt_id, crf_version_id , NEW.ordinal);
                DELETE FROM rule_action_run_log where item_data_id = NEW.item_data_id;  
                /*---------------*/
                ELSEIF(OLD.value <> NEW.value) THEN
                /*---------------*/
                 /*Item data updated*/
                SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
                SELECT INTO entity_name_value item.name FROM item WHERE item.item_id = NEW.item_id;
                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value, event_crf_id,study_event_id, event_crf_version_id,item_data_repeat_key)
                    VALUES (pk, '1', now(), NEW.update_id, 'item_data', NEW.item_data_id, entity_name_value, OLD.value, NEW.value, NEW.event_crf_id,std_evnt_id, crf_version_id , NEW.ordinal);
                DELETE FROM rule_action_run_log where item_data_id = NEW.item_data_id;  
                /*---------------*/
                END IF;
                RETURN NULL;  /*return values ignored for 'after' triggers*/
            END IF;
        RETURN NULL;  /*return values ignored for 'after' triggers*/
        END;
        $$;


--
-- Name: populate_ssid_in_didm_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.populate_ssid_in_didm_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            update dn_item_data_map  set study_subject_id = 
            (
                select DISTINCT se.study_subject_id from study_event se, event_crf ec, item_data id where 
                id.event_crf_id = ec.event_crf_id and ec.study_event_id = se.study_event_id and id.item_data_id = dn_item_data_map.item_data_id
            ) where study_subject_id is null;
        RETURN NULL;    
        END;
        $$;


--
-- Name: repeating_item_data_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repeating_item_data_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
		 pk INTEGER;
		 entity_name_value TEXT;
		 std_evnt_id INTEGER;
		 crf_version_id INTEGER;
		 validator_id INTEGER;
		 event_crf_status_id INTEGER;
		
		
		BEGIN
		 IF (TG_OP = 'INSERT') THEN
		  /*---------------*/ 
		  SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
		  SELECT INTO entity_name_value item.name FROM item WHERE item.item_id = NEW.item_id;
		        SELECT INTO std_evnt_id ec.study_event_id FROM event_crf ec WHERE ec.event_crf_id = NEW.event_crf_id;
		        SELECT INTO crf_version_id ec.crf_version_id FROM event_crf ec WHERE ec.event_crf_id = NEW.event_crf_id;
		 SELECT INTO validator_id ec.validator_id FROM event_crf ec WHERE ec.event_crf_id = NEW.event_crf_id;
		 SELECT INTO event_crf_status_id ec.status_id FROM event_crf ec WHERE ec.event_crf_id = NEW.event_crf_id;
		 
		        IF (NEW.status_id = '2' AND NEW.ordinal > 1 AND validator_id > 0 AND event_crf_status_id  = '4') THEN  /*DDE*/
		          
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, new_value, event_crf_id, study_event_id, event_crf_version_id)
		                VALUES (pk, '30', now(), NEW.owner_id, 'item_data', NEW.item_data_id, entity_name_value, NEW.value, NEW.event_crf_id, std_evnt_id, crf_version_id);
		        ELSE 
		          IF(NEW.status_id ='2' AND NEW.ordinal > 1  AND event_crf_status_id  = '2') THEN /*ADE*/
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, new_value, event_crf_id, study_event_id, event_crf_version_id)
		                VALUES (pk, '30', now(), NEW.owner_id, 'item_data', NEW.item_data_id, entity_name_value, NEW.value, NEW.event_crf_id, std_evnt_id, crf_version_id);
		          END IF;
		       END IF;
		  RETURN NULL;  /*return values ignored for 'after' triggers*/
		 
		 END IF;
		RETURN NULL;  /*return values ignored for 'after' triggers*/
		END; $$;


--
-- Name: study_event_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.study_event_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
            pk INTEGER;
        BEGIN
            IF (TG_OP = 'INSERT') THEN
                SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
                IF(NEW.subject_event_status_id = '1') THEN
                    INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                    VALUES (pk, '17', now(), NEW.owner_id, 'study_event', NEW.study_event_id, 'Status','0', NEW.subject_event_status_id);
                END IF;
            END IF;
        
            IF (TG_OP = 'UPDATE') THEN
                IF(OLD.subject_event_status_id <> NEW.subject_event_status_id) THEN
                    SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
                    IF(NEW.subject_event_status_id = '1') THEN
                        INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                        VALUES (pk, '17', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
                    ELSIF(NEW.subject_event_status_id = '3') THEN
                        INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                        VALUES (pk, '18', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
                    ELSIF(NEW.subject_event_status_id = '4') THEN
                        INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                        VALUES (pk, '19', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
                    ELSIF(NEW.subject_event_status_id = '5') THEN
                        INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                        VALUES (pk, '20', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
                    ELSIF(NEW.subject_event_status_id = '6') THEN
                        INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                        VALUES (pk, '21', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
                    ELSIF(NEW.subject_event_status_id = '7') THEN
                        INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                        VALUES (pk, '22', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
                    ELSIF(NEW.subject_event_status_id = '8') THEN
                        INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                        VALUES (pk, '31', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
                    END IF;
                END IF;
                IF(OLD.status_id <> NEW.status_id) THEN
                    IF(NEW.status_id = '5' or NEW.status_id = '1') THEN
                        SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
                        INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                        VALUES (pk, '23', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.status_id, NEW.status_id);
                    END IF;
                END IF;
                IF(OLD.date_start <> NEW.date_start) THEN
                    SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
                    INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                    VALUES (pk, '24', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Start date', OLD.date_start, NEW.date_start);
                END IF;
                IF(OLD.date_end <> NEW.date_end) THEN
                    SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
                    INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                    VALUES (pk, '25', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'End date', OLD.date_end, NEW.date_end);
                END IF;
                IF(OLD.location <> NEW.location) THEN
                    SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
                    INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
                    VALUES (pk, '26', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Location', OLD.location, NEW.location);
                END IF;
                RETURN NULL;  /*return values ignored for 'after' triggers*/
            END IF;
            RETURN NULL;
        END;$$;


--
-- Name: study_event_trigger_new(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.study_event_trigger_new() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
			pk INTEGER;
		BEGIN
			IF (TG_OP = 'INSERT') THEN
		        SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
		        IF(NEW.subject_event_status_id = '1') THEN
		            INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		            VALUES (pk, '17', now(), NEW.owner_id, 'study_event', NEW.study_event_id, 'Status','0', NEW.subject_event_status_id);
		        END IF;
		    END IF;
		
			IF (TG_OP = 'UPDATE') THEN
				IF(OLD.subject_event_status_id <> NEW.subject_event_status_id) THEN
		            SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
		            IF(NEW.subject_event_status_id = '1') THEN
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		                VALUES (pk, '17', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
		            ELSIF(NEW.subject_event_status_id = '3') THEN
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		                VALUES (pk, '18', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
		            ELSIF(NEW.subject_event_status_id = '4') THEN
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		                VALUES (pk, '19', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
		            ELSIF(NEW.subject_event_status_id = '5') THEN
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		                VALUES (pk, '20', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
		            ELSIF(NEW.subject_event_status_id = '6') THEN
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		                VALUES (pk, '21', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
		            ELSIF(NEW.subject_event_status_id = '7') THEN
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		                VALUES (pk, '22', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
		            ELSIF(NEW.subject_event_status_id = '8') THEN
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		                VALUES (pk, '31', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.subject_event_status_id, NEW.subject_event_status_id);
				    END IF;
			    END IF;
		        IF(OLD.status_id <> NEW.status_id) THEN
		            IF(NEW.status_id = '5' and OLD.status_id = '1') THEN
		                SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		                VALUES (pk, '23', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.status_id, NEW.status_id);
		            END IF;
		            IF(OLD.status_id = '5' and NEW.status_id = '1') THEN
		                SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
		                INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		                VALUES (pk, '35', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Status', OLD.status_id, NEW.status_id);
		            END IF;
		        END IF;
		        IF(OLD.date_start <> NEW.date_start) THEN
		            SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
		            INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		            VALUES (pk, '24', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Start date', OLD.date_start, NEW.date_start);
		        END IF;
		        IF(OLD.date_end <> NEW.date_end) THEN
		            SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
		            INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		            VALUES (pk, '25', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'End date', OLD.date_end, NEW.date_end);
		        END IF;
		        IF(OLD.location <> NEW.location) THEN
		            SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
		            INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		            VALUES (pk, '26', now(), NEW.update_id, 'study_event', NEW.study_event_id, 'Location', OLD.location, NEW.location);
		        END IF;
		    	RETURN NULL;  /*return values ignored for 'after' triggers*/
			END IF;
			RETURN NULL;
		END;$$;


--
-- Name: study_subject_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.study_subject_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
			pk INTEGER;
			entity_name_value TEXT;
		    old_unique_identifier TEXT;
		    new_unique_identifier TEXT;
		
		BEGIN
			IF (TG_OP = 'INSERT') THEN
				/*---------------*/
				 /*Study subject created*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id)
					VALUES (pk, '2', now(), NEW.owner_id, 'study_subject', NEW.study_subject_id);
				RETURN NULL; /*return values ignored for 'after' triggers*/
				/*---------------*/
			ELSIF (TG_OP = 'UPDATE') THEN
				IF(OLD.status_id <> NEW.status_id) THEN
				 /*---------------*/
				/*Study subject status changed*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Status';
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
					VALUES (pk, '3', now(), NEW.update_id, 'study_subject', NEW.study_subject_id, entity_name_value, OLD.status_id, NEW.status_id);
				/*---------------*/
				END IF;
		
				IF(OLD.label <> NEW.label) THEN
				/*---------------*/
				 /*Study subject value changed*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Study Subject ID';
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
					VALUES (pk, '4', now(), NEW.update_id, 'study_subject', NEW.study_subject_id, entity_name_value, OLD.label, NEW.label);
				/*---------------*/
				END IF;
		
				IF(OLD.secondary_label <> NEW.secondary_label) THEN
				/*---------------*/
				/*Study subject value changed*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Secondary Subject ID';
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
					VALUES (pk, '4', now(), NEW.update_id, 'study_subject', NEW.study_subject_id, entity_name_value, OLD.secondary_label, NEW.secondary_label);
				/*---------------*/
				END IF;
		
				IF(OLD.enrollment_date <> NEW.enrollment_date) THEN
				/*---------------*/
				/*Study subject value changed*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Enrollment Date';
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
					VALUES (pk, '4', now(), NEW.update_id, 'study_subject', NEW.study_subject_id, entity_name_value, OLD.enrollment_date, NEW.enrollment_date);
				 /*---------------*/
				END IF;

				IF(OLD.time_zone <> NEW.time_zone) THEN
				/*---------------*/
				/*Study subject value changed*/
				SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
				SELECT INTO entity_name_value 'Time Zone';
				INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
					VALUES (pk, '4', now(), NEW.update_id, 'study_subject', NEW.study_subject_id, entity_name_value, OLD.time_zone, NEW.time_zone);
				 /*---------------*/
				END IF;

	
		        IF(OLD.study_id <> NEW.study_id) THEN
		         /*---------------*/
		         /*Subject reassigned*/
		        SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
		        SELECT INTO entity_name_value 'Study id';
		        SELECT INTO old_unique_identifier study.unique_identifier FROM study study WHERE study.study_id = OLD.study_id;
		        SELECT INTO new_unique_identifier study.unique_identifier FROM study study WHERE study.study_id = NEW.study_id;
		        INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
		            VALUES (pk, '27', now(), NEW.update_id, 'study_subject', NEW.study_subject_id, entity_name_value, old_unique_identifier, new_unique_identifier);
		        /*---------------*/
		        END IF;
		
				RETURN NULL;  /*return values ignored for 'after' triggers*/
			END IF;
		END;
		$$;


--
-- Name: subject_group_assignment_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.subject_group_assignment_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
            pk INTEGER;
            group_name TEXT;
            old_group_name TEXT;
            new_group_name TEXT;
            study_group_class_name TEXT;
            BEGIN
            IF (TG_OP = 'INSERT') THEN
            SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
            SELECT INTO group_name sg.name FROM study_group sg WHERE sg.study_group_id = NEW.study_group_id;
            SELECT INTO study_group_class_name sgc.name FROM study_group sg join study_group_class sgc ON sg.study_group_class_id = sgc.study_group_class_id WHERE sg.study_group_id = NEW.study_group_id ;
            INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
            VALUES (pk, '28', now(), NEW.owner_id, 'subject_group_map', NEW.study_subject_id, study_group_class_name,'', group_name);
            END IF;
            IF (TG_OP = 'UPDATE') THEN
            IF(OLD.study_group_id <> NEW.study_group_id) THEN
            SELECT INTO pk NEXTVAL('audit_log_event_audit_id_seq');
            SELECT INTO old_group_name sg.name FROM study_group sg WHERE sg.study_group_id = OLD.study_group_id;
            SELECT INTO new_group_name sg.name FROM study_group sg WHERE sg.study_group_id = NEW.study_group_id;
            SELECT INTO study_group_class_name sgc.name FROM study_group sg join study_group_class sgc ON sg.study_group_class_id = sgc.study_group_class_id WHERE sg.study_group_id = NEW.study_group_id ;
            INSERT INTO audit_log_event(audit_id, audit_log_event_type_id, audit_date, user_id, audit_table, entity_id, entity_name, old_value, new_value)
            VALUES (pk, '29', now(), NEW.update_id, 'subject_group_map', NEW.study_subject_id, study_group_class_name,old_group_name, new_group_name);
            END IF;
            RETURN NULL;  /*return values ignored for 'after' triggers*/
            END IF;
            RETURN NULL;
            END;$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: archived_dataset_file; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.archived_dataset_file (
    archived_dataset_file_id integer NOT NULL,
    name character varying(255),
    dataset_id integer,
    export_format_id integer,
    file_reference character varying(1000),
    run_time integer,
    file_size integer,
    date_created timestamp(6) without time zone,
    owner_id integer
);


--
-- Name: archived_dataset_file_archived_dataset_file_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.archived_dataset_file_archived_dataset_file_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: archived_dataset_file_archived_dataset_file_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.archived_dataset_file_archived_dataset_file_id_seq OWNED BY public.archived_dataset_file.archived_dataset_file_id;


--
-- Name: audit_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_event (
    audit_id integer NOT NULL,
    audit_date timestamp without time zone NOT NULL,
    audit_table character varying(500) NOT NULL,
    user_id integer,
    entity_id integer,
    reason_for_change character varying(1000),
    action_message character varying(4000)
);


--
-- Name: audit_event_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_event_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_event_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_event_audit_id_seq OWNED BY public.audit_event.audit_id;


--
-- Name: audit_event_context; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_event_context (
    audit_id integer,
    study_id integer,
    subject_id integer,
    study_subject_id integer,
    role_name character varying(200),
    event_crf_id integer,
    study_event_id integer,
    study_event_definition_id integer,
    crf_id integer,
    crf_version_id integer,
    study_crf_id integer,
    item_id integer
);


--
-- Name: audit_event_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_event_values (
    audit_id integer,
    column_name character varying(255),
    old_value character varying(2000),
    new_value character varying(2000)
);


--
-- Name: audit_log_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log_event (
    audit_id integer NOT NULL,
    audit_date timestamp without time zone NOT NULL,
    audit_table character varying(500) NOT NULL,
    user_id integer,
    entity_id integer,
    entity_name character varying(500),
    reason_for_change character varying(1000),
    audit_log_event_type_id integer,
    old_value character varying(4000),
    new_value character varying(4000),
    event_crf_id integer,
    study_event_id integer,
    event_crf_version_id integer,
    item_data_repeat_key character varying(4000)
);


--
-- Name: audit_log_event_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_event_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_event_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_event_audit_id_seq OWNED BY public.audit_log_event.audit_id;


--
-- Name: audit_log_event_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log_event_type (
    audit_log_event_type_id integer NOT NULL,
    name character varying(255)
);


--
-- Name: audit_log_event_type_audit_log_event_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_event_type_audit_log_event_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_event_type_audit_log_event_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_event_type_audit_log_event_type_id_seq OWNED BY public.audit_log_event_type.audit_log_event_type_id;


--
-- Name: audit_user_api_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_user_api_log (
    id integer NOT NULL,
    audit_id character varying(36) NOT NULL,
    user_id integer,
    username character varying(255) NOT NULL,
    user_role character varying(50),
    http_method character varying(10) NOT NULL,
    endpoint_path character varying(500) NOT NULL,
    query_params text,
    request_body text,
    response_status integer,
    ip_address character varying(45),
    user_agent text,
    duration_ms integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_user_api_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_user_api_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_user_api_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_user_api_log_id_seq OWNED BY public.audit_user_api_log.id;


--
-- Name: audit_user_login; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_user_login (
    id integer NOT NULL,
    user_name character varying(255),
    user_account_id integer,
    login_attempt_date timestamp without time zone,
    login_status_code integer,
    version integer,
    details character varying(255)
);


--
-- Name: audit_user_login_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_user_login_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_user_login_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_user_login_id_seq OWNED BY public.audit_user_login.id;


--
-- Name: authorities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.authorities (
    id integer NOT NULL,
    username character varying(64) NOT NULL,
    authority character varying(50) NOT NULL,
    version integer
);


--
-- Name: authorities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.authorities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: authorities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.authorities_id_seq OWNED BY public.authorities.id;


--
-- Name: completion_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.completion_status (
    completion_status_id integer NOT NULL,
    status_id integer,
    name character varying(255),
    description character varying(1000)
);


--
-- Name: completion_status_completion_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.completion_status_completion_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: completion_status_completion_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.completion_status_completion_status_id_seq OWNED BY public.completion_status.completion_status_id;


--
-- Name: configuration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configuration (
    id integer NOT NULL,
    key character varying(255),
    value character varying(255),
    description character varying(512),
    version integer
);


--
-- Name: configuration_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.configuration_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: configuration_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.configuration_id_seq OWNED BY public.configuration.id;


--
-- Name: crf; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crf (
    crf_id integer NOT NULL,
    status_id integer,
    name character varying(255),
    description character varying(2048),
    owner_id integer,
    date_created date,
    date_updated date,
    update_id integer,
    oc_oid character varying(40) NOT NULL,
    source_study_id integer
);


--
-- Name: crf_crf_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crf_crf_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crf_crf_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crf_crf_id_seq OWNED BY public.crf.crf_id;


--
-- Name: crf_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crf_version (
    crf_version_id integer NOT NULL,
    crf_id integer NOT NULL,
    name character varying(255),
    description character varying(4000),
    revision_notes character varying(255),
    status_id integer,
    date_created date,
    date_updated date,
    owner_id integer,
    update_id integer,
    oc_oid character varying(40) NOT NULL,
    xform text,
    xform_name character varying(255)
);


--
-- Name: crf_version_crf_version_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crf_version_crf_version_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crf_version_crf_version_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crf_version_crf_version_id_seq OWNED BY public.crf_version.crf_version_id;


--
-- Name: crf_version_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crf_version_media (
    crf_version_media_id integer NOT NULL,
    crf_version_id integer NOT NULL,
    name character varying(255) NOT NULL,
    path character varying(4000) NOT NULL
);


--
-- Name: crf_version_media_crf_version_media_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crf_version_media_crf_version_media_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crf_version_media_crf_version_media_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crf_version_media_crf_version_media_id_seq OWNED BY public.crf_version_media.crf_version_media_id;


--
-- Name: databasechangelog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.databasechangelog (
    id character varying(255) NOT NULL,
    author character varying(255) NOT NULL,
    filename character varying(255) NOT NULL,
    dateexecuted timestamp without time zone NOT NULL,
    orderexecuted integer NOT NULL,
    exectype character varying(10) NOT NULL,
    md5sum character varying(35),
    description character varying(255),
    comments character varying(255),
    tag character varying(255),
    liquibase character varying(20),
    contexts character varying(255),
    labels character varying(255),
    deployment_id character varying(10)
);


--
-- Name: databasechangeloglock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.databasechangeloglock (
    id integer NOT NULL,
    locked boolean NOT NULL,
    lockgranted timestamp without time zone,
    lockedby character varying(255)
);


--
-- Name: dataset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dataset (
    dataset_id integer NOT NULL,
    study_id integer,
    status_id integer,
    name character varying(255),
    description character varying(2000),
    sql_statement text,
    num_runs integer,
    date_start date,
    date_end date,
    date_created date,
    date_updated date,
    date_last_run date,
    owner_id integer,
    approver_id integer,
    update_id integer,
    show_event_location boolean DEFAULT false,
    show_event_start boolean DEFAULT false,
    show_event_end boolean DEFAULT false,
    show_subject_dob boolean DEFAULT false,
    show_subject_gender boolean DEFAULT false,
    show_event_status boolean DEFAULT false,
    show_subject_status boolean DEFAULT false,
    show_subject_unique_id boolean DEFAULT false,
    show_subject_age_at_event boolean DEFAULT false,
    show_crf_status boolean DEFAULT false,
    show_crf_version boolean DEFAULT false,
    show_crf_int_name boolean DEFAULT false,
    show_crf_int_date boolean DEFAULT false,
    show_group_info boolean DEFAULT false,
    show_disc_info boolean DEFAULT false,
    odm_metadataversion_name character varying(255),
    odm_metadataversion_oid character varying(255),
    odm_prior_study_oid character varying(255),
    odm_prior_metadataversion_oid character varying(255),
    show_secondary_id boolean DEFAULT false,
    dataset_item_status_id integer
);


--
-- Name: dataset_crf_version_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dataset_crf_version_map (
    dataset_id integer,
    event_definition_crf_id integer
);


--
-- Name: dataset_dataset_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dataset_dataset_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dataset_dataset_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dataset_dataset_id_seq OWNED BY public.dataset.dataset_id;


--
-- Name: dataset_filter_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dataset_filter_map (
    dataset_id integer,
    filter_id integer,
    ordinal integer
);


--
-- Name: dataset_item_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dataset_item_status (
    dataset_item_status_id integer NOT NULL,
    name character varying(50),
    description character varying(255)
);


--
-- Name: dataset_item_status_dataset_item_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dataset_item_status_dataset_item_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dataset_item_status_dataset_item_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dataset_item_status_dataset_item_status_id_seq OWNED BY public.dataset_item_status.dataset_item_status_id;


--
-- Name: dataset_study_group_class_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dataset_study_group_class_map (
    dataset_id integer NOT NULL,
    study_group_class_id integer NOT NULL
);


--
-- Name: dc_computed_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dc_computed_event (
    dc_summary_event_id integer NOT NULL,
    dc_event_id integer NOT NULL,
    item_target_id integer,
    summary_type character varying(255)
);


--
-- Name: dc_computed_event_dc_summary_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dc_computed_event_dc_summary_event_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dc_computed_event_dc_summary_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dc_computed_event_dc_summary_event_id_seq OWNED BY public.dc_computed_event.dc_summary_event_id;


--
-- Name: dc_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dc_event (
    dc_event_id integer NOT NULL,
    decision_condition_id integer,
    ordinal integer NOT NULL,
    type character varying(256) NOT NULL
);


--
-- Name: dc_event_dc_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dc_event_dc_event_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dc_event_dc_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dc_event_dc_event_id_seq OWNED BY public.dc_event.dc_event_id;


--
-- Name: dc_primitive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dc_primitive (
    dc_primitive_id integer NOT NULL,
    decision_condition_id integer,
    item_id integer,
    dynamic_value_item_id integer,
    comparison character varying(3) NOT NULL,
    constant_value character varying(4000)
);


--
-- Name: dc_primitive_dc_primitive_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dc_primitive_dc_primitive_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dc_primitive_dc_primitive_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dc_primitive_dc_primitive_id_seq OWNED BY public.dc_primitive.dc_primitive_id;


--
-- Name: dc_section_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dc_section_event (
    dc_event_id integer NOT NULL,
    section_id integer NOT NULL
);


--
-- Name: dc_section_event_dc_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dc_section_event_dc_event_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dc_section_event_dc_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dc_section_event_dc_event_id_seq OWNED BY public.dc_section_event.dc_event_id;


--
-- Name: dc_send_email_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dc_send_email_event (
    dc_event_id integer NOT NULL,
    to_address character varying(1000) NOT NULL,
    subject character varying(1000),
    body character varying(4000)
);


--
-- Name: dc_send_email_event_dc_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dc_send_email_event_dc_event_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dc_send_email_event_dc_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dc_send_email_event_dc_event_id_seq OWNED BY public.dc_send_email_event.dc_event_id;


--
-- Name: dc_substitution_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dc_substitution_event (
    dc_event_id integer NOT NULL,
    item_id integer,
    value character varying(1000) NOT NULL
);


--
-- Name: dc_substitution_event_dc_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dc_substitution_event_dc_event_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dc_substitution_event_dc_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dc_substitution_event_dc_event_id_seq OWNED BY public.dc_substitution_event.dc_event_id;


--
-- Name: dc_summary_item_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dc_summary_item_map (
    dc_summary_event_id integer,
    item_id integer,
    ordinal integer
);


--
-- Name: decision_condition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_condition (
    decision_condition_id integer NOT NULL,
    crf_version_id integer,
    status_id integer,
    label character varying(1000) NOT NULL,
    comments character varying(3000) NOT NULL,
    quantity integer NOT NULL,
    type character varying(3) NOT NULL,
    owner_id integer,
    date_created date,
    date_updated date,
    update_id integer
);


--
-- Name: decision_condition_decision_condition_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.decision_condition_decision_condition_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: decision_condition_decision_condition_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.decision_condition_decision_condition_id_seq OWNED BY public.decision_condition.decision_condition_id;


--
-- Name: discrepancy_note; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discrepancy_note (
    discrepancy_note_id integer NOT NULL,
    description character varying(2040),
    discrepancy_note_type_id integer,
    resolution_status_id integer,
    detailed_notes character varying(1000),
    date_created timestamp with time zone,
    owner_id integer,
    parent_dn_id integer,
    entity_type character varying(30),
    study_id integer,
    assigned_user_id integer
);


--
-- Name: discrepancy_note_discrepancy_note_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.discrepancy_note_discrepancy_note_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: discrepancy_note_discrepancy_note_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.discrepancy_note_discrepancy_note_id_seq OWNED BY public.discrepancy_note.discrepancy_note_id;


--
-- Name: discrepancy_note_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discrepancy_note_type (
    discrepancy_note_type_id integer NOT NULL,
    name character varying(50),
    description character varying(255)
);


--
-- Name: discrepancy_note_type_discrepancy_note_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.discrepancy_note_type_discrepancy_note_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: discrepancy_note_type_discrepancy_note_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.discrepancy_note_type_discrepancy_note_type_id_seq OWNED BY public.discrepancy_note_type.discrepancy_note_type_id;


--
-- Name: dn_age_days; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.dn_age_days AS
 SELECT dn.discrepancy_note_id,
        CASE
            WHEN (dn.resolution_status_id = ANY (ARRAY[1, 2, 3])) THEN date_part('day'::text, (CURRENT_TIMESTAMP - ( SELECT cdn.date_created
               FROM public.discrepancy_note cdn
              WHERE (cdn.discrepancy_note_id = ( SELECT max(idn.discrepancy_note_id) AS max
                       FROM public.discrepancy_note idn
                      WHERE (idn.parent_dn_id = dn.discrepancy_note_id))))))
            ELSE (NULL::integer)::double precision
        END AS days,
        CASE
            WHEN (dn.resolution_status_id = 4) THEN date_part('day'::text, (( SELECT cdn.date_created
               FROM public.discrepancy_note cdn
              WHERE (cdn.discrepancy_note_id = ( SELECT max(idn.discrepancy_note_id) AS max
                       FROM public.discrepancy_note idn
                      WHERE (idn.parent_dn_id = dn.discrepancy_note_id)))) - dn.date_created))
            WHEN (dn.resolution_status_id = ANY (ARRAY[1, 2, 3])) THEN date_part('day'::text, (CURRENT_TIMESTAMP - dn.date_created))
            ELSE (NULL::integer)::double precision
        END AS age
   FROM public.discrepancy_note dn
  WHERE (dn.parent_dn_id IS NULL);


--
-- Name: dn_event_crf_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dn_event_crf_map (
    event_crf_id integer,
    discrepancy_note_id integer,
    column_name character varying(255)
);


--
-- Name: dn_item_data_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dn_item_data_map (
    item_data_id integer,
    discrepancy_note_id integer,
    column_name character varying(255),
    study_subject_id integer,
    activated boolean DEFAULT true
);


--
-- Name: dn_study_event_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dn_study_event_map (
    study_event_id integer,
    discrepancy_note_id integer,
    column_name character varying(255)
);


--
-- Name: dn_study_subject_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dn_study_subject_map (
    study_subject_id integer,
    discrepancy_note_id integer,
    column_name character varying(255)
);


--
-- Name: dn_subject_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dn_subject_map (
    subject_id integer,
    discrepancy_note_id integer,
    column_name character varying(255)
);


--
-- Name: dyn_item_form_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dyn_item_form_metadata (
    id integer NOT NULL,
    item_form_metadata_id integer,
    item_id integer,
    crf_version_id integer,
    show_item boolean DEFAULT true,
    event_crf_id integer,
    version integer,
    item_data_id integer,
    passed_dde integer DEFAULT 0
);


--
-- Name: dyn_item_form_metadata_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dyn_item_form_metadata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dyn_item_form_metadata_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dyn_item_form_metadata_id_seq OWNED BY public.dyn_item_form_metadata.id;


--
-- Name: dyn_item_group_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dyn_item_group_metadata (
    id integer NOT NULL,
    item_group_metadata_id integer,
    item_group_id integer,
    show_group boolean DEFAULT true,
    event_crf_id integer,
    version integer,
    passed_dde integer DEFAULT 0
);


--
-- Name: dyn_item_group_metadata_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dyn_item_group_metadata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dyn_item_group_metadata_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dyn_item_group_metadata_id_seq OWNED BY public.dyn_item_group_metadata.id;


--
-- Name: event_crf; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_crf (
    event_crf_id integer NOT NULL,
    study_event_id integer,
    crf_version_id integer,
    date_interviewed date,
    interviewer_name character varying(255),
    completion_status_id integer,
    status_id integer,
    annotations character varying(4000),
    date_completed timestamp without time zone,
    validator_id integer,
    date_validate date,
    date_validate_completed timestamp without time zone,
    validator_annotations character varying(4000),
    validate_string character varying(256),
    owner_id integer,
    date_created timestamp with time zone,
    study_subject_id integer,
    date_updated timestamp with time zone,
    update_id integer,
    electronic_signature_status boolean DEFAULT false,
    sdv_status boolean DEFAULT false NOT NULL,
    old_status_id integer DEFAULT 1,
    sdv_update_id integer DEFAULT 0
);


--
-- Name: event_crf_event_crf_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_crf_event_crf_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_crf_event_crf_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_crf_event_crf_id_seq OWNED BY public.event_crf.event_crf_id;


--
-- Name: event_crf_flag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_crf_flag (
    id integer NOT NULL,
    path character varying(255),
    tag_id integer,
    flag_workflow_id integer,
    owner_id integer,
    update_id integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: event_crf_flag_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_crf_flag_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_crf_flag_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_crf_flag_id_seq OWNED BY public.event_crf_flag.id;


--
-- Name: event_crf_flag_workflow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_crf_flag_workflow (
    id integer NOT NULL,
    workflow_id character varying(255),
    workflow_status character varying(255),
    owner_id integer,
    update_id integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: event_crf_flag_workflow_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_crf_flag_workflow_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_crf_flag_workflow_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_crf_flag_workflow_id_seq OWNED BY public.event_crf_flag_workflow.id;


--
-- Name: event_definition_crf; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_definition_crf (
    event_definition_crf_id integer NOT NULL,
    study_event_definition_id integer,
    study_id integer,
    crf_id integer,
    required_crf boolean,
    double_entry boolean,
    require_all_text_filled boolean,
    decision_conditions boolean,
    null_values character varying(255),
    default_version_id integer,
    status_id integer,
    owner_id integer,
    date_created date,
    date_updated date,
    update_id integer,
    ordinal integer,
    electronic_signature boolean DEFAULT false,
    hide_crf boolean DEFAULT false,
    source_data_verification_code integer,
    selected_version_ids character varying(150),
    parent_id integer,
    participant_form boolean DEFAULT false,
    allow_anonymous_submission boolean DEFAULT false,
    submission_url character varying(255)
);


--
-- Name: event_definition_crf_event_definition_crf_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_definition_crf_event_definition_crf_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_definition_crf_event_definition_crf_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_definition_crf_event_definition_crf_id_seq OWNED BY public.event_definition_crf.event_definition_crf_id;


--
-- Name: event_definition_crf_item_tag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_definition_crf_item_tag (
    id integer NOT NULL,
    path character varying(255),
    tag_id integer,
    active boolean,
    owner_id integer,
    update_id integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: event_definition_crf_item_tag_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_definition_crf_item_tag_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_definition_crf_item_tag_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_definition_crf_item_tag_id_seq OWNED BY public.event_definition_crf_item_tag.id;


--
-- Name: event_definition_crf_tag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_definition_crf_tag (
    id integer NOT NULL,
    path character varying(255),
    tag_id integer,
    active boolean,
    owner_id integer,
    update_id integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: event_definition_crf_tag_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_definition_crf_tag_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_definition_crf_tag_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_definition_crf_tag_id_seq OWNED BY public.event_definition_crf_tag.id;


--
-- Name: export_format; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.export_format (
    export_format_id integer NOT NULL,
    name character varying(255),
    description character varying(1000),
    mime_type character varying(255)
);


--
-- Name: export_format_export_format_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.export_format_export_format_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: export_format_export_format_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.export_format_export_format_id_seq OWNED BY public.export_format.export_format_id;


--
-- Name: filter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.filter (
    filter_id integer NOT NULL,
    name character varying(255),
    description character varying(2000),
    sql_statement text,
    status_id integer,
    date_created date,
    date_updated date,
    owner_id integer NOT NULL,
    update_id integer
);


--
-- Name: filter_crf_version_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.filter_crf_version_map (
    filter_id integer,
    crf_version_id integer
);


--
-- Name: filter_filter_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.filter_filter_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: filter_filter_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.filter_filter_id_seq OWNED BY public.filter.filter_id;


--
-- Name: group_class_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_class_types (
    group_class_type_id integer NOT NULL,
    name character varying(255),
    description character varying(1000)
);


--
-- Name: group_class_types_group_class_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.group_class_types_group_class_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: group_class_types_group_class_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.group_class_types_group_class_type_id_seq OWNED BY public.group_class_types.group_class_type_id;


--
-- Name: item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item (
    item_id integer NOT NULL,
    name character varying(255),
    description character varying(4000),
    units character varying(64),
    phi_status boolean,
    item_data_type_id integer,
    item_reference_type_id integer,
    status_id integer,
    owner_id integer,
    date_created date,
    date_updated date,
    update_id integer,
    oc_oid character varying(40) NOT NULL
);


--
-- Name: item_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_data (
    item_data_id integer NOT NULL,
    item_id integer NOT NULL,
    event_crf_id integer,
    status_id integer,
    value character varying(4000),
    date_created date,
    date_updated date,
    owner_id integer,
    update_id integer,
    ordinal integer,
    old_status_id integer,
    deleted boolean DEFAULT false
);


--
-- Name: item_data_flag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_data_flag (
    id integer NOT NULL,
    path character varying(255),
    tag_id integer,
    flag_workflow_id integer,
    owner_id integer,
    update_id integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: item_data_flag_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_data_flag_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_data_flag_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_data_flag_id_seq OWNED BY public.item_data_flag.id;


--
-- Name: item_data_flag_workflow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_data_flag_workflow (
    id integer NOT NULL,
    workflow_id character varying(255),
    workflow_status character varying(255),
    owner_id integer,
    update_id integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: item_data_flag_workflow_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_data_flag_workflow_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_data_flag_workflow_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_data_flag_workflow_id_seq OWNED BY public.item_data_flag_workflow.id;


--
-- Name: item_data_item_data_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_data_item_data_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_data_item_data_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_data_item_data_id_seq OWNED BY public.item_data.item_data_id;


--
-- Name: item_data_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_data_type (
    item_data_type_id integer NOT NULL,
    code character varying(20),
    name character varying(255),
    definition character varying(1000),
    reference character varying(1000)
);


--
-- Name: item_data_type_item_data_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_data_type_item_data_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_data_type_item_data_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_data_type_item_data_type_id_seq OWNED BY public.item_data_type.item_data_type_id;


--
-- Name: item_form_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_form_metadata (
    item_form_metadata_id integer NOT NULL,
    item_id integer NOT NULL,
    crf_version_id integer,
    header character varying(2000),
    subheader character varying(240),
    parent_id integer,
    parent_label character varying(120),
    column_number integer,
    page_number_label character varying(5),
    question_number_label character varying(20),
    left_item_text character varying(4000),
    right_item_text character varying(2000),
    section_id integer NOT NULL,
    decision_condition_id integer,
    response_set_id integer NOT NULL,
    regexp character varying(1000),
    regexp_error_msg character varying(255),
    ordinal integer NOT NULL,
    required boolean,
    default_value character varying(4000),
    response_layout character varying(255),
    width_decimal character varying(10),
    show_item boolean DEFAULT true
);


--
-- Name: item_form_metadata_item_form_metadata_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_form_metadata_item_form_metadata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_form_metadata_item_form_metadata_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_form_metadata_item_form_metadata_id_seq OWNED BY public.item_form_metadata.item_form_metadata_id;


--
-- Name: item_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_group (
    item_group_id integer NOT NULL,
    name character varying(255),
    crf_id integer NOT NULL,
    status_id integer,
    date_created date,
    date_updated date,
    owner_id integer,
    update_id integer,
    oc_oid character varying(40) NOT NULL
);


--
-- Name: item_group_item_group_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_group_item_group_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_group_item_group_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_group_item_group_id_seq OWNED BY public.item_group.item_group_id;


--
-- Name: item_group_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_group_metadata (
    item_group_metadata_id integer NOT NULL,
    item_group_id integer NOT NULL,
    header character varying(255),
    subheader character varying(255),
    layout character varying(100),
    repeat_number integer,
    repeat_max integer,
    repeat_array character varying(255),
    row_start_number integer,
    crf_version_id integer NOT NULL,
    item_id integer NOT NULL,
    ordinal integer NOT NULL,
    borders integer,
    show_group boolean DEFAULT true,
    repeating_group boolean DEFAULT true NOT NULL
);


--
-- Name: item_group_metadata_item_group_metadata_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_group_metadata_item_group_metadata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_group_metadata_item_group_metadata_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_group_metadata_item_group_metadata_id_seq OWNED BY public.item_group_metadata.item_group_metadata_id;


--
-- Name: item_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_item_id_seq OWNED BY public.item.item_id;


--
-- Name: item_reference_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_reference_type (
    item_reference_type_id integer NOT NULL,
    name character varying(255),
    description character varying(1000)
);


--
-- Name: item_reference_type_item_reference_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_reference_type_item_reference_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_reference_type_item_reference_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_reference_type_item_reference_type_id_seq OWNED BY public.item_reference_type.item_reference_type_id;


--
-- Name: measurement_unit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_unit (
    id integer NOT NULL,
    oc_oid character varying(40) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(255),
    version integer
);


--
-- Name: measurement_unit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.measurement_unit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: measurement_unit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.measurement_unit_id_seq OWNED BY public.measurement_unit.id;


--
-- Name: null_value_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.null_value_type (
    null_value_type_id integer NOT NULL,
    code character varying(20),
    name character varying(255),
    definition character varying(1000),
    reference character varying(1000)
);


--
-- Name: null_value_type_null_value_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.null_value_type_null_value_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: null_value_type_null_value_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.null_value_type_null_value_type_id_seq OWNED BY public.null_value_type.null_value_type_id;


--
-- Name: oc_qrtz_blob_triggers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_blob_triggers (
    trigger_name character varying(200) NOT NULL,
    trigger_group character varying(200) NOT NULL,
    blob_data bytea
);


--
-- Name: oc_qrtz_calendars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_calendars (
    calendar_name character varying(200) NOT NULL,
    sched_name character varying(120) DEFAULT 'TestScheduler'::character varying NOT NULL,
    calendar bytea
);


--
-- Name: oc_qrtz_cron_triggers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_cron_triggers (
    trigger_name character varying(200) NOT NULL,
    trigger_group character varying(200) NOT NULL,
    cron_expression character varying(120) NOT NULL,
    time_zone_id character varying(80),
    sched_name character varying(120) DEFAULT 'TestScheduler'::character varying NOT NULL
);


--
-- Name: oc_qrtz_fired_triggers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_fired_triggers (
    entry_id character varying(95) NOT NULL,
    trigger_name character varying(200) NOT NULL,
    trigger_group character varying(200) NOT NULL,
    instance_name character varying(200) NOT NULL,
    fired_time bigint NOT NULL,
    priority integer NOT NULL,
    state character varying(16) NOT NULL,
    job_name character varying(200),
    job_group character varying(200),
    is_stateful boolean,
    requests_recovery boolean,
    sched_name character varying(120) DEFAULT 'TestScheduler'::character varying NOT NULL,
    is_nonconcurrent boolean,
    is_update_data boolean,
    sched_time bigint NOT NULL
);


--
-- Name: oc_qrtz_job_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_job_details (
    job_name character varying(200) NOT NULL,
    job_group character varying(200) NOT NULL,
    description character varying(250),
    job_class_name character varying(250) NOT NULL,
    is_durable boolean NOT NULL,
    requests_recovery boolean NOT NULL,
    sched_name character varying(120) DEFAULT 'TestScheduler'::character varying NOT NULL,
    is_nonconcurrent boolean,
    is_update_data boolean,
    job_data bytea
);


--
-- Name: oc_qrtz_job_listeners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_job_listeners (
    job_name character varying(200) NOT NULL,
    job_group character varying(200) NOT NULL,
    job_listener character varying(200) NOT NULL
);


--
-- Name: oc_qrtz_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_locks (
    lock_name character varying(40) NOT NULL,
    sched_name character varying(120) DEFAULT 'TestScheduler'::character varying NOT NULL
);


--
-- Name: oc_qrtz_paused_trigger_grps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_paused_trigger_grps (
    trigger_group character varying(200) NOT NULL,
    sched_name character varying(120) DEFAULT 'TestScheduler'::character varying NOT NULL
);


--
-- Name: oc_qrtz_scheduler_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_scheduler_state (
    instance_name character varying(200) NOT NULL,
    last_checkin_time bigint NOT NULL,
    checkin_interval bigint NOT NULL,
    sched_name character varying(120) DEFAULT 'TestScheduler'::character varying NOT NULL
);


--
-- Name: oc_qrtz_simple_triggers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_simple_triggers (
    trigger_name character varying(200) NOT NULL,
    trigger_group character varying(200) NOT NULL,
    repeat_count bigint NOT NULL,
    repeat_interval bigint NOT NULL,
    times_triggered bigint NOT NULL,
    sched_name character varying(120) DEFAULT 'TestScheduler'::character varying NOT NULL
);


--
-- Name: oc_qrtz_trigger_listeners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_trigger_listeners (
    trigger_name character varying(200) NOT NULL,
    trigger_group character varying(200) NOT NULL,
    trigger_listener character varying(200) NOT NULL
);


--
-- Name: oc_qrtz_triggers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oc_qrtz_triggers (
    trigger_name character varying(200) NOT NULL,
    trigger_group character varying(200) NOT NULL,
    job_name character varying(200) NOT NULL,
    job_group character varying(200) NOT NULL,
    description character varying(250),
    next_fire_time bigint,
    prev_fire_time bigint,
    priority integer,
    trigger_state character varying(16) NOT NULL,
    trigger_type character varying(8) NOT NULL,
    start_time bigint NOT NULL,
    end_time bigint,
    calendar_name character varying(200),
    misfire_instr smallint,
    sched_name character varying(120) DEFAULT 'TestScheduler'::character varying NOT NULL,
    job_data bytea
);


--
-- Name: openclinica_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.openclinica_version (
    id integer NOT NULL,
    name character varying(255),
    build_number character varying(1000),
    version integer,
    update_timestamp timestamp without time zone
);


--
-- Name: openclinica_version_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.openclinica_version_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: openclinica_version_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.openclinica_version_id_seq OWNED BY public.openclinica_version.id;


--
-- Name: privilege; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.privilege (
    priv_id integer NOT NULL,
    priv_name character varying(50),
    priv_desc character varying(2000)
);


--
-- Name: privilege_priv_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.privilege_priv_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: privilege_priv_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.privilege_priv_id_seq OWNED BY public.privilege.priv_id;


--
-- Name: resolution_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resolution_status (
    resolution_status_id integer NOT NULL,
    name character varying(50),
    description character varying(255)
);


--
-- Name: resolution_status_resolution_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.resolution_status_resolution_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: resolution_status_resolution_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.resolution_status_resolution_status_id_seq OWNED BY public.resolution_status.resolution_status_id;


--
-- Name: response_set; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.response_set (
    response_set_id integer NOT NULL,
    response_type_id integer,
    label character varying(80),
    options_text character varying(4000),
    options_values character varying(4000),
    version_id integer
);


--
-- Name: response_set_response_set_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.response_set_response_set_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: response_set_response_set_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.response_set_response_set_id_seq OWNED BY public.response_set.response_set_id;


--
-- Name: response_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.response_type (
    response_type_id integer NOT NULL,
    name character varying(255),
    description character varying(1000)
);


--
-- Name: response_type_response_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.response_type_response_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: response_type_response_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.response_type_response_type_id_seq OWNED BY public.response_type.response_type_id;


--
-- Name: role_privilege_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_privilege_map (
    role_id integer NOT NULL,
    priv_id integer NOT NULL,
    priv_value character varying(50)
);


--
-- Name: rule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule (
    id integer NOT NULL,
    name character varying(255),
    description character varying(255),
    oc_oid character varying(40),
    enabled boolean,
    rule_expression_id integer NOT NULL,
    owner_id integer,
    date_created date,
    date_updated date,
    update_id integer,
    status_id integer,
    version integer,
    study_id integer
);


--
-- Name: rule_action; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule_action (
    id integer NOT NULL,
    rule_set_rule_id integer NOT NULL,
    action_type integer NOT NULL,
    expression_evaluates_to boolean NOT NULL,
    message character varying(2040),
    email_to character varying(255),
    owner_id integer,
    date_created date,
    date_updated date,
    update_id integer,
    status_id integer,
    version integer,
    rule_action_run_id integer,
    oc_oid_reference character varying(4000),
    email_subject character varying(1020)
);


--
-- Name: rule_action_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rule_action_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rule_action_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rule_action_id_seq OWNED BY public.rule_action.id;


--
-- Name: rule_action_property; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule_action_property (
    id integer NOT NULL,
    rule_action_id integer,
    oc_oid character varying(512),
    value character varying(512),
    version integer,
    rule_expression_id integer,
    property character varying(4000)
);


--
-- Name: rule_action_property_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rule_action_property_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rule_action_property_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rule_action_property_id_seq OWNED BY public.rule_action_property.id;


--
-- Name: rule_action_run; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule_action_run (
    id integer NOT NULL,
    administrative_data_entry boolean,
    initial_data_entry boolean,
    double_data_entry boolean,
    import_data_entry boolean,
    batch boolean,
    version integer,
    not_started boolean,
    scheduled boolean,
    data_entry_started boolean,
    complete boolean,
    skipped boolean,
    stopped boolean
);


--
-- Name: rule_action_run_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rule_action_run_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rule_action_run_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rule_action_run_id_seq OWNED BY public.rule_action_run.id;


--
-- Name: rule_action_run_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule_action_run_log (
    id integer NOT NULL,
    action_type integer,
    item_data_id integer,
    value character varying(4000),
    rule_oc_oid character varying(40),
    version integer
);


--
-- Name: rule_action_run_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rule_action_run_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rule_action_run_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rule_action_run_log_id_seq OWNED BY public.rule_action_run_log.id;


--
-- Name: rule_action_stratification_factor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule_action_stratification_factor (
    id integer NOT NULL,
    rule_action_id integer,
    version integer,
    rule_expression_id integer
);


--
-- Name: rule_action_stratification_factor_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rule_action_stratification_factor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rule_action_stratification_factor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rule_action_stratification_factor_id_seq OWNED BY public.rule_action_stratification_factor.id;


--
-- Name: rule_expression; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule_expression (
    id integer NOT NULL,
    value character varying(2040) NOT NULL,
    context integer NOT NULL,
    owner_id integer,
    date_created date,
    date_updated date,
    update_id integer,
    status_id integer,
    version integer
);


--
-- Name: rule_expression_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rule_expression_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rule_expression_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rule_expression_id_seq OWNED BY public.rule_expression.id;


--
-- Name: rule_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rule_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rule_id_seq OWNED BY public.rule.id;


--
-- Name: rule_set; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule_set (
    id integer NOT NULL,
    rule_expression_id integer NOT NULL,
    study_event_definition_id integer,
    crf_id integer,
    crf_version_id integer,
    study_id integer NOT NULL,
    owner_id integer,
    date_created date,
    date_updated date,
    update_id integer,
    status_id integer,
    version integer,
    item_id integer,
    item_group_id integer,
    run_schedule boolean DEFAULT false,
    run_time character varying(255)
);


--
-- Name: rule_set_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule_set_audit (
    id integer NOT NULL,
    rule_set_id integer NOT NULL,
    date_updated date,
    updater_id integer,
    status_id integer,
    version integer
);


--
-- Name: rule_set_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rule_set_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rule_set_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rule_set_audit_id_seq OWNED BY public.rule_set_audit.id;


--
-- Name: rule_set_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rule_set_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rule_set_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rule_set_id_seq OWNED BY public.rule_set.id;


--
-- Name: rule_set_rule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule_set_rule (
    id integer NOT NULL,
    rule_set_id integer NOT NULL,
    rule_id integer NOT NULL,
    owner_id integer,
    date_created date,
    date_updated date,
    update_id integer,
    status_id integer,
    version integer
);


--
-- Name: rule_set_rule_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule_set_rule_audit (
    id integer NOT NULL,
    rule_set_rule_id integer NOT NULL,
    date_updated date,
    updater_id integer,
    status_id integer,
    version integer
);


--
-- Name: rule_set_rule_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rule_set_rule_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rule_set_rule_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rule_set_rule_audit_id_seq OWNED BY public.rule_set_rule_audit.id;


--
-- Name: rule_set_rule_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rule_set_rule_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rule_set_rule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rule_set_rule_id_seq OWNED BY public.rule_set_rule.id;


--
-- Name: scd_item_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scd_item_metadata (
    id integer NOT NULL,
    scd_item_form_metadata_id integer,
    control_item_form_metadata_id integer,
    control_item_name character varying(255),
    option_value character varying(500),
    message character varying(3000),
    version integer
);


--
-- Name: scd_item_metadata_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scd_item_metadata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scd_item_metadata_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scd_item_metadata_id_seq OWNED BY public.scd_item_metadata.id;


--
-- Name: section; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.section (
    section_id integer NOT NULL,
    crf_version_id integer NOT NULL,
    status_id integer,
    label character varying(2000),
    title character varying(2000),
    subtitle character varying(2000),
    instructions character varying(2000),
    page_number_label character varying(5),
    ordinal integer,
    parent_id integer,
    date_created date,
    date_updated date,
    owner_id integer NOT NULL,
    update_id integer,
    borders integer
);


--
-- Name: section_section_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.section_section_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: section_section_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.section_section_id_seq OWNED BY public.section.section_id;


--
-- Name: status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status (
    status_id integer NOT NULL,
    name character varying(255),
    description character varying(1000)
);


--
-- Name: status_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.status_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: status_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.status_status_id_seq OWNED BY public.status.status_id;


--
-- Name: study; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study (
    study_id integer NOT NULL,
    parent_study_id integer,
    unique_identifier character varying(30),
    secondary_identifier character varying(255),
    name character varying(255),
    summary character varying(255),
    date_planned_start date,
    date_planned_end date,
    date_created date,
    date_updated date,
    owner_id integer,
    update_id integer,
    type_id integer,
    status_id integer,
    principal_investigator character varying(255),
    facility_name character varying(255),
    facility_city character varying(255),
    facility_address character varying(1000),
    facility_state character varying(20),
    facility_zip character varying(64),
    facility_country character varying(64),
    facility_recruitment_status character varying(60),
    facility_contact_name character varying(255),
    facility_contact_degree character varying(255),
    facility_contact_phone character varying(255),
    facility_contact_email character varying(255),
    protocol_type character varying(30),
    protocol_description character varying(1000),
    protocol_date_verification date,
    phase character varying(30),
    expected_total_enrollment integer,
    sponsor character varying(255),
    collaborators character varying(1000),
    medline_identifier character varying(255),
    url character varying(255),
    url_description character varying(255),
    conditions character varying(500),
    keywords character varying(255),
    eligibility character varying(500),
    gender character varying(30),
    age_max character varying(3),
    age_min character varying(3),
    healthy_volunteer_accepted boolean,
    purpose character varying(64),
    allocation character varying(64),
    masking character varying(30),
    control character varying(30),
    assignment character varying(30),
    endpoint character varying(64),
    interventions character varying(1000),
    duration character varying(30),
    selection character varying(30),
    timing character varying(30),
    official_title character varying(255),
    results_reference boolean,
    oc_oid character varying(40) NOT NULL,
    old_status_id integer DEFAULT 1,
    mail_notification character varying(255) DEFAULT 'DISABLED'::character varying NOT NULL,
    contact_email character varying(255)
);


--
-- Name: study_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_event (
    study_event_id integer NOT NULL,
    study_event_definition_id integer,
    study_subject_id integer,
    location character varying(2000),
    sample_ordinal integer,
    date_start timestamp without time zone,
    date_end timestamp without time zone,
    owner_id integer,
    status_id integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    update_id integer,
    subject_event_status_id integer,
    start_time_flag boolean,
    end_time_flag boolean,
    scheduled_date timestamp with time zone,
    is_unscheduled boolean DEFAULT false
);


--
-- Name: study_event_definition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_event_definition (
    study_event_definition_id integer NOT NULL,
    study_id integer,
    name character varying(2000),
    description character varying(2000),
    repeating boolean,
    type character varying(20),
    category character varying(2000),
    owner_id integer,
    status_id integer,
    date_created date,
    date_updated date,
    update_id integer,
    ordinal integer,
    oc_oid character varying(40) NOT NULL
);


--
-- Name: study_event_definition_study_event_definition_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_event_definition_study_event_definition_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_event_definition_study_event_definition_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_event_definition_study_event_definition_id_seq OWNED BY public.study_event_definition.study_event_definition_id;


--
-- Name: study_event_study_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_event_study_event_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_event_study_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_event_study_event_id_seq OWNED BY public.study_event.study_event_id;


--
-- Name: study_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_group (
    study_group_id integer NOT NULL,
    name character varying(255),
    description character varying(1000),
    study_group_class_id integer
);


--
-- Name: study_group_class; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_group_class (
    study_group_class_id integer NOT NULL,
    name character varying(30),
    study_id integer,
    owner_id integer,
    date_created date,
    group_class_type_id integer,
    status_id integer,
    date_updated date,
    update_id integer,
    subject_assignment character varying(30)
);


--
-- Name: study_group_class_study_group_class_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_group_class_study_group_class_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_group_class_study_group_class_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_group_class_study_group_class_id_seq OWNED BY public.study_group_class.study_group_class_id;


--
-- Name: study_group_study_group_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_group_study_group_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_group_study_group_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_group_study_group_id_seq OWNED BY public.study_group.study_group_id;


--
-- Name: study_module_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_module_status (
    id integer NOT NULL,
    study_id integer,
    study integer DEFAULT 1,
    crf integer DEFAULT 1,
    event_definition integer DEFAULT 1,
    subject_group integer DEFAULT 1,
    rule integer DEFAULT 1,
    site integer DEFAULT 1,
    users integer DEFAULT 1,
    version integer,
    date_created date,
    date_updated date,
    owner_id integer,
    update_id integer,
    status_id integer
);


--
-- Name: study_module_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_module_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_module_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_module_status_id_seq OWNED BY public.study_module_status.id;


--
-- Name: study_parameter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_parameter (
    study_parameter_id integer NOT NULL,
    handle character varying(50),
    name character varying(50),
    description character varying(255),
    default_value character varying(50),
    inheritable boolean DEFAULT true,
    overridable boolean
);


--
-- Name: study_parameter_study_parameter_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_parameter_study_parameter_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_parameter_study_parameter_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_parameter_study_parameter_id_seq OWNED BY public.study_parameter.study_parameter_id;


--
-- Name: study_parameter_value; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_parameter_value (
    study_parameter_value_id integer NOT NULL,
    study_id integer,
    value character varying(50),
    parameter character varying(50)
);


--
-- Name: study_parameter_value_study_parameter_value_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_parameter_value_study_parameter_value_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_parameter_value_study_parameter_value_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_parameter_value_study_parameter_value_id_seq OWNED BY public.study_parameter_value.study_parameter_value_id;


--
-- Name: study_study_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_study_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_study_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_study_id_seq OWNED BY public.study.study_id;


--
-- Name: study_subject; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_subject (
    study_subject_id integer NOT NULL,
    label character varying(30),
    secondary_label character varying(30),
    subject_id integer,
    study_id integer,
    status_id integer,
    enrollment_date date,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    owner_id integer,
    update_id integer,
    oc_oid character varying(40) NOT NULL,
    time_zone character varying(255) DEFAULT ''::character varying
);


--
-- Name: study_subject_study_subject_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_subject_study_subject_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_subject_study_subject_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_subject_study_subject_id_seq OWNED BY public.study_subject.study_subject_id;


--
-- Name: study_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_type (
    study_type_id integer NOT NULL,
    name character varying(255),
    description character varying(1000)
);


--
-- Name: study_type_study_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_type_study_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_type_study_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_type_study_type_id_seq OWNED BY public.study_type.study_type_id;


--
-- Name: study_user_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_user_role (
    role_name character varying(40),
    study_id integer,
    status_id integer,
    owner_id integer,
    date_created date,
    date_updated date,
    update_id integer,
    user_name character varying(64)
);


--
-- Name: subject; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject (
    subject_id integer NOT NULL,
    father_id integer,
    mother_id integer,
    status_id integer,
    date_of_birth date,
    gender character(1),
    unique_identifier character varying(255),
    date_created timestamp with time zone,
    owner_id integer,
    date_updated timestamp with time zone,
    update_id integer,
    dob_collected boolean
);


--
-- Name: subject_event_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject_event_status (
    subject_event_status_id integer NOT NULL,
    name character varying(255),
    description character varying(1000)
);


--
-- Name: subject_event_status_subject_event_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subject_event_status_subject_event_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subject_event_status_subject_event_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subject_event_status_subject_event_status_id_seq OWNED BY public.subject_event_status.subject_event_status_id;


--
-- Name: subject_group_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject_group_map (
    subject_group_map_id integer NOT NULL,
    study_group_class_id integer,
    study_subject_id integer,
    study_group_id integer,
    status_id integer,
    owner_id integer,
    date_created date,
    date_updated date,
    update_id integer,
    notes character varying(255)
);


--
-- Name: subject_group_map_subject_group_map_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subject_group_map_subject_group_map_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subject_group_map_subject_group_map_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subject_group_map_subject_group_map_id_seq OWNED BY public.subject_group_map.subject_group_map_id;


--
-- Name: subject_subject_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subject_subject_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subject_subject_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subject_subject_id_seq OWNED BY public.subject.subject_id;


--
-- Name: tag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag (
    id integer NOT NULL,
    tag_name character varying(255),
    workflow character varying(255),
    owner_id integer,
    update_id integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: tag_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tag_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tag_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tag_id_seq OWNED BY public.tag.id;


--
-- Name: usage_statistics_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_statistics_data (
    id integer NOT NULL,
    param_key character varying(255),
    param_value character varying(1000),
    update_timestamp timestamp without time zone,
    version integer
);


--
-- Name: usage_statistics_data_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usage_statistics_data_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usage_statistics_data_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usage_statistics_data_id_seq OWNED BY public.usage_statistics_data.id;


--
-- Name: user_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_account (
    user_id integer NOT NULL,
    user_name character varying(64),
    passwd character varying(255),
    first_name character varying(50),
    last_name character varying(50),
    email character varying(120),
    active_study integer,
    institutional_affiliation character varying(255),
    status_id integer,
    owner_id integer,
    date_created date,
    date_updated date,
    date_lastvisit timestamp without time zone,
    passwd_timestamp date,
    passwd_challenge_question character varying(64),
    passwd_challenge_answer character varying(255),
    phone character varying(64),
    user_type_id integer,
    update_id integer,
    enabled boolean DEFAULT true NOT NULL,
    account_non_locked boolean DEFAULT true NOT NULL,
    lock_counter integer DEFAULT 0 NOT NULL,
    run_webservices boolean DEFAULT false NOT NULL,
    access_code character varying(64),
    time_zone character varying(255) DEFAULT ''::character varying,
    enable_api_key boolean DEFAULT false,
    api_key character varying(255),
    authtype character varying(255) DEFAULT 'STANDARD'::character varying NOT NULL,
    authsecret character varying(255)
);


--
-- Name: user_account_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_account_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_account_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_account_user_id_seq OWNED BY public.user_account.user_id;


--
-- Name: user_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_role (
    role_id integer NOT NULL,
    role_name character varying(50) NOT NULL,
    parent_id integer,
    role_desc character varying(2000)
);


--
-- Name: user_role_role_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_role_role_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_role_role_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_role_role_id_seq OWNED BY public.user_role.role_id;


--
-- Name: user_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_type (
    user_type_id integer NOT NULL,
    user_type character varying(50)
);


--
-- Name: user_type_user_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_type_user_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_type_user_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_type_user_type_id_seq OWNED BY public.user_type.user_type_id;


--
-- Name: versioning_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.versioning_map (
    crf_version_id integer,
    item_id integer
);


--
-- Name: view_dn_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.view_dn_stats AS
 SELECT dn.discrepancy_note_id,
        CASE
            WHEN ((dn.resolution_status_id = 1) OR (dn.resolution_status_id = 2) OR (dn.resolution_status_id = 3)) THEN date_part('day'::text, (CURRENT_TIMESTAMP - totals.date_updated))
            ELSE (NULL::integer)::double precision
        END AS days,
        CASE
            WHEN ((dn.resolution_status_id = 1) OR (dn.resolution_status_id = 2) OR (dn.resolution_status_id = 3)) THEN date_part('day'::text, (CURRENT_TIMESTAMP - dn.date_created))
            WHEN (dn.resolution_status_id = 4) THEN date_part('day'::text, (totals.date_updated - dn.date_created))
            ELSE (NULL::integer)::double precision
        END AS age,
    totals.total_notes,
    dn.date_created,
    totals.date_updated
   FROM public.discrepancy_note dn,
    ( SELECT dn1.parent_dn_id,
            max(dn1.date_created) AS date_updated,
            count(dn1.discrepancy_note_id) AS total_notes
           FROM public.discrepancy_note dn1
          GROUP BY dn1.parent_dn_id) totals
  WHERE (((dn.parent_dn_id IS NULL) OR (dn.parent_dn_id = 0)) AND (dn.discrepancy_note_id = totals.parent_dn_id));


--
-- Name: view_dn_event_crf; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.view_dn_event_crf AS
 SELECT s.study_id,
    s.parent_study_id,
    ( SELECT event_definition_crf.hide_crf
           FROM public.event_definition_crf
          WHERE ((event_definition_crf.study_event_definition_id = sed.study_event_definition_id) AND ((event_definition_crf.study_id = s.study_id) OR (event_definition_crf.study_id = s.parent_study_id)) AND (event_definition_crf.crf_id = c.crf_id) AND ((event_definition_crf.parent_id = 0) OR (event_definition_crf.parent_id IS NULL)))) AS study_hide_crf,
    ( SELECT event_definition_crf.hide_crf
           FROM public.event_definition_crf
          WHERE ((event_definition_crf.study_event_definition_id = sed.study_event_definition_id) AND (event_definition_crf.study_id = s.study_id) AND (event_definition_crf.crf_id = c.crf_id) AND ((event_definition_crf.parent_id <> 0) OR (event_definition_crf.parent_id IS NOT NULL)))) AS site_hide_crf,
    dn.discrepancy_note_id,
    map.event_crf_id AS entity_id,
    map.column_name,
    ss.study_subject_id,
    ss.label,
    ss.status_id AS ss_status_id,
    dn.discrepancy_note_type_id,
    dn.resolution_status_id,
    s.unique_identifier AS site_id,
    ds.date_created,
    ds.date_updated,
    ds.days,
    ds.age,
    sed.name AS event_name,
    se.date_start,
    c.name AS crf_name,
    ec.status_id,
    NULL::integer AS item_id,
    map.column_name AS entity_name,
        CASE
            WHEN ((map.column_name)::text = 'date_interviewed'::text) THEN to_char((ec.date_interviewed)::timestamp with time zone, 'YYYY-MM-DD'::text)
            WHEN ((map.column_name)::text = 'interviewer_name'::text) THEN (ec.interviewer_name)::text
            ELSE btrim(''::text)
        END AS value,
    dn.entity_type,
    dn.description,
    dn.detailed_notes,
    ds.total_notes,
    ua.first_name,
    ua.last_name,
    ua.user_name,
    ua2.first_name AS owner_first_name,
    ua2.last_name AS owner_last_name,
    ua2.user_name AS owner_user_name
   FROM (((((((((((public.dn_event_crf_map map
     JOIN public.discrepancy_note dn ON (((dn.discrepancy_note_id = map.discrepancy_note_id) AND ((dn.entity_type)::text = 'eventCrf'::text) AND ((dn.parent_dn_id IS NULL) OR (dn.parent_dn_id = 0)))))
     JOIN public.view_dn_stats ds ON ((dn.discrepancy_note_id = ds.discrepancy_note_id)))
     JOIN public.user_account ua2 ON ((dn.owner_id = ua2.user_id)))
     JOIN public.event_crf ec ON ((map.event_crf_id = ec.event_crf_id)))
     JOIN public.study_event se ON ((ec.study_event_id = se.study_event_id)))
     JOIN public.crf_version cv ON ((ec.crf_version_id = cv.crf_version_id)))
     JOIN public.study_event_definition sed ON ((se.study_event_definition_id = sed.study_event_definition_id)))
     JOIN public.crf c ON ((cv.crf_id = c.crf_id)))
     JOIN public.study_subject ss ON ((se.study_subject_id = ss.study_subject_id)))
     JOIN public.study s ON ((ss.study_id = s.study_id)))
     LEFT JOIN public.user_account ua ON ((dn.assigned_user_id = ua.user_id)));


--
-- Name: view_dn_item_data; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.view_dn_item_data AS
 SELECT s.study_id,
    s.parent_study_id,
    ( SELECT event_definition_crf.hide_crf
           FROM public.event_definition_crf
          WHERE ((event_definition_crf.study_event_definition_id = sed.study_event_definition_id) AND ((event_definition_crf.study_id = s.study_id) OR (event_definition_crf.study_id = s.parent_study_id)) AND (event_definition_crf.crf_id = c.crf_id) AND ((event_definition_crf.parent_id = 0) OR (event_definition_crf.parent_id IS NULL)))) AS study_hide_crf,
    ( SELECT event_definition_crf.hide_crf
           FROM public.event_definition_crf
          WHERE ((event_definition_crf.study_event_definition_id = sed.study_event_definition_id) AND (event_definition_crf.study_id = s.study_id) AND (event_definition_crf.crf_id = c.crf_id) AND ((event_definition_crf.parent_id <> 0) OR (event_definition_crf.parent_id IS NOT NULL)))) AS site_hide_crf,
    dn.discrepancy_note_id,
    map.item_data_id AS entity_id,
    map.column_name,
    ss.study_subject_id,
    ss.label,
    ss.status_id AS ss_status_id,
    dn.discrepancy_note_type_id,
    dn.resolution_status_id,
    s.unique_identifier AS site_id,
    ds.date_created,
    ds.date_updated,
    ds.days,
    ds.age,
    sed.name AS event_name,
    se.date_start,
    c.name AS crf_name,
    ec.status_id,
    i.item_id,
    i.name AS entity_name,
    id.value,
    dn.entity_type,
    dn.description,
    dn.detailed_notes,
    ds.total_notes,
    ua.first_name,
    ua.last_name,
    ua.user_name,
    ua2.first_name AS owner_first_name,
    ua2.last_name AS owner_last_name,
    ua2.user_name AS owner_user_name
   FROM (((((((((((((public.dn_item_data_map map
     JOIN public.discrepancy_note dn ON (((dn.discrepancy_note_id = map.discrepancy_note_id) AND ((dn.entity_type)::text = 'itemData'::text) AND ((dn.parent_dn_id IS NULL) OR (dn.parent_dn_id = 0)))))
     JOIN public.view_dn_stats ds ON ((dn.discrepancy_note_id = ds.discrepancy_note_id)))
     JOIN public.user_account ua2 ON ((dn.owner_id = ua2.user_id)))
     JOIN public.item_data id ON ((map.item_data_id = id.item_data_id)))
     JOIN public.item i ON ((id.item_id = i.item_id)))
     JOIN public.event_crf ec ON ((id.event_crf_id = ec.event_crf_id)))
     JOIN public.study_event se ON ((ec.study_event_id = se.study_event_id)))
     JOIN public.crf_version cv ON ((ec.crf_version_id = cv.crf_version_id)))
     JOIN public.study_event_definition sed ON ((se.study_event_definition_id = sed.study_event_definition_id)))
     JOIN public.crf c ON ((cv.crf_id = c.crf_id)))
     JOIN public.study_subject ss ON ((se.study_subject_id = ss.study_subject_id)))
     JOIN public.study s ON ((ss.study_id = s.study_id)))
     LEFT JOIN public.user_account ua ON ((dn.assigned_user_id = ua.user_id)))
  WHERE (map.study_subject_id = ss.study_subject_id);


--
-- Name: view_dn_study_event; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.view_dn_study_event AS
 SELECT s.study_id,
    s.parent_study_id,
    false AS study_hide_crf,
    false AS site_hide_crf,
    dn.discrepancy_note_id,
    map.study_event_id AS entity_id,
    map.column_name,
    ss.study_subject_id,
    ss.label,
    ss.status_id AS ss_status_id,
    dn.discrepancy_note_type_id,
    dn.resolution_status_id,
    s.unique_identifier AS site_id,
    ds.date_created,
    ds.date_updated,
    ds.days,
    ds.age,
    sed.name AS event_name,
    se.date_start,
    btrim(''::text) AS crf_name,
    0 AS status_id,
    NULL::integer AS item_id,
    map.column_name AS entity_name,
        CASE
            WHEN ((map.column_name)::text = 'start_date'::text) THEN to_char(se.date_start, 'YYYY-MM-DD'::text)
            WHEN ((map.column_name)::text = 'end_date'::text) THEN to_char(se.date_end, 'YYYY-MM-DD'::text)
            WHEN ((map.column_name)::text = 'location'::text) THEN (se.location)::text
            ELSE btrim(''::text)
        END AS value,
    dn.entity_type,
    dn.description,
    dn.detailed_notes,
    ds.total_notes,
    ua.first_name,
    ua.last_name,
    ua.user_name,
    ua2.first_name AS owner_first_name,
    ua2.last_name AS owner_last_name,
    ua2.user_name AS owner_user_name
   FROM ((((((((public.dn_study_event_map map
     JOIN public.discrepancy_note dn ON (((dn.discrepancy_note_id = map.discrepancy_note_id) AND ((dn.entity_type)::text = 'studyEvent'::text) AND ((dn.parent_dn_id IS NULL) OR (dn.parent_dn_id = 0)))))
     JOIN public.view_dn_stats ds ON ((dn.discrepancy_note_id = ds.discrepancy_note_id)))
     JOIN public.user_account ua2 ON ((dn.owner_id = ua2.user_id)))
     JOIN public.study_event se ON ((map.study_event_id = se.study_event_id)))
     JOIN public.study_subject ss ON ((se.study_subject_id = ss.study_subject_id)))
     JOIN public.study s ON ((ss.study_id = s.study_id)))
     JOIN public.study_event_definition sed ON ((se.study_event_definition_id = sed.study_event_definition_id)))
     LEFT JOIN public.user_account ua ON ((dn.assigned_user_id = ua.user_id)));


--
-- Name: view_dn_study_subject; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.view_dn_study_subject AS
 SELECT s.study_id,
    s.parent_study_id,
    false AS study_hide_crf,
    false AS site_hide_crf,
    dn.discrepancy_note_id,
    map.study_subject_id AS entity_id,
    map.column_name,
    ss.study_subject_id,
    ss.label,
    ss.status_id AS ss_status_id,
    dn.discrepancy_note_type_id,
    dn.resolution_status_id,
    s.unique_identifier AS site_id,
    ds.date_created,
    ds.date_updated,
    ds.days,
    ds.age,
    btrim(''::text) AS event_name,
    NULL::timestamp with time zone AS date_start,
    btrim(''::text) AS crf_name,
    0 AS status_id,
    NULL::integer AS item_id,
    map.column_name AS entity_name,
    to_char((ss.enrollment_date)::timestamp with time zone, 'YYYY-MM-DD'::text) AS value,
    dn.entity_type,
    dn.description,
    dn.detailed_notes,
    ds.total_notes,
    ua.first_name,
    ua.last_name,
    ua.user_name,
    ua2.first_name AS owner_first_name,
    ua2.last_name AS owner_last_name,
    ua2.user_name AS owner_user_name
   FROM ((((((public.dn_study_subject_map map
     JOIN public.discrepancy_note dn ON (((dn.discrepancy_note_id = map.discrepancy_note_id) AND ((dn.entity_type)::text = 'studySub'::text) AND ((dn.parent_dn_id IS NULL) OR (dn.parent_dn_id = 0)))))
     JOIN public.view_dn_stats ds ON ((dn.discrepancy_note_id = ds.discrepancy_note_id)))
     JOIN public.user_account ua2 ON ((dn.owner_id = ua2.user_id)))
     JOIN public.study_subject ss ON ((map.study_subject_id = ss.study_subject_id)))
     JOIN public.study s ON ((ss.study_id = s.study_id)))
     LEFT JOIN public.user_account ua ON ((dn.assigned_user_id = ua.user_id)));


--
-- Name: view_dn_subject; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.view_dn_subject AS
 SELECT s.study_id,
    s.parent_study_id,
    false AS study_hide_crf,
    false AS site_hide_crf,
    dn.discrepancy_note_id,
    map.subject_id AS entity_id,
    map.column_name,
    ss.study_subject_id,
    ss.label,
    ss.status_id AS ss_status_id,
    dn.discrepancy_note_type_id,
    dn.resolution_status_id,
    s.unique_identifier AS site_id,
    ds.date_created,
    ds.date_updated,
    ds.days,
    ds.age,
    btrim(''::text) AS event_name,
    NULL::timestamp with time zone AS date_start,
    btrim(''::text) AS crf_name,
    0 AS status_id,
    NULL::integer AS item_id,
    map.column_name AS entity_name,
        CASE
            WHEN ((map.column_name)::text = 'unique_identifier'::text) THEN (su.unique_identifier)::text
            WHEN ((map.column_name)::text = 'gender'::text) THEN (su.gender)::text
            WHEN ((map.column_name)::text = 'date_of_birth'::text) THEN to_char((su.date_of_birth)::timestamp with time zone, 'YYYY-MM-DD'::text)
            ELSE btrim(''::text)
        END AS value,
    dn.entity_type,
    dn.description,
    dn.detailed_notes,
    ds.total_notes,
    ua.first_name,
    ua.last_name,
    ua.user_name,
    ua2.first_name AS owner_first_name,
    ua2.last_name AS owner_last_name,
    ua2.user_name AS owner_user_name
   FROM (((((((public.dn_subject_map map
     JOIN public.discrepancy_note dn ON (((dn.discrepancy_note_id = map.discrepancy_note_id) AND ((dn.entity_type)::text = 'subject'::text) AND ((dn.parent_dn_id IS NULL) OR (dn.parent_dn_id = 0)))))
     JOIN public.view_dn_stats ds ON ((dn.discrepancy_note_id = ds.discrepancy_note_id)))
     JOIN public.user_account ua2 ON ((dn.owner_id = ua2.user_id)))
     JOIN public.subject su ON ((map.subject_id = su.subject_id)))
     JOIN public.study_subject ss ON ((su.subject_id = ss.subject_id)))
     JOIN public.study s ON ((ss.study_id = s.study_id)))
     LEFT JOIN public.user_account ua ON ((dn.assigned_user_id = ua.user_id)));


--
-- Name: view_discrepancy_note; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.view_discrepancy_note AS
 SELECT view_dn_item_data.study_id,
    view_dn_item_data.parent_study_id,
    view_dn_item_data.study_hide_crf,
    view_dn_item_data.site_hide_crf,
    view_dn_item_data.discrepancy_note_id,
    view_dn_item_data.entity_id,
    view_dn_item_data.column_name,
    view_dn_item_data.study_subject_id,
    view_dn_item_data.label,
    view_dn_item_data.ss_status_id,
    view_dn_item_data.discrepancy_note_type_id,
    view_dn_item_data.resolution_status_id,
    view_dn_item_data.site_id,
    view_dn_item_data.date_created,
    view_dn_item_data.date_updated,
    view_dn_item_data.days,
    view_dn_item_data.age,
    view_dn_item_data.event_name,
    view_dn_item_data.date_start,
    view_dn_item_data.crf_name,
    view_dn_item_data.status_id,
    view_dn_item_data.item_id,
    view_dn_item_data.entity_name,
    view_dn_item_data.value,
    view_dn_item_data.entity_type,
    view_dn_item_data.description,
    view_dn_item_data.detailed_notes,
    view_dn_item_data.total_notes,
    view_dn_item_data.first_name,
    view_dn_item_data.last_name,
    view_dn_item_data.user_name,
    view_dn_item_data.owner_first_name,
    view_dn_item_data.owner_last_name,
    view_dn_item_data.owner_user_name
   FROM public.view_dn_item_data
UNION ALL
 SELECT view_dn_event_crf.study_id,
    view_dn_event_crf.parent_study_id,
    view_dn_event_crf.study_hide_crf,
    view_dn_event_crf.site_hide_crf,
    view_dn_event_crf.discrepancy_note_id,
    view_dn_event_crf.entity_id,
    view_dn_event_crf.column_name,
    view_dn_event_crf.study_subject_id,
    view_dn_event_crf.label,
    view_dn_event_crf.ss_status_id,
    view_dn_event_crf.discrepancy_note_type_id,
    view_dn_event_crf.resolution_status_id,
    view_dn_event_crf.site_id,
    view_dn_event_crf.date_created,
    view_dn_event_crf.date_updated,
    view_dn_event_crf.days,
    view_dn_event_crf.age,
    view_dn_event_crf.event_name,
    view_dn_event_crf.date_start,
    view_dn_event_crf.crf_name,
    view_dn_event_crf.status_id,
    view_dn_event_crf.item_id,
    view_dn_event_crf.entity_name,
    view_dn_event_crf.value,
    view_dn_event_crf.entity_type,
    view_dn_event_crf.description,
    view_dn_event_crf.detailed_notes,
    view_dn_event_crf.total_notes,
    view_dn_event_crf.first_name,
    view_dn_event_crf.last_name,
    view_dn_event_crf.user_name,
    view_dn_event_crf.owner_first_name,
    view_dn_event_crf.owner_last_name,
    view_dn_event_crf.owner_user_name
   FROM public.view_dn_event_crf
UNION ALL
 SELECT view_dn_study_event.study_id,
    view_dn_study_event.parent_study_id,
    view_dn_study_event.study_hide_crf,
    view_dn_study_event.site_hide_crf,
    view_dn_study_event.discrepancy_note_id,
    view_dn_study_event.entity_id,
    view_dn_study_event.column_name,
    view_dn_study_event.study_subject_id,
    view_dn_study_event.label,
    view_dn_study_event.ss_status_id,
    view_dn_study_event.discrepancy_note_type_id,
    view_dn_study_event.resolution_status_id,
    view_dn_study_event.site_id,
    view_dn_study_event.date_created,
    view_dn_study_event.date_updated,
    view_dn_study_event.days,
    view_dn_study_event.age,
    view_dn_study_event.event_name,
    view_dn_study_event.date_start,
    view_dn_study_event.crf_name,
    view_dn_study_event.status_id,
    view_dn_study_event.item_id,
    view_dn_study_event.entity_name,
    view_dn_study_event.value,
    view_dn_study_event.entity_type,
    view_dn_study_event.description,
    view_dn_study_event.detailed_notes,
    view_dn_study_event.total_notes,
    view_dn_study_event.first_name,
    view_dn_study_event.last_name,
    view_dn_study_event.user_name,
    view_dn_study_event.owner_first_name,
    view_dn_study_event.owner_last_name,
    view_dn_study_event.owner_user_name
   FROM public.view_dn_study_event
UNION ALL
 SELECT view_dn_study_subject.study_id,
    view_dn_study_subject.parent_study_id,
    view_dn_study_subject.study_hide_crf,
    view_dn_study_subject.site_hide_crf,
    view_dn_study_subject.discrepancy_note_id,
    view_dn_study_subject.entity_id,
    view_dn_study_subject.column_name,
    view_dn_study_subject.study_subject_id,
    view_dn_study_subject.label,
    view_dn_study_subject.ss_status_id,
    view_dn_study_subject.discrepancy_note_type_id,
    view_dn_study_subject.resolution_status_id,
    view_dn_study_subject.site_id,
    view_dn_study_subject.date_created,
    view_dn_study_subject.date_updated,
    view_dn_study_subject.days,
    view_dn_study_subject.age,
    view_dn_study_subject.event_name,
    view_dn_study_subject.date_start,
    view_dn_study_subject.crf_name,
    view_dn_study_subject.status_id,
    view_dn_study_subject.item_id,
    view_dn_study_subject.entity_name,
    view_dn_study_subject.value,
    view_dn_study_subject.entity_type,
    view_dn_study_subject.description,
    view_dn_study_subject.detailed_notes,
    view_dn_study_subject.total_notes,
    view_dn_study_subject.first_name,
    view_dn_study_subject.last_name,
    view_dn_study_subject.user_name,
    view_dn_study_subject.owner_first_name,
    view_dn_study_subject.owner_last_name,
    view_dn_study_subject.owner_user_name
   FROM public.view_dn_study_subject
UNION ALL
 SELECT view_dn_subject.study_id,
    view_dn_subject.parent_study_id,
    view_dn_subject.study_hide_crf,
    view_dn_subject.site_hide_crf,
    view_dn_subject.discrepancy_note_id,
    view_dn_subject.entity_id,
    view_dn_subject.column_name,
    view_dn_subject.study_subject_id,
    view_dn_subject.label,
    view_dn_subject.ss_status_id,
    view_dn_subject.discrepancy_note_type_id,
    view_dn_subject.resolution_status_id,
    view_dn_subject.site_id,
    view_dn_subject.date_created,
    view_dn_subject.date_updated,
    view_dn_subject.days,
    view_dn_subject.age,
    view_dn_subject.event_name,
    view_dn_subject.date_start,
    view_dn_subject.crf_name,
    view_dn_subject.status_id,
    view_dn_subject.item_id,
    view_dn_subject.entity_name,
    view_dn_subject.value,
    view_dn_subject.entity_type,
    view_dn_subject.description,
    view_dn_subject.detailed_notes,
    view_dn_subject.total_notes,
    view_dn_subject.first_name,
    view_dn_subject.last_name,
    view_dn_subject.user_name,
    view_dn_subject.owner_first_name,
    view_dn_subject.owner_last_name,
    view_dn_subject.owner_user_name
   FROM public.view_dn_subject;


--
-- Name: view_item_data_toolkit; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.view_item_data_toolkit AS
 SELECT DISTINCT id.item_data_id,
        CASE
            WHEN (s.parent_study_id IS NULL) THEN 0
            ELSE s.parent_study_id
        END AS parent_study_id,
    s.study_id,
    ss.label AS study_subject_id,
    ss.oc_oid AS ss_oid,
    sed.name AS study_event_defn,
    sed.oc_oid AS sed_oid,
    se.sample_ordinal AS event_ordinal,
    c.name AS crf_name,
    c.oc_oid AS crf_oid,
    ig.name AS group_name,
    ig.oc_oid AS group_oid,
    id.ordinal AS group_ordinal,
    i.oc_oid AS item_oid,
    ifm.left_item_text,
    id.value,
    ec.event_crf_id,
    ec.status_id AS event_crf_status_id
   FROM (((((((((((public.item_data id
     JOIN public.item i ON ((id.item_id = i.item_id)))
     JOIN public.item_form_metadata ifm ON ((ifm.item_id = i.item_id)))
     JOIN public.event_crf ec ON ((id.event_crf_id = ec.event_crf_id)))
     JOIN public.study_subject ss ON ((ss.study_subject_id = ec.study_subject_id)))
     JOIN public.study s ON ((s.study_id = ss.study_id)))
     JOIN public.crf_version cv ON ((ec.crf_version_id = cv.crf_version_id)))
     JOIN public.crf c ON ((c.crf_id = cv.crf_id)))
     JOIN public.item_group_metadata igm ON ((igm.item_id = id.item_id)))
     JOIN public.item_group ig ON ((ig.item_group_id = igm.item_group_id)))
     JOIN public.study_event se ON ((se.study_event_id = ec.study_event_id)))
     JOIN public.study_event_definition sed ON ((sed.study_event_definition_id = se.study_event_definition_id)))
  ORDER BY id.item_data_id;


--
-- Name: view_item_data_toolkit_filtered; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.view_item_data_toolkit_filtered AS
 SELECT DISTINCT view.item_data_id,
    view.parent_study_id,
    view.study_id,
    view.study_subject_id,
    view.ss_oid,
    view.study_event_defn,
    view.sed_oid,
    view.event_ordinal,
    view.crf_name,
    view.crf_oid,
    view.group_name,
    view.group_oid,
    view.group_ordinal,
    view.item_oid,
    view.left_item_text,
    view.value,
    view.event_crf_id,
    view.event_crf_status_id,
    edci_tag.path,
    edc_tag.tag_id,
    idfw.workflow_status AS item_data_workflow_status
   FROM ((((((public.view_item_data_toolkit view
     JOIN public.event_definition_crf_tag edc_tag ON (((edc_tag.path)::text = (((view.sed_oid)::text || '.'::text) || (view.crf_oid)::text))))
     LEFT JOIN public.event_definition_crf_item_tag edci_tag ON ((((edci_tag.path)::text = (((((((view.sed_oid)::text || '.'::text) || (view.crf_oid)::text) || '.'::text) || (view.group_oid)::text) || '.'::text) || (view.item_oid)::text)) AND (edci_tag.active = true) AND (edci_tag.tag_id = edc_tag.tag_id))))
     LEFT JOIN public.item_data_flag id_flag ON (((id_flag.path)::text = (((((((((((((view.ss_oid)::text || '.'::text) || (view.sed_oid)::text) || '.'::text) || (view.event_ordinal)::text) || '.'::text) || (view.crf_oid)::text) || '.'::text) || (view.group_oid)::text) || '.'::text) || (view.group_ordinal)::text) || '.'::text) || (view.item_oid)::text))))
     LEFT JOIN public.event_crf_flag ec_flag ON ((((ec_flag.path)::text = (((((((view.ss_oid)::text || '.'::text) || (view.sed_oid)::text) || '.'::text) || (view.event_ordinal)::text) || '.'::text) || (view.crf_oid)::text)) AND (ec_flag.tag_id = edc_tag.tag_id))))
     LEFT JOIN public.item_data_flag_workflow idfw ON ((idfw.id = id_flag.flag_workflow_id)))
     LEFT JOIN public.event_crf_flag_workflow ecfw ON ((ecfw.id = ec_flag.flag_workflow_id)))
  ORDER BY view.event_crf_id;


--
-- Name: view_site_hidden_event_definition_crf; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.view_site_hidden_event_definition_crf AS
 SELECT edc.event_definition_crf_id,
    edc.hide_crf,
    edc.study_id,
    se.study_event_id,
    cv.crf_version_id
   FROM ((public.event_definition_crf edc
     JOIN public.study_event se ON (((edc.study_event_definition_id = se.study_event_definition_id) AND (NOT (edc.event_definition_crf_id IN ( SELECT event_definition_crf.parent_id
           FROM public.event_definition_crf
          WHERE ((event_definition_crf.parent_id IS NOT NULL) OR (event_definition_crf.parent_id <> 0))))))))
     JOIN public.crf_version cv ON ((edc.crf_id = cv.crf_id)));


--
-- Name: view_study_hidden_event_definition_crf; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.view_study_hidden_event_definition_crf AS
 SELECT edc.event_definition_crf_id,
    edc.hide_crf,
    edc.study_id,
    se.study_event_id,
    cv.crf_version_id
   FROM ((public.event_definition_crf edc
     JOIN public.study_event se ON (((edc.study_event_definition_id = se.study_event_definition_id) AND (edc.parent_id IS NULL))))
     JOIN public.crf_version cv ON ((edc.crf_id = cv.crf_id)));


--
-- Name: archived_dataset_file archived_dataset_file_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archived_dataset_file ALTER COLUMN archived_dataset_file_id SET DEFAULT nextval('public.archived_dataset_file_archived_dataset_file_id_seq'::regclass);


--
-- Name: audit_event audit_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event ALTER COLUMN audit_id SET DEFAULT nextval('public.audit_event_audit_id_seq'::regclass);


--
-- Name: audit_log_event audit_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log_event ALTER COLUMN audit_id SET DEFAULT nextval('public.audit_log_event_audit_id_seq'::regclass);


--
-- Name: audit_log_event_type audit_log_event_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log_event_type ALTER COLUMN audit_log_event_type_id SET DEFAULT nextval('public.audit_log_event_type_audit_log_event_type_id_seq'::regclass);


--
-- Name: audit_user_api_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_user_api_log ALTER COLUMN id SET DEFAULT nextval('public.audit_user_api_log_id_seq'::regclass);


--
-- Name: audit_user_login id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_user_login ALTER COLUMN id SET DEFAULT nextval('public.audit_user_login_id_seq'::regclass);


--
-- Name: authorities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authorities ALTER COLUMN id SET DEFAULT nextval('public.authorities_id_seq'::regclass);


--
-- Name: completion_status completion_status_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_status ALTER COLUMN completion_status_id SET DEFAULT nextval('public.completion_status_completion_status_id_seq'::regclass);


--
-- Name: configuration id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuration ALTER COLUMN id SET DEFAULT nextval('public.configuration_id_seq'::regclass);


--
-- Name: crf crf_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf ALTER COLUMN crf_id SET DEFAULT nextval('public.crf_crf_id_seq'::regclass);


--
-- Name: crf_version crf_version_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf_version ALTER COLUMN crf_version_id SET DEFAULT nextval('public.crf_version_crf_version_id_seq'::regclass);


--
-- Name: crf_version_media crf_version_media_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf_version_media ALTER COLUMN crf_version_media_id SET DEFAULT nextval('public.crf_version_media_crf_version_media_id_seq'::regclass);


--
-- Name: dataset dataset_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset ALTER COLUMN dataset_id SET DEFAULT nextval('public.dataset_dataset_id_seq'::regclass);


--
-- Name: dataset_item_status dataset_item_status_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_item_status ALTER COLUMN dataset_item_status_id SET DEFAULT nextval('public.dataset_item_status_dataset_item_status_id_seq'::regclass);


--
-- Name: dc_computed_event dc_summary_event_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_computed_event ALTER COLUMN dc_summary_event_id SET DEFAULT nextval('public.dc_computed_event_dc_summary_event_id_seq'::regclass);


--
-- Name: dc_event dc_event_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_event ALTER COLUMN dc_event_id SET DEFAULT nextval('public.dc_event_dc_event_id_seq'::regclass);


--
-- Name: dc_primitive dc_primitive_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_primitive ALTER COLUMN dc_primitive_id SET DEFAULT nextval('public.dc_primitive_dc_primitive_id_seq'::regclass);


--
-- Name: dc_section_event dc_event_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_section_event ALTER COLUMN dc_event_id SET DEFAULT nextval('public.dc_section_event_dc_event_id_seq'::regclass);


--
-- Name: dc_send_email_event dc_event_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_send_email_event ALTER COLUMN dc_event_id SET DEFAULT nextval('public.dc_send_email_event_dc_event_id_seq'::regclass);


--
-- Name: dc_substitution_event dc_event_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_substitution_event ALTER COLUMN dc_event_id SET DEFAULT nextval('public.dc_substitution_event_dc_event_id_seq'::regclass);


--
-- Name: decision_condition decision_condition_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_condition ALTER COLUMN decision_condition_id SET DEFAULT nextval('public.decision_condition_decision_condition_id_seq'::regclass);


--
-- Name: discrepancy_note discrepancy_note_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_note ALTER COLUMN discrepancy_note_id SET DEFAULT nextval('public.discrepancy_note_discrepancy_note_id_seq'::regclass);


--
-- Name: discrepancy_note_type discrepancy_note_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_note_type ALTER COLUMN discrepancy_note_type_id SET DEFAULT nextval('public.discrepancy_note_type_discrepancy_note_type_id_seq'::regclass);


--
-- Name: dyn_item_form_metadata id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dyn_item_form_metadata ALTER COLUMN id SET DEFAULT nextval('public.dyn_item_form_metadata_id_seq'::regclass);


--
-- Name: dyn_item_group_metadata id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dyn_item_group_metadata ALTER COLUMN id SET DEFAULT nextval('public.dyn_item_group_metadata_id_seq'::regclass);


--
-- Name: event_crf event_crf_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf ALTER COLUMN event_crf_id SET DEFAULT nextval('public.event_crf_event_crf_id_seq'::regclass);


--
-- Name: event_crf_flag id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf_flag ALTER COLUMN id SET DEFAULT nextval('public.event_crf_flag_id_seq'::regclass);


--
-- Name: event_crf_flag_workflow id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf_flag_workflow ALTER COLUMN id SET DEFAULT nextval('public.event_crf_flag_workflow_id_seq'::regclass);


--
-- Name: event_definition_crf event_definition_crf_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf ALTER COLUMN event_definition_crf_id SET DEFAULT nextval('public.event_definition_crf_event_definition_crf_id_seq'::regclass);


--
-- Name: event_definition_crf_item_tag id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf_item_tag ALTER COLUMN id SET DEFAULT nextval('public.event_definition_crf_item_tag_id_seq'::regclass);


--
-- Name: event_definition_crf_tag id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf_tag ALTER COLUMN id SET DEFAULT nextval('public.event_definition_crf_tag_id_seq'::regclass);


--
-- Name: export_format export_format_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_format ALTER COLUMN export_format_id SET DEFAULT nextval('public.export_format_export_format_id_seq'::regclass);


--
-- Name: filter filter_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.filter ALTER COLUMN filter_id SET DEFAULT nextval('public.filter_filter_id_seq'::regclass);


--
-- Name: group_class_types group_class_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_class_types ALTER COLUMN group_class_type_id SET DEFAULT nextval('public.group_class_types_group_class_type_id_seq'::regclass);


--
-- Name: item item_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item ALTER COLUMN item_id SET DEFAULT nextval('public.item_item_id_seq'::regclass);


--
-- Name: item_data item_data_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data ALTER COLUMN item_data_id SET DEFAULT nextval('public.item_data_item_data_id_seq'::regclass);


--
-- Name: item_data_flag id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data_flag ALTER COLUMN id SET DEFAULT nextval('public.item_data_flag_id_seq'::regclass);


--
-- Name: item_data_flag_workflow id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data_flag_workflow ALTER COLUMN id SET DEFAULT nextval('public.item_data_flag_workflow_id_seq'::regclass);


--
-- Name: item_data_type item_data_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data_type ALTER COLUMN item_data_type_id SET DEFAULT nextval('public.item_data_type_item_data_type_id_seq'::regclass);


--
-- Name: item_form_metadata item_form_metadata_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_form_metadata ALTER COLUMN item_form_metadata_id SET DEFAULT nextval('public.item_form_metadata_item_form_metadata_id_seq'::regclass);


--
-- Name: item_group item_group_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group ALTER COLUMN item_group_id SET DEFAULT nextval('public.item_group_item_group_id_seq'::regclass);


--
-- Name: item_group_metadata item_group_metadata_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group_metadata ALTER COLUMN item_group_metadata_id SET DEFAULT nextval('public.item_group_metadata_item_group_metadata_id_seq'::regclass);


--
-- Name: item_reference_type item_reference_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_reference_type ALTER COLUMN item_reference_type_id SET DEFAULT nextval('public.item_reference_type_item_reference_type_id_seq'::regclass);


--
-- Name: measurement_unit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_unit ALTER COLUMN id SET DEFAULT nextval('public.measurement_unit_id_seq'::regclass);


--
-- Name: null_value_type null_value_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.null_value_type ALTER COLUMN null_value_type_id SET DEFAULT nextval('public.null_value_type_null_value_type_id_seq'::regclass);


--
-- Name: openclinica_version id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.openclinica_version ALTER COLUMN id SET DEFAULT nextval('public.openclinica_version_id_seq'::regclass);


--
-- Name: privilege priv_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privilege ALTER COLUMN priv_id SET DEFAULT nextval('public.privilege_priv_id_seq'::regclass);


--
-- Name: resolution_status resolution_status_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resolution_status ALTER COLUMN resolution_status_id SET DEFAULT nextval('public.resolution_status_resolution_status_id_seq'::regclass);


--
-- Name: response_set response_set_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_set ALTER COLUMN response_set_id SET DEFAULT nextval('public.response_set_response_set_id_seq'::regclass);


--
-- Name: response_type response_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_type ALTER COLUMN response_type_id SET DEFAULT nextval('public.response_type_response_type_id_seq'::regclass);


--
-- Name: rule id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule ALTER COLUMN id SET DEFAULT nextval('public.rule_id_seq'::regclass);


--
-- Name: rule_action id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_action ALTER COLUMN id SET DEFAULT nextval('public.rule_action_id_seq'::regclass);


--
-- Name: rule_action_property id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_action_property ALTER COLUMN id SET DEFAULT nextval('public.rule_action_property_id_seq'::regclass);


--
-- Name: rule_action_run id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_action_run ALTER COLUMN id SET DEFAULT nextval('public.rule_action_run_id_seq'::regclass);


--
-- Name: rule_action_run_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_action_run_log ALTER COLUMN id SET DEFAULT nextval('public.rule_action_run_log_id_seq'::regclass);


--
-- Name: rule_action_stratification_factor id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_action_stratification_factor ALTER COLUMN id SET DEFAULT nextval('public.rule_action_stratification_factor_id_seq'::regclass);


--
-- Name: rule_expression id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_expression ALTER COLUMN id SET DEFAULT nextval('public.rule_expression_id_seq'::regclass);


--
-- Name: rule_set id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_set ALTER COLUMN id SET DEFAULT nextval('public.rule_set_id_seq'::regclass);


--
-- Name: rule_set_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_set_audit ALTER COLUMN id SET DEFAULT nextval('public.rule_set_audit_id_seq'::regclass);


--
-- Name: rule_set_rule id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_set_rule ALTER COLUMN id SET DEFAULT nextval('public.rule_set_rule_id_seq'::regclass);


--
-- Name: rule_set_rule_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_set_rule_audit ALTER COLUMN id SET DEFAULT nextval('public.rule_set_rule_audit_id_seq'::regclass);


--
-- Name: scd_item_metadata id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scd_item_metadata ALTER COLUMN id SET DEFAULT nextval('public.scd_item_metadata_id_seq'::regclass);


--
-- Name: section section_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.section ALTER COLUMN section_id SET DEFAULT nextval('public.section_section_id_seq'::regclass);


--
-- Name: status status_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status ALTER COLUMN status_id SET DEFAULT nextval('public.status_status_id_seq'::regclass);


--
-- Name: study study_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study ALTER COLUMN study_id SET DEFAULT nextval('public.study_study_id_seq'::regclass);


--
-- Name: study_event study_event_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event ALTER COLUMN study_event_id SET DEFAULT nextval('public.study_event_study_event_id_seq'::regclass);


--
-- Name: study_event_definition study_event_definition_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event_definition ALTER COLUMN study_event_definition_id SET DEFAULT nextval('public.study_event_definition_study_event_definition_id_seq'::regclass);


--
-- Name: study_group study_group_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_group ALTER COLUMN study_group_id SET DEFAULT nextval('public.study_group_study_group_id_seq'::regclass);


--
-- Name: study_group_class study_group_class_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_group_class ALTER COLUMN study_group_class_id SET DEFAULT nextval('public.study_group_class_study_group_class_id_seq'::regclass);


--
-- Name: study_module_status id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_module_status ALTER COLUMN id SET DEFAULT nextval('public.study_module_status_id_seq'::regclass);


--
-- Name: study_parameter study_parameter_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_parameter ALTER COLUMN study_parameter_id SET DEFAULT nextval('public.study_parameter_study_parameter_id_seq'::regclass);


--
-- Name: study_parameter_value study_parameter_value_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_parameter_value ALTER COLUMN study_parameter_value_id SET DEFAULT nextval('public.study_parameter_value_study_parameter_value_id_seq'::regclass);


--
-- Name: study_subject study_subject_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_subject ALTER COLUMN study_subject_id SET DEFAULT nextval('public.study_subject_study_subject_id_seq'::regclass);


--
-- Name: study_type study_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_type ALTER COLUMN study_type_id SET DEFAULT nextval('public.study_type_study_type_id_seq'::regclass);


--
-- Name: subject subject_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject ALTER COLUMN subject_id SET DEFAULT nextval('public.subject_subject_id_seq'::regclass);


--
-- Name: subject_event_status subject_event_status_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_event_status ALTER COLUMN subject_event_status_id SET DEFAULT nextval('public.subject_event_status_subject_event_status_id_seq'::regclass);


--
-- Name: subject_group_map subject_group_map_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_group_map ALTER COLUMN subject_group_map_id SET DEFAULT nextval('public.subject_group_map_subject_group_map_id_seq'::regclass);


--
-- Name: tag id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag ALTER COLUMN id SET DEFAULT nextval('public.tag_id_seq'::regclass);


--
-- Name: usage_statistics_data id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_statistics_data ALTER COLUMN id SET DEFAULT nextval('public.usage_statistics_data_id_seq'::regclass);


--
-- Name: user_account user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account ALTER COLUMN user_id SET DEFAULT nextval('public.user_account_user_id_seq'::regclass);


--
-- Name: user_role role_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role ALTER COLUMN role_id SET DEFAULT nextval('public.user_role_role_id_seq'::regclass);


--
-- Name: user_type user_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_type ALTER COLUMN user_type_id SET DEFAULT nextval('public.user_type_user_type_id_seq'::regclass);


--
-- Name: archived_dataset_file archived_dataset_file_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archived_dataset_file
    ADD CONSTRAINT archived_dataset_file_pkey PRIMARY KEY (archived_dataset_file_id);


--
-- Name: audit_event audit_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT audit_event_pkey PRIMARY KEY (audit_id);


--
-- Name: audit_log_event audit_log_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log_event
    ADD CONSTRAINT audit_log_event_pkey PRIMARY KEY (audit_id);


--
-- Name: audit_log_event_type audit_log_event_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log_event_type
    ADD CONSTRAINT audit_log_event_type_pkey PRIMARY KEY (audit_log_event_type_id);


--
-- Name: audit_user_api_log audit_user_api_log_audit_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_user_api_log
    ADD CONSTRAINT audit_user_api_log_audit_id_key UNIQUE (audit_id);


--
-- Name: audit_user_api_log audit_user_api_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_user_api_log
    ADD CONSTRAINT audit_user_api_log_pkey PRIMARY KEY (id);


--
-- Name: audit_user_login audit_user_login_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_user_login
    ADD CONSTRAINT audit_user_login_pkey PRIMARY KEY (id);


--
-- Name: completion_status completion_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_status
    ADD CONSTRAINT completion_status_pkey PRIMARY KEY (completion_status_id);


--
-- Name: configuration configuration_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuration
    ADD CONSTRAINT configuration_key_key UNIQUE (key);


--
-- Name: configuration configuration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuration
    ADD CONSTRAINT configuration_pkey PRIMARY KEY (id);


--
-- Name: crf crf_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf
    ADD CONSTRAINT crf_pkey PRIMARY KEY (crf_id);


--
-- Name: crf_version_media crf_version_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf_version_media
    ADD CONSTRAINT crf_version_media_pkey PRIMARY KEY (crf_version_media_id);


--
-- Name: crf_version crf_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf_version
    ADD CONSTRAINT crf_version_pkey PRIMARY KEY (crf_version_id);


--
-- Name: databasechangeloglock databasechangeloglock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.databasechangeloglock
    ADD CONSTRAINT databasechangeloglock_pkey PRIMARY KEY (id);


--
-- Name: dataset_item_status dataset_item_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_item_status
    ADD CONSTRAINT dataset_item_status_pkey PRIMARY KEY (dataset_item_status_id);


--
-- Name: dataset dataset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset
    ADD CONSTRAINT dataset_pkey PRIMARY KEY (dataset_id);


--
-- Name: dc_computed_event dc_computed_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_computed_event
    ADD CONSTRAINT dc_computed_event_pkey PRIMARY KEY (dc_summary_event_id);


--
-- Name: dc_event dc_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_event
    ADD CONSTRAINT dc_event_pkey PRIMARY KEY (dc_event_id);


--
-- Name: dc_primitive dc_primitive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_primitive
    ADD CONSTRAINT dc_primitive_pkey PRIMARY KEY (dc_primitive_id);


--
-- Name: dc_section_event dc_section_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_section_event
    ADD CONSTRAINT dc_section_event_pkey PRIMARY KEY (dc_event_id);


--
-- Name: dc_send_email_event dc_send_email_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_send_email_event
    ADD CONSTRAINT dc_send_email_event_pkey PRIMARY KEY (dc_event_id);


--
-- Name: dc_substitution_event dc_substitution_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_substitution_event
    ADD CONSTRAINT dc_substitution_event_pkey PRIMARY KEY (dc_event_id);


--
-- Name: decision_condition decision_condition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_condition
    ADD CONSTRAINT decision_condition_pkey PRIMARY KEY (decision_condition_id);


--
-- Name: discrepancy_note discrepancy_note_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_note
    ADD CONSTRAINT discrepancy_note_pkey PRIMARY KEY (discrepancy_note_id);


--
-- Name: discrepancy_note_type discrepancy_note_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_note_type
    ADD CONSTRAINT discrepancy_note_type_pkey PRIMARY KEY (discrepancy_note_type_id);


--
-- Name: event_definition_crf_tag duplicate_crfpath_tag_uniqueness_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf_tag
    ADD CONSTRAINT duplicate_crfpath_tag_uniqueness_key UNIQUE (path, tag_id);


--
-- Name: study_event duplicate_event_uniqueness_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event
    ADD CONSTRAINT duplicate_event_uniqueness_key UNIQUE (study_event_definition_id, study_subject_id, sample_ordinal);


--
-- Name: event_definition_crf_item_tag duplicate_itempath_tag_uniqueness_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf_item_tag
    ADD CONSTRAINT duplicate_itempath_tag_uniqueness_key UNIQUE (path, tag_id);


--
-- Name: dyn_item_form_metadata dyn_item_form_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dyn_item_form_metadata
    ADD CONSTRAINT dyn_item_form_metadata_pkey PRIMARY KEY (id);


--
-- Name: dyn_item_group_metadata dyn_item_group_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dyn_item_group_metadata
    ADD CONSTRAINT dyn_item_group_metadata_pkey PRIMARY KEY (id);


--
-- Name: event_crf event_crf_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf
    ADD CONSTRAINT event_crf_pkey PRIMARY KEY (event_crf_id);


--
-- Name: event_definition_crf event_definition_crf_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf
    ADD CONSTRAINT event_definition_crf_pkey PRIMARY KEY (event_definition_crf_id);


--
-- Name: export_format export_format_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_format
    ADD CONSTRAINT export_format_pkey PRIMARY KEY (export_format_id);


--
-- Name: filter filter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.filter
    ADD CONSTRAINT filter_pkey PRIMARY KEY (filter_id);


--
-- Name: group_class_types group_class_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_class_types
    ADD CONSTRAINT group_class_types_pkey PRIMARY KEY (group_class_type_id);


--
-- Name: item_data item_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data
    ADD CONSTRAINT item_data_pkey PRIMARY KEY (item_data_id);


--
-- Name: item_data_type item_data_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data_type
    ADD CONSTRAINT item_data_type_pkey PRIMARY KEY (item_data_type_id);


--
-- Name: item_form_metadata item_form_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_form_metadata
    ADD CONSTRAINT item_form_metadata_pkey PRIMARY KEY (item_form_metadata_id);


--
-- Name: item_group_metadata item_group_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group_metadata
    ADD CONSTRAINT item_group_metadata_pkey PRIMARY KEY (item_group_metadata_id);


--
-- Name: item_group item_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group
    ADD CONSTRAINT item_group_pkey PRIMARY KEY (item_group_id);


--
-- Name: item item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item
    ADD CONSTRAINT item_pkey PRIMARY KEY (item_id);


--
-- Name: item_reference_type item_reference_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_reference_type
    ADD CONSTRAINT item_reference_type_pkey PRIMARY KEY (item_reference_type_id);


--
-- Name: measurement_unit measurement_unit_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_unit
    ADD CONSTRAINT measurement_unit_name_key UNIQUE (name);


--
-- Name: measurement_unit measurement_unit_oc_oid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_unit
    ADD CONSTRAINT measurement_unit_oc_oid_key UNIQUE (oc_oid);


--
-- Name: measurement_unit measurement_unit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_unit
    ADD CONSTRAINT measurement_unit_pkey PRIMARY KEY (id);


--
-- Name: null_value_type null_value_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.null_value_type
    ADD CONSTRAINT null_value_type_pkey PRIMARY KEY (null_value_type_id);


--
-- Name: oc_qrtz_blob_triggers oc_qrtz_blob_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_blob_triggers
    ADD CONSTRAINT oc_qrtz_blob_triggers_pkey PRIMARY KEY (trigger_name, trigger_group);


--
-- Name: oc_qrtz_calendars oc_qrtz_calendars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_calendars
    ADD CONSTRAINT oc_qrtz_calendars_pkey PRIMARY KEY (calendar_name);


--
-- Name: oc_qrtz_cron_triggers oc_qrtz_cron_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_cron_triggers
    ADD CONSTRAINT oc_qrtz_cron_triggers_pkey PRIMARY KEY (trigger_name, trigger_group);


--
-- Name: oc_qrtz_fired_triggers oc_qrtz_fired_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_fired_triggers
    ADD CONSTRAINT oc_qrtz_fired_triggers_pkey PRIMARY KEY (entry_id);


--
-- Name: oc_qrtz_job_details oc_qrtz_job_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_job_details
    ADD CONSTRAINT oc_qrtz_job_details_pkey PRIMARY KEY (job_name, job_group);


--
-- Name: oc_qrtz_job_listeners oc_qrtz_job_listeners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_job_listeners
    ADD CONSTRAINT oc_qrtz_job_listeners_pkey PRIMARY KEY (job_name, job_group, job_listener);


--
-- Name: oc_qrtz_locks oc_qrtz_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_locks
    ADD CONSTRAINT oc_qrtz_locks_pkey PRIMARY KEY (lock_name, sched_name);


--
-- Name: oc_qrtz_paused_trigger_grps oc_qrtz_paused_trigger_grps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_paused_trigger_grps
    ADD CONSTRAINT oc_qrtz_paused_trigger_grps_pkey PRIMARY KEY (trigger_group);


--
-- Name: oc_qrtz_scheduler_state oc_qrtz_scheduler_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_scheduler_state
    ADD CONSTRAINT oc_qrtz_scheduler_state_pkey PRIMARY KEY (instance_name);


--
-- Name: oc_qrtz_simple_triggers oc_qrtz_simple_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_simple_triggers
    ADD CONSTRAINT oc_qrtz_simple_triggers_pkey PRIMARY KEY (trigger_name, trigger_group);


--
-- Name: oc_qrtz_trigger_listeners oc_qrtz_trigger_listeners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_trigger_listeners
    ADD CONSTRAINT oc_qrtz_trigger_listeners_pkey PRIMARY KEY (trigger_name, trigger_group, trigger_listener);


--
-- Name: oc_qrtz_triggers oc_qrtz_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_triggers
    ADD CONSTRAINT oc_qrtz_triggers_pkey PRIMARY KEY (trigger_name, trigger_group);


--
-- Name: openclinica_version openclinica_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.openclinica_version
    ADD CONSTRAINT openclinica_version_pkey PRIMARY KEY (id);


--
-- Name: event_crf_flag pk_event_crf_flag; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf_flag
    ADD CONSTRAINT pk_event_crf_flag PRIMARY KEY (id);


--
-- Name: event_crf_flag_workflow pk_event_crf_flag_workflow; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf_flag_workflow
    ADD CONSTRAINT pk_event_crf_flag_workflow PRIMARY KEY (id);


--
-- Name: event_definition_crf_item_tag pk_event_definition_crf_item_tag; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf_item_tag
    ADD CONSTRAINT pk_event_definition_crf_item_tag PRIMARY KEY (id);


--
-- Name: event_definition_crf_tag pk_event_definition_crf_tag; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf_tag
    ADD CONSTRAINT pk_event_definition_crf_tag PRIMARY KEY (id);


--
-- Name: item_data_flag pk_item_data_flag; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data_flag
    ADD CONSTRAINT pk_item_data_flag PRIMARY KEY (id);


--
-- Name: item_data_flag_workflow pk_item_data_flag_workflow; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data_flag_workflow
    ADD CONSTRAINT pk_item_data_flag_workflow PRIMARY KEY (id);


--
-- Name: item_data pk_item_data_new; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data
    ADD CONSTRAINT pk_item_data_new UNIQUE (item_id, event_crf_id, ordinal);


--
-- Name: tag pk_tag; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT pk_tag PRIMARY KEY (id);


--
-- Name: privilege privilege_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privilege
    ADD CONSTRAINT privilege_pkey PRIMARY KEY (priv_id);


--
-- Name: resolution_status resolution_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resolution_status
    ADD CONSTRAINT resolution_status_pkey PRIMARY KEY (resolution_status_id);


--
-- Name: response_set response_set_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_set
    ADD CONSTRAINT response_set_pkey PRIMARY KEY (response_set_id);


--
-- Name: response_type response_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_type
    ADD CONSTRAINT response_type_pkey PRIMARY KEY (response_type_id);


--
-- Name: rule_action rule_action_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_action
    ADD CONSTRAINT rule_action_pkey PRIMARY KEY (id);


--
-- Name: rule_action_property rule_action_property_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_action_property
    ADD CONSTRAINT rule_action_property_pkey PRIMARY KEY (id);


--
-- Name: rule_action_run_log rule_action_run_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_action_run_log
    ADD CONSTRAINT rule_action_run_log_pkey PRIMARY KEY (id);


--
-- Name: rule_action_run rule_action_run_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_action_run
    ADD CONSTRAINT rule_action_run_pkey PRIMARY KEY (id);


--
-- Name: rule_action_stratification_factor rule_action_stratification_factor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_action_stratification_factor
    ADD CONSTRAINT rule_action_stratification_factor_pkey PRIMARY KEY (id);


--
-- Name: rule_expression rule_expression_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_expression
    ADD CONSTRAINT rule_expression_pkey PRIMARY KEY (id);


--
-- Name: rule rule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule
    ADD CONSTRAINT rule_pkey PRIMARY KEY (id);


--
-- Name: rule_set_audit rule_set_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_set_audit
    ADD CONSTRAINT rule_set_audit_pkey PRIMARY KEY (id);


--
-- Name: rule_set rule_set_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_set
    ADD CONSTRAINT rule_set_pkey PRIMARY KEY (id);


--
-- Name: rule_set_rule_audit rule_set_rule_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_set_rule_audit
    ADD CONSTRAINT rule_set_rule_audit_pkey PRIMARY KEY (id);


--
-- Name: rule_set_rule rule_set_rule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_set_rule
    ADD CONSTRAINT rule_set_rule_pkey PRIMARY KEY (id);


--
-- Name: scd_item_metadata scd_item_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scd_item_metadata
    ADD CONSTRAINT scd_item_metadata_pkey PRIMARY KEY (id);


--
-- Name: section section_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.section
    ADD CONSTRAINT section_pkey PRIMARY KEY (section_id);


--
-- Name: status status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status
    ADD CONSTRAINT status_pkey PRIMARY KEY (status_id);


--
-- Name: study_event_definition study_event_definition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event_definition
    ADD CONSTRAINT study_event_definition_pkey PRIMARY KEY (study_event_definition_id);


--
-- Name: study_event study_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event
    ADD CONSTRAINT study_event_pkey PRIMARY KEY (study_event_id);


--
-- Name: study_group_class study_group_class_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_group_class
    ADD CONSTRAINT study_group_class_pkey PRIMARY KEY (study_group_class_id);


--
-- Name: study_group study_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_group
    ADD CONSTRAINT study_group_pkey PRIMARY KEY (study_group_id);


--
-- Name: study_module_status study_module_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_module_status
    ADD CONSTRAINT study_module_status_pkey PRIMARY KEY (id);


--
-- Name: study_parameter study_parameter_handle_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_parameter
    ADD CONSTRAINT study_parameter_handle_key UNIQUE (handle);


--
-- Name: study_parameter study_parameter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_parameter
    ADD CONSTRAINT study_parameter_pkey PRIMARY KEY (study_parameter_id);


--
-- Name: study study_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study
    ADD CONSTRAINT study_pkey PRIMARY KEY (study_id);


--
-- Name: study_subject study_subject_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_subject
    ADD CONSTRAINT study_subject_pkey PRIMARY KEY (study_subject_id);


--
-- Name: study_type study_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_type
    ADD CONSTRAINT study_type_pkey PRIMARY KEY (study_type_id);


--
-- Name: subject_event_status subject_event_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_event_status
    ADD CONSTRAINT subject_event_status_pkey PRIMARY KEY (subject_event_status_id);


--
-- Name: subject_group_map subject_group_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_group_map
    ADD CONSTRAINT subject_group_map_pkey PRIMARY KEY (subject_group_map_id);


--
-- Name: subject subject_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject
    ADD CONSTRAINT subject_pkey PRIMARY KEY (subject_id);


--
-- Name: crf uniq_crf_oc_oid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf
    ADD CONSTRAINT uniq_crf_oc_oid UNIQUE (oc_oid);


--
-- Name: crf_version uniq_crf_version_oc_oid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf_version
    ADD CONSTRAINT uniq_crf_version_oc_oid UNIQUE (oc_oid);


--
-- Name: item_group uniq_item_group_oc_oid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group
    ADD CONSTRAINT uniq_item_group_oc_oid UNIQUE (oc_oid);


--
-- Name: item uniq_item_oc_oid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item
    ADD CONSTRAINT uniq_item_oc_oid UNIQUE (oc_oid);


--
-- Name: event_crf uniq_study_event_crf_version_study_subject; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf
    ADD CONSTRAINT uniq_study_event_crf_version_study_subject UNIQUE (study_event_id, crf_version_id, study_subject_id);


--
-- Name: study_event_definition uniq_study_event_def_oid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event_definition
    ADD CONSTRAINT uniq_study_event_def_oid UNIQUE (oc_oid);


--
-- Name: event_definition_crf uniq_study_event_def_study_crf; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf
    ADD CONSTRAINT uniq_study_event_def_study_crf UNIQUE (study_event_definition_id, study_id, crf_id);


--
-- Name: study uniq_study_oid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study
    ADD CONSTRAINT uniq_study_oid UNIQUE (oc_oid);


--
-- Name: study_subject uniq_study_subject_oid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_subject
    ADD CONSTRAINT uniq_study_subject_oid UNIQUE (oc_oid);


--
-- Name: usage_statistics_data usage_statistics_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_statistics_data
    ADD CONSTRAINT usage_statistics_data_pkey PRIMARY KEY (id);


--
-- Name: user_account user_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_pkey PRIMARY KEY (user_id);


--
-- Name: user_role user_role_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role
    ADD CONSTRAINT user_role_pkey PRIMARY KEY (role_id);


--
-- Name: user_type user_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_type
    ADD CONSTRAINT user_type_pkey PRIMARY KEY (user_type_id);


--
-- Name: crf_version_idx_crf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crf_version_idx_crf ON public.crf_version USING btree (crf_id);


--
-- Name: discrepancy_note_idx_entity_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discrepancy_note_idx_entity_type ON public.discrepancy_note USING btree (entity_type);


--
-- Name: discrepancy_note_idx_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discrepancy_note_idx_parent ON public.discrepancy_note USING btree (discrepancy_note_id) WHERE ((parent_dn_id IS NULL) OR (parent_dn_id = 0));


--
-- Name: event_definition_crf_idx_crf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_definition_crf_idx_crf ON public.event_definition_crf USING btree (crf_id);


--
-- Name: event_definition_crf_idx_parent_null; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_definition_crf_idx_parent_null ON public.event_definition_crf USING btree (parent_id) WHERE (parent_id IS NULL);


--
-- Name: event_definition_crf_idx_parent_zero; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_definition_crf_idx_parent_zero ON public.event_definition_crf USING btree (parent_id) WHERE ((parent_id IS NOT NULL) OR (parent_id <> 0));


--
-- Name: event_definition_crf_idx_study_event_definition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_definition_crf_idx_study_event_definition ON public.event_definition_crf USING btree (study_event_definition_id);


--
-- Name: i_audit_event_audit_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_audit_event_audit_table ON public.audit_event USING btree (audit_table);


--
-- Name: i_audit_event_context_study_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_audit_event_context_study_id ON public.audit_event_context USING btree (study_id);


--
-- Name: i_audit_event_entity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_audit_event_entity_id ON public.audit_event USING btree (entity_id);


--
-- Name: i_audit_event_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_audit_event_user_id ON public.audit_event USING btree (user_id);


--
-- Name: i_audit_log_event_audit_log_event_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_audit_log_event_audit_log_event_type_id ON public.audit_log_event USING btree (audit_log_event_type_id);


--
-- Name: i_audit_log_event_audit_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_audit_log_event_audit_table ON public.audit_log_event USING btree (audit_table);


--
-- Name: i_audit_log_event_entity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_audit_log_event_entity_id ON public.audit_log_event USING btree (entity_id);


--
-- Name: i_audit_log_event_event_crf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_audit_log_event_event_crf_id ON public.audit_log_event USING btree (event_crf_id);


--
-- Name: i_audit_log_event_event_crf_version_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_audit_log_event_event_crf_version_id ON public.audit_log_event USING btree (event_crf_version_id);


--
-- Name: i_audit_log_event_study_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_audit_log_event_study_event_id ON public.audit_log_event USING btree (study_event_id);


--
-- Name: i_audit_log_event_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_audit_log_event_user_id ON public.audit_log_event USING btree (user_id);


--
-- Name: i_completion_status_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_completion_status_status_id ON public.completion_status USING btree (status_id);


--
-- Name: i_crf_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_crf_name ON public.crf USING btree (name);


--
-- Name: i_crf_oc_oid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_crf_oc_oid ON public.crf USING btree (oc_oid);


--
-- Name: i_crf_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_crf_owner_id ON public.crf USING btree (owner_id);


--
-- Name: i_crf_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_crf_status_id ON public.crf USING btree (status_id);


--
-- Name: i_crf_version_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_crf_version_name ON public.crf_version USING btree (name);


--
-- Name: i_crf_version_oc_oid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_crf_version_oc_oid ON public.crf_version USING btree (oc_oid);


--
-- Name: i_crf_version_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_crf_version_status_id ON public.crf_version USING btree (status_id);


--
-- Name: i_dataset_crf_version_map_dataset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dataset_crf_version_map_dataset_id ON public.dataset_crf_version_map USING btree (dataset_id);


--
-- Name: i_dataset_crf_version_map_event_definition_crf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dataset_crf_version_map_event_definition_crf_id ON public.dataset_crf_version_map USING btree (event_definition_crf_id);


--
-- Name: i_dataset_filter_map_dataset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dataset_filter_map_dataset_id ON public.dataset_filter_map USING btree (dataset_id);


--
-- Name: i_dataset_filter_map_filter_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dataset_filter_map_filter_id ON public.dataset_filter_map USING btree (filter_id);


--
-- Name: i_dataset_filter_map_ordinal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dataset_filter_map_ordinal ON public.dataset_filter_map USING btree (ordinal);


--
-- Name: i_dataset_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dataset_status_id ON public.dataset USING btree (status_id);


--
-- Name: i_dataset_study_group_class_map_dataset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dataset_study_group_class_map_dataset_id ON public.dataset_study_group_class_map USING btree (dataset_id);


--
-- Name: i_dataset_study_group_class_map_study_group_class_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dataset_study_group_class_map_study_group_class_id ON public.dataset_study_group_class_map USING btree (study_group_class_id);


--
-- Name: i_dc_computed_event_dc_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dc_computed_event_dc_event_id ON public.dc_computed_event USING btree (dc_event_id);


--
-- Name: i_dc_computed_event_item_target_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dc_computed_event_item_target_id ON public.dc_computed_event USING btree (item_target_id);


--
-- Name: i_dc_primitive_decision_condition_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dc_primitive_decision_condition_id ON public.dc_primitive USING btree (decision_condition_id);


--
-- Name: i_dc_primitive_dynamic_value_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dc_primitive_dynamic_value_item_id ON public.dc_primitive USING btree (dynamic_value_item_id);


--
-- Name: i_dc_primitive_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dc_primitive_item_id ON public.dc_primitive USING btree (item_id);


--
-- Name: i_dc_section_event_section_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dc_section_event_section_id ON public.dc_section_event USING btree (section_id);


--
-- Name: i_dc_substitution_event_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dc_substitution_event_item_id ON public.dc_substitution_event USING btree (item_id);


--
-- Name: i_dc_summary_item_map_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dc_summary_item_map_item_id ON public.dc_summary_item_map USING btree (item_id);


--
-- Name: i_decision_condition_crf_version_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_decision_condition_crf_version_id ON public.decision_condition USING btree (crf_version_id);


--
-- Name: i_decision_condition_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_decision_condition_status_id ON public.decision_condition USING btree (status_id);


--
-- Name: i_didm_column_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_didm_column_name ON public.dn_item_data_map USING btree (column_name);


--
-- Name: i_difm_event_crf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_difm_event_crf_id ON public.dyn_item_form_metadata USING btree (event_crf_id);


--
-- Name: i_difm_item_data_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_difm_item_data_id ON public.dyn_item_form_metadata USING btree (item_data_id);


--
-- Name: i_difm_item_form_metadata_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_difm_item_form_metadata_id ON public.dyn_item_form_metadata USING btree (item_form_metadata_id);


--
-- Name: i_difm_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_difm_item_id ON public.dyn_item_form_metadata USING btree (item_id);


--
-- Name: i_difm_show_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_difm_show_item ON public.dyn_item_form_metadata USING btree (show_item);


--
-- Name: i_digm_event_crf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_digm_event_crf_id ON public.dyn_item_group_metadata USING btree (event_crf_id);


--
-- Name: i_digm_item_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_digm_item_group_id ON public.dyn_item_group_metadata USING btree (item_group_id);


--
-- Name: i_digm_item_group_metadata_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_digm_item_group_metadata_id ON public.dyn_item_group_metadata USING btree (item_group_metadata_id);


--
-- Name: i_digm_show_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_digm_show_group ON public.dyn_item_group_metadata USING btree (show_group);


--
-- Name: i_discrepancy_note_discrepancy_note_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_discrepancy_note_discrepancy_note_type_id ON public.discrepancy_note USING btree (discrepancy_note_type_id);


--
-- Name: i_discrepancy_note_entity_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_discrepancy_note_entity_type ON public.discrepancy_note USING btree (entity_type);


--
-- Name: i_discrepancy_note_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_discrepancy_note_owner_id ON public.discrepancy_note USING btree (owner_id);


--
-- Name: i_discrepancy_note_parent_dn_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_discrepancy_note_parent_dn_id ON public.discrepancy_note USING btree (parent_dn_id);


--
-- Name: i_discrepancy_note_resolution_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_discrepancy_note_resolution_status_id ON public.discrepancy_note USING btree (resolution_status_id);


--
-- Name: i_discrepancy_note_study_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_discrepancy_note_study_id ON public.discrepancy_note USING btree (study_id);


--
-- Name: i_dn_event_crf_map_discrepancy_note_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dn_event_crf_map_discrepancy_note_id ON public.dn_event_crf_map USING btree (discrepancy_note_id);


--
-- Name: i_dn_event_crf_map_event_crf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dn_event_crf_map_event_crf_id ON public.dn_event_crf_map USING btree (event_crf_id);


--
-- Name: i_dn_item_data_map_discrepancy_note_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dn_item_data_map_discrepancy_note_id ON public.dn_item_data_map USING btree (discrepancy_note_id);


--
-- Name: i_dn_item_data_map_item_data_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dn_item_data_map_item_data_id ON public.dn_item_data_map USING btree (item_data_id);


--
-- Name: i_dn_study_event_map_discrepancy_note_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dn_study_event_map_discrepancy_note_id ON public.dn_study_event_map USING btree (discrepancy_note_id);


--
-- Name: i_dn_study_event_map_study_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dn_study_event_map_study_event_id ON public.dn_study_event_map USING btree (study_event_id);


--
-- Name: i_dn_study_subject_map_discrepancy_note_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dn_study_subject_map_discrepancy_note_id ON public.dn_study_subject_map USING btree (discrepancy_note_id);


--
-- Name: i_dn_study_subject_map_study_subject_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dn_study_subject_map_study_subject_id ON public.dn_study_subject_map USING btree (study_subject_id);


--
-- Name: i_dn_subject_map_discrepancy_note_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dn_subject_map_discrepancy_note_id ON public.dn_subject_map USING btree (discrepancy_note_id);


--
-- Name: i_dn_subject_map_subject_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_dn_subject_map_subject_id ON public.dn_subject_map USING btree (subject_id);


--
-- Name: i_event_crf_completion_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_crf_completion_status_id ON public.event_crf USING btree (completion_status_id);


--
-- Name: i_event_crf_date_interviewed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_crf_date_interviewed ON public.event_crf USING btree (date_interviewed);


--
-- Name: i_event_crf_interviewer_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_crf_interviewer_name ON public.event_crf USING btree (interviewer_name);


--
-- Name: i_event_crf_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_crf_owner_id ON public.event_crf USING btree (owner_id);


--
-- Name: i_event_crf_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_crf_status_id ON public.event_crf USING btree (status_id);


--
-- Name: i_event_crf_study_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_crf_study_event_id ON public.event_crf USING btree (study_event_id);


--
-- Name: i_event_crf_study_subject_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_crf_study_subject_id ON public.event_crf USING btree (study_subject_id);


--
-- Name: i_event_crf_validator_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_crf_validator_id ON public.event_crf USING btree (validator_id);


--
-- Name: i_event_definition_crf_crf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_definition_crf_crf_id ON public.event_definition_crf USING btree (crf_id);


--
-- Name: i_event_definition_crf_default_version_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_definition_crf_default_version_id ON public.event_definition_crf USING btree (default_version_id);


--
-- Name: i_event_definition_crf_electronic_signature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_definition_crf_electronic_signature ON public.event_definition_crf USING btree (electronic_signature);


--
-- Name: i_event_definition_crf_ordinal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_definition_crf_ordinal ON public.event_definition_crf USING btree (ordinal);


--
-- Name: i_event_definition_crf_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_definition_crf_status_id ON public.event_definition_crf USING btree (status_id);


--
-- Name: i_event_definition_crf_study_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_event_definition_crf_study_id ON public.event_definition_crf USING btree (study_id);


--
-- Name: i_filter_crf_version_map_crf_version_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_filter_crf_version_map_crf_version_id ON public.filter_crf_version_map USING btree (crf_version_id);


--
-- Name: i_filter_crf_version_map_filter_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_filter_crf_version_map_filter_id ON public.filter_crf_version_map USING btree (filter_id);


--
-- Name: i_ifm_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_ifm_item_id ON public.item_form_metadata USING btree (item_id);


--
-- Name: i_ifm_response_set_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_ifm_response_set_id ON public.item_form_metadata USING btree (response_set_id);


--
-- Name: i_ifm_section_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_ifm_section_id ON public.item_form_metadata USING btree (section_id);


--
-- Name: i_item_data_event_crf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_data_event_crf_id ON public.item_data USING btree (event_crf_id);


--
-- Name: i_item_data_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_data_item_id ON public.item_data USING btree (item_id);


--
-- Name: i_item_data_ordinal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_data_ordinal ON public.item_data USING btree (ordinal);


--
-- Name: i_item_data_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_data_status_id ON public.item_data USING btree (status_id);


--
-- Name: i_item_form_metadata_decision_condition_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_form_metadata_decision_condition_id ON public.item_form_metadata USING btree (decision_condition_id);


--
-- Name: i_item_form_metadata_ordinal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_form_metadata_ordinal ON public.item_form_metadata USING btree (ordinal);


--
-- Name: i_item_form_metadata_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_form_metadata_parent_id ON public.item_form_metadata USING btree (parent_id);


--
-- Name: i_item_group_crf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_group_crf_id ON public.item_group USING btree (crf_id);


--
-- Name: i_item_group_metadata_crf_version_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_group_metadata_crf_version_id ON public.item_group_metadata USING btree (crf_version_id);


--
-- Name: i_item_group_metadata_item_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_group_metadata_item_group_id ON public.item_group_metadata USING btree (item_group_id);


--
-- Name: i_item_group_metadata_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_group_metadata_item_id ON public.item_group_metadata USING btree (item_id);


--
-- Name: i_item_group_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_group_status_id ON public.item_group USING btree (status_id);


--
-- Name: i_item_item_data_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_item_data_type_id ON public.item USING btree (item_data_type_id);


--
-- Name: i_item_item_reference_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_item_reference_type_id ON public.item USING btree (item_reference_type_id);


--
-- Name: i_item_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_name ON public.item USING btree (name);


--
-- Name: i_item_oc_oid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_oc_oid ON public.item USING btree (oc_oid);


--
-- Name: i_item_units; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_item_units ON public.item USING btree (units);


--
-- Name: i_itm_form_metadata_crf_ver_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_itm_form_metadata_crf_ver_id ON public.item_form_metadata USING btree (crf_version_id);


--
-- Name: i_key_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_key_index ON public.configuration USING btree (key);


--
-- Name: i_null_value_type_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_null_value_type_code ON public.null_value_type USING btree (code);


--
-- Name: i_rule_action_action_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_action_action_type ON public.rule_action USING btree (action_type);


--
-- Name: i_rule_action_rule_set_rule_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_action_rule_set_rule_id ON public.rule_action USING btree (rule_set_rule_id);


--
-- Name: i_rule_action_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_action_status_id ON public.rule_action USING btree (status_id);


--
-- Name: i_rule_expression_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_expression_status_id ON public.rule_expression USING btree (status_id);


--
-- Name: i_rule_oc_oid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_oc_oid ON public.rule USING btree (oc_oid);


--
-- Name: i_rule_rule_expression_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_rule_expression_id ON public.rule USING btree (rule_expression_id);


--
-- Name: i_rule_set_audit_rule_set_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_audit_rule_set_id ON public.rule_set_audit USING btree (rule_set_id);


--
-- Name: i_rule_set_audit_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_audit_status_id ON public.rule_set_audit USING btree (status_id);


--
-- Name: i_rule_set_crf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_crf_id ON public.rule_set USING btree (crf_id);


--
-- Name: i_rule_set_crf_version_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_crf_version_id ON public.rule_set USING btree (crf_version_id);


--
-- Name: i_rule_set_rule_audit_rule_set_rule_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_rule_audit_rule_set_rule_id ON public.rule_set_rule_audit USING btree (rule_set_rule_id);


--
-- Name: i_rule_set_rule_audit_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_rule_audit_status_id ON public.rule_set_rule_audit USING btree (status_id);


--
-- Name: i_rule_set_rule_expression_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_rule_expression_id ON public.rule_set USING btree (rule_expression_id);


--
-- Name: i_rule_set_rule_rule_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_rule_rule_id ON public.rule_set_rule USING btree (rule_id);


--
-- Name: i_rule_set_rule_rule_set_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_rule_rule_set_id ON public.rule_set_rule USING btree (rule_set_id);


--
-- Name: i_rule_set_rule_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_rule_status_id ON public.rule_set_rule USING btree (status_id);


--
-- Name: i_rule_set_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_status_id ON public.rule_set USING btree (status_id);


--
-- Name: i_rule_set_study_event_definition_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_study_event_definition_id ON public.rule_set USING btree (study_event_definition_id);


--
-- Name: i_rule_set_study_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_set_study_id ON public.rule_set USING btree (study_id);


--
-- Name: i_rule_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_rule_status_id ON public.rule USING btree (status_id);


--
-- Name: i_section_ordinal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_section_ordinal ON public.section USING btree (ordinal);


--
-- Name: i_section_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_section_parent_id ON public.section USING btree (parent_id);


--
-- Name: i_section_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_section_status_id ON public.section USING btree (status_id);


--
-- Name: i_study_event_date_end; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_event_date_end ON public.study_event USING btree (date_end);


--
-- Name: i_study_event_date_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_event_date_start ON public.study_event USING btree (date_start);


--
-- Name: i_study_event_definition_oc_oid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_event_definition_oc_oid ON public.study_event_definition USING btree (oc_oid);


--
-- Name: i_study_event_definition_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_event_definition_status_id ON public.study_event_definition USING btree (status_id);


--
-- Name: i_study_event_definition_update_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_event_definition_update_id ON public.study_event_definition USING btree (update_id);


--
-- Name: i_study_event_sample_ordinal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_event_sample_ordinal ON public.study_event USING btree (sample_ordinal);


--
-- Name: i_study_event_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_event_status_id ON public.study_event USING btree (status_id);


--
-- Name: i_study_event_subject_event_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_event_subject_event_status_id ON public.study_event USING btree (subject_event_status_id);


--
-- Name: i_study_group_class_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_group_class_status_id ON public.study_group_class USING btree (status_id);


--
-- Name: i_study_group_class_study_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_group_class_study_id ON public.study_group_class USING btree (study_id);


--
-- Name: i_study_oc_oid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_oc_oid ON public.study USING btree (oc_oid);


--
-- Name: i_study_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_owner_id ON public.study USING btree (owner_id);


--
-- Name: i_study_parameter_value_study_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_parameter_value_study_id ON public.study_parameter_value USING btree (study_id);


--
-- Name: i_study_parent_study_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_parent_study_id ON public.study USING btree (parent_study_id);


--
-- Name: i_study_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_status_id ON public.study USING btree (status_id);


--
-- Name: i_study_subject_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_subject_label ON public.study_subject USING btree (label);


--
-- Name: i_study_subject_oc_oid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_subject_oc_oid ON public.study_subject USING btree (oc_oid);


--
-- Name: i_study_subject_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_subject_status_id ON public.study_subject USING btree (status_id);


--
-- Name: i_study_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_type_id ON public.study USING btree (type_id);


--
-- Name: i_study_unique_identifier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_unique_identifier ON public.study USING btree (name);


--
-- Name: i_study_user_role_user_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_study_user_role_user_name ON public.study_user_role USING btree (user_name);


--
-- Name: i_subject_date_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_subject_date_created ON public.subject USING btree (date_created);


--
-- Name: i_subject_date_of_birth; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_subject_date_of_birth ON public.subject USING btree (date_of_birth);


--
-- Name: i_subject_gender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_subject_gender ON public.subject USING btree (gender);


--
-- Name: i_subject_group_map_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_subject_group_map_status_id ON public.subject_group_map USING btree (status_id);


--
-- Name: i_subject_group_map_study_group_class_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_subject_group_map_study_group_class_id ON public.subject_group_map USING btree (study_group_class_id);


--
-- Name: i_subject_unique_identifier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_subject_unique_identifier ON public.subject USING btree (unique_identifier);


--
-- Name: i_user_account_user_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_user_account_user_name ON public.user_account USING btree (user_name);


--
-- Name: i_versioning_map_crf_version_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_versioning_map_crf_version_id ON public.versioning_map USING btree (crf_version_id);


--
-- Name: i_versioning_map_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX i_versioning_map_item_id ON public.versioning_map USING btree (item_id);


--
-- Name: idx_audit_user_api_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user_api_log_created_at ON public.audit_user_api_log USING btree (created_at);


--
-- Name: idx_audit_user_api_log_endpoint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user_api_log_endpoint ON public.audit_user_api_log USING btree (endpoint_path);


--
-- Name: idx_audit_user_api_log_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user_api_log_user_id ON public.audit_user_api_log USING btree (user_id);


--
-- Name: ix1_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix1_study ON public.study USING btree (mail_notification);


--
-- Name: ix1_user_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix1_user_account ON public.user_account USING btree (authtype);


--
-- Name: ix2_user_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix2_user_account ON public.user_account USING btree (authsecret);


--
-- Name: study_event_idx_study_event_definition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX study_event_idx_study_event_definition ON public.study_event USING btree (study_event_definition_id);


--
-- Name: study_subject_idx_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX study_subject_idx_study ON public.study_subject USING btree (study_id);


--
-- Name: dn_item_data_map didm_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER didm_update AFTER INSERT ON public.dn_item_data_map FOR EACH ROW EXECUTE FUNCTION public.populate_ssid_in_didm_trigger();


--
-- Name: event_crf event_crf_initial; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_crf_initial AFTER INSERT ON public.event_crf FOR EACH ROW EXECUTE FUNCTION public.event_crf_initial_trigger();


--
-- Name: event_crf event_crf_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_crf_update AFTER UPDATE ON public.event_crf FOR EACH ROW EXECUTE FUNCTION public.event_crf_trigger();


--
-- Name: event_crf event_crf_update_1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_crf_update_1 AFTER UPDATE ON public.event_crf FOR EACH ROW EXECUTE FUNCTION public.event_crf_version_change_trigger();


--
-- Name: event_definition_crf event_definition_crf_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_definition_crf_update AFTER UPDATE ON public.event_definition_crf FOR EACH ROW EXECUTE FUNCTION public.event_definition_crf_trigger();


--
-- Name: subject global_subject_insert_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER global_subject_insert_update AFTER INSERT OR UPDATE ON public.subject FOR EACH ROW EXECUTE FUNCTION public.global_subject_trigger();


--
-- Name: item_data item_data_initial; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER item_data_initial AFTER INSERT ON public.item_data FOR EACH ROW EXECUTE FUNCTION public.item_data_initial_trigger();


--
-- Name: item_data item_data_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER item_data_update AFTER DELETE OR UPDATE ON public.item_data FOR EACH ROW EXECUTE FUNCTION public.item_data_trigger();


--
-- Name: item_data repeating_data_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER repeating_data_insert AFTER INSERT ON public.item_data FOR EACH ROW EXECUTE FUNCTION public.repeating_item_data_trigger();


--
-- Name: study_event study_event_insert_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER study_event_insert_update AFTER UPDATE ON public.study_event FOR EACH ROW EXECUTE FUNCTION public.study_event_trigger_new();


--
-- Name: study_subject study_subject_insert_updare; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER study_subject_insert_updare AFTER INSERT OR UPDATE ON public.study_subject FOR EACH ROW EXECUTE FUNCTION public.study_subject_trigger();


--
-- Name: subject_group_map subject_group_map_insert_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subject_group_map_insert_update AFTER INSERT OR UPDATE ON public.subject_group_map FOR EACH ROW EXECUTE FUNCTION public.subject_group_assignment_trigger();


--
-- Name: audit_user_api_log audit_user_api_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_user_api_log
    ADD CONSTRAINT audit_user_api_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_account(user_id) ON DELETE SET NULL;


--
-- Name: dataset dataset_fk_dataset_item_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset
    ADD CONSTRAINT dataset_fk_dataset_item_status FOREIGN KEY (dataset_item_status_id) REFERENCES public.dataset_item_status(dataset_item_status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: discrepancy_note discrepancy_note_asn_u_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_note
    ADD CONSTRAINT discrepancy_note_asn_u_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: discrepancy_note discrepancy_note_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_note
    ADD CONSTRAINT discrepancy_note_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: discrepancy_note discrepancy_note_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_note
    ADD CONSTRAINT discrepancy_note_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.study(study_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: discrepancy_note dn_discrepancy_note_type_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_note
    ADD CONSTRAINT dn_discrepancy_note_type_id_fk FOREIGN KEY (discrepancy_note_type_id) REFERENCES public.discrepancy_note_type(discrepancy_note_type_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dn_event_crf_map dn_event_crf_map_dn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dn_event_crf_map
    ADD CONSTRAINT dn_event_crf_map_dn_id_fkey FOREIGN KEY (discrepancy_note_id) REFERENCES public.discrepancy_note(discrepancy_note_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dn_event_crf_map dn_evnt_crf_map_evnt_crf_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dn_event_crf_map
    ADD CONSTRAINT dn_evnt_crf_map_evnt_crf_id_fk FOREIGN KEY (event_crf_id) REFERENCES public.event_crf(event_crf_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dn_item_data_map dn_item_data_map_dn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dn_item_data_map
    ADD CONSTRAINT dn_item_data_map_dn_id_fkey FOREIGN KEY (discrepancy_note_id) REFERENCES public.discrepancy_note(discrepancy_note_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dn_item_data_map dn_itm_data_map_itm_data_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dn_item_data_map
    ADD CONSTRAINT dn_itm_data_map_itm_data_id_fk FOREIGN KEY (item_data_id) REFERENCES public.item_data(item_data_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: discrepancy_note dn_resolution_status_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_note
    ADD CONSTRAINT dn_resolution_status_id_fkey FOREIGN KEY (resolution_status_id) REFERENCES public.resolution_status(resolution_status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dn_study_event_map dn_sem_study_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dn_study_event_map
    ADD CONSTRAINT dn_sem_study_event_id_fkey FOREIGN KEY (study_event_id) REFERENCES public.study_event(study_event_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dn_study_subject_map dn_ssm_study_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dn_study_subject_map
    ADD CONSTRAINT dn_ssm_study_subject_id_fkey FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dn_study_event_map dn_study_event_map_dn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dn_study_event_map
    ADD CONSTRAINT dn_study_event_map_dn_id_fkey FOREIGN KEY (discrepancy_note_id) REFERENCES public.discrepancy_note(discrepancy_note_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dn_study_subject_map dn_study_subject_map_dn_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dn_study_subject_map
    ADD CONSTRAINT dn_study_subject_map_dn_id_fk FOREIGN KEY (discrepancy_note_id) REFERENCES public.discrepancy_note(discrepancy_note_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dn_subject_map dn_subject_map_dn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dn_subject_map
    ADD CONSTRAINT dn_subject_map_dn_id_fkey FOREIGN KEY (discrepancy_note_id) REFERENCES public.discrepancy_note(discrepancy_note_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dn_subject_map dn_subject_map_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dn_subject_map
    ADD CONSTRAINT dn_subject_map_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item_data fk_answer_reference_item; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data
    ADD CONSTRAINT fk_answer_reference_item FOREIGN KEY (item_id) REFERENCES public.item(item_id) ON UPDATE RESTRICT;


--
-- Name: archived_dataset_file fk_archived_reference_dataset; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archived_dataset_file
    ADD CONSTRAINT fk_archived_reference_dataset FOREIGN KEY (dataset_id) REFERENCES public.dataset(dataset_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: archived_dataset_file fk_archived_reference_export_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archived_dataset_file
    ADD CONSTRAINT fk_archived_reference_export_f FOREIGN KEY (export_format_id) REFERENCES public.export_format(export_format_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: audit_event_context fk_audit_ev_reference_audit_ev; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event_context
    ADD CONSTRAINT fk_audit_ev_reference_audit_ev FOREIGN KEY (audit_id) REFERENCES public.audit_event(audit_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: audit_event_values fk_audit_lo_ref_audit_lo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event_values
    ADD CONSTRAINT fk_audit_lo_ref_audit_lo FOREIGN KEY (audit_id) REFERENCES public.audit_event(audit_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: audit_user_login fk_audit_user_login_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_user_login
    ADD CONSTRAINT fk_audit_user_login_id FOREIGN KEY (user_account_id) REFERENCES public.user_account(user_id);


--
-- Name: completion_status fk_completi_fk_comple_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_status
    ADD CONSTRAINT fk_completi_fk_comple_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: crf fk_crf_crf_user_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf
    ADD CONSTRAINT fk_crf_crf_user_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: crf fk_crf_fk_crf_fk_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf
    ADD CONSTRAINT fk_crf_fk_crf_fk_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item_group_metadata fk_crf_metadata; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group_metadata
    ADD CONSTRAINT fk_crf_metadata FOREIGN KEY (crf_version_id) REFERENCES public.crf_version(crf_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: crf_version fk_crf_vers_crf_versi_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf_version
    ADD CONSTRAINT fk_crf_vers_crf_versi_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: crf_version fk_crf_vers_fk_crf_ve_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf_version
    ADD CONSTRAINT fk_crf_vers_fk_crf_ve_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: crf_version_media fk_crf_version_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf_version_media
    ADD CONSTRAINT fk_crf_version_id FOREIGN KEY (crf_version_id) REFERENCES public.crf_version(crf_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dataset_crf_version_map fk_dataset__ref_event_event_de; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_crf_version_map
    ADD CONSTRAINT fk_dataset__ref_event_event_de FOREIGN KEY (event_definition_crf_id) REFERENCES public.event_definition_crf(event_definition_crf_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dataset_crf_version_map fk_dataset_crf_ref_dataset; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_crf_version_map
    ADD CONSTRAINT fk_dataset_crf_ref_dataset FOREIGN KEY (dataset_id) REFERENCES public.dataset(dataset_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dataset fk_dataset_fk_datase_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset
    ADD CONSTRAINT fk_dataset_fk_datase_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dataset fk_dataset_fk_datase_study; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset
    ADD CONSTRAINT fk_dataset_fk_datase_study FOREIGN KEY (study_id) REFERENCES public.study(study_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dataset fk_dataset_fk_datase_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset
    ADD CONSTRAINT fk_dataset_fk_datase_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dataset_study_group_class_map fk_dataset_ref_study_grp_class; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_study_group_class_map
    ADD CONSTRAINT fk_dataset_ref_study_grp_class FOREIGN KEY (study_group_class_id) REFERENCES public.study_group_class(study_group_class_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dataset_filter_map fk_dataset_reference_dataset; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_filter_map
    ADD CONSTRAINT fk_dataset_reference_dataset FOREIGN KEY (dataset_id) REFERENCES public.dataset(dataset_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dataset_filter_map fk_dataset_reference_filter; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_filter_map
    ADD CONSTRAINT fk_dataset_reference_filter FOREIGN KEY (filter_id) REFERENCES public.filter(filter_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dataset_study_group_class_map fk_dataset_study_ref_dataset; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_study_group_class_map
    ADD CONSTRAINT fk_dataset_study_ref_dataset FOREIGN KEY (dataset_id) REFERENCES public.dataset(dataset_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dc_computed_event fk_dc_compu_fk_dc_com_dc_event; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_computed_event
    ADD CONSTRAINT fk_dc_compu_fk_dc_com_dc_event FOREIGN KEY (dc_event_id) REFERENCES public.dc_event(dc_event_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dc_event fk_dc_event_fk_dc_eve_decision; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_event
    ADD CONSTRAINT fk_dc_event_fk_dc_eve_decision FOREIGN KEY (decision_condition_id) REFERENCES public.decision_condition(decision_condition_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dc_primitive fk_dc_primi_fk_dc_pri_decision; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_primitive
    ADD CONSTRAINT fk_dc_primi_fk_dc_pri_decision FOREIGN KEY (decision_condition_id) REFERENCES public.decision_condition(decision_condition_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dc_primitive fk_dc_primi_fk_dc_pri_item; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_primitive
    ADD CONSTRAINT fk_dc_primi_fk_dc_pri_item FOREIGN KEY (dynamic_value_item_id) REFERENCES public.item(item_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dc_primitive fk_dc_primi_fk_item_i_item; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_primitive
    ADD CONSTRAINT fk_dc_primi_fk_item_i_item FOREIGN KEY (item_id) REFERENCES public.item(item_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dc_section_event fk_dc_secti_fk_dc_sec_dc_event; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_section_event
    ADD CONSTRAINT fk_dc_secti_fk_dc_sec_dc_event FOREIGN KEY (dc_event_id) REFERENCES public.dc_event(dc_event_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dc_send_email_event fk_dc_send__dc_send_e_dc_event; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_send_email_event
    ADD CONSTRAINT fk_dc_send__dc_send_e_dc_event FOREIGN KEY (dc_event_id) REFERENCES public.dc_event(dc_event_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dc_substitution_event fk_dc_subst_fk_dc_sub_dc_event; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_substitution_event
    ADD CONSTRAINT fk_dc_subst_fk_dc_sub_dc_event FOREIGN KEY (dc_event_id) REFERENCES public.dc_event(dc_event_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dc_substitution_event fk_dc_subst_fk_dc_sub_item; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_substitution_event
    ADD CONSTRAINT fk_dc_subst_fk_dc_sub_item FOREIGN KEY (item_id) REFERENCES public.item(item_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dc_summary_item_map fk_dc_summa_fk_dc_sum_dc_compu; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_summary_item_map
    ADD CONSTRAINT fk_dc_summa_fk_dc_sum_dc_compu FOREIGN KEY (dc_summary_event_id) REFERENCES public.dc_computed_event(dc_summary_event_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: dc_summary_item_map fk_dc_summa_fk_dc_sum_item; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dc_summary_item_map
    ADD CONSTRAINT fk_dc_summa_fk_dc_sum_item FOREIGN KEY (item_id) REFERENCES public.item(item_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: decision_condition fk_decision_fk_decisi_crf_vers; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_condition
    ADD CONSTRAINT fk_decision_fk_decisi_crf_vers FOREIGN KEY (crf_version_id) REFERENCES public.crf_version(crf_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: decision_condition fk_decision_fk_decisi_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_condition
    ADD CONSTRAINT fk_decision_fk_decisi_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: decision_condition fk_decision_fk_decisi_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_condition
    ADD CONSTRAINT fk_decision_fk_decisi_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: event_crf fk_event_cr_fk_event__completi; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf
    ADD CONSTRAINT fk_event_cr_fk_event__completi FOREIGN KEY (completion_status_id) REFERENCES public.completion_status(completion_status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: event_crf fk_event_cr_fk_event__status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf
    ADD CONSTRAINT fk_event_cr_fk_event__status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: event_crf fk_event_cr_fk_event__study_ev; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf
    ADD CONSTRAINT fk_event_cr_fk_event__study_ev FOREIGN KEY (study_event_id) REFERENCES public.study_event(study_event_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: event_crf fk_event_cr_fk_event__user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf
    ADD CONSTRAINT fk_event_cr_fk_event__user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: event_crf fk_event_cr_reference_study_su; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf
    ADD CONSTRAINT fk_event_cr_reference_study_su FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: event_definition_crf fk_event_de_fk_study__status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf
    ADD CONSTRAINT fk_event_de_fk_study__status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: event_definition_crf fk_event_de_reference_study_ev; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf
    ADD CONSTRAINT fk_event_de_reference_study_ev FOREIGN KEY (study_event_definition_id) REFERENCES public.study_event_definition(study_event_definition_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: event_definition_crf fk_event_de_study_crf_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf
    ADD CONSTRAINT fk_event_de_study_crf_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: filter_crf_version_map fk_filter_c_reference_crf_vers; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.filter_crf_version_map
    ADD CONSTRAINT fk_filter_c_reference_crf_vers FOREIGN KEY (crf_version_id) REFERENCES public.crf_version(crf_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: filter_crf_version_map fk_filter_c_reference_filter; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.filter_crf_version_map
    ADD CONSTRAINT fk_filter_c_reference_filter FOREIGN KEY (filter_id) REFERENCES public.filter(filter_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: filter fk_filter_fk_query__status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.filter
    ADD CONSTRAINT fk_filter_fk_query__status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: filter fk_filter_fk_query__user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.filter
    ADD CONSTRAINT fk_filter_fk_query__user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_group fk_group_class_study_group; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_group
    ADD CONSTRAINT fk_group_class_study_group FOREIGN KEY (study_group_class_id) REFERENCES public.study_group_class(study_group_class_id) ON UPDATE RESTRICT ON DELETE SET NULL;


--
-- Name: item_group_metadata fk_item; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group_metadata
    ADD CONSTRAINT fk_item FOREIGN KEY (item_id) REFERENCES public.item(item_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item_data fk_item_dat_fk_item_d_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data
    ADD CONSTRAINT fk_item_dat_fk_item_d_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item_data fk_item_dat_fk_item_d_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data
    ADD CONSTRAINT fk_item_dat_fk_item_d_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item fk_item_fk_item_f_item_ref; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item
    ADD CONSTRAINT fk_item_fk_item_f_item_ref FOREIGN KEY (item_reference_type_id) REFERENCES public.item_reference_type(item_reference_type_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item fk_item_fk_item_i_item_dat; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item
    ADD CONSTRAINT fk_item_fk_item_i_item_dat FOREIGN KEY (item_data_type_id) REFERENCES public.item_data_type(item_data_type_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item fk_item_fk_item_s_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item
    ADD CONSTRAINT fk_item_fk_item_s_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item fk_item_fk_item_u_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item
    ADD CONSTRAINT fk_item_fk_item_u_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item_group fk_item_gro_fk_item_g_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group
    ADD CONSTRAINT fk_item_gro_fk_item_g_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item_group fk_item_gro_fk_item_g_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group
    ADD CONSTRAINT fk_item_gro_fk_item_g_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item_group_metadata fk_item_group; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group_metadata
    ADD CONSTRAINT fk_item_group FOREIGN KEY (item_group_id) REFERENCES public.item_group(item_group_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item_group fk_item_group_crf; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group
    ADD CONSTRAINT fk_item_group_crf FOREIGN KEY (crf_id) REFERENCES public.crf(crf_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: item_form_metadata fk_item_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_form_metadata
    ADD CONSTRAINT fk_item_id FOREIGN KEY (item_id) REFERENCES public.item(item_id) ON UPDATE RESTRICT;


--
-- Name: item_data fk_item_reference_subject; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_data
    ADD CONSTRAINT fk_item_reference_subject FOREIGN KEY (event_crf_id) REFERENCES public.event_crf(event_crf_id) ON UPDATE RESTRICT;


--
-- Name: study fk_old_status_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study
    ADD CONSTRAINT fk_old_status_id FOREIGN KEY (old_status_id) REFERENCES public.status(status_id);


--
-- Name: study_user_role fk_person_role_study_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_user_role
    ADD CONSTRAINT fk_person_role_study_id FOREIGN KEY (study_id) REFERENCES public.study(study_id) ON UPDATE RESTRICT;


--
-- Name: role_privilege_map fk_priv_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_privilege_map
    ADD CONSTRAINT fk_priv_id FOREIGN KEY (priv_id) REFERENCES public.privilege(priv_id) ON UPDATE RESTRICT;


--
-- Name: study_subject fk_project__reference_study2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_subject
    ADD CONSTRAINT fk_project__reference_study2 FOREIGN KEY (study_id) REFERENCES public.study(study_id) ON UPDATE RESTRICT;


--
-- Name: response_set fk_response_fk_respon_response; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_set
    ADD CONSTRAINT fk_response_fk_respon_response FOREIGN KEY (response_type_id) REFERENCES public.response_type(response_type_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: role_privilege_map fk_role_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_privilege_map
    ADD CONSTRAINT fk_role_id FOREIGN KEY (role_id) REFERENCES public.user_role(role_id) ON UPDATE RESTRICT;


--
-- Name: item_form_metadata fk_rs_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_form_metadata
    ADD CONSTRAINT fk_rs_id FOREIGN KEY (response_set_id) REFERENCES public.response_set(response_set_id) ON UPDATE RESTRICT;


--
-- Name: item_form_metadata fk_sec_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_form_metadata
    ADD CONSTRAINT fk_sec_id FOREIGN KEY (section_id) REFERENCES public.section(section_id) ON UPDATE RESTRICT;


--
-- Name: section fk_section_fk_sectio_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.section
    ADD CONSTRAINT fk_section_fk_sectio_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: section fk_section_fk_sectio_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.section
    ADD CONSTRAINT fk_section_fk_sectio_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: section fk_section_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.section
    ADD CONSTRAINT fk_section_version FOREIGN KEY (crf_version_id) REFERENCES public.crf_version(crf_version_id) ON UPDATE RESTRICT;


--
-- Name: crf fk_source_study_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf
    ADD CONSTRAINT fk_source_study_id FOREIGN KEY (source_study_id) REFERENCES public.study(study_id);


--
-- Name: study_event fk_study_ev_fk_study__status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event
    ADD CONSTRAINT fk_study_ev_fk_study__status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_event_definition fk_study_ev_fk_study__study; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event_definition
    ADD CONSTRAINT fk_study_ev_fk_study__study FOREIGN KEY (study_id) REFERENCES public.study(study_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_event fk_study_ev_fk_study__study_ev; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event
    ADD CONSTRAINT fk_study_ev_fk_study__study_ev FOREIGN KEY (study_event_definition_id) REFERENCES public.study_event_definition(study_event_definition_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_event fk_study_ev_fk_study__user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event
    ADD CONSTRAINT fk_study_ev_fk_study__user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_event_definition fk_study_ev_fk_studye_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event_definition
    ADD CONSTRAINT fk_study_ev_fk_studye_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_event_definition fk_study_ev_fk_studye_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event_definition
    ADD CONSTRAINT fk_study_ev_fk_studye_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_event fk_study_ev_reference_study_su; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_event
    ADD CONSTRAINT fk_study_ev_reference_study_su FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study fk_study_fk_study__status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study
    ADD CONSTRAINT fk_study_fk_study__status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study fk_study_fk_study__user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study
    ADD CONSTRAINT fk_study_fk_study__user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_group_class fk_study_gr_fk_study__group_ty; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_group_class
    ADD CONSTRAINT fk_study_gr_fk_study__group_ty FOREIGN KEY (group_class_type_id) REFERENCES public.group_class_types(group_class_type_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_group_class fk_study_gr_fk_study__status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_group_class
    ADD CONSTRAINT fk_study_gr_fk_study__status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_group_class fk_study_gr_fk_study__user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_group_class
    ADD CONSTRAINT fk_study_gr_fk_study__user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: event_definition_crf fk_study_inst_reference; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf
    ADD CONSTRAINT fk_study_inst_reference FOREIGN KEY (crf_id) REFERENCES public.crf(crf_id) ON UPDATE RESTRICT;


--
-- Name: study_module_status fk_study_module_study_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_module_status
    ADD CONSTRAINT fk_study_module_study_id FOREIGN KEY (study_id) REFERENCES public.study(study_id);


--
-- Name: event_definition_crf fk_study_reference_instrument; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf
    ADD CONSTRAINT fk_study_reference_instrument FOREIGN KEY (study_id) REFERENCES public.study(study_id) ON UPDATE RESTRICT;


--
-- Name: study_subject fk_study_reference_subject; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_subject
    ADD CONSTRAINT fk_study_reference_subject FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON UPDATE RESTRICT ON DELETE SET NULL;


--
-- Name: study_subject fk_study_su_fk_study__status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_subject
    ADD CONSTRAINT fk_study_su_fk_study__status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_subject fk_study_su_fk_study__user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_subject
    ADD CONSTRAINT fk_study_su_fk_study__user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study fk_study_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study
    ADD CONSTRAINT fk_study_type FOREIGN KEY (type_id) REFERENCES public.study_type(study_type_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_user_role fk_study_us_fk_study__status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_user_role
    ADD CONSTRAINT fk_study_us_fk_study__status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_user_role fk_study_us_study_use_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_user_role
    ADD CONSTRAINT fk_study_us_study_use_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: subject_group_map fk_subject__fk_sub_gr_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_group_map
    ADD CONSTRAINT fk_subject__fk_sub_gr_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: subject_group_map fk_subject__fk_subjec_group_ro; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_group_map
    ADD CONSTRAINT fk_subject__fk_subjec_group_ro FOREIGN KEY (study_group_id) REFERENCES public.study_group(study_group_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: subject_group_map fk_subject__fk_subjec_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_group_map
    ADD CONSTRAINT fk_subject__fk_subjec_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: subject_group_map fk_subject__fk_subjec_study_gr; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_group_map
    ADD CONSTRAINT fk_subject__fk_subjec_study_gr FOREIGN KEY (study_group_class_id) REFERENCES public.study_group_class(study_group_class_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: subject_group_map fk_subject__subject_g_study_su; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_group_map
    ADD CONSTRAINT fk_subject__subject_g_study_su FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: subject fk_subject_fk_subjec_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject
    ADD CONSTRAINT fk_subject_fk_subjec_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: subject fk_subject_fk_subjec_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject
    ADD CONSTRAINT fk_subject_fk_subjec_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: event_crf fk_subject_referenc_instrument; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_crf
    ADD CONSTRAINT fk_subject_referenc_instrument FOREIGN KEY (crf_version_id) REFERENCES public.crf_version(crf_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: user_account fk_user_acc_fk_user_f_user_acc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT fk_user_acc_fk_user_f_user_acc FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: user_account fk_user_acc_ref_user__user_typ; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT fk_user_acc_ref_user__user_typ FOREIGN KEY (user_type_id) REFERENCES public.user_type(user_type_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: user_account fk_user_acc_status_re_status; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT fk_user_acc_status_re_status FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: versioning_map fk_versioni_fk_versio_crf_vers; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.versioning_map
    ADD CONSTRAINT fk_versioni_fk_versio_crf_vers FOREIGN KEY (crf_version_id) REFERENCES public.crf_version(crf_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: versioning_map fk_versioni_fk_versio_item; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.versioning_map
    ADD CONSTRAINT fk_versioni_fk_versio_item FOREIGN KEY (item_id) REFERENCES public.item(item_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: crf_version fk_versioni_reference_instrume; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crf_version
    ADD CONSTRAINT fk_versioni_reference_instrume FOREIGN KEY (crf_id) REFERENCES public.crf(crf_id) ON UPDATE RESTRICT;


--
-- Name: event_definition_crf fk_versioning_study_inst; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_definition_crf
    ADD CONSTRAINT fk_versioning_study_inst FOREIGN KEY (default_version_id) REFERENCES public.crf_version(crf_version_id) ON UPDATE RESTRICT ON DELETE SET NULL;


--
-- Name: subject has_father; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject
    ADD CONSTRAINT has_father FOREIGN KEY (father_id) REFERENCES public.subject(subject_id) ON UPDATE RESTRICT ON DELETE SET NULL;


--
-- Name: subject has_mother; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject
    ADD CONSTRAINT has_mother FOREIGN KEY (mother_id) REFERENCES public.subject(subject_id) ON UPDATE RESTRICT ON DELETE SET NULL;


--
-- Name: oc_qrtz_blob_triggers oc_qrtz_blob_triggers_trg_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_blob_triggers
    ADD CONSTRAINT oc_qrtz_blob_triggers_trg_fkey FOREIGN KEY (trigger_name, trigger_group) REFERENCES public.oc_qrtz_triggers(trigger_name, trigger_group);


--
-- Name: oc_qrtz_cron_triggers oc_qrtz_cron_triggers_trg_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_cron_triggers
    ADD CONSTRAINT oc_qrtz_cron_triggers_trg_fkey FOREIGN KEY (trigger_name, trigger_group) REFERENCES public.oc_qrtz_triggers(trigger_name, trigger_group);


--
-- Name: oc_qrtz_job_listeners oc_qrtz_job_listeners_job_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_job_listeners
    ADD CONSTRAINT oc_qrtz_job_listeners_job_fkey FOREIGN KEY (job_name, job_group) REFERENCES public.oc_qrtz_job_details(job_name, job_group);


--
-- Name: oc_qrtz_simple_triggers oc_qrtz_simple_trigs_trg_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_simple_triggers
    ADD CONSTRAINT oc_qrtz_simple_trigs_trg_fkey FOREIGN KEY (trigger_name, trigger_group) REFERENCES public.oc_qrtz_triggers(trigger_name, trigger_group);


--
-- Name: oc_qrtz_trigger_listeners oc_qrtz_trigger_lsnrs_trg_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_trigger_listeners
    ADD CONSTRAINT oc_qrtz_trigger_lsnrs_trg_fkey FOREIGN KEY (trigger_name, trigger_group) REFERENCES public.oc_qrtz_triggers(trigger_name, trigger_group);


--
-- Name: oc_qrtz_triggers oc_qrtz_triggers_job_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oc_qrtz_triggers
    ADD CONSTRAINT oc_qrtz_triggers_job_name_fkey FOREIGN KEY (job_name, job_group) REFERENCES public.oc_qrtz_job_details(job_name, job_group);


--
-- Name: study project_is_contained_within_pa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study
    ADD CONSTRAINT project_is_contained_within_pa FOREIGN KEY (parent_study_id) REFERENCES public.study(study_id) ON UPDATE RESTRICT ON DELETE SET NULL;


--
-- Name: scd_item_metadata scd_meta_fk_control_meta_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scd_item_metadata
    ADD CONSTRAINT scd_meta_fk_control_meta_id FOREIGN KEY (control_item_form_metadata_id) REFERENCES public.item_form_metadata(item_form_metadata_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: scd_item_metadata scd_meta_fk_scd_form_meta_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scd_item_metadata
    ADD CONSTRAINT scd_meta_fk_scd_form_meta_id FOREIGN KEY (scd_item_form_metadata_id) REFERENCES public.item_form_metadata(item_form_metadata_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_parameter_value study_param_value_param_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_parameter_value
    ADD CONSTRAINT study_param_value_param_fkey FOREIGN KEY (parameter) REFERENCES public.study_parameter(handle) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: study_parameter_value study_param_value_study_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_parameter_value
    ADD CONSTRAINT study_param_value_study_id_fk FOREIGN KEY (study_id) REFERENCES public.study(study_id) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict YTxmaFFkDkeeLPmIi1QrgYtaBtjcOaueSfngdv3WsgpQW8RiTaGx7txJZHhDS3S

