--
-- PostgreSQL database dump
--

\restrict 7eKzhxlVCIx35G2uduCz9HwxMpFvLkacsnxO0BIqn53SX23O2XzI5cdgxIPyifv

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: acc_access_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_access_request (
    request_id integer NOT NULL,
    email character varying(255) NOT NULL,
    first_name character varying(50) NOT NULL,
    last_name character varying(50) NOT NULL,
    phone character varying(64),
    organization_name character varying(255),
    professional_title character varying(100),
    credentials character varying(255),
    reason text,
    organization_id integer,
    requested_role character varying(50) DEFAULT 'data_entry'::character varying,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by integer,
    reviewed_at timestamp without time zone,
    review_notes text,
    user_id integer,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_access_request_request_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_access_request_request_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_access_request_request_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_access_request_request_id_seq OWNED BY public.acc_access_request.request_id;


--
-- Name: acc_consent_document; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_consent_document (
    document_id integer NOT NULL,
    study_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    document_type character varying(50) DEFAULT 'main'::character varying,
    language_code character varying(10) DEFAULT 'en'::character varying,
    status character varying(20) DEFAULT 'draft'::character varying,
    requires_witness boolean DEFAULT false,
    requires_lar boolean DEFAULT false,
    age_of_majority integer DEFAULT 18,
    min_reading_time integer DEFAULT 60,
    owner_id integer,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_consent_document_document_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_consent_document_document_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_consent_document_document_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_consent_document_document_id_seq OWNED BY public.acc_consent_document.document_id;


--
-- Name: acc_consent_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_consent_version (
    version_id integer NOT NULL,
    document_id integer NOT NULL,
    version_number character varying(20) NOT NULL,
    version_name character varying(100),
    content jsonb NOT NULL,
    pdf_template text,
    effective_date date NOT NULL,
    expiration_date date,
    irb_approval_date date,
    irb_approval_number character varying(100),
    change_summary text,
    status character varying(20) DEFAULT 'draft'::character varying,
    approved_by integer,
    approved_at timestamp without time zone,
    created_by integer,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_consent_version_version_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_consent_version_version_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_consent_version_version_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_consent_version_version_id_seq OWNED BY public.acc_consent_version.version_id;


--
-- Name: acc_email_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_email_queue (
    queue_id integer NOT NULL,
    template_id integer,
    recipient_email character varying(255) NOT NULL,
    recipient_user_id integer,
    subject character varying(255) NOT NULL,
    html_body text NOT NULL,
    text_body text,
    variables jsonb,
    priority integer DEFAULT 5,
    status character varying(20) DEFAULT 'pending'::character varying,
    attempts integer DEFAULT 0,
    last_attempt timestamp without time zone,
    sent_at timestamp without time zone,
    error_message text,
    study_id integer,
    entity_type character varying(50),
    entity_id integer,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    scheduled_for timestamp without time zone
);


--
-- Name: acc_email_queue_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_email_queue_queue_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_email_queue_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_email_queue_queue_id_seq OWNED BY public.acc_email_queue.queue_id;


--
-- Name: acc_email_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_email_template (
    template_id integer NOT NULL,
    name character varying(100) NOT NULL,
    subject character varying(255) NOT NULL,
    html_body text NOT NULL,
    text_body text,
    description text,
    variables jsonb,
    version integer DEFAULT 1,
    status_id integer DEFAULT 1,
    owner_id integer,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_email_template_template_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_email_template_template_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_email_template_template_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_email_template_template_id_seq OWNED BY public.acc_email_template.template_id;


--
-- Name: acc_feature; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_feature (
    feature_id integer NOT NULL,
    feature_key character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    description text,
    category character varying(50) DEFAULT 'general'::character varying,
    is_active boolean DEFAULT true,
    requires_role_level integer DEFAULT 0,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_feature_feature_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_feature_feature_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_feature_feature_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_feature_feature_id_seq OWNED BY public.acc_feature.feature_id;


--
-- Name: acc_form_folder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_form_folder (
    folder_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    study_id integer,
    owner_id integer NOT NULL,
    sort_order integer DEFAULT 0,
    date_created timestamp without time zone DEFAULT now(),
    date_updated timestamp without time zone DEFAULT now(),
    parent_folder_id integer,
    organization_id integer
);


--
-- Name: acc_form_folder_folder_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_form_folder_folder_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_form_folder_folder_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_form_folder_folder_id_seq OWNED BY public.acc_form_folder.folder_id;


--
-- Name: acc_form_folder_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_form_folder_item (
    folder_item_id integer NOT NULL,
    folder_id integer NOT NULL,
    crf_id integer NOT NULL,
    sort_order integer DEFAULT 0,
    date_added timestamp without time zone DEFAULT now()
);


--
-- Name: acc_form_folder_item_folder_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_form_folder_item_folder_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_form_folder_item_folder_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_form_folder_item_folder_item_id_seq OWNED BY public.acc_form_folder_item.folder_item_id;


--
-- Name: acc_form_workflow_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_form_workflow_config (
    config_id integer NOT NULL,
    crf_id integer NOT NULL,
    study_id integer,
    requires_sdv boolean DEFAULT false NOT NULL,
    requires_signature boolean DEFAULT false NOT NULL,
    requires_dde boolean DEFAULT false NOT NULL,
    query_route_to_users text DEFAULT '[]'::text,
    updated_by integer,
    date_updated timestamp without time zone DEFAULT now()
);


--
-- Name: acc_form_workflow_config_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_form_workflow_config_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_form_workflow_config_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_form_workflow_config_config_id_seq OWNED BY public.acc_form_workflow_config.config_id;


--
-- Name: acc_inventory_alert; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_inventory_alert (
    alert_id integer NOT NULL,
    study_id integer NOT NULL,
    site_id integer,
    kit_type_id integer,
    alert_type character varying(50) NOT NULL,
    severity character varying(20) DEFAULT 'warning'::character varying,
    message text NOT NULL,
    threshold_value integer,
    current_value integer,
    status character varying(20) DEFAULT 'open'::character varying,
    acknowledged_at timestamp without time zone,
    acknowledged_by integer,
    resolved_at timestamp without time zone,
    resolved_by integer,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_inventory_alert_alert_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_inventory_alert_alert_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_inventory_alert_alert_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_inventory_alert_alert_id_seq OWNED BY public.acc_inventory_alert.alert_id;


--
-- Name: acc_kit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_kit (
    kit_id integer NOT NULL,
    kit_type_id integer NOT NULL,
    kit_number character varying(100) NOT NULL,
    batch_number character varying(100),
    lot_number character varying(100),
    manufacture_date date,
    expiration_date date NOT NULL,
    received_date date,
    status character varying(30) DEFAULT 'available'::character varying,
    current_site_id integer,
    current_shipment_id integer,
    dispensed_to_subject_id integer,
    dispensed_at timestamp without time zone,
    dispensed_by integer,
    dispensing_visit character varying(100),
    returned_at timestamp without time zone,
    returned_by integer,
    return_reason text,
    return_condition character varying(50),
    destroyed_at timestamp without time zone,
    destroyed_by integer,
    destruction_reason text,
    destruction_witness character varying(255),
    created_by integer,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_kit_dispensing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_kit_dispensing (
    dispensing_id integer NOT NULL,
    kit_id integer NOT NULL,
    study_subject_id integer NOT NULL,
    study_event_id integer,
    dispensed_at timestamp without time zone NOT NULL,
    dispensed_by integer NOT NULL,
    kit_number_verified boolean DEFAULT true,
    subject_id_verified boolean DEFAULT true,
    expiration_verified boolean DEFAULT true,
    dosing_instructions text,
    quantity_dispensed integer DEFAULT 1,
    signature_id integer,
    notes text,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_kit_dispensing_dispensing_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_kit_dispensing_dispensing_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_kit_dispensing_dispensing_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_kit_dispensing_dispensing_id_seq OWNED BY public.acc_kit_dispensing.dispensing_id;


--
-- Name: acc_kit_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_kit_inventory (
    kit_id integer NOT NULL,
    kit_type_id integer,
    kit_number character varying(100) NOT NULL,
    batch_number character varying(100),
    lot_number character varying(100),
    site_id integer,
    study_id integer NOT NULL,
    manufacture_date date,
    expiration_date date,
    received_date date,
    status character varying(30) DEFAULT 'available'::character varying,
    assigned_subject_id integer,
    assigned_at timestamp without time zone,
    dispensed_at timestamp without time zone,
    dispensed_by integer,
    returned_at timestamp without time zone,
    return_condition character varying(50),
    destroyed_at timestamp without time zone,
    destroyed_by integer,
    destruction_witness integer,
    temperature_log jsonb,
    notes text,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_kit_inventory_kit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_kit_inventory_kit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_kit_inventory_kit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_kit_inventory_kit_id_seq OWNED BY public.acc_kit_inventory.kit_id;


--
-- Name: acc_kit_kit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_kit_kit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_kit_kit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_kit_kit_id_seq OWNED BY public.acc_kit.kit_id;


--
-- Name: acc_kit_shipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_kit_shipment (
    shipment_id integer NOT NULL,
    study_id integer NOT NULL,
    from_site_id integer,
    to_site_id integer NOT NULL,
    tracking_number character varying(100),
    carrier character varying(100),
    shipped_date date,
    expected_arrival date,
    actual_arrival date,
    temperature_range character varying(50),
    status character varying(30) DEFAULT 'preparing'::character varying,
    shipped_by integer,
    received_by integer,
    condition_on_receipt character varying(50),
    notes text,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_kit_shipment_shipment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_kit_shipment_shipment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_kit_shipment_shipment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_kit_shipment_shipment_id_seq OWNED BY public.acc_kit_shipment.shipment_id;


--
-- Name: acc_kit_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_kit_type (
    kit_type_id integer NOT NULL,
    study_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    product_code character varying(100),
    treatment_arm character varying(100),
    storage_conditions character varying(255),
    min_storage_temp numeric,
    max_storage_temp numeric,
    shelf_life_days integer,
    units_per_kit integer DEFAULT 1,
    kit_image_path character varying(500),
    is_placebo boolean DEFAULT false,
    is_blinded boolean DEFAULT true,
    reorder_threshold integer,
    status character varying(20) DEFAULT 'active'::character varying,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_kit_type_kit_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_kit_type_kit_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_kit_type_kit_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_kit_type_kit_type_id_seq OWNED BY public.acc_kit_type.kit_type_id;


--
-- Name: acc_notification_preference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_notification_preference (
    preference_id integer NOT NULL,
    user_id integer NOT NULL,
    study_id integer,
    notification_type character varying(50) NOT NULL,
    email_enabled boolean DEFAULT true,
    digest_enabled boolean DEFAULT false,
    in_app_enabled boolean DEFAULT true,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_notification_preference_preference_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_notification_preference_preference_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_notification_preference_preference_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_notification_preference_preference_id_seq OWNED BY public.acc_notification_preference.preference_id;


--
-- Name: acc_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_notifications (
    notification_id integer NOT NULL,
    user_id integer NOT NULL,
    notification_type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    entity_type character varying(50),
    entity_id integer,
    study_id integer,
    link_url character varying(500),
    date_created timestamp without time zone DEFAULT now() NOT NULL,
    date_read timestamp without time zone
);


--
-- Name: acc_notifications_notification_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_notifications_notification_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_notifications_notification_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_notifications_notification_id_seq OWNED BY public.acc_notifications.notification_id;


--
-- Name: acc_organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_organization (
    organization_id integer NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(50) DEFAULT 'sponsor'::character varying NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(64),
    website character varying(255),
    street character varying(255),
    city character varying(255),
    state character varying(100),
    postal_code character varying(20),
    country character varying(100),
    owner_id integer,
    approved_by integer,
    approved_at timestamp without time zone,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_organization_code; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_organization_code (
    code_id integer NOT NULL,
    code character varying(20) NOT NULL,
    organization_id integer NOT NULL,
    max_uses integer,
    current_uses integer DEFAULT 0,
    expires_at timestamp without time zone,
    default_role character varying(50) DEFAULT 'data_entry'::character varying,
    is_active boolean DEFAULT true,
    created_by integer,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_organization_code_code_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_organization_code_code_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_organization_code_code_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_organization_code_code_id_seq OWNED BY public.acc_organization_code.code_id;


--
-- Name: acc_organization_member; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_organization_member (
    member_id integer NOT NULL,
    organization_id integer NOT NULL,
    user_id integer NOT NULL,
    role character varying(50) DEFAULT 'member'::character varying NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    date_joined timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_organization_member_member_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_organization_member_member_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_organization_member_member_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_organization_member_member_id_seq OWNED BY public.acc_organization_member.member_id;


--
-- Name: acc_organization_organization_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_organization_organization_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_organization_organization_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_organization_organization_id_seq OWNED BY public.acc_organization.organization_id;


--
-- Name: acc_patient_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_patient_account (
    patient_account_id integer NOT NULL,
    study_subject_id integer NOT NULL,
    email character varying(255),
    phone character varying(50),
    pin_hash character varying(255),
    magic_link_token character varying(255),
    magic_link_expires timestamp without time zone,
    preferred_language character varying(10) DEFAULT 'en'::character varying,
    timezone character varying(50) DEFAULT 'UTC'::character varying,
    notification_preferences jsonb DEFAULT '{"sms": false, "push": true, "email": true}'::jsonb,
    last_login timestamp without time zone,
    login_attempts integer DEFAULT 0,
    locked_until timestamp without time zone,
    status character varying(20) DEFAULT 'active'::character varying,
    device_tokens jsonb,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_patient_account_patient_account_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_patient_account_patient_account_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_patient_account_patient_account_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_patient_account_patient_account_id_seq OWNED BY public.acc_patient_account.patient_account_id;


--
-- Name: acc_pro_assignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_pro_assignment (
    assignment_id integer NOT NULL,
    study_subject_id integer NOT NULL,
    study_event_id integer,
    instrument_id integer,
    crf_version_id integer,
    assignment_type character varying(50) DEFAULT 'scheduled'::character varying,
    scheduled_date date,
    scheduled_time time without time zone,
    window_before_days integer DEFAULT 0,
    window_after_days integer DEFAULT 3,
    recurrence_pattern character varying(50),
    recurrence_end_date date,
    recurrence_days jsonb,
    status character varying(20) DEFAULT 'pending'::character varying,
    available_from timestamp without time zone,
    expires_at timestamp without time zone,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    response_id integer,
    assigned_by integer,
    assigned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    notes text,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_pro_assignment_assignment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_pro_assignment_assignment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_pro_assignment_assignment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_pro_assignment_assignment_id_seq OWNED BY public.acc_pro_assignment.assignment_id;


--
-- Name: acc_pro_instrument; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_pro_instrument (
    instrument_id integer NOT NULL,
    name character varying(255) NOT NULL,
    short_name character varying(50) NOT NULL,
    description text,
    version character varying(20),
    category character varying(100),
    scoring_algorithm jsonb,
    content jsonb NOT NULL,
    reference_url character varying(500),
    license_type character varying(100),
    language_code character varying(10) DEFAULT 'en'::character varying,
    estimated_minutes integer,
    status_id integer DEFAULT 1,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_pro_instrument_instrument_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_pro_instrument_instrument_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_pro_instrument_instrument_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_pro_instrument_instrument_id_seq OWNED BY public.acc_pro_instrument.instrument_id;


--
-- Name: acc_pro_reminder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_pro_reminder (
    reminder_id integer NOT NULL,
    assignment_id integer NOT NULL,
    patient_account_id integer NOT NULL,
    reminder_type character varying(50) NOT NULL,
    scheduled_for timestamp without time zone NOT NULL,
    sent_at timestamp without time zone,
    status character varying(20) DEFAULT 'pending'::character varying,
    message_subject character varying(255),
    message_body text,
    error_message text,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_pro_reminder_reminder_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_pro_reminder_reminder_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_pro_reminder_reminder_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_pro_reminder_reminder_id_seq OWNED BY public.acc_pro_reminder.reminder_id;


--
-- Name: acc_pro_response; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_pro_response (
    response_id integer NOT NULL,
    assignment_id integer NOT NULL,
    study_subject_id integer NOT NULL,
    instrument_id integer,
    answers jsonb NOT NULL,
    raw_score numeric,
    scaled_score numeric,
    score_interpretation character varying(100),
    started_at timestamp without time zone NOT NULL,
    completed_at timestamp without time zone NOT NULL,
    time_spent_seconds integer,
    device_type character varying(50),
    user_agent text,
    ip_address character varying(50),
    timezone character varying(50),
    local_timestamp timestamp without time zone,
    reviewed_by integer,
    reviewed_at timestamp without time zone,
    review_notes text,
    flagged boolean DEFAULT false,
    flag_reason text,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(20) DEFAULT 'in_progress'::character varying,
    patient_account_id integer,
    completion_percentage numeric DEFAULT 0,
    severity_category character varying(50),
    subscale_scores jsonb,
    total_score numeric,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_pro_response_response_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_pro_response_response_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_pro_response_response_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_pro_response_response_id_seq OWNED BY public.acc_pro_response.response_id;


--
-- Name: acc_randomization_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_randomization_config (
    config_id integer NOT NULL,
    study_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    randomization_type character varying(50) DEFAULT 'block'::character varying NOT NULL,
    blinding_level character varying(50) DEFAULT 'double_blind'::character varying NOT NULL,
    block_size integer DEFAULT 4,
    block_size_varied boolean DEFAULT false,
    block_sizes_list text,
    allocation_ratios jsonb DEFAULT '{}'::jsonb NOT NULL,
    stratification_factors jsonb,
    study_group_class_id integer,
    seed character varying(128),
    total_slots integer DEFAULT 100,
    is_active boolean DEFAULT false,
    is_locked boolean DEFAULT false,
    drug_kit_management boolean DEFAULT false,
    drug_kit_prefix character varying(50),
    site_specific boolean DEFAULT false,
    created_by integer,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_randomization_config_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_randomization_config_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_randomization_config_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_randomization_config_config_id_seq OWNED BY public.acc_randomization_config.config_id;


--
-- Name: acc_randomization_list; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_randomization_list (
    list_entry_id integer NOT NULL,
    config_id integer NOT NULL,
    sequence_number integer NOT NULL,
    study_group_id integer NOT NULL,
    stratum_key character varying(255) DEFAULT 'default'::character varying,
    site_id integer,
    block_number integer DEFAULT 0,
    is_used boolean DEFAULT false,
    used_by_subject_id integer,
    used_at timestamp without time zone,
    used_by_user_id integer,
    randomization_number character varying(50),
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_randomization_list_list_entry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_randomization_list_list_entry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_randomization_list_list_entry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_randomization_list_list_entry_id_seq OWNED BY public.acc_randomization_list.list_entry_id;


--
-- Name: acc_reconsent_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_reconsent_request (
    request_id integer NOT NULL,
    version_id integer NOT NULL,
    study_subject_id integer NOT NULL,
    previous_consent_id integer,
    reason text NOT NULL,
    requested_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    requested_by integer,
    due_date date,
    completed_consent_id integer,
    status character varying(20) DEFAULT 'pending'::character varying,
    waived_by integer,
    waived_reason text,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_reconsent_request_request_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_reconsent_request_request_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_reconsent_request_request_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_reconsent_request_request_id_seq OWNED BY public.acc_reconsent_request.request_id;


--
-- Name: acc_role_default_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_role_default_features (
    id integer NOT NULL,
    role_name character varying(50) NOT NULL,
    feature_key character varying(50) NOT NULL,
    is_enabled boolean DEFAULT true,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_role_default_features_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_role_default_features_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_role_default_features_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_role_default_features_id_seq OWNED BY public.acc_role_default_features.id;


--
-- Name: acc_role_permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_role_permission (
    role_permission_id integer NOT NULL,
    organization_id integer NOT NULL,
    role_name character varying(50) NOT NULL,
    permission_key character varying(100) NOT NULL,
    allowed boolean DEFAULT false,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_role_permission_role_permission_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_role_permission_role_permission_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_role_permission_role_permission_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_role_permission_role_permission_id_seq OWNED BY public.acc_role_permission.role_permission_id;


--
-- Name: acc_shipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_shipment (
    shipment_id integer NOT NULL,
    study_id integer NOT NULL,
    shipment_number character varying(100) NOT NULL,
    shipment_type character varying(50) DEFAULT 'outbound'::character varying,
    source_type character varying(50) NOT NULL,
    source_id character varying(100),
    source_name character varying(255),
    destination_type character varying(50) NOT NULL,
    destination_id integer,
    destination_name character varying(255),
    carrier character varying(255),
    tracking_number character varying(255),
    shipping_conditions character varying(255),
    package_count integer DEFAULT 1,
    status character varying(30) DEFAULT 'pending'::character varying,
    requested_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    requested_by integer,
    shipped_at timestamp without time zone,
    shipped_by integer,
    expected_delivery date,
    delivered_at timestamp without time zone,
    received_by integer,
    shipping_notes text,
    receipt_notes text,
    has_temperature_excursion boolean DEFAULT false,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_shipment_shipment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_shipment_shipment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_shipment_shipment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_shipment_shipment_id_seq OWNED BY public.acc_shipment.shipment_id;


--
-- Name: acc_subject_consent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_subject_consent (
    consent_id integer NOT NULL,
    study_subject_id integer NOT NULL,
    version_id integer,
    consent_type character varying(50) DEFAULT 'subject'::character varying,
    consent_status character varying(20) DEFAULT 'pending'::character varying,
    subject_name character varying(255),
    subject_signature_data jsonb,
    subject_signed_at timestamp without time zone,
    subject_ip_address character varying(50),
    subject_user_agent text,
    witness_name character varying(255),
    witness_relationship character varying(100),
    witness_signature_data jsonb,
    witness_signed_at timestamp without time zone,
    lar_name character varying(255),
    lar_relationship character varying(100),
    lar_signature_data jsonb,
    lar_signed_at timestamp without time zone,
    lar_reason text,
    presented_at timestamp without time zone,
    time_spent_reading integer,
    pages_viewed jsonb,
    acknowledgments_checked jsonb,
    questions_asked text,
    copy_emailed_to character varying(255),
    copy_emailed_at timestamp without time zone,
    pdf_file_path character varying(500),
    withdrawn_at timestamp without time zone,
    withdrawal_reason text,
    withdrawn_by integer,
    consented_by integer,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    scanned_consent_file_ids jsonb,
    is_scanned_consent boolean DEFAULT false,
    subject_signature_id integer,
    witness_signature_id integer,
    lar_signature_id integer,
    investigator_signature_id integer,
    content_hash character varying(128),
    device_info jsonb,
    page_view_records jsonb,
    consent_form_data jsonb,
    template_id character varying(255)
);


--
-- Name: acc_subject_consent_consent_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_subject_consent_consent_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_subject_consent_consent_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_subject_consent_consent_id_seq OWNED BY public.acc_subject_consent.consent_id;


--
-- Name: acc_task_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_task_status (
    task_status_id integer NOT NULL,
    task_id character varying(100) NOT NULL,
    status character varying(30) DEFAULT 'completed'::character varying NOT NULL,
    completed_by integer,
    completed_at timestamp without time zone DEFAULT now(),
    reason text,
    organization_id integer,
    date_created timestamp without time zone DEFAULT now() NOT NULL,
    date_updated timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: acc_task_status_task_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_task_status_task_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_task_status_task_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_task_status_task_status_id_seq OWNED BY public.acc_task_status.task_status_id;


--
-- Name: acc_temperature_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_temperature_log (
    log_id integer NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id integer NOT NULL,
    recorded_at timestamp without time zone NOT NULL,
    temperature numeric NOT NULL,
    humidity numeric,
    is_excursion boolean DEFAULT false,
    excursion_duration_minutes integer,
    recorded_by integer,
    device_id character varying(100),
    notes text,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_temperature_log_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_temperature_log_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_temperature_log_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_temperature_log_log_id_seq OWNED BY public.acc_temperature_log.log_id;


--
-- Name: acc_transfer_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_transfer_log (
    transfer_id integer NOT NULL,
    study_subject_id integer NOT NULL,
    study_id integer NOT NULL,
    source_site_id integer NOT NULL,
    destination_site_id integer NOT NULL,
    reason_for_transfer text NOT NULL,
    transfer_status character varying(20) DEFAULT 'pending'::character varying,
    requires_approvals boolean DEFAULT true,
    initiated_by integer NOT NULL,
    initiated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    source_approved_by integer,
    source_approved_at timestamp without time zone,
    source_signature_id integer,
    destination_approved_by integer,
    destination_approved_at timestamp without time zone,
    destination_signature_id integer,
    completed_by integer,
    completed_at timestamp without time zone,
    cancelled_by integer,
    cancelled_at timestamp without time zone,
    cancel_reason text,
    notes text,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_transfer_log_transfer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_transfer_log_transfer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_transfer_log_transfer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_transfer_log_transfer_id_seq OWNED BY public.acc_transfer_log.transfer_id;


--
-- Name: acc_unlock_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_unlock_request (
    unlock_request_id integer NOT NULL,
    event_crf_id integer NOT NULL,
    study_subject_id integer,
    study_id integer,
    requested_by_id integer NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text NOT NULL,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by_id integer,
    reviewed_at timestamp with time zone,
    review_notes text,
    CONSTRAINT acc_unlock_request_priority_check CHECK (((priority)::text = ANY (ARRAY[('low'::character varying)::text, ('medium'::character varying)::text, ('high'::character varying)::text, ('urgent'::character varying)::text]))),
    CONSTRAINT acc_unlock_request_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: acc_unlock_request_unlock_request_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_unlock_request_unlock_request_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_unlock_request_unlock_request_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_unlock_request_unlock_request_id_seq OWNED BY public.acc_unlock_request.unlock_request_id;


--
-- Name: acc_user_feature_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_user_feature_access (
    access_id integer NOT NULL,
    user_id integer NOT NULL,
    feature_key character varying(50) NOT NULL,
    is_enabled boolean DEFAULT true,
    granted_by integer,
    granted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    revoked_by integer,
    revoked_at timestamp without time zone,
    notes text,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_user_feature_access_access_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_user_feature_access_access_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_user_feature_access_access_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_user_feature_access_access_id_seq OWNED BY public.acc_user_feature_access.access_id;


--
-- Name: acc_user_invitation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_user_invitation (
    invitation_id integer NOT NULL,
    email character varying(255) NOT NULL,
    token character varying(255) NOT NULL,
    organization_id integer,
    study_id integer,
    role character varying(50) DEFAULT 'data_entry'::character varying,
    expires_at timestamp without time zone NOT NULL,
    invited_by integer,
    message text,
    status character varying(30) DEFAULT 'pending'::character varying,
    accepted_by integer,
    accepted_at timestamp without time zone,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_user_invitation_invitation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_user_invitation_invitation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_user_invitation_invitation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_user_invitation_invitation_id_seq OWNED BY public.acc_user_invitation.invitation_id;


--
-- Name: acc_workflow_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_workflow_tasks (
    task_id integer NOT NULL,
    task_type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    entity_type character varying(50),
    entity_id integer,
    event_crf_id integer,
    study_id integer,
    assigned_to_user_ids integer[] DEFAULT '{}'::integer[],
    created_by integer NOT NULL,
    completed_by integer,
    date_created timestamp without time zone DEFAULT now() NOT NULL,
    date_updated timestamp without time zone DEFAULT now() NOT NULL,
    date_completed timestamp without time zone,
    due_date timestamp without time zone,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: acc_workflow_tasks_task_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_workflow_tasks_task_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_workflow_tasks_task_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_workflow_tasks_task_id_seq OWNED BY public.acc_workflow_tasks.task_id;


--
-- Name: acc_wound_capture; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_wound_capture (
    capture_id integer NOT NULL,
    study_subject_id integer NOT NULL,
    study_event_id integer,
    event_crf_id integer,
    item_id integer,
    capture_token character varying(255),
    capture_status character varying(30) DEFAULT 'pending'::character varying,
    image_path character varying(500),
    thumbnail_path character varying(500),
    s3_key character varying(500),
    wound_type character varying(100),
    wound_location character varying(255),
    measurements jsonb,
    ai_analysis jsonb,
    captured_at timestamp without time zone,
    captured_by integer,
    device_info jsonb,
    integrity_hash character varying(128),
    audit_chain jsonb,
    notes text,
    date_created timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: acc_wound_capture_capture_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acc_wound_capture_capture_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acc_wound_capture_capture_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acc_wound_capture_capture_id_seq OWNED BY public.acc_wound_capture.capture_id;


--
-- Name: user_custom_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_custom_permissions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    permission_key character varying(64) NOT NULL,
    granted boolean DEFAULT true NOT NULL,
    granted_by integer,
    date_created timestamp without time zone DEFAULT now(),
    date_updated timestamp without time zone DEFAULT now()
);


--
-- Name: user_custom_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_custom_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_custom_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_custom_permissions_id_seq OWNED BY public.user_custom_permissions.id;


--
-- Name: acc_access_request request_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_access_request ALTER COLUMN request_id SET DEFAULT nextval('public.acc_access_request_request_id_seq'::regclass);


--
-- Name: acc_consent_document document_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_consent_document ALTER COLUMN document_id SET DEFAULT nextval('public.acc_consent_document_document_id_seq'::regclass);


--
-- Name: acc_consent_version version_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_consent_version ALTER COLUMN version_id SET DEFAULT nextval('public.acc_consent_version_version_id_seq'::regclass);


--
-- Name: acc_email_queue queue_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_email_queue ALTER COLUMN queue_id SET DEFAULT nextval('public.acc_email_queue_queue_id_seq'::regclass);


--
-- Name: acc_email_template template_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_email_template ALTER COLUMN template_id SET DEFAULT nextval('public.acc_email_template_template_id_seq'::regclass);


--
-- Name: acc_feature feature_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_feature ALTER COLUMN feature_id SET DEFAULT nextval('public.acc_feature_feature_id_seq'::regclass);


--
-- Name: acc_form_folder folder_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_form_folder ALTER COLUMN folder_id SET DEFAULT nextval('public.acc_form_folder_folder_id_seq'::regclass);


--
-- Name: acc_form_folder_item folder_item_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_form_folder_item ALTER COLUMN folder_item_id SET DEFAULT nextval('public.acc_form_folder_item_folder_item_id_seq'::regclass);


--
-- Name: acc_form_workflow_config config_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_form_workflow_config ALTER COLUMN config_id SET DEFAULT nextval('public.acc_form_workflow_config_config_id_seq'::regclass);


--
-- Name: acc_inventory_alert alert_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_alert ALTER COLUMN alert_id SET DEFAULT nextval('public.acc_inventory_alert_alert_id_seq'::regclass);


--
-- Name: acc_kit kit_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit ALTER COLUMN kit_id SET DEFAULT nextval('public.acc_kit_kit_id_seq'::regclass);


--
-- Name: acc_kit_dispensing dispensing_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_dispensing ALTER COLUMN dispensing_id SET DEFAULT nextval('public.acc_kit_dispensing_dispensing_id_seq'::regclass);


--
-- Name: acc_kit_inventory kit_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_inventory ALTER COLUMN kit_id SET DEFAULT nextval('public.acc_kit_inventory_kit_id_seq'::regclass);


--
-- Name: acc_kit_shipment shipment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_shipment ALTER COLUMN shipment_id SET DEFAULT nextval('public.acc_kit_shipment_shipment_id_seq'::regclass);


--
-- Name: acc_kit_type kit_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_type ALTER COLUMN kit_type_id SET DEFAULT nextval('public.acc_kit_type_kit_type_id_seq'::regclass);


--
-- Name: acc_notification_preference preference_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_notification_preference ALTER COLUMN preference_id SET DEFAULT nextval('public.acc_notification_preference_preference_id_seq'::regclass);


--
-- Name: acc_notifications notification_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_notifications ALTER COLUMN notification_id SET DEFAULT nextval('public.acc_notifications_notification_id_seq'::regclass);


--
-- Name: acc_organization organization_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_organization ALTER COLUMN organization_id SET DEFAULT nextval('public.acc_organization_organization_id_seq'::regclass);


--
-- Name: acc_organization_code code_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_organization_code ALTER COLUMN code_id SET DEFAULT nextval('public.acc_organization_code_code_id_seq'::regclass);


--
-- Name: acc_organization_member member_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_organization_member ALTER COLUMN member_id SET DEFAULT nextval('public.acc_organization_member_member_id_seq'::regclass);


--
-- Name: acc_patient_account patient_account_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_patient_account ALTER COLUMN patient_account_id SET DEFAULT nextval('public.acc_patient_account_patient_account_id_seq'::regclass);


--
-- Name: acc_pro_assignment assignment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_assignment ALTER COLUMN assignment_id SET DEFAULT nextval('public.acc_pro_assignment_assignment_id_seq'::regclass);


--
-- Name: acc_pro_instrument instrument_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_instrument ALTER COLUMN instrument_id SET DEFAULT nextval('public.acc_pro_instrument_instrument_id_seq'::regclass);


--
-- Name: acc_pro_reminder reminder_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_reminder ALTER COLUMN reminder_id SET DEFAULT nextval('public.acc_pro_reminder_reminder_id_seq'::regclass);


--
-- Name: acc_pro_response response_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_response ALTER COLUMN response_id SET DEFAULT nextval('public.acc_pro_response_response_id_seq'::regclass);


--
-- Name: acc_randomization_config config_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_randomization_config ALTER COLUMN config_id SET DEFAULT nextval('public.acc_randomization_config_config_id_seq'::regclass);


--
-- Name: acc_randomization_list list_entry_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_randomization_list ALTER COLUMN list_entry_id SET DEFAULT nextval('public.acc_randomization_list_list_entry_id_seq'::regclass);


--
-- Name: acc_reconsent_request request_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_reconsent_request ALTER COLUMN request_id SET DEFAULT nextval('public.acc_reconsent_request_request_id_seq'::regclass);


--
-- Name: acc_role_default_features id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_role_default_features ALTER COLUMN id SET DEFAULT nextval('public.acc_role_default_features_id_seq'::regclass);


--
-- Name: acc_role_permission role_permission_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_role_permission ALTER COLUMN role_permission_id SET DEFAULT nextval('public.acc_role_permission_role_permission_id_seq'::regclass);


--
-- Name: acc_shipment shipment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_shipment ALTER COLUMN shipment_id SET DEFAULT nextval('public.acc_shipment_shipment_id_seq'::regclass);


--
-- Name: acc_subject_consent consent_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subject_consent ALTER COLUMN consent_id SET DEFAULT nextval('public.acc_subject_consent_consent_id_seq'::regclass);


--
-- Name: acc_task_status task_status_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_task_status ALTER COLUMN task_status_id SET DEFAULT nextval('public.acc_task_status_task_status_id_seq'::regclass);


--
-- Name: acc_temperature_log log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_temperature_log ALTER COLUMN log_id SET DEFAULT nextval('public.acc_temperature_log_log_id_seq'::regclass);


--
-- Name: acc_transfer_log transfer_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_transfer_log ALTER COLUMN transfer_id SET DEFAULT nextval('public.acc_transfer_log_transfer_id_seq'::regclass);


--
-- Name: acc_unlock_request unlock_request_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_unlock_request ALTER COLUMN unlock_request_id SET DEFAULT nextval('public.acc_unlock_request_unlock_request_id_seq'::regclass);


--
-- Name: acc_user_feature_access access_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_user_feature_access ALTER COLUMN access_id SET DEFAULT nextval('public.acc_user_feature_access_access_id_seq'::regclass);


--
-- Name: acc_user_invitation invitation_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_user_invitation ALTER COLUMN invitation_id SET DEFAULT nextval('public.acc_user_invitation_invitation_id_seq'::regclass);


--
-- Name: acc_workflow_tasks task_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_workflow_tasks ALTER COLUMN task_id SET DEFAULT nextval('public.acc_workflow_tasks_task_id_seq'::regclass);


--
-- Name: acc_wound_capture capture_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_wound_capture ALTER COLUMN capture_id SET DEFAULT nextval('public.acc_wound_capture_capture_id_seq'::regclass);


--
-- Name: user_custom_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_permissions ALTER COLUMN id SET DEFAULT nextval('public.user_custom_permissions_id_seq'::regclass);


--
-- Name: acc_access_request acc_access_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_access_request
    ADD CONSTRAINT acc_access_request_pkey PRIMARY KEY (request_id);


--
-- Name: acc_consent_document acc_consent_document_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_consent_document
    ADD CONSTRAINT acc_consent_document_pkey PRIMARY KEY (document_id);


--
-- Name: acc_consent_document acc_consent_document_study_id_name_language_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_consent_document
    ADD CONSTRAINT acc_consent_document_study_id_name_language_code_key UNIQUE (study_id, name, language_code);


--
-- Name: acc_consent_version acc_consent_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_consent_version
    ADD CONSTRAINT acc_consent_version_pkey PRIMARY KEY (version_id);


--
-- Name: acc_email_queue acc_email_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_email_queue
    ADD CONSTRAINT acc_email_queue_pkey PRIMARY KEY (queue_id);


--
-- Name: acc_email_template acc_email_template_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_email_template
    ADD CONSTRAINT acc_email_template_name_key UNIQUE (name);


--
-- Name: acc_email_template acc_email_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_email_template
    ADD CONSTRAINT acc_email_template_pkey PRIMARY KEY (template_id);


--
-- Name: acc_feature acc_feature_feature_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_feature
    ADD CONSTRAINT acc_feature_feature_key_key UNIQUE (feature_key);


--
-- Name: acc_feature acc_feature_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_feature
    ADD CONSTRAINT acc_feature_pkey PRIMARY KEY (feature_id);


--
-- Name: acc_form_folder_item acc_form_folder_item_folder_id_crf_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_form_folder_item
    ADD CONSTRAINT acc_form_folder_item_folder_id_crf_id_key UNIQUE (folder_id, crf_id);


--
-- Name: acc_form_folder_item acc_form_folder_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_form_folder_item
    ADD CONSTRAINT acc_form_folder_item_pkey PRIMARY KEY (folder_item_id);


--
-- Name: acc_form_folder acc_form_folder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_form_folder
    ADD CONSTRAINT acc_form_folder_pkey PRIMARY KEY (folder_id);


--
-- Name: acc_form_workflow_config acc_form_workflow_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_form_workflow_config
    ADD CONSTRAINT acc_form_workflow_config_pkey PRIMARY KEY (config_id);


--
-- Name: acc_inventory_alert acc_inventory_alert_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_alert
    ADD CONSTRAINT acc_inventory_alert_pkey PRIMARY KEY (alert_id);


--
-- Name: acc_kit_dispensing acc_kit_dispensing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_dispensing
    ADD CONSTRAINT acc_kit_dispensing_pkey PRIMARY KEY (dispensing_id);


--
-- Name: acc_kit_inventory acc_kit_inventory_kit_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_inventory
    ADD CONSTRAINT acc_kit_inventory_kit_number_key UNIQUE (kit_number);


--
-- Name: acc_kit_inventory acc_kit_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_inventory
    ADD CONSTRAINT acc_kit_inventory_pkey PRIMARY KEY (kit_id);


--
-- Name: acc_kit acc_kit_kit_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit
    ADD CONSTRAINT acc_kit_kit_number_key UNIQUE (kit_number);


--
-- Name: acc_kit acc_kit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit
    ADD CONSTRAINT acc_kit_pkey PRIMARY KEY (kit_id);


--
-- Name: acc_kit_shipment acc_kit_shipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_shipment
    ADD CONSTRAINT acc_kit_shipment_pkey PRIMARY KEY (shipment_id);


--
-- Name: acc_kit_type acc_kit_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_type
    ADD CONSTRAINT acc_kit_type_pkey PRIMARY KEY (kit_type_id);


--
-- Name: acc_kit_type acc_kit_type_study_id_product_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_type
    ADD CONSTRAINT acc_kit_type_study_id_product_code_key UNIQUE (study_id, product_code);


--
-- Name: acc_notification_preference acc_notification_preference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_notification_preference
    ADD CONSTRAINT acc_notification_preference_pkey PRIMARY KEY (preference_id);


--
-- Name: acc_notification_preference acc_notification_preference_user_id_study_id_notification_t_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_notification_preference
    ADD CONSTRAINT acc_notification_preference_user_id_study_id_notification_t_key UNIQUE (user_id, study_id, notification_type);


--
-- Name: acc_notifications acc_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_notifications
    ADD CONSTRAINT acc_notifications_pkey PRIMARY KEY (notification_id);


--
-- Name: acc_organization_code acc_organization_code_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_organization_code
    ADD CONSTRAINT acc_organization_code_code_key UNIQUE (code);


--
-- Name: acc_organization_code acc_organization_code_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_organization_code
    ADD CONSTRAINT acc_organization_code_pkey PRIMARY KEY (code_id);


--
-- Name: acc_organization_member acc_organization_member_organization_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_organization_member
    ADD CONSTRAINT acc_organization_member_organization_id_user_id_key UNIQUE (organization_id, user_id);


--
-- Name: acc_organization_member acc_organization_member_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_organization_member
    ADD CONSTRAINT acc_organization_member_pkey PRIMARY KEY (member_id);


--
-- Name: acc_organization acc_organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_organization
    ADD CONSTRAINT acc_organization_pkey PRIMARY KEY (organization_id);


--
-- Name: acc_patient_account acc_patient_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_patient_account
    ADD CONSTRAINT acc_patient_account_pkey PRIMARY KEY (patient_account_id);


--
-- Name: acc_patient_account acc_patient_account_study_subject_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_patient_account
    ADD CONSTRAINT acc_patient_account_study_subject_id_key UNIQUE (study_subject_id);


--
-- Name: acc_pro_assignment acc_pro_assignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_assignment
    ADD CONSTRAINT acc_pro_assignment_pkey PRIMARY KEY (assignment_id);


--
-- Name: acc_pro_instrument acc_pro_instrument_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_instrument
    ADD CONSTRAINT acc_pro_instrument_pkey PRIMARY KEY (instrument_id);


--
-- Name: acc_pro_instrument acc_pro_instrument_short_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_instrument
    ADD CONSTRAINT acc_pro_instrument_short_name_key UNIQUE (short_name);


--
-- Name: acc_pro_reminder acc_pro_reminder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_reminder
    ADD CONSTRAINT acc_pro_reminder_pkey PRIMARY KEY (reminder_id);


--
-- Name: acc_pro_response acc_pro_response_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_response
    ADD CONSTRAINT acc_pro_response_pkey PRIMARY KEY (response_id);


--
-- Name: acc_randomization_config acc_randomization_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_randomization_config
    ADD CONSTRAINT acc_randomization_config_pkey PRIMARY KEY (config_id);


--
-- Name: acc_randomization_list acc_randomization_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_randomization_list
    ADD CONSTRAINT acc_randomization_list_pkey PRIMARY KEY (list_entry_id);


--
-- Name: acc_reconsent_request acc_reconsent_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_reconsent_request
    ADD CONSTRAINT acc_reconsent_request_pkey PRIMARY KEY (request_id);


--
-- Name: acc_role_default_features acc_role_default_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_role_default_features
    ADD CONSTRAINT acc_role_default_features_pkey PRIMARY KEY (id);


--
-- Name: acc_role_default_features acc_role_default_features_role_name_feature_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_role_default_features
    ADD CONSTRAINT acc_role_default_features_role_name_feature_key_key UNIQUE (role_name, feature_key);


--
-- Name: acc_role_permission acc_role_permission_organization_id_role_name_permission_ke_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_role_permission
    ADD CONSTRAINT acc_role_permission_organization_id_role_name_permission_ke_key UNIQUE (organization_id, role_name, permission_key);


--
-- Name: acc_role_permission acc_role_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_role_permission
    ADD CONSTRAINT acc_role_permission_pkey PRIMARY KEY (role_permission_id);


--
-- Name: acc_shipment acc_shipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_shipment
    ADD CONSTRAINT acc_shipment_pkey PRIMARY KEY (shipment_id);


--
-- Name: acc_shipment acc_shipment_shipment_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_shipment
    ADD CONSTRAINT acc_shipment_shipment_number_key UNIQUE (shipment_number);


--
-- Name: acc_subject_consent acc_subject_consent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subject_consent
    ADD CONSTRAINT acc_subject_consent_pkey PRIMARY KEY (consent_id);


--
-- Name: acc_task_status acc_task_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_task_status
    ADD CONSTRAINT acc_task_status_pkey PRIMARY KEY (task_status_id);


--
-- Name: acc_task_status acc_task_status_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_task_status
    ADD CONSTRAINT acc_task_status_task_id_key UNIQUE (task_id);


--
-- Name: acc_temperature_log acc_temperature_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_temperature_log
    ADD CONSTRAINT acc_temperature_log_pkey PRIMARY KEY (log_id);


--
-- Name: acc_transfer_log acc_transfer_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_transfer_log
    ADD CONSTRAINT acc_transfer_log_pkey PRIMARY KEY (transfer_id);


--
-- Name: acc_unlock_request acc_unlock_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_unlock_request
    ADD CONSTRAINT acc_unlock_request_pkey PRIMARY KEY (unlock_request_id);


--
-- Name: acc_user_feature_access acc_user_feature_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_user_feature_access
    ADD CONSTRAINT acc_user_feature_access_pkey PRIMARY KEY (access_id);


--
-- Name: acc_user_feature_access acc_user_feature_access_user_id_feature_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_user_feature_access
    ADD CONSTRAINT acc_user_feature_access_user_id_feature_key_key UNIQUE (user_id, feature_key);


--
-- Name: acc_user_invitation acc_user_invitation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_user_invitation
    ADD CONSTRAINT acc_user_invitation_pkey PRIMARY KEY (invitation_id);


--
-- Name: acc_user_invitation acc_user_invitation_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_user_invitation
    ADD CONSTRAINT acc_user_invitation_token_key UNIQUE (token);


--
-- Name: acc_workflow_tasks acc_workflow_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_workflow_tasks
    ADD CONSTRAINT acc_workflow_tasks_pkey PRIMARY KEY (task_id);


--
-- Name: acc_wound_capture acc_wound_capture_capture_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_wound_capture
    ADD CONSTRAINT acc_wound_capture_capture_token_key UNIQUE (capture_token);


--
-- Name: acc_wound_capture acc_wound_capture_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_wound_capture
    ADD CONSTRAINT acc_wound_capture_pkey PRIMARY KEY (capture_id);


--
-- Name: user_custom_permissions user_custom_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_permissions
    ADD CONSTRAINT user_custom_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_custom_permissions user_custom_permissions_user_id_permission_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_permissions
    ADD CONSTRAINT user_custom_permissions_user_id_permission_key_key UNIQUE (user_id, permission_key);


--
-- Name: idx_acc_task_status_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acc_task_status_org ON public.acc_task_status USING btree (organization_id);


--
-- Name: idx_acc_task_status_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acc_task_status_status ON public.acc_task_status USING btree (status);


--
-- Name: idx_acc_task_status_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acc_task_status_task_id ON public.acc_task_status USING btree (task_id);


--
-- Name: idx_access_request_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_request_org ON public.acc_access_request USING btree (organization_id);


--
-- Name: idx_consent_doc_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_doc_status ON public.acc_consent_document USING btree (status);


--
-- Name: idx_consent_doc_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_doc_study ON public.acc_consent_document USING btree (study_id);


--
-- Name: idx_consent_ver_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_ver_doc ON public.acc_consent_version USING btree (document_id);


--
-- Name: idx_consent_ver_effective; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_ver_effective ON public.acc_consent_version USING btree (effective_date);


--
-- Name: idx_consent_ver_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_ver_status ON public.acc_consent_version USING btree (status);


--
-- Name: idx_dispensing_kit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispensing_kit ON public.acc_kit_dispensing USING btree (kit_id);


--
-- Name: idx_dispensing_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispensing_subject ON public.acc_kit_dispensing USING btree (study_subject_id);


--
-- Name: idx_email_queue_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_queue_scheduled ON public.acc_email_queue USING btree (scheduled_for);


--
-- Name: idx_email_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_queue_status ON public.acc_email_queue USING btree (status);


--
-- Name: idx_form_folder_item_crf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_folder_item_crf ON public.acc_form_folder_item USING btree (crf_id);


--
-- Name: idx_form_folder_item_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_folder_item_folder ON public.acc_form_folder_item USING btree (folder_id);


--
-- Name: idx_form_folder_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_folder_org ON public.acc_form_folder USING btree (organization_id);


--
-- Name: idx_form_folder_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_folder_owner ON public.acc_form_folder USING btree (owner_id);


--
-- Name: idx_form_folder_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_folder_parent ON public.acc_form_folder USING btree (parent_folder_id);


--
-- Name: idx_form_folder_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_folder_study ON public.acc_form_folder USING btree (study_id);


--
-- Name: idx_form_workflow_config_crf_study; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_form_workflow_config_crf_study ON public.acc_form_workflow_config USING btree (crf_id, COALESCE(study_id, 0));


--
-- Name: idx_inventory_alert_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_alert_status ON public.acc_inventory_alert USING btree (status);


--
-- Name: idx_inventory_alert_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_alert_study ON public.acc_inventory_alert USING btree (study_id);


--
-- Name: idx_kit_expiration; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_expiration ON public.acc_kit USING btree (expiration_date);


--
-- Name: idx_kit_inventory_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_inventory_site ON public.acc_kit_inventory USING btree (site_id);


--
-- Name: idx_kit_inventory_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_inventory_status ON public.acc_kit_inventory USING btree (status);


--
-- Name: idx_kit_shipment_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_shipment_study ON public.acc_kit_shipment USING btree (study_id);


--
-- Name: idx_kit_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_site ON public.acc_kit USING btree (current_site_id);


--
-- Name: idx_kit_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_status ON public.acc_kit USING btree (status);


--
-- Name: idx_kit_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_subject ON public.acc_kit USING btree (dispensed_to_subject_id);


--
-- Name: idx_kit_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_type_id ON public.acc_kit USING btree (kit_type_id);


--
-- Name: idx_kit_type_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_type_study ON public.acc_kit_type USING btree (study_id);


--
-- Name: idx_notif_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_user_date ON public.acc_notifications USING btree (user_id, date_created DESC);


--
-- Name: idx_notif_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_user_unread ON public.acc_notifications USING btree (user_id, is_read) WHERE (is_read = false);


--
-- Name: idx_notification_pref_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_pref_user ON public.acc_notification_preference USING btree (user_id);


--
-- Name: idx_org_code_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_code_code ON public.acc_organization_code USING btree (code);


--
-- Name: idx_org_member_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_member_org ON public.acc_organization_member USING btree (organization_id);


--
-- Name: idx_org_member_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_member_user ON public.acc_organization_member USING btree (user_id);


--
-- Name: idx_patient_account_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_account_email ON public.acc_patient_account USING btree (email);


--
-- Name: idx_patient_account_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_account_subject ON public.acc_patient_account USING btree (study_subject_id);


--
-- Name: idx_pro_assignment_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pro_assignment_date ON public.acc_pro_assignment USING btree (scheduled_date);


--
-- Name: idx_pro_assignment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pro_assignment_status ON public.acc_pro_assignment USING btree (status);


--
-- Name: idx_pro_assignment_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pro_assignment_subject ON public.acc_pro_assignment USING btree (study_subject_id);


--
-- Name: idx_pro_reminder_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pro_reminder_scheduled ON public.acc_pro_reminder USING btree (scheduled_for);


--
-- Name: idx_pro_reminder_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pro_reminder_status ON public.acc_pro_reminder USING btree (status);


--
-- Name: idx_pro_response_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pro_response_assignment ON public.acc_pro_response USING btree (assignment_id);


--
-- Name: idx_pro_response_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pro_response_status ON public.acc_pro_response USING btree (status);


--
-- Name: idx_pro_response_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pro_response_subject ON public.acc_pro_response USING btree (study_subject_id);


--
-- Name: idx_rand_config_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rand_config_active ON public.acc_randomization_config USING btree (study_id, is_active);


--
-- Name: idx_rand_config_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rand_config_study ON public.acc_randomization_config USING btree (study_id);


--
-- Name: idx_rand_list_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rand_list_available ON public.acc_randomization_list USING btree (config_id, stratum_key, is_used, sequence_number);


--
-- Name: idx_rand_list_config; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rand_list_config ON public.acc_randomization_list USING btree (config_id);


--
-- Name: idx_rand_list_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rand_list_subject ON public.acc_randomization_list USING btree (used_by_subject_id);


--
-- Name: idx_reconsent_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconsent_status ON public.acc_reconsent_request USING btree (status);


--
-- Name: idx_reconsent_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconsent_subject ON public.acc_reconsent_request USING btree (study_subject_id);


--
-- Name: idx_role_default_features_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_default_features_role ON public.acc_role_default_features USING btree (role_name);


--
-- Name: idx_role_perm_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_perm_org ON public.acc_role_permission USING btree (organization_id);


--
-- Name: idx_shipment_dest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_dest ON public.acc_shipment USING btree (destination_id);


--
-- Name: idx_shipment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_status ON public.acc_shipment USING btree (status);


--
-- Name: idx_shipment_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_study ON public.acc_shipment USING btree (study_id);


--
-- Name: idx_subject_consent_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subject_consent_status ON public.acc_subject_consent USING btree (consent_status);


--
-- Name: idx_subject_consent_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subject_consent_subject ON public.acc_subject_consent USING btree (study_subject_id);


--
-- Name: idx_subject_consent_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subject_consent_version ON public.acc_subject_consent USING btree (version_id);


--
-- Name: idx_temp_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_temp_log_entity ON public.acc_temperature_log USING btree (entity_type, entity_id);


--
-- Name: idx_transfer_dest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transfer_dest ON public.acc_transfer_log USING btree (destination_site_id);


--
-- Name: idx_transfer_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transfer_source ON public.acc_transfer_log USING btree (source_site_id);


--
-- Name: idx_transfer_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transfer_status ON public.acc_transfer_log USING btree (transfer_status);


--
-- Name: idx_transfer_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transfer_study ON public.acc_transfer_log USING btree (study_id);


--
-- Name: idx_transfer_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transfer_subject ON public.acc_transfer_log USING btree (study_subject_id);


--
-- Name: idx_unlock_request_event_crf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unlock_request_event_crf ON public.acc_unlock_request USING btree (event_crf_id);


--
-- Name: idx_unlock_request_requested_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unlock_request_requested_by ON public.acc_unlock_request USING btree (requested_by_id);


--
-- Name: idx_unlock_request_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unlock_request_status ON public.acc_unlock_request USING btree (status);


--
-- Name: idx_unlock_request_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unlock_request_study ON public.acc_unlock_request USING btree (study_id);


--
-- Name: idx_user_feature_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_feature_enabled ON public.acc_user_feature_access USING btree (user_id, is_enabled);


--
-- Name: idx_user_feature_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_feature_key ON public.acc_user_feature_access USING btree (feature_key);


--
-- Name: idx_user_feature_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_feature_user ON public.acc_user_feature_access USING btree (user_id);


--
-- Name: idx_user_inv_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_inv_email ON public.acc_user_invitation USING btree (email);


--
-- Name: idx_user_inv_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_inv_token ON public.acc_user_invitation USING btree (token);


--
-- Name: idx_wf_tasks_event_crf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wf_tasks_event_crf ON public.acc_workflow_tasks USING btree (event_crf_id);


--
-- Name: idx_wf_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wf_tasks_status ON public.acc_workflow_tasks USING btree (status);


--
-- Name: idx_wf_tasks_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wf_tasks_study ON public.acc_workflow_tasks USING btree (study_id);


--
-- Name: idx_wound_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wound_subject ON public.acc_wound_capture USING btree (study_subject_id);


--
-- Name: idx_wound_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wound_token ON public.acc_wound_capture USING btree (capture_token);


--
-- Name: acc_consent_document acc_consent_document_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_consent_document
    ADD CONSTRAINT acc_consent_document_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id);


--
-- Name: acc_consent_document acc_consent_document_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_consent_document
    ADD CONSTRAINT acc_consent_document_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.study(study_id);


--
-- Name: acc_consent_version acc_consent_version_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_consent_version
    ADD CONSTRAINT acc_consent_version_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_consent_version acc_consent_version_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_consent_version
    ADD CONSTRAINT acc_consent_version_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_consent_version acc_consent_version_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_consent_version
    ADD CONSTRAINT acc_consent_version_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.acc_consent_document(document_id);


--
-- Name: acc_email_queue acc_email_queue_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_email_queue
    ADD CONSTRAINT acc_email_queue_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.user_account(user_id);


--
-- Name: acc_email_queue acc_email_queue_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_email_queue
    ADD CONSTRAINT acc_email_queue_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.study(study_id);


--
-- Name: acc_email_queue acc_email_queue_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_email_queue
    ADD CONSTRAINT acc_email_queue_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.acc_email_template(template_id);


--
-- Name: acc_email_template acc_email_template_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_email_template
    ADD CONSTRAINT acc_email_template_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.user_account(user_id);


--
-- Name: acc_form_folder_item acc_form_folder_item_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_form_folder_item
    ADD CONSTRAINT acc_form_folder_item_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.acc_form_folder(folder_id) ON DELETE CASCADE;


--
-- Name: acc_form_folder acc_form_folder_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_form_folder
    ADD CONSTRAINT acc_form_folder_parent_folder_id_fkey FOREIGN KEY (parent_folder_id) REFERENCES public.acc_form_folder(folder_id) ON DELETE SET NULL;


--
-- Name: acc_inventory_alert acc_inventory_alert_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_alert
    ADD CONSTRAINT acc_inventory_alert_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_inventory_alert acc_inventory_alert_kit_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_alert
    ADD CONSTRAINT acc_inventory_alert_kit_type_id_fkey FOREIGN KEY (kit_type_id) REFERENCES public.acc_kit_type(kit_type_id);


--
-- Name: acc_inventory_alert acc_inventory_alert_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_alert
    ADD CONSTRAINT acc_inventory_alert_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_inventory_alert acc_inventory_alert_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_alert
    ADD CONSTRAINT acc_inventory_alert_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.study(study_id);


--
-- Name: acc_inventory_alert acc_inventory_alert_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_alert
    ADD CONSTRAINT acc_inventory_alert_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.study(study_id);


--
-- Name: acc_kit acc_kit_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit
    ADD CONSTRAINT acc_kit_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_kit acc_kit_current_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit
    ADD CONSTRAINT acc_kit_current_site_id_fkey FOREIGN KEY (current_site_id) REFERENCES public.study(study_id);


--
-- Name: acc_kit acc_kit_destroyed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit
    ADD CONSTRAINT acc_kit_destroyed_by_fkey FOREIGN KEY (destroyed_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_kit acc_kit_dispensed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit
    ADD CONSTRAINT acc_kit_dispensed_by_fkey FOREIGN KEY (dispensed_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_kit acc_kit_dispensed_to_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit
    ADD CONSTRAINT acc_kit_dispensed_to_subject_id_fkey FOREIGN KEY (dispensed_to_subject_id) REFERENCES public.study_subject(study_subject_id);


--
-- Name: acc_kit_dispensing acc_kit_dispensing_dispensed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_dispensing
    ADD CONSTRAINT acc_kit_dispensing_dispensed_by_fkey FOREIGN KEY (dispensed_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_kit_dispensing acc_kit_dispensing_kit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_dispensing
    ADD CONSTRAINT acc_kit_dispensing_kit_id_fkey FOREIGN KEY (kit_id) REFERENCES public.acc_kit(kit_id);


--
-- Name: acc_kit_dispensing acc_kit_dispensing_study_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_dispensing
    ADD CONSTRAINT acc_kit_dispensing_study_event_id_fkey FOREIGN KEY (study_event_id) REFERENCES public.study_event(study_event_id);


--
-- Name: acc_kit_dispensing acc_kit_dispensing_study_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_dispensing
    ADD CONSTRAINT acc_kit_dispensing_study_subject_id_fkey FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id);


--
-- Name: acc_kit acc_kit_kit_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit
    ADD CONSTRAINT acc_kit_kit_type_id_fkey FOREIGN KEY (kit_type_id) REFERENCES public.acc_kit_type(kit_type_id);


--
-- Name: acc_kit acc_kit_returned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit
    ADD CONSTRAINT acc_kit_returned_by_fkey FOREIGN KEY (returned_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_kit_type acc_kit_type_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_kit_type
    ADD CONSTRAINT acc_kit_type_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.study(study_id);


--
-- Name: acc_notification_preference acc_notification_preference_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_notification_preference
    ADD CONSTRAINT acc_notification_preference_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.study(study_id);


--
-- Name: acc_notification_preference acc_notification_preference_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_notification_preference
    ADD CONSTRAINT acc_notification_preference_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_account(user_id);


--
-- Name: acc_patient_account acc_patient_account_study_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_patient_account
    ADD CONSTRAINT acc_patient_account_study_subject_id_fkey FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id);


--
-- Name: acc_pro_assignment acc_pro_assignment_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_assignment
    ADD CONSTRAINT acc_pro_assignment_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_pro_assignment acc_pro_assignment_crf_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_assignment
    ADD CONSTRAINT acc_pro_assignment_crf_version_id_fkey FOREIGN KEY (crf_version_id) REFERENCES public.crf_version(crf_version_id);


--
-- Name: acc_pro_assignment acc_pro_assignment_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_assignment
    ADD CONSTRAINT acc_pro_assignment_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.acc_pro_instrument(instrument_id);


--
-- Name: acc_pro_assignment acc_pro_assignment_study_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_assignment
    ADD CONSTRAINT acc_pro_assignment_study_event_id_fkey FOREIGN KEY (study_event_id) REFERENCES public.study_event(study_event_id);


--
-- Name: acc_pro_assignment acc_pro_assignment_study_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_assignment
    ADD CONSTRAINT acc_pro_assignment_study_subject_id_fkey FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id);


--
-- Name: acc_pro_reminder acc_pro_reminder_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_reminder
    ADD CONSTRAINT acc_pro_reminder_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.acc_pro_assignment(assignment_id);


--
-- Name: acc_pro_reminder acc_pro_reminder_patient_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_reminder
    ADD CONSTRAINT acc_pro_reminder_patient_account_id_fkey FOREIGN KEY (patient_account_id) REFERENCES public.acc_patient_account(patient_account_id);


--
-- Name: acc_pro_response acc_pro_response_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_response
    ADD CONSTRAINT acc_pro_response_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.acc_pro_assignment(assignment_id);


--
-- Name: acc_pro_response acc_pro_response_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_response
    ADD CONSTRAINT acc_pro_response_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.acc_pro_instrument(instrument_id);


--
-- Name: acc_pro_response acc_pro_response_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_response
    ADD CONSTRAINT acc_pro_response_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_pro_response acc_pro_response_study_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_pro_response
    ADD CONSTRAINT acc_pro_response_study_subject_id_fkey FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id);


--
-- Name: acc_reconsent_request acc_reconsent_request_completed_consent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_reconsent_request
    ADD CONSTRAINT acc_reconsent_request_completed_consent_id_fkey FOREIGN KEY (completed_consent_id) REFERENCES public.acc_subject_consent(consent_id);


--
-- Name: acc_reconsent_request acc_reconsent_request_previous_consent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_reconsent_request
    ADD CONSTRAINT acc_reconsent_request_previous_consent_id_fkey FOREIGN KEY (previous_consent_id) REFERENCES public.acc_subject_consent(consent_id);


--
-- Name: acc_reconsent_request acc_reconsent_request_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_reconsent_request
    ADD CONSTRAINT acc_reconsent_request_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_reconsent_request acc_reconsent_request_study_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_reconsent_request
    ADD CONSTRAINT acc_reconsent_request_study_subject_id_fkey FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id);


--
-- Name: acc_reconsent_request acc_reconsent_request_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_reconsent_request
    ADD CONSTRAINT acc_reconsent_request_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.acc_consent_version(version_id);


--
-- Name: acc_reconsent_request acc_reconsent_request_waived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_reconsent_request
    ADD CONSTRAINT acc_reconsent_request_waived_by_fkey FOREIGN KEY (waived_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_shipment acc_shipment_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_shipment
    ADD CONSTRAINT acc_shipment_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_shipment acc_shipment_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_shipment
    ADD CONSTRAINT acc_shipment_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_shipment acc_shipment_shipped_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_shipment
    ADD CONSTRAINT acc_shipment_shipped_by_fkey FOREIGN KEY (shipped_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_shipment acc_shipment_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_shipment
    ADD CONSTRAINT acc_shipment_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.study(study_id);


--
-- Name: acc_subject_consent acc_subject_consent_consented_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subject_consent
    ADD CONSTRAINT acc_subject_consent_consented_by_fkey FOREIGN KEY (consented_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_subject_consent acc_subject_consent_study_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subject_consent
    ADD CONSTRAINT acc_subject_consent_study_subject_id_fkey FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id);


--
-- Name: acc_subject_consent acc_subject_consent_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subject_consent
    ADD CONSTRAINT acc_subject_consent_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.acc_consent_version(version_id);


--
-- Name: acc_subject_consent acc_subject_consent_withdrawn_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subject_consent
    ADD CONSTRAINT acc_subject_consent_withdrawn_by_fkey FOREIGN KEY (withdrawn_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_temperature_log acc_temperature_log_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_temperature_log
    ADD CONSTRAINT acc_temperature_log_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_transfer_log acc_transfer_log_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_transfer_log
    ADD CONSTRAINT acc_transfer_log_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_transfer_log acc_transfer_log_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_transfer_log
    ADD CONSTRAINT acc_transfer_log_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_transfer_log acc_transfer_log_destination_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_transfer_log
    ADD CONSTRAINT acc_transfer_log_destination_approved_by_fkey FOREIGN KEY (destination_approved_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_transfer_log acc_transfer_log_destination_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_transfer_log
    ADD CONSTRAINT acc_transfer_log_destination_site_id_fkey FOREIGN KEY (destination_site_id) REFERENCES public.study(study_id);


--
-- Name: acc_transfer_log acc_transfer_log_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_transfer_log
    ADD CONSTRAINT acc_transfer_log_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_transfer_log acc_transfer_log_source_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_transfer_log
    ADD CONSTRAINT acc_transfer_log_source_approved_by_fkey FOREIGN KEY (source_approved_by) REFERENCES public.user_account(user_id);


--
-- Name: acc_transfer_log acc_transfer_log_source_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_transfer_log
    ADD CONSTRAINT acc_transfer_log_source_site_id_fkey FOREIGN KEY (source_site_id) REFERENCES public.study(study_id);


--
-- Name: acc_transfer_log acc_transfer_log_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_transfer_log
    ADD CONSTRAINT acc_transfer_log_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.study(study_id);


--
-- Name: acc_transfer_log acc_transfer_log_study_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_transfer_log
    ADD CONSTRAINT acc_transfer_log_study_subject_id_fkey FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id);


--
-- Name: acc_unlock_request acc_unlock_request_event_crf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_unlock_request
    ADD CONSTRAINT acc_unlock_request_event_crf_id_fkey FOREIGN KEY (event_crf_id) REFERENCES public.event_crf(event_crf_id) ON DELETE CASCADE;


--
-- Name: acc_unlock_request acc_unlock_request_requested_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_unlock_request
    ADD CONSTRAINT acc_unlock_request_requested_by_id_fkey FOREIGN KEY (requested_by_id) REFERENCES public.user_account(user_id);


--
-- Name: acc_unlock_request acc_unlock_request_reviewed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_unlock_request
    ADD CONSTRAINT acc_unlock_request_reviewed_by_id_fkey FOREIGN KEY (reviewed_by_id) REFERENCES public.user_account(user_id);


--
-- Name: acc_unlock_request acc_unlock_request_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_unlock_request
    ADD CONSTRAINT acc_unlock_request_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.study(study_id) ON DELETE SET NULL;


--
-- Name: acc_unlock_request acc_unlock_request_study_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_unlock_request
    ADD CONSTRAINT acc_unlock_request_study_subject_id_fkey FOREIGN KEY (study_subject_id) REFERENCES public.study_subject(study_subject_id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict 7eKzhxlVCIx35G2uduCz9HwxMpFvLkacsnxO0BIqn53SX23O2XzI5cdgxIPyifv

- -  
 - -   P o s t g r e S Q L   d a t a b a s e   d u m p  
 - -  
  
 \ r e s t r i c t   T T U U R F P l T e 2 p E T a T 4 l 7 E B B W H n a d i U r 3 V a s k u H n P 1 H F X I m F D 4 Z b R q 2 t Y Q 5 K i p M 1 u  
  
 - -   D u m p e d   f r o m   d a t a b a s e   v e r s i o n   1 4 . 2 0  
 - -   D u m p e d   b y   p g _ d u m p   v e r s i o n   1 4 . 2 0  
  
 S E T   s t a t e m e n t _ t i m e o u t   =   0 ;  
 S E T   l o c k _ t i m e o u t   =   0 ;  
 S E T   i d l e _ i n _ t r a n s a c t i o n _ s e s s i o n _ t i m e o u t   =   0 ;  
 S E T   c l i e n t _ e n c o d i n g   =   ' U T F 8 ' ;  
 S E T   s t a n d a r d _ c o n f o r m i n g _ s t r i n g s   =   o n ;  
 S E L E C T   p g _ c a t a l o g . s e t _ c o n f i g ( ' s e a r c h _ p a t h ' ,   ' ' ,   f a l s e ) ;  
 S E T   c h e c k _ f u n c t i o n _ b o d i e s   =   f a l s e ;  
 S E T   x m l o p t i o n   =   c o n t e n t ;  
 S E T   c l i e n t _ m i n _ m e s s a g e s   =   w a r n i n g ;  
 S E T   r o w _ s e c u r i t y   =   o f f ;  
  
 S E T   d e f a u l t _ t a b l e s p a c e   =   ' ' ;  
  
 S E T   d e f a u l t _ t a b l e _ a c c e s s _ m e t h o d   =   h e a p ;  
  
 - -  
 - -   N a m e :   u s e r _ c u s t o m _ p e r m i s s i o n s ;   T y p e :   T A B L E ;   S c h e m a :   p u b l i c ;   O w n e r :   -  
 - -  
  
 C R E A T E   T A B L E   p u b l i c . u s e r _ c u s t o m _ p e r m i s s i o n s   (  
         i d   i n t e g e r   N O T   N U L L ,  
         u s e r _ i d   i n t e g e r   N O T   N U L L ,  
         p e r m i s s i o n _ k e y   c h a r a c t e r   v a r y i n g ( 6 4 )   N O T   N U L L ,  
         g r a n t e d   b o o l e a n   D E F A U L T   t r u e   N O T   N U L L ,  
         g r a n t e d _ b y   i n t e g e r ,  
         d a t e _ c r e a t e d   t i m e s t a m p   w i t h o u t   t i m e   z o n e   D E F A U L T   n o w ( ) ,  
         d a t e _ u p d a t e d   t i m e s t a m p   w i t h o u t   t i m e   z o n e   D E F A U L T   n o w ( )  
 ) ;  
  
  
 - -  
 - -   N a m e :   u s e r _ c u s t o m _ p e r m i s s i o n s _ i d _ s e q ;   T y p e :   S E Q U E N C E ;   S c h e m a :   p u b l i c ;   O w n e r :   -  
 - -  
  
 C R E A T E   S E Q U E N C E   p u b l i c . u s e r _ c u s t o m _ p e r m i s s i o n s _ i d _ s e q  
         A S   i n t e g e r  
         S T A R T   W I T H   1  
         I N C R E M E N T   B Y   1  
         N O   M I N V A L U E  
         N O   M A X V A L U E  
         C A C H E   1 ;  
  
  
 - -  
 - -   N a m e :   u s e r _ c u s t o m _ p e r m i s s i o n s _ i d _ s e q ;   T y p e :   S E Q U E N C E   O W N E D   B Y ;   S c h e m a :   p u b l i c ;   O w n e r :   -  
 - -  
  
 A L T E R   S E Q U E N C E   p u b l i c . u s e r _ c u s t o m _ p e r m i s s i o n s _ i d _ s e q   O W N E D   B Y   p u b l i c . u s e r _ c u s t o m _ p e r m i s s i o n s . i d ;  
  
  
 - -  
 - -   N a m e :   u s e r _ c u s t o m _ p e r m i s s i o n s   i d ;   T y p e :   D E F A U L T ;   S c h e m a :   p u b l i c ;   O w n e r :   -  
 - -  
  
 A L T E R   T A B L E   O N L Y   p u b l i c . u s e r _ c u s t o m _ p e r m i s s i o n s   A L T E R   C O L U M N   i d   S E T   D E F A U L T   n e x t v a l ( ' p u b l i c . u s e r _ c u s t o m _ p e r m i s s i o n s _ i d _ s e q ' : : r e g c l a s s ) ;  
  
  
 - -  
 - -   N a m e :   u s e r _ c u s t o m _ p e r m i s s i o n s   u s e r _ c u s t o m _ p e r m i s s i o n s _ p k e y ;   T y p e :   C O N S T R A I N T ;   S c h e m a :   p u b l i c ;   O w n e r :   -  
 - -  
  
 A L T E R   T A B L E   O N L Y   p u b l i c . u s e r _ c u s t o m _ p e r m i s s i o n s  
         A D D   C O N S T R A I N T   u s e r _ c u s t o m _ p e r m i s s i o n s _ p k e y   P R I M A R Y   K E Y   ( i d ) ;  
  
  
 - -  
 - -   N a m e :   u s e r _ c u s t o m _ p e r m i s s i o n s   u s e r _ c u s t o m _ p e r m i s s i o n s _ u s e r _ i d _ p e r m i s s i o n _ k e y _ k e y ;   T y p e :   C O N S T R A I N T ;   S c h e m a :   p u b l i c ;   O w n e r :   -  
 - -  
  
 A L T E R   T A B L E   O N L Y   p u b l i c . u s e r _ c u s t o m _ p e r m i s s i o n s  
         A D D   C O N S T R A I N T   u s e r _ c u s t o m _ p e r m i s s i o n s _ u s e r _ i d _ p e r m i s s i o n _ k e y _ k e y   U N I Q U E   ( u s e r _ i d ,   p e r m i s s i o n _ k e y ) ;  
  
  
 - -  
 - -   P o s t g r e S Q L   d a t a b a s e   d u m p   c o m p l e t e  
 - -  
  
 \ u n r e s t r i c t   T T U U R F P l T e 2 p E T a T 4 l 7 E B B W H n a d i U r 3 V a s k u H n P 1 H F X I m F D 4 Z b R q 2 t Y Q 5 K i p M 1 u  
  
 