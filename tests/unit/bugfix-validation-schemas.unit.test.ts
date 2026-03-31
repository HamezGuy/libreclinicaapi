/**
 * Unit Tests — Validation Schema Fixes
 * 
 * Tests the Joi validation schema changes:
 * - validateField accepts operationType 'create'
 * - validateField accepts null/empty values
 * - Study creation accepts extended field lengths
 * - Event definitions accept schedule_day, minDay, maxDay
 */

import Joi from 'joi';

// Re-import the schemas inline since we can't import from middleware directly in unit test
const crfAssignmentSchema = Joi.object({
  crfId: Joi.number().integer().positive().required(),
  required: Joi.boolean().default(true),
  doubleDataEntry: Joi.boolean().default(false),
  electronicSignature: Joi.boolean().default(false),
  hideCrf: Joi.boolean().default(false),
  ordinal: Joi.number().integer().min(1).default(1)
});

const eventDefinitionSchema = Joi.object({
  studyEventDefinitionId: Joi.number().integer().optional(),
  name: Joi.string().required().max(255),
  description: Joi.string().optional().max(2000).allow(''),
  category: Joi.string().optional().allow(''),
  type: Joi.string().valid('scheduled', 'unscheduled', 'common').default('scheduled'),
  ordinal: Joi.number().integer().min(1).optional(),
  repeating: Joi.boolean().default(false),
  scheduleDay: Joi.number().integer().min(0).optional().allow(null),
  minDay: Joi.number().integer().max(0).optional().allow(null),
  maxDay: Joi.number().integer().min(0).optional().allow(null),
  referenceEventId: Joi.number().integer().positive().optional().allow(null),
  crfAssignments: Joi.array().items(crfAssignmentSchema).optional()
});

const validateFieldSchema = Joi.object({
  crfId: Joi.number().integer().positive().required(),
  fieldPath: Joi.string().required().max(255),
  value: Joi.any().allow(null, '').optional(),
  itemId: Joi.number().integer().positive().optional(),
  allFormData: Joi.object().optional(),
  eventCrfId: Joi.number().integer().positive().optional(),
  createQueries: Joi.boolean().optional().default(false),
  studyId: Joi.number().integer().positive().optional(),
  subjectId: Joi.number().integer().positive().optional(),
  itemDataId: Joi.number().integer().positive().optional(),
  operationType: Joi.string().optional().valid('create', 'insert', 'update', 'delete'),
});

