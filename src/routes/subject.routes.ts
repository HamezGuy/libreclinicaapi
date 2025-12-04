/**
 * Subject Routes
 * 
 * API endpoints for subject/patient management including:
 * - List and search subjects
 * - CRUD operations
 * - Progress tracking
 * - Events and forms
 */

import express, { Request, Response } from 'express';
import * as controller from '../controllers/subject.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, subjectSchemas, commonSchemas } from '../middleware/validation.middleware';
import { soapRateLimiter } from '../middleware/rateLimiter.middleware';
import * as studyParamsService from '../services/database/studyParameters.service';
import * as studyGroupsService from '../services/database/studyGroups.service';
import { logger } from '../config/logger';

const router = express.Router();

router.use(authMiddleware);

/**
 * GET /api/subjects/enrollment-config/:studyId
 * Get study parameters and group classes needed for enrollment form
 * This tells the frontend how to configure the enrollment form dynamically
 */
router.get('/enrollment-config/:studyId', async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    
    if (isNaN(studyId)) {
      res.status(400).json({ success: false, message: 'Invalid study ID' });
      return;
    }

    // Fetch study parameters and group classes in parallel
    const [parameters, groupClasses, nextSubjectId] = await Promise.all([
      studyParamsService.getStudyParameters(studyId),
      studyGroupsService.getStudyGroupClasses(studyId),
      studyParamsService.generateNextSubjectId(studyId)
    ]);

    res.json({
      success: true,
      data: {
        studyId,
        parameters,
        groupClasses,
        suggestedSubjectId: nextSubjectId,
        // UI hints based on parameters
        formConfig: {
          showDateOfBirth: parameters.collectDob !== 'not_used',
          dateOfBirthRequired: parameters.collectDob === 'required',
          yearOfBirthOnly: parameters.collectDob === 'year_only',
          showGender: parameters.genderRequired,
          genderRequired: parameters.genderRequired,
          showPersonId: parameters.subjectPersonIdRequired !== 'not_used',
          personIdRequired: parameters.subjectPersonIdRequired === 'required',
          showSecondaryLabel: parameters.secondaryLabelViewable,
          subjectIdAutoGenerate: parameters.subjectIdGeneration !== 'manual',
          subjectIdEditable: parameters.subjectIdGeneration !== 'auto_non_editable',
          showEventLocation: parameters.eventLocationRequired !== 'not_used',
          eventLocationRequired: parameters.eventLocationRequired === 'required',
          randomizationEnabled: parameters.randomization === 'enabled',
          requiredGroupClasses: groupClasses.filter(gc => gc.subjectAssignment === 'Required'),
          optionalGroupClasses: groupClasses.filter(gc => gc.subjectAssignment === 'Optional')
        }
      }
    });
  } catch (error: any) {
    logger.error('Failed to get enrollment config', { 
      studyId: req.params.studyId, 
      error: error.message 
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

// Read operations
router.get('/', validate({ query: subjectSchemas.list }), controller.list);
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.get('/:id/progress', validate({ params: commonSchemas.idParam }), controller.getProgress);
router.get('/:id/events', validate({ params: commonSchemas.idParam }), controller.getEvents);
router.get('/:id/forms', validate({ params: commonSchemas.idParam }), controller.getForms);

// Create/Update operations - require coordinator or investigator role
router.post('/', requireRole('coordinator', 'investigator'), soapRateLimiter, validate({ body: subjectSchemas.create }), controller.create);
router.put('/:id', requireRole('coordinator', 'investigator'), validate({ params: commonSchemas.idParam }), controller.update);
router.put('/:id/status', requireRole('coordinator', 'investigator'), validate({ params: commonSchemas.idParam }), controller.updateStatus);

// Delete operation - require admin role (soft delete)
router.delete('/:id', requireRole('admin', 'coordinator'), validate({ params: commonSchemas.idParam }), controller.remove);

export default router;

