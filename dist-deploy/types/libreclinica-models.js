"use strict";
/**
 * LibreClinica Core Models
 *
 * These TypeScript interfaces match the actual LibreClinica Java Bean classes.
 * All frontend and API code should use these models for consistency.
 *
 * Source: LibreClinica\core\src\main\java\org\akaza\openclinica\bean\
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROUP_CLASS_TYPE_MAP = exports.COMPLETION_STATUS_MAP = exports.DATA_ENTRY_STAGE_MAP = exports.SUBJECT_EVENT_STATUS_MAP = exports.STUDY_TYPE_MAP = exports.ROLE_DISPLAY_MAP = exports.STATUS_MAP = void 0;
exports.getStatusFromId = getStatusFromId;
exports.getStatusId = getStatusId;
exports.getRoleDisplayName = getRoleDisplayName;
exports.getStudyType = getStudyType;
exports.toStudyPhase = toStudyPhase;
exports.getCompletionStatusFromId = getCompletionStatusFromId;
exports.getCompletionStatusId = getCompletionStatusId;
exports.toSubject = toSubject;
exports.toStudySubject = toStudySubject;
exports.toStudy = toStudy;
exports.toStudyEvent = toStudyEvent;
exports.toEventCRF = toEventCRF;
exports.toCRF = toCRF;
exports.toUserAccount = toUserAccount;
exports.STATUS_MAP = {
    0: 'invalid',
    1: 'available',
    2: 'unavailable',
    3: 'private',
    4: 'pending',
    5: 'removed',
    6: 'locked',
    7: 'auto-removed',
    8: 'signed',
    9: 'frozen',
    10: 'source_data_verification',
    11: 'reset'
};
function getStatusFromId(statusId) {
    return exports.STATUS_MAP[statusId] || 'available';
}
function getStatusId(status) {
    var entry = Object.entries(exports.STATUS_MAP).find(function (_a) {
        var _ = _a[0], v = _a[1];
        return v === status;
    });
    return entry ? parseInt(entry[0]) : 1;
}
/**
 * Maps database role names (as stored in study_user_role.role_name) to display names.
 * The Role type above uses canonical names, but the database may store shorter versions.
 */
exports.ROLE_DISPLAY_MAP = {
    'admin': 'System Administrator',
    'system_administrator': 'System Administrator',
    'coordinator': 'Clinical Research Coordinator',
    'clinical_research_coordinator': 'Clinical Research Coordinator',
    'director': 'Study Director',
    'study_director': 'Study Director',
    'Investigator': 'Investigator',
    'investigator': 'Investigator',
    'ra': 'Research Assistant',
    'ra2': 'Data Entry Person',
    'monitor': 'Monitor',
    'data_specialist': 'Data Specialist',
    'data_entry_person': 'Data Entry Person',
    'guest': 'Guest'
};
/**
 * Gets the display name for a role.
 * @param roleCode The role code from the database
 * @returns Human-readable role name
 */
function getRoleDisplayName(roleCode) {
    return exports.ROLE_DISPLAY_MAP[roleCode] || roleCode;
}
/**
 * Maps study_type_id to StudyType
 */
exports.STUDY_TYPE_MAP = {
    1: 'genetic',
    2: 'observational',
    3: 'interventional',
    4: 'other'
};
/**
 * Get study type from type_id
 */
function getStudyType(typeId) {
    return exports.STUDY_TYPE_MAP[typeId] || 'other';
}
/**
 * Convert database row (snake_case) to StudyPhase (camelCase)
 */
