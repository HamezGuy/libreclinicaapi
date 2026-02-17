/**
 * Study Groups Service
 * 
 * Manages study group classes and groups for randomization/treatment arm assignment.
 * 
 * Database Tables:
 * - study_group_class: Categories of groups (Arm, Family/Pedigree, Demographic, Other)
 * - study_group: Individual groups within a class
 * - subject_group_map: Assignment of subjects to groups
 * - group_class_types: Reference table for group class types
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

// Group class types from LibreClinica (predefined + custom)
export type GroupClassType = 'Arm' | 'Family/Pedigree' | 'Demographic' | 'Other' | 'Custom' | 'Cohort' | 'Stratification Factor' | 'Dose Group';

export interface StudyGroupClass {
  studyGroupClassId: number;
  name: string;
  studyId: number;
  groupClassTypeId: number;
  groupClassTypeName: string;
  customTypeName?: string;
  subjectAssignment: 'Required' | 'Optional';
  statusId: number;
  statusName: string;
  groups: StudyGroup[];
  dateCreated: Date;
  ownerId: number;
}

export interface StudyGroup {
  studyGroupId: number;
  name: string;
  description?: string;
  studyGroupClassId: number;
}

export interface SubjectGroupAssignment {
  subjectGroupMapId: number;
  studySubjectId: number;
  studyGroupClassId: number;
  studyGroupId: number;
  notes?: string;
  dateCreated: Date;
}

/**
 * Get all group class types (reference data)
 */
export const getGroupClassTypes = async (): Promise<{ id: number; name: string }[]> => {
  const query = `
    SELECT group_class_type_id as id, name
    FROM group_class_types
    ORDER BY group_class_type_id
  `;

  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error: any) {
    logger.error('Failed to get group class types', { error: error.message });
    return [
      { id: 1, name: 'Arm' },
      { id: 2, name: 'Family/Pedigree' },
      { id: 3, name: 'Demographic' },
      { id: 4, name: 'Other' },
      { id: 5, name: 'Custom' },
      { id: 6, name: 'Cohort' },
      { id: 7, name: 'Stratification Factor' },
      { id: 8, name: 'Dose Group' }
    ];
  }
};

/**
 * Get all active study group classes for a study with their groups
 */
export const getStudyGroupClasses = async (studyId: number): Promise<StudyGroupClass[]> => {
  logger.info('Fetching study group classes', { studyId });

  try {
    // Get parent study ID if this is a site
    const parentQuery = `SELECT parent_study_id FROM study WHERE study_id = $1`;
    const parentResult = await pool.query(parentQuery, [studyId]);
    const parentStudyId = parentResult.rows[0]?.parent_study_id;

    // Get group classes - from this study or parent study
    const classQuery = `
      SELECT 
        sgc.study_group_class_id,
        sgc.name,
        sgc.study_id,
        sgc.group_class_type_id,
        sgc.custom_type_name,
        gct.name as group_class_type_name,
        sgc.subject_assignment,
        sgc.status_id,
        st.name as status_name,
        sgc.date_created,
        sgc.owner_id
      FROM study_group_class sgc
      INNER JOIN group_class_types gct ON sgc.group_class_type_id = gct.group_class_type_id
      INNER JOIN status st ON sgc.status_id = st.status_id
      WHERE (sgc.study_id = $1 OR sgc.study_id = $2)
        AND sgc.status_id = 1
      ORDER BY sgc.name
    `;

    const classResult = await pool.query(classQuery, [studyId, parentStudyId || studyId]);

    // Get groups for each class
    const groupClasses: StudyGroupClass[] = [];
    
    for (const row of classResult.rows) {
      const groupQuery = `
        SELECT 
          study_group_id,
          name,
          description,
          study_group_class_id
        FROM study_group
        WHERE study_group_class_id = $1
        ORDER BY name
      `;
      
      const groupResult = await pool.query(groupQuery, [row.study_group_class_id]);
      
      groupClasses.push({
        studyGroupClassId: row.study_group_class_id,
        name: row.name,
        studyId: row.study_id,
        groupClassTypeId: row.group_class_type_id,
        groupClassTypeName: row.group_class_type_name,
        customTypeName: row.custom_type_name || undefined,
        subjectAssignment: row.subject_assignment || 'Optional',
        statusId: row.status_id,
        statusName: row.status_name,
        dateCreated: row.date_created,
        ownerId: row.owner_id,
        groups: groupResult.rows.map(g => ({
          studyGroupId: g.study_group_id,
          name: g.name,
          description: g.description,
          studyGroupClassId: g.study_group_class_id
        }))
      });
    }

    logger.info('Study group classes fetched', { 
      studyId, 
      classCount: groupClasses.length,
      totalGroups: groupClasses.reduce((sum, c) => sum + c.groups.length, 0)
    });

    return groupClasses;
  } catch (error: any) {
    logger.error('Failed to get study group classes', { studyId, error: error.message });
    return [];
  }
};

/**
 * Create a new study group class
 */
