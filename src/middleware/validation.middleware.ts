/**
 * Validation Middleware
 *
 * Implements request validation using Joi schemas
 * - Validates request body, query params, and URL params
 * - Provides detailed validation error messages
 * - Ensures data integrity before processing
 *
 * Compliance: 21 CFR Part 11, §11.10(f) - Operational System Checks
 */

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { logger } from '../config/logger';

/**
 * Validation schema options
 */
const validationOptions: Joi.ValidationOptions = {
  abortEarly: false, // Return all errors, not just first
  allowUnknown: true, // Allow unknown properties
  stripUnknown: true  // Remove unknown properties
};

/**
 * Generic validation middleware factory
 * Creates middleware that validates specific parts of the request
 */
export const validate = (schema: {
  body?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
}) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Validate request body
      if (schema.body) {
        const { error, value } = schema.body.validate(req.body, validationOptions);
        if (error) {
          logger.warn('Request body validation failed', {
            path: req.path,
            errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
          });

          res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: error.details.map(detail => ({
              field: detail.path.join('.'),
              message: detail.message,
              type: detail.type
            }))
          });
          return;
        }
        req.body = value;
      }

      // Validate query parameters
      if (schema.query) {
        const { error, value } = schema.query.validate(req.query, validationOptions);
        if (error) {
          logger.warn('Query parameter validation failed', {
            path: req.path,
            errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
          });

          res.status(400).json({
            success: false,
            message: 'Query parameter validation failed',
            errors: error.details.map(detail => ({
              field: detail.path.join('.'),
              message: detail.message
            }))
          });
          return;
        }
        req.query = value;
      }

      // Validate URL parameters
      if (schema.params) {
        const { error, value } = schema.params.validate(req.params, validationOptions);
        if (error) {
          logger.warn('URL parameter validation failed', {
            path: req.path,
            errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
          });

          res.status(400).json({
            success: false,
            message: 'URL parameter validation failed',
            errors: error.details.map(detail => ({
              field: detail.path.join('.'),
              message: detail.message
            }))
          });
          return;
        }
        req.params = value;
      }

      next();
    } catch (error: any) {
      logger.error('Validation middleware error', { error: error.message });
      res.status(500).json({
        success: false,
        message: 'Internal validation error'
      });
    }
  };
};

/**
 * ============================================================================
 * VALIDATION SCHEMAS
 * ============================================================================
 */

/**
 * Authentication Schemas
 */
export const authSchemas = {
  login: Joi.object({
    username: Joi.string().required().min(3).max(255)
      .messages({
        'string.empty': 'Username is required',
        'string.min': 'Username must be at least 3 characters',
        'string.max': 'Username must not exceed 255 characters'
      }),
    password: Joi.string().required().min(1)
      .messages({
        'string.empty': 'Password is required'
      })
  }),

  googleAuth: Joi.object({
    idToken: Joi.string().required()
      .messages({
        'string.empty': 'Google ID token is required'
      })
  }),

  refreshToken: Joi.object({
    refreshToken: Joi.string().required()
      .messages({
        'string.empty': 'Refresh token is required'
      })
  }),

  changePassword: Joi.object({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string().required()
      .min(12)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .messages({
        'string.empty': 'New password is required',
        'string.min': 'Password must be at least 12 characters',
        'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character'
      })
  })
};

/**
 * Subject (Patient) Schemas
 */
