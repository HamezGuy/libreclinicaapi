/**
 * Validation Middleware
 * 
 * Implements request validation using Joi schemas
 * - Validates request body, query params, and URL params
 * - Provides detailed validation error messages
 * - Ensures data integrity before processing
 * 
 * Compliance: 21 CFR Part 11 §11.10(f) - Operational System Checks
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
    secondaryId: Joi.string().optional().allow('').max(30),
    enrollmentDate: Joi.date().iso().optional(),
    gender: Joi.string().valid('m', 'f', 'Male', 'Female', '').optional(),
    dateOfBirth: Joi.date().iso().optional()
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
    eventCrfId: Joi.number().integer().positive().optional(),
    
    // Form ID - accept both frontend and backend naming conventions
    formId: Joi.number().integer().positive().optional(),
    crfId: Joi.number().integer().positive().optional(),
    crfVersionId: Joi.number().integer().positive().optional(),
    
    // Form data - accept both frontend and backend naming conventions
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

/**
 * Study Schemas
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
    uniqueIdentifier: Joi.string().required().min(3).max(255)
      .pattern(/^[a-zA-Z0-9_-]+$/)
      .messages({
        'string.pattern.base': 'Study identifier can only contain letters, numbers, hyphens, and underscores',
        'any.required': 'Protocol number is required'
      }),
    principalInvestigator: Joi.string().required().max(255)
      .messages({
        'any.required': 'Principal Investigator is required for clinical trials'
      }),
    sponsor: Joi.string().required().max(255)
      .messages({
        'any.required': 'Sponsor is required for clinical trials'
      }),
    phase: Joi.string().required().valid('I', 'II', 'III', 'IV', 'N/A', 'i', 'ii', 'iii', 'iv', 'phase_i', 'phase_ii', 'phase_iii', 'phase_iv')
      .messages({
        'any.required': 'Study phase is required',
        'any.only': 'Phase must be I, II, III, IV, or N/A'
      }),
    expectedTotalEnrollment: Joi.number().integer().min(1).required()
      .messages({
        'any.required': 'Expected enrollment is required',
        'number.min': 'Expected enrollment must be at least 1'
      }),
    datePlannedStart: Joi.alternatives().try(
      Joi.date().iso(),
      Joi.string().min(1)
    ).required()
      .messages({
        'any.required': 'Planned start date is required'
      }),
    // Optional fields
    description: Joi.string().optional().max(2000).allow(''),
    summary: Joi.string().optional().max(2000).allow(''),
    protocolType: Joi.string().optional().valid('interventional', 'observational'),
    targetEnrollment: Joi.number().integer().min(0).optional(), // Allow frontend variation
    datePlannedEnd: Joi.alternatives().try(
      Joi.date().iso(),
      Joi.string().allow('')
    ).optional(),
    parentStudyId: Joi.number().integer().positive().optional(),
    // Additional optional fields from frontend
    officialTitle: Joi.string().optional().max(255).allow(''),
    secondaryIdentifier: Joi.string().optional().max(255).allow(''),
    collaborators: Joi.string().optional().max(1000).allow(''),
    facilityName: Joi.string().optional().max(255).allow(''),
    facilityCity: Joi.string().optional().max(255).allow(''),
    facilityState: Joi.string().optional().max(20).allow(''),
    facilityZip: Joi.string().optional().max(64).allow(''),
    facilityCountry: Joi.string().optional().max(64).allow(''),
    facilityRecruitmentStatus: Joi.string().optional().max(60).allow(''),
    facilityContactName: Joi.string().optional().max(255).allow(''),
    facilityContactDegree: Joi.string().optional().max(255).allow(''),
    facilityContactPhone: Joi.string().optional().max(255).allow(''),
    facilityContactEmail: Joi.string().optional().max(255).email().allow(''),
    protocolDescription: Joi.string().optional().max(1000).allow(''),
    protocolDateVerification: Joi.string().optional().allow(''),
    medlineIdentifier: Joi.string().optional().max(255).allow(''),
    url: Joi.string().optional().max(255).allow(''),
    urlDescription: Joi.string().optional().max(255).allow(''),
    resultsReference: Joi.boolean().optional(),
    conditions: Joi.string().optional().max(500).allow(''),
    keywords: Joi.string().optional().max(255).allow(''),
    interventions: Joi.string().optional().max(1000).allow(''),
    eligibility: Joi.string().optional().max(500).allow(''),
    gender: Joi.string().optional().allow(''),
    ageMin: Joi.string().optional().max(3).allow(''),
    ageMax: Joi.string().optional().max(3).allow(''),
    healthyVolunteerAccepted: Joi.boolean().optional(),
    purpose: Joi.string().optional().max(64).allow(''),
    allocation: Joi.string().optional().max(64).allow(''),
    masking: Joi.string().optional().max(30).allow(''),
    control: Joi.string().optional().max(30).allow(''),
    assignment: Joi.string().optional().max(30).allow(''),
    endpoint: Joi.string().optional().max(64).allow(''),
    duration: Joi.string().optional().max(30).allow(''),
    selection: Joi.string().optional().max(30).allow(''),
    timing: Joi.string().optional().max(30).allow(''),
    // Event definitions (phases) with CRF assignments
    eventDefinitions: Joi.array().items(Joi.object({
      name: Joi.string().required().max(255),
      description: Joi.string().optional().max(2000).allow(''),
      category: Joi.string().optional().allow(''),
      type: Joi.string().valid('scheduled', 'unscheduled', 'common').default('scheduled'),
      ordinal: Joi.number().integer().min(1).optional(),
      repeating: Joi.boolean().default(false),
      crfAssignments: Joi.array().items(Joi.object({
        crfId: Joi.number().integer().positive().required(),
        required: Joi.boolean().default(true),
        doubleDataEntry: Joi.boolean().default(false),
        electronicSignature: Joi.boolean().default(false),
        hideCrf: Joi.boolean().default(false),
        ordinal: Joi.number().integer().min(1).default(1)
      })).optional()
    })).optional(),
    // Group classes
    groupClasses: Joi.array().items(Joi.object({
      name: Joi.string().required().max(255),
      type: Joi.number().integer().min(1).max(4).default(1),
      subjectAssignment: Joi.string().optional().allow(''),
      groups: Joi.array().items(Joi.object({
        name: Joi.string().required().max(255),
        description: Joi.string().optional().max(1000).allow('')
      })).optional()
    })).optional(),
    // Sites (child studies)
    sites: Joi.array().items(Joi.object({
      name: Joi.string().required().max(255),
      uniqueIdentifier: Joi.string().required().max(255),
      facilityName: Joi.string().optional().max(255).allow(''),
      facilityCity: Joi.string().optional().max(255).allow(''),
      facilityCountry: Joi.string().optional().max(64).allow(''),
      principalInvestigator: Joi.string().optional().max(255).allow(''),
      expectedTotalEnrollment: Joi.number().integer().min(0).optional(),
      inheritFromParent: Joi.boolean().default(true)
    })).optional(),
    // Study parameters
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
    contactEmail: Joi.string().optional().email().allow('')
  }),

  update: Joi.object({
    name: Joi.string().optional().min(3).max(255),
    description: Joi.string().optional().max(2000),
    principalInvestigator: Joi.string().optional().max(255),
    sponsor: Joi.string().optional().max(255),
    phase: Joi.string().optional().valid('I', 'II', 'III', 'IV', 'N/A'),
    expectedTotalEnrollment: Joi.number().integer().min(0).optional(),
    datePlannedStart: Joi.date().iso().optional(),
    datePlannedEnd: Joi.date().iso().optional()
  })
};

/**
 * Query/Discrepancy Note Schemas
 */