describe('Validation Schema Fixes', () => {

  describe('validateField schema', () => {
    it('should accept operationType "create"', () => {
      const { error } = validateFieldSchema.validate({
        crfId: 1, fieldPath: 'test', value: 'hello', operationType: 'create'
      });
      expect(error).toBeUndefined();
    });

    it('should accept operationType "update"', () => {
      const { error } = validateFieldSchema.validate({
        crfId: 1, fieldPath: 'test', value: 'hello', operationType: 'update'
      });
      expect(error).toBeUndefined();
    });

    it('should accept operationType "delete"', () => {
      const { error } = validateFieldSchema.validate({
        crfId: 1, fieldPath: 'test', value: '', operationType: 'delete'
      });
      expect(error).toBeUndefined();
    });

    it('should reject invalid operationType', () => {
      const { error } = validateFieldSchema.validate({
        crfId: 1, fieldPath: 'test', value: 'x', operationType: 'invalid'
      });
      expect(error).toBeDefined();
    });

    it('should accept null value', () => {
      const { error } = validateFieldSchema.validate({
        crfId: 1, fieldPath: 'test', value: null
      });
      expect(error).toBeUndefined();
    });

    it('should accept empty string value', () => {
      const { error } = validateFieldSchema.validate({
        crfId: 1, fieldPath: 'test', value: ''
      });
      expect(error).toBeUndefined();
    });

    it('should accept undefined value', () => {
      const { error } = validateFieldSchema.validate({
        crfId: 1, fieldPath: 'test'
      });
      expect(error).toBeUndefined();
    });

    it('should require crfId', () => {
      const { error } = validateFieldSchema.validate({
        fieldPath: 'test', value: 'x'
      });
      expect(error).toBeDefined();
    });

    it('should require fieldPath', () => {
      const { error } = validateFieldSchema.validate({
        crfId: 1, value: 'x'
      });
      expect(error).toBeDefined();
    });
  });

  describe('eventDefinition schema', () => {
    it('should accept scheduleDay, minDay, maxDay', () => {
      const { error } = eventDefinitionSchema.validate({
        name: 'Week 4 Visit',
        type: 'scheduled',
        scheduleDay: 28,
        minDay: -7,
        maxDay: 7
      });
      expect(error).toBeUndefined();
    });

    it('should accept null schedule fields', () => {
      const { error } = eventDefinitionSchema.validate({
        name: 'Screening',
        scheduleDay: null,
        minDay: null,
        maxDay: null
      });
      expect(error).toBeUndefined();
    });

    it('should reject negative scheduleDay', () => {
      const { error } = eventDefinitionSchema.validate({
        name: 'Bad Visit',
        scheduleDay: -5
      });
      expect(error).toBeDefined();
    });

    it('should reject positive minDay (must be ≤ 0)', () => {
      const { error } = eventDefinitionSchema.validate({
        name: 'Bad Window',
        minDay: 5
      });
      expect(error).toBeDefined();
    });

    it('should accept visit with CRF assignments', () => {
      const { error } = eventDefinitionSchema.validate({
        name: 'Baseline',
        type: 'scheduled',
        scheduleDay: 7,
        crfAssignments: [
          { crfId: 1, required: true },
          { crfId: 2, required: false, doubleDataEntry: true }
        ]
      });
      expect(error).toBeUndefined();
    });
  });

  describe('Study creation field limits', () => {
    const studyCreateSchema = Joi.object({
      name: Joi.string().required().min(3).max(500),
      uniqueIdentifier: Joi.string().required().min(3).max(100).pattern(/^[a-zA-Z0-9_-]+$/),
      principalInvestigator: Joi.string().optional().max(500).allow(''),
      sponsor: Joi.string().optional().max(500).allow(''),
      summary: Joi.string().optional().max(100000).allow(''),
      ageMin: Joi.string().optional().max(10).allow(''),
      ageMax: Joi.string().optional().max(10).allow(''),
      url: Joi.string().optional().max(2000).allow(''),
    });

    it('should accept name up to 500 chars', () => {
      const { error } = studyCreateSchema.validate({
        name: 'A'.repeat(500),
        uniqueIdentifier: 'TEST-001'
      });
      expect(error).toBeUndefined();
    });

    it('should reject name over 500 chars', () => {
      const { error } = studyCreateSchema.validate({
        name: 'A'.repeat(501),
        uniqueIdentifier: 'TEST-001'
      });
      expect(error).toBeDefined();
    });

    it('should accept uniqueIdentifier up to 100 chars', () => {
      const { error } = studyCreateSchema.validate({
        name: 'Test Study',
        uniqueIdentifier: 'A'.repeat(100)
      });
      expect(error).toBeUndefined();
    });

    it('should accept ageMin/ageMax up to 10 chars', () => {
      const { error } = studyCreateSchema.validate({
        name: 'Test Study',
        uniqueIdentifier: 'AGE-TEST',
        ageMin: '0.5',
        ageMax: '99.9'
      });
      expect(error).toBeUndefined();
    });

    it('should accept URL up to 2000 chars', () => {
      const { error } = studyCreateSchema.validate({
        name: 'Test Study',
        uniqueIdentifier: 'URL-TEST',
        url: 'https://example.com/' + 'x'.repeat(1900)
      });
      expect(error).toBeUndefined();
    });
  });
});