export const subjectSchemas = {
  create: Joi.object({
    // === REQUIRED FIELDS ===
    studyId: Joi.number().integer().positive().required()
      .messages({
        'number.base': 'Study ID must be a number',
        'number.positive': 'Study ID must be positive',
        'any.required': 'Study ID is required'
      }),
    studySubjectId: Joi.string().required().max(30)
      .messages({
        'string.empty': 'Subject ID is required',
        'string.max': 'Subject ID must not exceed 30 characters'
      }),

    // === OPTIONAL STUDY_SUBJECT FIELDS ===
    secondaryId: Joi.string().optional().allow('').max(30),
    enrollmentDate: Joi.alternatives().try(
      Joi.date().iso(),
      Joi.string().isoDate()
    ).optional(),
    timeZone: Joi.string().optional().allow('').max(255),

    // === OPTIONAL SUBJECT (DEMOGRAPHICS) FIELDS ===
    gender: Joi.string().valid('m', 'f', 'Male', 'Female', 'male', 'female', '').optional(),
    dateOfBirth: Joi.alternatives().try(
      Joi.date().iso(),
      Joi.string().isoDate()
    ).optional(),
    personId: Joi.string().optional().allow('').max(255),

    // === FAMILY/GENETIC STUDY FIELDS ===
    fatherId: Joi.number().integer().positive().optional().allow(null),
    motherId: Joi.number().integer().positive().optional().allow(null),

    // === GROUP ASSIGNMENTS (for randomization) ===
    groupAssignments: Joi.array().items(Joi.object({
      studyGroupClassId: Joi.number().integer().positive().required(),
      studyGroupId: Joi.number().integer().positive().required(),
      notes: Joi.string().optional().allow('').max(255)
    })).optional(),

    // === FIRST EVENT SCHEDULING ===
    scheduleEvent: Joi.object({
      studyEventDefinitionId: Joi.number().integer().positive().required(),
      location: Joi.string().optional().allow('').max(255),
      startDate: Joi.alternatives().try(
        Joi.date().iso(),
        Joi.string().isoDate()
      ).optional()
    }).optional(),

    // === ELECTRONIC SIGNATURE (21 CFR Part 11, §11.50) ===
    password: Joi.string().optional(),
    signaturePassword: Joi.string().optional(),
    signatureMeaning: Joi.string().optional().max(500)
  }),

  list: Joi.object({
    studyId: Joi.number().integer().positive().required(),
    status: Joi.string().valid('available', 'enrolled', 'completed', 'withdrawn').optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(1000).default(20),
    search: Joi.string().optional().allow('')
  }),

  getById: Joi.object({
    id: Joi.number().integer().positive().required()
  })
};

/**
 * Form/CRF Schemas
 * 
 * ARCHITECTURE NOTE — validation is layered:
 * 
 * Layer 1 (this middleware): validates REQUEST STRUCTURE only — ensures the
 *   required identifiers (studyId, subjectId, event/form IDs) are present and
 *   have correct types.  The actual form field data inside `data`/`formData`
 *   is intentionally left as a free-form object here.
 * 
 * Layer 2 (validation-rules.service.ts): validates FIELD VALUES.  After the
 *   middleware passes the request through, the form service invokes the
 *   validation rules engine which checks each user-entered value against
 *   configured rules (required, range, format, consistency, formula).
 *   - Hard-edit rules (severity: 'error') block the save.
 *   - Soft-edit rules (severity: 'warning') create queries (discrepancy notes).
 * 
 * This separation ensures that field-level business rules are managed via the
 * validation-rules configuration screen, not hard-coded in Joi schemas.
 */
export const formSchemas = {
  saveData: Joi.object({
    // Study ID - required
    studyId: Joi.number().integer().positive().required(),

    // Subject ID - required
    subjectId: Joi.number().integer().positive().required(),

    // Event ID - accept both frontend and backend naming conventions
    eventId: Joi.number().integer().positive().optional(),
    studyEventDefinitionId: Joi.number().integer().positive().optional(),
    studyEventId: Joi.number().integer().positive().optional(),
    // eventCrfId: passed through explicitly so the service layer can use it
    // for itemId-based field matching during validation rule evaluation.
    eventCrfId: Joi.number().integer().positive().optional(),

    // Form ID - accept both frontend and backend naming conventions
    formId: Joi.number().integer().positive().optional(),
    crfId: Joi.number().integer().positive().optional(),
    crfVersionId: Joi.number().integer().positive().optional(),

    // Form data — free-form objects; field-level validation is handled by
    // validation-rules.service.ts (Layer 2), not here.
    data: Joi.object().optional(),
    formData: Joi.object().optional(),

    // Interview information
    interviewDate: Joi.string().isoDate().optional().allow('', null),
    interviewerName: Joi.string().optional().allow('', null),

    // Electronic signature
    electronicSignature: Joi.object({
      username: Joi.string().required(),
      password: Joi.string().required(),
      meaning: Joi.string().required().valid('Data Entry', 'Review', 'Approval')
    }).optional()
  }).or('eventId', 'studyEventDefinitionId', 'studyEventId', 'eventCrfId') // At least one event identifier
   .or('formId', 'crfId', 'crfVersionId') // At least one form identifier
   .or('data', 'formData'), // At least one data object

  getData: Joi.object({
    subjectId: Joi.number().integer().positive().required(),
    eventCrfId: Joi.number().integer().positive().required()
  }),

  listForms: Joi.object({
    studyId: Joi.number().integer().positive().required()
  })
};

