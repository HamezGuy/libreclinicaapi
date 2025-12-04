/**
 * Study Parameters Service
 * 
 * Fetches and manages study configuration parameters from LibreClinica database.
 * These parameters control enrollment behavior, subject ID generation, etc.
 * 
 * Database Tables:
 * - study_parameter: Reference table of all possible parameters
 * - study_parameter_value: Per-study parameter values
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

// Study parameter configuration matching LibreClinica's structure
export interface StudyParameterConfig {
  collectDob: 'required' | 'year_only' | 'not_used';  // 1, 2, 3 in DB
  discrepancyManagement: boolean;
  subjectPersonIdRequired: 'required' | 'optional' | 'not_used';
  genderRequired: boolean;
  subjectIdGeneration: 'manual' | 'auto_editable' | 'auto_non_editable';
  subjectIdPrefixSuffix: string;
  interviewerNameRequired: 'required' | 'optional' | 'not_used';
  interviewerNameDefault: 'blank' | 'user_name';
  interviewerNameEditable: boolean;
  interviewDateRequired: 'required' | 'optional' | 'not_used';
  interviewDateDefault: 'blank' | 'eventDate';
  interviewDateEditable: boolean;
  personIdShownOnCRF: boolean;
  secondaryLabelViewable: boolean;
  adminForcedReasonForChange: boolean;
  eventLocationRequired: 'required' | 'optional' | 'not_used';
  participantPortal: 'enabled' | 'disabled';
  randomization: 'enabled' | 'disabled';
}

// Raw parameter value from database
interface RawParameter {
  parameter: string;
  value: string;
  default_value: string;
}

/**
 * Get all available study parameters (reference data)
 */
export const getAvailableParameters = async (): Promise<any[]> => {
  const query = `
    SELECT 
      study_parameter_id,
      handle,
      name,
      description,
      default_value,
      inheritable,
      overridable
    FROM study_parameter
    ORDER BY study_parameter_id
  `;

  try {
    const result = await pool.query(query);
    return result.rows.map(row => ({
      id: row.study_parameter_id,
      handle: row.handle,
      name: row.name || row.handle,
      description: row.description || '',
      defaultValue: row.default_value,
      inheritable: row.inheritable,
      overridable: row.overridable
    }));
  } catch (error: any) {
    logger.error('Failed to get available parameters', { error: error.message });
    throw error;
  }
};

/**
 * Get study parameters for a specific study
 * Falls back to defaults from parent study or system defaults
 */
export const getStudyParameters = async (studyId: number): Promise<StudyParameterConfig> => {
  logger.info('Fetching study parameters', { studyId });

  try {
    // First, get the parent study ID (if this is a site)
    const parentQuery = `SELECT parent_study_id FROM study WHERE study_id = $1`;
    const parentResult = await pool.query(parentQuery, [studyId]);
    const parentStudyId = parentResult.rows[0]?.parent_study_id;

    // Get parameters - check study first, then parent, then defaults
    const query = `
      SELECT 
        sp.handle as parameter,
        COALESCE(
          spv_study.value,
          spv_parent.value,
          sp.default_value
        ) as value,
        sp.default_value
      FROM study_parameter sp
      LEFT JOIN study_parameter_value spv_study 
        ON sp.handle = spv_study.parameter AND spv_study.study_id = $1
      LEFT JOIN study_parameter_value spv_parent 
        ON sp.handle = spv_parent.parameter AND spv_parent.study_id = $2
      ORDER BY sp.study_parameter_id
    `;

    const result = await pool.query(query, [studyId, parentStudyId || studyId]);
    
    // Convert raw values to typed config
    const config = parseParameterValues(result.rows);
    
    logger.info('Study parameters fetched', { studyId, config });
    return config;
  } catch (error: any) {
    logger.error('Failed to get study parameters', { studyId, error: error.message });
    // Return defaults on error
    return getDefaultParameters();
  }
};

/**
 * Get raw parameter values for a study (useful for editing)
 */
export const getRawStudyParameters = async (studyId: number): Promise<Record<string, string>> => {
  const query = `
    SELECT parameter, value
    FROM study_parameter_value
    WHERE study_id = $1
  `;

  try {
    const result = await pool.query(query, [studyId]);
    const params: Record<string, string> = {};
    for (const row of result.rows) {
      params[row.parameter] = row.value;
    }
    return params;
  } catch (error: any) {
    logger.error('Failed to get raw study parameters', { studyId, error: error.message });
    return {};
  }
};

/**
 * Save study parameters
 */
export const saveStudyParameters = async (
  studyId: number, 
  parameters: Record<string, string>,
  userId: number
): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    for (const [handle, value] of Object.entries(parameters)) {
      // Check if parameter exists for this study
      const existsQuery = `
        SELECT study_parameter_value_id 
        FROM study_parameter_value 
        WHERE study_id = $1 AND parameter = $2
      `;
      const existsResult = await client.query(existsQuery, [studyId, handle]);

      if (existsResult.rows.length > 0) {
        // Update existing
        await client.query(`
          UPDATE study_parameter_value 
          SET value = $1 
          WHERE study_id = $2 AND parameter = $3
        `, [value, studyId, handle]);
      } else {
        // Insert new
        await client.query(`
          INSERT INTO study_parameter_value (study_id, parameter, value)
          VALUES ($1, $2, $3)
        `, [studyId, handle, value]);
      }
    }

    await client.query('COMMIT');
    logger.info('Study parameters saved', { studyId, paramCount: Object.keys(parameters).length });
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to save study parameters', { studyId, error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Initialize default parameters for a new study
 */