export const createStudyGroupClass = async (
  data: {
    studyId: number;
    name: string;
    groupClassTypeId: number;
    customTypeName?: string;
    subjectAssignment?: 'Required' | 'Optional';
  },
  userId: number
): Promise<{ success: boolean; studyGroupClassId?: number; message?: string }> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO study_group_class (
        name, study_id, owner_id, date_created, 
        group_class_type_id, custom_type_name, status_id, subject_assignment
      ) VALUES ($1, $2, $3, NOW(), $4, $5, 1, $6)
      RETURNING study_group_class_id
    `;

    const result = await client.query(insertQuery, [
      data.name,
      data.studyId,
      userId,
      data.groupClassTypeId,
      data.customTypeName || null,
      data.subjectAssignment || 'Optional'
    ]);

    await client.query('COMMIT');

    logger.info('Study group class created', { 
      studyGroupClassId: result.rows[0].study_group_class_id,
      name: data.name 
    });

    return {
      success: true,
      studyGroupClassId: result.rows[0].study_group_class_id
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to create study group class', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Create a new group within a class
 */
export const createStudyGroup = async (
  data: {
    studyGroupClassId: number;
    name: string;
    description?: string;
  }
): Promise<{ success: boolean; studyGroupId?: number; message?: string }> => {
  try {
    const insertQuery = `
      INSERT INTO study_group (name, description, study_group_class_id)
      VALUES ($1, $2, $3)
      RETURNING study_group_id
    `;

    const result = await pool.query(insertQuery, [
      data.name,
      data.description || '',
      data.studyGroupClassId
    ]);

    logger.info('Study group created', { 
      studyGroupId: result.rows[0].study_group_id,
      name: data.name 
    });

    return {
      success: true,
      studyGroupId: result.rows[0].study_group_id
    };
  } catch (error: any) {
    logger.error('Failed to create study group', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Assign a subject to groups
 */
export const assignSubjectToGroups = async (
  studySubjectId: number,
  assignments: { studyGroupClassId: number; studyGroupId: number; notes?: string }[],
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    for (const assignment of assignments) {
      // Check if assignment already exists
      const existsQuery = `
        SELECT subject_group_map_id 
        FROM subject_group_map 
        WHERE study_subject_id = $1 AND study_group_class_id = $2
      `;
      const existsResult = await client.query(existsQuery, [
        studySubjectId, 
        assignment.studyGroupClassId
      ]);

      if (existsResult.rows.length > 0) {
        // Update existing
        await client.query(`
          UPDATE subject_group_map 
          SET study_group_id = $1, notes = $2, date_updated = NOW(), update_id = $3
          WHERE study_subject_id = $4 AND study_group_class_id = $5
        `, [
          assignment.studyGroupId,
          assignment.notes || '',
          userId,
          studySubjectId,
          assignment.studyGroupClassId
        ]);
      } else {
        // Insert new
        await client.query(`
          INSERT INTO subject_group_map (
            study_group_class_id, study_subject_id, study_group_id,
            status_id, owner_id, date_created, notes
          ) VALUES ($1, $2, $3, 1, $4, NOW(), $5)
        `, [
          assignment.studyGroupClassId,
          studySubjectId,
          assignment.studyGroupId,
          userId,
          assignment.notes || ''
        ]);
      }
    }

    await client.query('COMMIT');
    
    logger.info('Subject group assignments saved', { 
      studySubjectId, 
      assignmentCount: assignments.length 
    });

    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to assign subject to groups', { 
      studySubjectId, 
      error: error.message 
    });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Get subject's group assignments
 */
export const getSubjectGroupAssignments = async (
  studySubjectId: number
): Promise<SubjectGroupAssignment[]> => {
  const query = `
    SELECT 
      sgm.subject_group_map_id,
      sgm.study_subject_id,
      sgm.study_group_class_id,
      sgm.study_group_id,
      sgm.notes,
      sgm.date_created,
      sgc.name as class_name,
      sg.name as group_name
    FROM subject_group_map sgm
    INNER JOIN study_group_class sgc ON sgm.study_group_class_id = sgc.study_group_class_id
    INNER JOIN study_group sg ON sgm.study_group_id = sg.study_group_id
    WHERE sgm.study_subject_id = $1 AND sgm.status_id = 1
    ORDER BY sgc.name
  `;

  try {
    const result = await pool.query(query, [studySubjectId]);
    return result.rows.map(row => ({
      subjectGroupMapId: row.subject_group_map_id,
      studySubjectId: row.study_subject_id,
      studyGroupClassId: row.study_group_class_id,
      studyGroupId: row.study_group_id,
      notes: row.notes,
      dateCreated: row.date_created,
      className: row.class_name,
      groupName: row.group_name
    }));
  } catch (error: any) {
    logger.error('Failed to get subject group assignments', { 
      studySubjectId, 
      error: error.message 
    });
    return [];
  }
};

/**
 * Get subjects in a specific group
 */
export const getSubjectsInGroup = async (
  studyGroupId: number
): Promise<{ studySubjectId: number; label: string; notes?: string }[]> => {
  const query = `
    SELECT 
      ss.study_subject_id,
      ss.label,
      sgm.notes
    FROM subject_group_map sgm
    INNER JOIN study_subject ss ON sgm.study_subject_id = ss.study_subject_id
    WHERE sgm.study_group_id = $1 AND sgm.status_id = 1
    ORDER BY ss.label
  `;

  try {
    const result = await pool.query(query, [studyGroupId]);
    return result.rows.map(row => ({
      studySubjectId: row.study_subject_id,
      label: row.label,
      notes: row.notes
    }));
  } catch (error: any) {
    logger.error('Failed to get subjects in group', { studyGroupId, error: error.message });
    return [];
  }
};