// ============================================================================
// Shared sub-schemas for study event definitions, group classes, sites, params
// ============================================================================

const crfAssignmentSchema = Joi.object({
  crfId: Joi.number().integer().positive().required(),
  required: Joi.boolean().default(true),
  doubleDataEntry: Joi.boolean().default(false),
  electronicSignature: Joi.boolean().default(false),
  hideCrf: Joi.boolean().default(false),
  ordinal: Joi.number().integer().min(1).default(1)
});

const eventDefinitionSchema = Joi.object({
  studyEventDefinitionId: Joi.number().integer().optional(), // For existing events (update)
  name: Joi.string().required().max(255),
  description: Joi.string().optional().max(2000).allow(''),
  category: Joi.string().optional().allow(''),
  type: Joi.string().valid('scheduled', 'unscheduled', 'common').default('scheduled'),
  ordinal: Joi.number().integer().min(1).optional(),
  repeating: Joi.boolean().default(false),
  crfAssignments: Joi.array().items(crfAssignmentSchema).optional()
});

const groupSchema = Joi.object({
  studyGroupId: Joi.number().integer().optional(),
  name: Joi.string().required().max(255),
  description: Joi.string().optional().max(1000).allow('')
});

const groupClassSchema = Joi.object({
  studyGroupClassId: Joi.number().integer().optional(), // For existing groups (update)
  name: Joi.string().required().max(255),
  // Accept both 'type' and 'groupClassTypeId' from frontend
  type: Joi.alternatives().try(
    Joi.number().integer().min(1).max(4),
    Joi.string()
  ).optional(),
  groupClassTypeId: Joi.alternatives().try(
    Joi.number().integer().min(1).max(4),
    Joi.string()
  ).optional(),
  subjectAssignment: Joi.string().optional().allow(''),
  description: Joi.string().optional().max(1000).allow(''),
  groups: Joi.array().items(groupSchema).optional()
});

const siteSchema = Joi.object({
  studyId: Joi.number().integer().optional(), // For existing sites (update)
  name: Joi.string().required().max(255),
  uniqueIdentifier: Joi.string().required().max(255),
  principalInvestigator: Joi.string().optional().max(255).allow(''),
  facilityName: Joi.string().optional().max(255).allow(''),
  facilityAddress: Joi.string().optional().max(1000).allow(''),
  facilityCity: Joi.string().optional().max(255).allow(''),
  facilityState: Joi.string().optional().max(20).allow(''),
  facilityZip: Joi.string().optional().max(64).allow(''),
  facilityCountry: Joi.string().optional().max(64).allow(''),
  facilityRecruitmentStatus: Joi.string().optional().max(60).allow(''),
  expectedTotalEnrollment: Joi.number().integer().min(0).optional(),
  isActive: Joi.boolean().optional(),
  inheritFromParent: Joi.boolean().default(true)
});