export const querySchemas = {
  create: Joi.object({
    entityType: Joi.string().required().valid('itemData', 'eventCrf', 'studySubject', 'studyEvent'),
    entityId: Joi.number().integer().positive().required(),
    description: Joi.string().required().min(10).max(1000)
      .messages({
        'string.min': 'Query description must be at least 10 characters',
        'string.max': 'Query description must not exceed 1000 characters'
      }),
    detailedNotes: Joi.string().optional().max(2000),
    queryType: Joi.string().valid('Query', 'Failed Validation Check', 'Annotation', 'Reason for Change').required(),
    studyId: Joi.number().integer().positive().required(),
    subjectId: Joi.number().integer().positive().optional()
  }),

  respond: Joi.object({
    description: Joi.string().required().min(10).max(1000)
      .messages({
        'string.min': 'Response must be at least 10 characters',
        'string.max': 'Response must not exceed 1000 characters'
      }),
    detailedNotes: Joi.string().optional().max(2000)
  }),

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
    status: Joi.string().valid('New', 'Updated', 'Resolved', 'Closed', 'Not Applicable').optional(),
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
    institutionalAffiliation: Joi.string().optional().max(255),
    phone: Joi.string().optional().max(40),
    password: Joi.string().required()
      .min(8)
      .pattern(/.*[@$!%*?&#^()_+=\-].*/)
      .messages({
        'string.min': 'Password must be at least 8 characters',
        'string.pattern.base': 'Password must contain at least one special character'
      }),
    role: Joi.string().required().valid('admin', 'coordinator', 'investigator', 'monitor', 'data_entry')
  }),

  update: Joi.object({
    userId: Joi.number().integer().positive().optional(), // Optional in body since it's in URL
    firstName: Joi.string().optional().max(50),
    lastName: Joi.string().optional().max(50),
    email: Joi.string().email().optional().max(120),
    institutionalAffiliation: Joi.string().optional().max(255),
    phone: Joi.string().optional().max(40),
    role: Joi.string().optional().valid('admin', 'coordinator', 'investigator', 'monitor', 'data_entry'),
    enabled: Joi.boolean().optional()
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
    location: Joi.string().optional().max(255)
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