function toStudyPhase(row) {
    return {
        studyEventDefinitionId: row.study_event_definition_id,
        studyId: row.study_id,
        name: row.name || '',
        description: row.description,
        category: row.category,
        type: row.type || 'scheduled',
        ordinal: row.ordinal || 1,
        repeating: row.repeating || false,
        statusId: row.status_id || 1,
        ownerId: row.owner_id,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated,
        updateId: row.update_id,
        oid: row.oc_oid,
        crfCount: parseInt(row.crf_count) || 0,
        usageCount: parseInt(row.usage_count) || 0,
        statusName: row.status_name
    };
}
exports.SUBJECT_EVENT_STATUS_MAP = {
    1: 'scheduled',
    2: 'not_scheduled',
    3: 'data_entry_started',
    4: 'completed',
    5: 'stopped',
    6: 'skipped',
    7: 'locked',
    8: 'signed'
};
exports.DATA_ENTRY_STAGE_MAP = {
    0: 'invalid',
    1: 'not_started',
    2: 'initial_data_entry',
    3: 'initial_data_entry_complete',
    4: 'double_data_entry',
    5: 'data_entry_complete',
    6: 'administrative_editing',
    7: 'locked'
};
exports.COMPLETION_STATUS_MAP = {
    1: 'not_started',
    2: 'initial_data_entry',
    3: 'data_entry_started',
    4: 'complete',
    5: 'signed'
};
function getCompletionStatusFromId(completionStatusId) {
    return exports.COMPLETION_STATUS_MAP[completionStatusId] || 'not_started';
}
function getCompletionStatusId(status) {
    var entry = Object.entries(exports.COMPLETION_STATUS_MAP).find(function (_a) {
        var _ = _a[0], v = _a[1];
        return v === status;
    });
    return entry ? parseInt(entry[0]) : 1;
}
exports.GROUP_CLASS_TYPE_MAP = {
    1: 'arm',
    2: 'family',
    3: 'dynamic',
    4: 'subject_groups'
};
// =============================================================================
// CONVERSION UTILITIES: DATABASE ROW → TYPESCRIPT MODEL (snake_case → camelCase)
// =============================================================================
/**
 * Convert database row (snake_case) to Subject (camelCase)
 */
function toSubject(row) {
    var _a;
    return {
        subjectId: row.subject_id,
        uniqueIdentifier: row.unique_identifier || '',
        dateOfBirth: row.date_of_birth,
        gender: row.gender || '',
        dobCollected: (_a = row.dob_collected) !== null && _a !== void 0 ? _a : false,
        fatherId: row.father_id,
        motherId: row.mother_id,
        statusId: row.status_id || 1,
        ownerId: row.owner_id,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated,
        updateId: row.update_id,
        label: row.label,
        studyIdentifier: row.study_unique_identifier
    };
}
/**
 * Convert database row (snake_case) to StudySubject (camelCase)
 */
function toStudySubject(row) {
    return {
        studySubjectId: row.study_subject_id,
        label: row.label || '',
        secondaryLabel: row.secondary_label || '',
        subjectId: row.subject_id,
        studyId: row.study_id,
        enrollmentDate: row.enrollment_date,
        oid: row.oc_oid,
        statusId: row.status_id || 1,
        status: getStatusFromId(row.status_id || 1),
        ownerId: row.owner_id,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated,
        updateId: row.update_id,
        uniqueIdentifier: row.unique_identifier,
        gender: row.gender,
        dateOfBirth: row.date_of_birth,
        dobCollected: row.dob_collected,
        studyName: row.study_name,
        siteName: row.site_name,
        timeZone: row.time_zone
    };
}
/**
 * Convert database row (snake_case) to Study (camelCase)
 */
function toStudy(row) {
    return {
        studyId: row.study_id,
        parentStudyId: row.parent_study_id,
        name: row.name || '',
        officialTitle: row.official_title,
        identifier: row.unique_identifier || '',
        secondaryIdentifier: row.secondary_identifier,
        oid: row.oc_oid,
        summary: row.summary,
        protocolDescription: row.protocol_description,
        datePlannedStart: row.date_planned_start,
        datePlannedEnd: row.date_planned_end,
        type: getStudyType(row.type_id),
        protocolType: row.protocol_type,
        phase: row.phase,
        expectedTotalEnrollment: row.expected_total_enrollment,
        sponsor: row.sponsor,
        collaborators: row.collaborators,
        principalInvestigator: row.principal_investigator,
        facilityName: row.facility_name,
        facilityCity: row.facility_city,
        facilityState: row.facility_state,
        facilityZip: row.facility_zip,
        facilityCountry: row.facility_country,
        facilityRecruitmentStatus: row.facility_recruitment_status,
        facilityContactName: row.facility_contact_name,
        facilityContactDegree: row.facility_contact_degree,
        facilityContactPhone: row.facility_contact_phone,
        facilityContactEmail: row.facility_contact_email,
        statusId: row.status_id || 1,
        ownerId: row.owner_id,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated,
        updateId: row.update_id
    };
}
/**
 * Convert database row (snake_case) to StudyEvent (camelCase)
 */