const studyParametersSchema = Joi.object({
  collectDob: Joi.string().optional().valid('1', '2', '3', 'full', 'year_only', 'not_used'),
  genderRequired: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
  subjectPersonIdRequired: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
  subjectIdGeneration: Joi.string().optional().valid('manual', 'auto_editable', 'auto_non_editable', 'auto'),
  subjectIdPrefix: Joi.string().optional().allow(''),
  subjectIdSuffix: Joi.string().optional().allow(''),
  studySubjectIdLabel: Joi.string().optional().allow(''),
  secondaryIdLabel: Joi.string().optional().allow(''),
  personIdShownOnCrf: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
  secondaryLabelViewable: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
  eventLocationRequired: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
  dateOfEnrollmentForStudyRequired: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
  discrepancyManagement: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
  allowAdministrativeEditing: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
  adminForcedReasonForChange: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
  mailNotification: Joi.string().optional().allow(''),
  contactEmail: Joi.string().optional().email({ tlds: { allow: false } }).allow('')
}).optional();

/**
 * Study Schemas
 *
 * Text field limits:
 * - summary: 10,000 chars (study overview)
 * - protocolDescription: 100,000 chars (protocol is usually multiple pages)
 * - collaborators: 10,000 chars
 * - conditions, eligibility, interventions: 50,000 chars each
 */