export const initializeStudyParameters = async (studyId: number, userId: number): Promise<void> => {
  const defaults = await getAvailableParameters();
  const params: Record<string, string> = {};
  
  for (const param of defaults) {
    params[param.handle] = param.defaultValue;
  }
  
  await saveStudyParameters(studyId, params, userId);
};

/**
 * Parse raw parameter values into typed config
 */
function parseParameterValues(rows: RawParameter[]): StudyParameterConfig {
  const valueMap: Record<string, string> = {};
  for (const row of rows) {
    valueMap[row.parameter] = row.value || row.default_value;
  }

  return {
    collectDob: parseCollectDob(valueMap['collectDob']),
    discrepancyManagement: valueMap['discrepancyManagement'] === 'true',
    subjectPersonIdRequired: parseRequiredOption(valueMap['subjectPersonIdRequired']),
    genderRequired: valueMap['genderRequired'] === 'true' || valueMap['genderRequired'] === 'required',
    subjectIdGeneration: parseIdGeneration(valueMap['subjectIdGeneration']),
    subjectIdPrefixSuffix: valueMap['subjectIdPrefixSuffix'] || '',
    interviewerNameRequired: parseRequiredOption(valueMap['interviewerNameRequired']),
    interviewerNameDefault: valueMap['interviewerNameDefault'] === 'blank' ? 'blank' : 'user_name',
    interviewerNameEditable: valueMap['interviewerNameEditable'] === 'editable' || valueMap['interviewerNameEditable'] === 'true',
    interviewDateRequired: parseRequiredOption(valueMap['interviewDateRequired']),
    interviewDateDefault: valueMap['interviewDateDefault'] === 'blank' ? 'blank' : 'eventDate',
    interviewDateEditable: valueMap['interviewDateEditable'] === 'editable' || valueMap['interviewDateEditable'] === 'true',
    personIdShownOnCRF: valueMap['personIdShownOnCRF'] === 'true',
    secondaryLabelViewable: valueMap['secondaryLabelViewable'] !== 'not viewable',
    adminForcedReasonForChange: valueMap['adminForcedReasonForChange'] === 'true',
    eventLocationRequired: parseRequiredOption(valueMap['eventLocationRequired']),
    participantPortal: valueMap['participantPortal'] === 'enabled' ? 'enabled' : 'disabled',
    randomization: valueMap['randomization'] === 'enabled' ? 'enabled' : 'disabled'
  };
}

function parseCollectDob(value: string): 'required' | 'year_only' | 'not_used' {
  if (value === '1' || value === 'required' || value === 'full') return 'required';
  if (value === '2' || value === 'year_only') return 'year_only';
  return 'not_used';
}

function parseRequiredOption(value: string): 'required' | 'optional' | 'not_used' {
  if (value === 'required' || value === 'true') return 'required';
  if (value === 'optional') return 'optional';
  return 'not_used';
}

function parseIdGeneration(value: string): 'manual' | 'auto_editable' | 'auto_non_editable' {
  if (value === 'auto editable' || value === 'auto_editable') return 'auto_editable';
  if (value === 'auto non-editable' || value === 'auto_non_editable') return 'auto_non_editable';
  return 'manual';
}

/**
 * Get default parameters when database fetch fails
 */
function getDefaultParameters(): StudyParameterConfig {
  return {
    collectDob: 'required',
    discrepancyManagement: true,
    subjectPersonIdRequired: 'required',
    genderRequired: true,
    subjectIdGeneration: 'manual',
    subjectIdPrefixSuffix: '',
    interviewerNameRequired: 'required',
    interviewerNameDefault: 'blank',
    interviewerNameEditable: true,
    interviewDateRequired: 'required',
    interviewDateDefault: 'eventDate',
    interviewDateEditable: true,
    personIdShownOnCRF: false,
    secondaryLabelViewable: false,
    adminForcedReasonForChange: true,
    eventLocationRequired: 'not_used',
    participantPortal: 'disabled',
    randomization: 'disabled'
  };
}

/**
 * Generate next subject ID based on study settings
 */
export const generateNextSubjectId = async (studyId: number): Promise<string> => {
  const params = await getStudyParameters(studyId);
  
  if (params.subjectIdGeneration === 'manual') {
    return ''; // Don't auto-generate for manual
  }

  // Get the greatest existing label and increment
  const query = `
    SELECT MAX(CAST(
      CASE 
        WHEN label ~ '^[0-9]+$' THEN label 
        ELSE '0' 
      END AS INTEGER
    )) as max_label
    FROM study_subject
    WHERE study_id = $1 OR study_id IN (
      SELECT study_id FROM study WHERE parent_study_id = $1
    )
  `;

  try {
    const result = await pool.query(query, [studyId]);
    const nextNum = (result.rows[0]?.max_label || 0) + 1;
    
    // Apply prefix/suffix if configured
    const prefix = params.subjectIdPrefixSuffix || '';
    if (prefix) {
      // Format: [PREFIX][AUTO#][SUFFIX] - parse and apply
      return prefix.replace('[AUTO#]', nextNum.toString().padStart(4, '0'));
    }
    
    return nextNum.toString();
  } catch (error: any) {
    logger.error('Failed to generate subject ID', { studyId, error: error.message });
    return '';
  }
};