function toStudyEvent(row) {
    return {
        studyEventId: row.study_event_id,
        studyEventDefinitionId: row.study_event_definition_id,
        studySubjectId: row.study_subject_id,
        location: row.location,
        sampleOrdinal: row.sample_ordinal || 1,
        dateStarted: row.date_start,
        dateEnded: row.date_end,
        startTimeFlag: row.start_time_flag,
        endTimeFlag: row.end_time_flag,
        subjectEventStatus: exports.SUBJECT_EVENT_STATUS_MAP[row.subject_event_status_id] || 'scheduled',
        statusId: row.status_id,
        ownerId: row.owner_id,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated,
        updateId: row.update_id,
        studySubjectLabel: row.study_subject_label
    };
}
/**
 * Convert database row (snake_case) to EventCRF (camelCase)
 */
function toEventCRF(row) {
    return {
        eventCrfId: row.event_crf_id,
        studyEventId: row.study_event_id,
        crfVersionId: row.crf_version_id,
        studySubjectId: row.study_subject_id,
        dateInterviewed: row.date_interviewed,
        interviewerName: row.interviewer_name,
        completionStatusId: row.completion_status_id,
        validatorId: row.validator_id,
        dateValidate: row.date_validate,
        dateValidateCompleted: row.date_validate_completed,
        validatorAnnotations: row.validator_annotations,
        validateString: row.validate_string,
        annotations: row.annotations,
        dateCompleted: row.date_completed,
        electronicSignatureStatus: row.electronic_signature_status || false,
        sdvStatus: row.sdv_status || false,
        sdvUpdateId: row.sdv_update_id,
        statusId: row.status_id,
        status: getStatusFromId(row.status_id),
        ownerId: row.owner_id,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated,
        updateId: row.update_id,
        studySubjectName: row.study_subject_name,
        eventName: row.event_name,
        studyName: row.study_name,
        eventOrdinal: row.event_ordinal
    };
}
/**
 * Convert database row (snake_case) to CRF (camelCase)
 */
function toCRF(row) {
    return {
        crfId: row.crf_id,
        studyId: row.study_id,
        name: row.name || '',
        description: row.description,
        oid: row.oc_oid,
        statusId: row.status_id,
        ownerId: row.owner_id,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated,
        updateId: row.update_id
    };
}
/**
 * Convert database row (snake_case) to UserAccount (camelCase)
 */
function toUserAccount(row) {
    var _a, _b;
    return {
        userId: row.user_id,
        userName: row.user_name || '',
        firstName: row.first_name || '',
        lastName: row.last_name || '',
        email: row.email || '',
        institutionalAffiliation: row.institutional_affiliation,
        phone: row.phone,
        enabled: (_a = row.enabled) !== null && _a !== void 0 ? _a : true,
        accountNonLocked: (_b = row.account_non_locked) !== null && _b !== void 0 ? _b : true,
        lockCounter: row.lock_counter,
        lastVisitDate: row.date_lastvisit,
        sysAdmin: row.user_type_id === 1 || row.user_type_id === 0,
        techAdmin: row.user_type_id === 0,
        activeStudyId: row.active_study,
        runWebservices: row.run_webservices,
        enableApiKey: row.enable_api_key,
        apiKey: row.api_key,
        accessCode: row.access_code,
        authtype: row.authtype,
        authsecret: row.authsecret,
        timeZone: row.time_zone,
        statusId: row.status_id || 1,
        ownerId: row.owner_id || row.user_id,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated,
        updateId: row.update_id
    };
}
exports.default = {
    STATUS_MAP: exports.STATUS_MAP,
    SUBJECT_EVENT_STATUS_MAP: exports.SUBJECT_EVENT_STATUS_MAP,
    DATA_ENTRY_STAGE_MAP: exports.DATA_ENTRY_STAGE_MAP,
    COMPLETION_STATUS_MAP: exports.COMPLETION_STATUS_MAP,
    getStatusFromId: getStatusFromId,
    getStatusId: getStatusId,
    getCompletionStatusFromId: getCompletionStatusFromId,
    getCompletionStatusId: getCompletionStatusId,
    toStudySubject: toStudySubject,
    toStudy: toStudy,
    toStudyEvent: toStudyEvent,
    toStudyPhase: toStudyPhase,
    toEventCRF: toEventCRF,
    toCRF: toCRF,
    toUserAccount: toUserAccount
};