export const studySchemas = {
  list: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().valid('available', 'pending', 'frozen', 'locked').optional()
  }),

  getById: Joi.object({
    id: Joi.number().integer().positive().required()
  }),

  create: Joi.object({
    // Required fields for clinical trial compliance
    name: Joi.string().required().min(3).max(255)
      .messages({
        'string.min': 'Study name must be at least 3 characters',
        'string.max': 'Study name cannot exceed 255 characters',
        'any.required': 'Study name is required'
      }),
    uniqueIdentifier: Joi.string().required().min(3).max(30)
      .pattern(/^[a-zA-Z0-9_-]+$/)
      .messages({
        'string.min': 'Protocol number must be at least 3 characters',
        'string.max': 'Protocol number cannot exceed 30 characters',
        'string.pattern.base': 'Study identifier can only contain letters, numbers, hyphens, and underscores',
        'any.required': 'Protocol number is required'
      }),
    principalInvestigator: Joi.string().optional().max(255).allow(''),
    sponsor: Joi.string().optional().max(255).allow(''),
    phase: Joi.string().optional().valid('I', 'II', 'III', 'IV', 'N/A', 'i', 'ii', 'iii', 'iv', 'phase_i', 'phase_ii', 'phase_iii', 'phase_iv', '').allow(''),
    expectedTotalEnrollment: Joi.number().integer().min(0).optional().allow(null),
    datePlannedStart: Joi.alternatives().try(
      Joi.date().iso(),
      Joi.string().allow('')
    ).optional(),

    // Optional identification fields
    description: Joi.string().optional().max(100000).allow(''),
    summary: Joi.string().optional().max(10000).allow(''),
    officialTitle: Joi.string().optional().max(255).allow(''),
    secondaryIdentifier: Joi.string().optional().max(255).allow(''),
    collaborators: Joi.string().optional().max(10000).allow(''),
    protocolType: Joi.string().optional().valid('interventional', 'observational'),
    targetEnrollment: Joi.number().integer().min(0).optional(),
    datePlannedEnd: Joi.alternatives().try(
      Joi.date().iso(),
      Joi.string().allow('')
    ).optional(),
    parentStudyId: Joi.number().integer().positive().optional(),

    // Facility fields
    facilityName: Joi.string().optional().max(255).allow(''),
    facilityAddress: Joi.string().optional().max(1000).allow(''),
    facilityCity: Joi.string().optional().max(255).allow(''),
    facilityState: Joi.string().optional().max(20).allow(''),
    facilityZip: Joi.string().optional().max(64).allow(''),
    facilityCountry: Joi.string().optional().max(64).allow(''),
    facilityRecruitmentStatus: Joi.string().optional().max(60).allow(''),
    facilityContactName: Joi.string().optional().max(255).allow(''),
    facilityContactDegree: Joi.string().optional().max(255).allow(''),
    facilityContactPhone: Joi.string().optional().max(255).allow(''),
    facilityContactEmail: Joi.string().optional().max(255).email({ tlds: { allow: false } }).allow(''),

    // Protocol fields - protocolDescription supports multiple pages
    protocolDescription: Joi.string().optional().max(100000).allow(''),
    protocolDateVerification: Joi.string().optional().allow(''),
    medlineIdentifier: Joi.string().optional().max(255).allow(''),
    url: Joi.string().optional().max(255).allow(''),
    urlDescription: Joi.string().optional().max(255).allow(''),
    resultsReference: Joi.boolean().optional(),

    // Eligibility fields - support long clinical criteria text
    conditions: Joi.string().optional().max(50000).allow(''),
    keywords: Joi.string().optional().max(255).allow(''),
    interventions: Joi.string().optional().max(50000).allow(''),
    eligibility: Joi.string().optional().max(50000).allow(''),
    gender: Joi.string().optional().max(30).allow(''),
    ageMin: Joi.string().optional().max(3).allow(''),
    ageMax: Joi.string().optional().max(3).allow(''),
    healthyVolunteerAccepted: Joi.boolean().optional(),

    // Study Design fields
    purpose: Joi.string().optional().max(64).allow(''),
    allocation: Joi.string().optional().max(64).allow(''),
    masking: Joi.string().optional().max(30).allow(''),
    control: Joi.string().optional().max(30).allow(''),
    assignment: Joi.string().optional().max(30).allow(''),
    endpoint: Joi.string().optional().max(64).allow(''),
    duration: Joi.string().optional().max(30).allow(''),
    selection: Joi.string().optional().max(30).allow(''),
    timing: Joi.string().optional().max(30).allow(''),

    // Nested data structures
    eventDefinitions: Joi.array().items(eventDefinitionSchema).optional(),
    groupClasses: Joi.array().items(groupClassSchema).optional(),
    sites: Joi.array().items(siteSchema).optional(),

    // Study parameters - accept BOTH nested object AND flat fields for compatibility
    studyParameters: studyParametersSchema,
    // Flat parameter fields (legacy compatibility)
    collectDob: Joi.string().optional().valid('1', '2', '3'),
    genderRequired: Joi.string().optional(),
    subjectPersonIdRequired: Joi.string().optional(),
    subjectIdGeneration: Joi.string().optional().valid('manual', 'auto_editable', 'auto_non_editable'),
    subjectIdPrefix: Joi.string().optional().allow(''),
    subjectIdSuffix: Joi.string().optional().allow(''),
    studySubjectIdLabel: Joi.string().optional().allow(''),
    secondaryIdLabel: Joi.string().optional().allow(''),
    personIdShownOnCrf: Joi.string().optional(),
    secondaryLabelViewable: Joi.boolean().optional(),
    eventLocationRequired: Joi.boolean().optional(),
    dateOfEnrollmentForStudyRequired: Joi.string().optional(),
    discrepancyManagement: Joi.boolean().optional(),
    allowAdministrativeEditing: Joi.boolean().optional(),
    mailNotification: Joi.string().optional().allow(''),
    contactEmail: Joi.string().optional().email({ tlds: { allow: false } }).allow(''),

    // === ELECTRONIC SIGNATURE (21 CFR Part 11, §11.50) ===
    password: Joi.string().optional(),
    signaturePassword: Joi.string().optional(),
    signatureMeaning: Joi.string().optional().max(500)
  }),

  update: Joi.object({
    // Basic fields
    name: Joi.string().optional().min(3).max(255),
    description: Joi.string().optional().max(100000).allow(''),
    summary: Joi.string().optional().max(10000).allow(''),
    officialTitle: Joi.string().optional().max(255).allow(''),
    secondaryIdentifier: Joi.string().optional().max(255).allow(''),
    principalInvestigator: Joi.string().optional().max(255).allow(''),
    sponsor: Joi.string().optional().max(255).allow(''),
    collaborators: Joi.string().optional().max(10000).allow(''),
    phase: Joi.string().optional().allow(''),
    protocolType: Joi.string().optional().valid('interventional', 'observational').allow(''),
    expectedTotalEnrollment: Joi.number().integer().min(0).optional(),
    datePlannedStart: Joi.alternatives().try(
      Joi.date().iso(),
      Joi.string().allow('')
    ).optional(),
    datePlannedEnd: Joi.alternatives().try(
      Joi.date().iso(),
      Joi.string().allow('')
    ).optional(),

    // Facility fields
    facilityName: Joi.string().optional().max(255).allow(''),
    facilityAddress: Joi.string().optional().max(1000).allow(''),
    facilityCity: Joi.string().optional().max(255).allow(''),
    facilityState: Joi.string().optional().max(20).allow(''),
    facilityZip: Joi.string().optional().max(64).allow(''),
    facilityCountry: Joi.string().optional().max(64).allow(''),
    facilityRecruitmentStatus: Joi.string().optional().max(60).allow(''),
    facilityContactName: Joi.string().optional().max(255).allow(''),
    facilityContactDegree: Joi.string().optional().max(255).allow(''),
    facilityContactPhone: Joi.string().optional().max(255).allow(''),
    facilityContactEmail: Joi.string().optional().max(255).email({ tlds: { allow: false } }).allow(''),

    // Protocol fields - protocolDescription supports multiple pages
    protocolDescription: Joi.string().optional().max(100000).allow(''),
    protocolDateVerification: Joi.string().optional().allow(''),
    medlineIdentifier: Joi.string().optional().max(255).allow(''),
    url: Joi.string().optional().max(255).allow(''),
    urlDescription: Joi.string().optional().max(255).allow(''),
    resultsReference: Joi.boolean().optional(),

    // Eligibility fields - support long clinical criteria text
    conditions: Joi.string().optional().max(50000).allow(''),
    keywords: Joi.string().optional().max(255).allow(''),
    interventions: Joi.string().optional().max(50000).allow(''),
    eligibility: Joi.string().optional().max(50000).allow(''),
    gender: Joi.string().optional().max(30).allow(''),
    ageMin: Joi.string().optional().max(3).allow(''),
    ageMax: Joi.string().optional().max(3).allow(''),
    healthyVolunteerAccepted: Joi.boolean().optional(),

    // Design fields
    purpose: Joi.string().optional().max(64).allow(''),
    allocation: Joi.string().optional().max(64).allow(''),
    masking: Joi.string().optional().max(30).allow(''),
    control: Joi.string().optional().max(30).allow(''),
    assignment: Joi.string().optional().max(30).allow(''),
    endpoint: Joi.string().optional().max(64).allow(''),
    duration: Joi.string().optional().max(30).allow(''),
    selection: Joi.string().optional().max(30).allow(''),
    timing: Joi.string().optional().max(30).allow(''),

    // Nested data structures
    eventDefinitions: Joi.array().items(eventDefinitionSchema).optional(),
    groupClasses: Joi.array().items(groupClassSchema).optional(),
    sites: Joi.array().items(siteSchema).optional(),

    // Study parameters (settings) - nested object
    studyParameters: studyParametersSchema,

    // === ELECTRONIC SIGNATURE (21 CFR Part 11, §11.50) ===
    password: Joi.string().optional(),
    signaturePassword: Joi.string().optional(),
    signatureMeaning: Joi.string().optional().max(500)
  })
};

/**
 * Query/Discrepancy Note Schemas
 */
export const querySchemas = {
  create: Joi.object({
    crfId: Joi.number().integer().positive().optional(),
    crfVersionId: Joi.number().integer().positive().optional(),
    eventCrfId: Joi.number().integer().positive().optional(),
    itemId: Joi.number().integer().positive().optional(),
    itemDataId: Joi.number().integer().positive().optional(),
    description: Joi.string().required().min(10).max(1000)
      .messages({
        'string.min': 'Query description must be at least 10 characters',
        'string.max': 'Query description must not exceed 1000 characters'
      }),
    detailedNotes: Joi.string().optional().max(2000),
    queryType: Joi.string().valid('Query', 'Failed Validation Check', 'Annotation', 'Reason for Change').required(),
    studyId: Joi.number().integer().positive().required(),
    subjectId: Joi.number().integer().positive().optional(),
    assignedUserId: Joi.number().integer().positive().optional()
  }),

  respond: Joi.object({
    description: Joi.string().min(10).max(1000)
      .messages({
        'string.min': 'Response must be at least 10 characters',
        'string.max': 'Response must not exceed 1000 characters'
      }),
    response: Joi.string().min(10).max(1000)
      .messages({
        'string.min': 'Response must be at least 10 characters',
        'string.max': 'Response must not exceed 1000 characters'
      }),
    detailedNotes: Joi.string().optional().max(2000),
    newStatusId: Joi.number().integer().min(1).max(5).optional()
  }).or('description', 'response'),

  updateStatus: Joi.object({
    statusId: Joi.number().integer().min(1).max(10).required()
  }),

  close: Joi.object({
    queryId: Joi.number().integer().positive().required(),
    resolution: Joi.string().required().max(500)
  }),

  list: Joi.object({
    studyId: Joi.number().integer().positive().optional(),
    subjectId: Joi.number().integer().positive().optional(),
    status: Joi.string().valid('New', 'Updated', 'Resolution Proposed', 'Closed', 'Not Applicable').optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  })
};

/**
 * Audit Trail Schemas
 */
export const auditSchemas = {
  query: Joi.object({
    studyId: Joi.number().integer().positive().optional(),
    subjectId: Joi.number().integer().positive().optional(),
    userId: Joi.number().integer().positive().optional(),
    eventType: Joi.string().optional(),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(500).default(50)
  }),

  export: Joi.object({
    studyId: Joi.number().integer().positive().required(),
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().required(),
    format: Joi.string().valid('csv', 'pdf', 'json').default('csv')
  })
};

/**
 * Dashboard Schemas
 */
export const dashboardSchemas = {
  enrollment: Joi.object({
    studyId: Joi.number().integer().positive().required(),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().optional()
  }),

  completion: Joi.object({
    studyId: Joi.number().integer().positive().required()
  }),

  queries: Joi.object({
    studyId: Joi.number().integer().positive().required(),
    timeframe: Joi.string().valid('week', 'month', 'quarter', 'year').default('month')
  }),

  activity: Joi.object({
    studyId: Joi.number().integer().positive().required(),
    days: Joi.number().integer().min(1).max(90).default(30)
  })
};

/**
 * User Management Schemas
 */
export const userSchemas = {
  create: Joi.object({
    username: Joi.string().required().min(3).max(64)
      .pattern(/^[a-zA-Z0-9_]+$/)
      .messages({
        'string.pattern.base': 'Username can only contain letters, numbers, and underscores'
      }),
    firstName: Joi.string().required().max(50),
    lastName: Joi.string().required().max(50),
    email: Joi.string().email().required().max(120),
    institutionalAffiliation: Joi.string().optional().max(255).allow('', null),
    phone: Joi.string().optional().max(40).allow('', null),
    timeZone: Joi.string().optional().max(255).allow('', null),
    password: Joi.string().required()
      .min(8)
      .pattern(/.*[@$!%*?&#^()_+=\-].*/)
      .messages({
        'string.min': 'Password must be at least 8 characters',
        'string.pattern.base': 'Password must contain at least one special character'
      }),
    role: Joi.string().required().valid(
      // Current 6 canonical roles
      'admin', 'data_manager', 'investigator', 'coordinator', 'monitor', 'viewer',
      // Legacy role names (backwards compatibility)
      'data_entry', 'ra', 'ra2', 'director'
    ),
    runWebservices: Joi.boolean().optional(),
    enableApiKey: Joi.boolean().optional()
  }),

  update: Joi.object({
    userId: Joi.number().integer().positive().optional(),
    firstName: Joi.string().optional().max(50).allow(''),
    lastName: Joi.string().optional().max(50).allow(''),
    email: Joi.string().email().optional().max(120).allow(''),
    institutionalAffiliation: Joi.string().optional().max(255).allow(''),
    phone: Joi.string().optional().max(40).allow(''),
    role: Joi.string().optional().valid(
      // Current 6 canonical roles
      'admin', 'data_manager', 'investigator', 'coordinator', 'monitor', 'viewer',
      // Legacy role names (backwards compatibility)
      'data_entry', 'ra', 'ra2', 'director'
    ).allow(''),
    enabled: Joi.boolean().optional(),
    timeZone: Joi.string().optional().max(255).allow('', null),
    runWebservices: Joi.boolean().optional(),
    enableApiKey: Joi.boolean().optional(),
    accountNonLocked: Joi.boolean().optional(),
    activeStudyId: Joi.number().integer().positive().optional().allow(null),
    userTypeId: Joi.number().integer().optional()
  }),

  list: Joi.object({
    studyId: Joi.number().integer().positive().optional(),
    role: Joi.string().optional(),
    enabled: Joi.boolean().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  })
};

/**
 * Report Schemas
 */
export const reportSchemas = {
  enrollment: Joi.object({
    studyId: Joi.number().integer().positive().required(),
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().required(),
    format: Joi.string().valid('csv', 'pdf', 'xlsx').default('pdf')
  }),

  dataCompletion: Joi.object({
    studyId: Joi.number().integer().positive().required(),
    includeSubjects: Joi.boolean().default(true),
    format: Joi.string().valid('csv', 'pdf', 'xlsx').default('pdf')
  }),

  queries: Joi.object({
    studyId: Joi.number().integer().positive().required(),
    status: Joi.string().valid('open', 'closed', 'all').default('all'),
    format: Joi.string().valid('csv', 'pdf', 'xlsx').default('pdf')
  })
};

/**
 * Event Scheduling Schemas
 */
export const eventSchemas = {
  schedule: Joi.object({
    studySubjectId: Joi.number().integer().positive().required(),
    studyEventDefinitionId: Joi.number().integer().positive().required(),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().optional(),
    location: Joi.string().optional().max(255),
    scheduledDate: Joi.date().iso().optional(),
    isUnscheduled: Joi.boolean().optional()
  }),

  create: Joi.object({
    studyId: Joi.number().integer().positive().required(),
    name: Joi.string().required().min(3).max(255),
    description: Joi.string().optional().max(1000),
    ordinal: Joi.number().integer().min(1).required(),
    type: Joi.string().optional().valid('scheduled', 'unscheduled', 'common'),
    repeating: Joi.boolean().optional(),
    category: Joi.string().optional().max(100)
  }),

  update: Joi.object({
    name: Joi.string().optional().min(3).max(255),
    description: Joi.string().optional().max(1000),
    ordinal: Joi.number().integer().min(1).optional(),
    type: Joi.string().optional().valid('scheduled', 'unscheduled', 'common'),
    repeating: Joi.boolean().optional(),
    category: Joi.string().optional().max(100)
  }),

  list: Joi.object({
    studyId: Joi.number().integer().positive().required(),
    subjectId: Joi.number().integer().positive().optional(),
    status: Joi.string().valid('scheduled', 'data_entry_started', 'completed', 'stopped', 'skipped').optional()
  })
};

/**
 * Common parameter schemas
 */
export const commonSchemas = {
  idParam: Joi.object({
    id: Joi.number().integer().positive().required()
      .messages({
        'number.base': 'ID must be a number',
        'number.positive': 'ID must be positive',
        'any.required': 'ID is required'
      })
  }),

  studyIdParam: Joi.object({
    studyId: Joi.number().integer().positive().required()
      .messages({
        'number.base': 'Study ID must be a number',
        'number.positive': 'Study ID must be positive',
        'any.required': 'Study ID is required'
      })
  }),

  subjectIdParam: Joi.object({
    subjectId: Joi.number().integer().positive().required()
      .messages({
        'number.base': 'Subject ID must be a number',
        'number.positive': 'Subject ID must be positive',
        'any.required': 'Subject ID is required'
      })
  }),

  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc')
  })
};

export default validate;
