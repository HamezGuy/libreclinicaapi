/**
 * Template Bundle Service
 *
 * Handles export and import of eCRF template bundles (.ecrftemplate files).
 * Uses field names as stable reference keys so bundles are portable across
 * studies and database instances.
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import {
  TemplateBundleV1, BUNDLE_FORMAT_VERSION,
  ExportedForm, ExportedField, ExportedSection,
  ExportedCondition, ExportedEditCheck, ExportedValidationRule,
  ExportedFormLink, ImportBundleResponse
} from '../../types/template-bundle.types';
import * as formService from './form.service';
import * as validationRulesService from '../database/validation-rules.service';
import { resolveFieldType } from '../../utils/field-type.utils';

// ============================================================================
// EXPORT
// ============================================================================

/**
 * Build an ID-to-name lookup from loaded fields so we can convert all
 * numeric ID references in skip logic / edit checks / etc. to name-based refs.
 * 
 * Fields may be referenced by:
 *  - numeric item_id (as a string), e.g. "42"
 *  - field name (from extended props fieldName), e.g. "age"
 *  - field label (item.name in DB stores the label), e.g. "Age"
 * 
 * We map ALL of these to the canonical refKey (oc_oid or name) so the
 * export always uses a stable portable key.
 */
function buildIdToNameMap(fields: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fields) {
    const id = String(f.item_id ?? f.id ?? '');
    const refKey = f.oc_oid || f.name || `field_${f.item_id}`;
    
    // Map numeric ID -> refKey
    if (id) map.set(id, refKey);
    
    // Map name -> refKey (identity if name IS the refKey)
    if (f.name) map.set(f.name, refKey);
    
    // Map label -> refKey (SCD uses item.name which is the label)
    if (f.label && f.label !== f.name) map.set(f.label, refKey);
  }
  return map;
}

function buildFormIdToRefKeyMap(formRows: any[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of formRows) {
    map.set(row.crf_id, row.oc_oid || `F_${row.name?.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`);
  }
  return map;
}

function convertCondition(cond: any, idToName: Map<string, string>): ExportedCondition {
  const fieldRef = idToName.get(String(cond.fieldId)) || cond.fieldId || '';
  return {
    fieldRef,
    operator: cond.operator || 'equals',
    value: cond.value,
    value2: cond.value2,
    message: cond.message,
    logicalOperator: cond.logicalOperator
  };
}

function convertConditions(conditions: any, idToName: Map<string, string>): ExportedCondition[] | undefined {
  if (!conditions) return undefined;
  const arr = Array.isArray(conditions) ? conditions : [conditions];
  if (arr.length === 0) return undefined;
  return arr.map(c => convertCondition(c, idToName));
}

function exportField(field: any, idToName: Map<string, string>, formIdToRef: Map<number, string>): ExportedField {
  const refKey = field.oc_oid || field.name || `field_${field.item_id}`;

  const exported: ExportedField = {
    refKey,
    name: field.name || field.label || '',
    label: field.label,
    type: field.type,
    placeholder: field.placeholder || undefined,
    helpText: field.helpText || field.description || undefined,
    description: field.description || undefined,
    required: field.required || false,
    readonly: field.readonly || false,
    hidden: field.hidden || false,
    defaultValue: field.defaultValue,
    options: field.options || undefined,
    validationRules: field.validationRules?.length ? field.validationRules.map((r: any) => ({
      type: r.type, value: r.value, message: r.message
    })) : undefined,
    unit: field.unit || field.units || undefined,
    min: field.min,
    max: field.max,
    format: field.format,
    isPhiField: field.isPhiField || false,
    phiClassification: field.phiClassification,
    auditRequired: field.auditRequired || false,
    criticalDataPoint: field.criticalDataPoint || false,
    signatureRequired: field.signatureRequired,
    sdvRequired: field.sdvRequired,
    showWhen: convertConditions(field.showWhen, idToName),
    hideWhen: convertConditions(field.hideWhen, idToName),
    requiredWhen: convertConditions(field.requiredWhen, idToName),
    calculationFormula: field.calculationFormula,
    dependsOnRefs: field.dependsOn?.length
      ? field.dependsOn.map((id: string) => idToName.get(String(id)) || id)
      : undefined,
    calculationType: field.calculationType,
    allowedFileTypes: field.allowedFileTypes,
    maxFileSize: field.maxFileSize,
    maxFiles: field.maxFiles,
    barcodeFormat: field.barcodeFormat,
    tableColumns: field.tableColumns,
    tableRows: field.tableRows,
    tableSettings: field.tableSettings,
    inlineFields: field.inlineFields,
    inlineGroupSettings: field.inlineGroupSettings,
    criteriaItems: field.criteriaItems,
    criteriaListSettings: field.criteriaListSettings,
    questionRows: field.questionRows,
    questionTableSettings: field.questionTableSettings,
    staticContent: field.staticContent,
    headerLevel: field.headerLevel,
    width: field.width,
    columnPosition: field.columnPosition,
    columnSpan: field.columnSpan,
    columnNumber: field.columnNumber,
    order: field.ordinal ?? field.order,
    ordinal: field.ordinal,
    section: field.section,
    group: field.group_name || field.group,
    groupId: field.groupId
  };

  if (field.linkedFormId) {
    exported.linkedFormRef = formIdToRef.get(Number(field.linkedFormId)) || String(field.linkedFormId);
    exported.linkedFormTriggerValue = field.linkedFormTriggerValue;
    exported.linkedFormRequired = field.linkedFormRequired;
  }

  // Strip undefined keys to keep the JSON compact
  for (const key of Object.keys(exported) as (keyof ExportedField)[]) {
    if (exported[key] === undefined) delete exported[key];
  }

  return exported;
}

/**
 * Export one or more CRFs as a portable template bundle.
 */
export async function exportBundle(
  crfIds: number[],
  username: string
): Promise<TemplateBundleV1> {
  logger.info('Exporting template bundle', { crfIds, username });

  // Load CRF rows to get basic info
  const crfRows = await pool.query(
    `SELECT c.crf_id, c.name, c.description, c.oc_oid, c.source_study_id,
            COALESCE(
              (SELECT s.name FROM study s WHERE s.study_id = c.source_study_id),
              ''
            ) as study_name
     FROM crf c WHERE c.crf_id = ANY($1) AND c.status_id NOT IN (5, 7)`,
    [crfIds]
  );

  if (crfRows.rows.length === 0) {
    throw new Error('No forms found for the given IDs');
  }

  const formIdToRefKey = buildFormIdToRefKeyMap(crfRows.rows);

  const forms: ExportedForm[] = [];

  for (const crfRow of crfRows.rows) {
    const crfId = crfRow.crf_id;

    // Load full metadata (fields, sections, etc.)
    const metadata = await formService.getFormMetadata(crfId, { includeHidden: true });
    if (!metadata) {
      logger.warn('Could not load metadata for CRF', { crfId });
      continue;
    }

    const fields: any[] = metadata.items || metadata.fields || [];
    const idToName = buildIdToNameMap(fields);

    // Load validation rules from the dedicated table
    let validationRules: any[] = [];
    try {
      validationRules = await validationRulesService.getRulesForCrf(crfId);
    } catch (e: any) {
      logger.warn('Could not load validation rules', { crfId, error: e.message });
    }

    // Get category from DB if available
    let category = 'other';
    try {
      const catResult = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'crf' AND column_name = 'category'`
      );
      if (catResult.rows.length > 0) {
        const catRow = await pool.query(`SELECT category FROM crf WHERE crf_id = $1`, [crfId]);
        category = catRow.rows[0]?.category || 'other';
      }
    } catch { /* ignore */ }

    // Get version name
    let versionName = 'v1.0';
    try {
      const vRow = await pool.query(
        `SELECT name FROM crf_version WHERE crf_id = $1 ORDER BY crf_version_id DESC LIMIT 1`,
        [crfId]
      );
      versionName = vRow.rows[0]?.name || 'v1.0';
    } catch { /* ignore */ }

    // Convert sections
    const sections: ExportedSection[] = (metadata.sections || []).map((s: any) => ({
      id: String(s.section_id || s.id || ''),
      name: s.label || s.name || '',
      description: s.instructions || s.description || undefined,
      order: s.ordinal ?? s.order ?? 0
    }));

    // Convert fields
    const exportedFields = fields.map(f => exportField(f, idToName, formIdToRefKey));

    // Convert edit checks stored in field extended props
    const editChecks: ExportedEditCheck[] = [];
    for (const f of fields) {
      const extProps = f.editChecks || [];
      for (const ec of extProps) {
        editChecks.push({
          name: ec.name || `check_${ec.id}`,
          description: ec.description,
          sourceFieldRef: idToName.get(String(ec.sourceFieldId)) || ec.sourceFieldId || '',
          targetFieldRef: ec.targetFieldId ? (idToName.get(String(ec.targetFieldId)) || ec.targetFieldId) : undefined,
          operator: ec.operator,
          value: ec.value,
          value2: ec.value2,
          customFormula: ec.customFormula,
          errorMessage: ec.errorMessage,
          severity: ec.severity || 'error',
          isActive: ec.isActive !== false,
          requiresQuery: ec.requiresQuery
        });
      }
    }

    // Convert validation rule records
    const exportedRules: ExportedValidationRule[] = validationRules.map((r: any) => ({
      name: r.name,
      description: r.description,
      fieldRef: r.fieldPath || (r.itemId ? (idToName.get(String(r.itemId)) || String(r.itemId)) : ''),
      ruleType: r.ruleType,
      severity: r.severity || 'error',
      errorMessage: r.errorMessage,
      warningMessage: r.warningMessage,
      active: r.active !== false,
      minValue: r.minValue,
      maxValue: r.maxValue,
      pattern: r.pattern,
      formatType: r.formatType,
      operator: r.operator,
      compareFieldRef: r.compareFieldPath
        ? (idToName.get(String(r.compareFieldPath)) || r.compareFieldPath)
        : undefined,
      compareValue: r.compareValue,
      customExpression: r.customExpression,
      bpSystolicMin: r.bpSystolicMin,
      bpSystolicMax: r.bpSystolicMax,
      bpDiastolicMin: r.bpDiastolicMin,
      bpDiastolicMax: r.bpDiastolicMax,
      tableCellTarget: r.tableCellTarget
    }));

    // Convert form links from fields
    const exportedFormLinks: ExportedFormLink[] = [];
    for (const f of fields) {
      const links: any[] = f.formLinks || [];
      for (const link of links) {
        exportedFormLinks.push({
          name: link.name || `link_${link.id}`,
          description: link.description,
          sourceFieldRef: idToName.get(String(f.item_id ?? f.id)) || f.name || '',
          targetFormRef: formIdToRefKey.get(Number(link.targetFormId)) || String(link.targetFormId),
          triggerConditions: (link.triggerConditions || []).map((c: any) => convertCondition(c, idToName)),
          linkType: link.linkType || 'modal',
          required: link.required || false,
          autoOpen: link.autoOpen || false,
          prefillFields: link.prefillFields?.map((pf: any) => ({
            sourceFieldRef: idToName.get(String(pf.sourceFieldId)) || pf.sourceFieldId || '',
            targetFieldRef: idToName.get(String(pf.targetFieldId)) || pf.targetFieldId || ''
          })),
          enabled: link.enabled
        });
      }
    }

    const refKey = crfRow.oc_oid || `F_${crfRow.name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;

    forms.push({
      refKey,
      name: crfRow.name,
      description: crfRow.description || undefined,
      category,
      version: versionName,
      sections,
      fields: exportedFields,
      editChecks,
      validationRuleRecords: exportedRules,
      formLinks: exportedFormLinks
    });
  }

  const sourceStudy = crfRows.rows[0]?.study_name || undefined;

  return {
    formatVersion: BUNDLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: username,
    sourceStudyName: sourceStudy,
    forms
  };
}

// ============================================================================
// IMPORT
// ============================================================================

function validateBundle(bundle: any): string[] {
  const errors: string[] = [];
  if (!bundle) { errors.push('Bundle is empty'); return errors; }
  if (bundle.formatVersion !== BUNDLE_FORMAT_VERSION) {
    errors.push(`Unsupported format version "${bundle.formatVersion}" (expected "${BUNDLE_FORMAT_VERSION}")`);
  }
  if (!Array.isArray(bundle.forms) || bundle.forms.length === 0) {
    errors.push('Bundle contains no forms');
  }
  for (const form of (bundle.forms || [])) {
    if (!form.name) errors.push(`Form with refKey "${form.refKey}" has no name`);
    if (!Array.isArray(form.fields)) errors.push(`Form "${form.name}" has no fields array`);
  }
  return errors;
}

/** Build name-to-new-ID map after fields are created.
 *  Maps refKey, field name, AND label to the new numeric item_id string
 *  so remapCondition can resolve any reference style.
 */
function buildNameToIdMap(
  fields: ExportedField[],
  newItemIds: number[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < fields.length; i++) {
    const idStr = String(newItemIds[i]);
    const ef = fields[i];
    // refKey (primary)
    map.set(ef.refKey, idStr);
    // field name
    if (ef.name) map.set(ef.name, idStr);
    // field label (SCD conditions may reference by label)
    if (ef.label && ef.label !== ef.name) map.set(ef.label, idStr);
  }
  return map;
}

function remapCondition(
  cond: ExportedCondition,
  nameToId: Map<string, string>
): any {
  return {
    fieldId: nameToId.get(cond.fieldRef) || cond.fieldRef,
    operator: cond.operator,
    value: cond.value,
    value2: cond.value2,
    message: cond.message,
    logicalOperator: cond.logicalOperator
  };
}

function remapConditions(
  conditions: ExportedCondition[] | undefined,
  nameToId: Map<string, string>
): any[] | undefined {
  if (!conditions || conditions.length === 0) return undefined;
  return conditions.map(c => remapCondition(c, nameToId));
}

/**
 * Import a template bundle into a target study.
 * All entities are created in a single DB transaction.
 */
export async function importBundle(
  bundle: TemplateBundleV1,
  targetStudyId: number,
  userId: number
): Promise<ImportBundleResponse> {
  logger.info('Importing template bundle', {
    formCount: bundle.forms.length,
    targetStudyId,
    userId
  });

  const validationErrors = validateBundle(bundle);
  if (validationErrors.length > 0) {
    return { success: false, createdForms: [], warnings: [], message: validationErrors.join('; ') };
  }

  const warnings: string[] = [];
  const createdForms: { refKey: string; newCrfId: number; newCrfVersionId: number }[] = [];

  // Global map: formRefKey -> newCrfId (for cross-form link resolution)
  const formRefToCrfId = new Map<string, number>();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Repair sequences before bulk inserts
    const sequences = [
      { seq: 'crf_crf_id_seq', table: 'crf', pk: 'crf_id' },
      { seq: 'crf_version_crf_version_id_seq', table: 'crf_version', pk: 'crf_version_id' },
      { seq: 'item_group_item_group_id_seq', table: 'item_group', pk: 'item_group_id' },
      { seq: 'item_item_id_seq', table: 'item', pk: 'item_id' }
    ];
    for (const s of sequences) {
      try {
        await client.query(
          `SELECT setval($1::regclass, GREATEST((SELECT COALESCE(MAX(${s.pk}),0) FROM ${s.table}), (SELECT last_value FROM ${s.seq})))`,
          [s.seq]
        );
      } catch { /* ignore */ }
    }

    // Check category column
    const catCheck = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='crf' AND column_name='category'`
    );
    const hasCategory = catCheck.rows.length > 0;

    // ── PASS 1: Create CRFs, versions, sections, fields ─────────────
    for (const form of bundle.forms) {
      // Deduplicate form name within the target study
      let formName = form.name;
      const nameCheck = await client.query(
        `SELECT crf_id FROM crf WHERE name=$1 AND status_id NOT IN (5,7)`,
        [formName]
      );
      if (nameCheck.rows.length > 0) {
        formName = `${form.name} (imported)`;
        warnings.push(`Form "${form.name}" already exists — imported as "${formName}"`);
      }

      // Create CRF
      const ts = Date.now().toString().slice(-6);
      const ocOid = `F_${formName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 24)}_${ts}`;

      let crfResult;
      if (hasCategory) {
        crfResult = await client.query(
          `INSERT INTO crf (name,description,category,status_id,owner_id,date_created,oc_oid,source_study_id)
           VALUES ($1,$2,$3,2,$4,NOW(),$5,$6) RETURNING crf_id`,
          [formName, form.description || '', form.category || 'other', userId, ocOid, targetStudyId]
        );
      } else {
        crfResult = await client.query(
          `INSERT INTO crf (name,description,status_id,owner_id,date_created,oc_oid,source_study_id)
           VALUES ($1,$2,2,$3,NOW(),$4,$5) RETURNING crf_id`,
          [formName, form.description || '', userId, ocOid, targetStudyId]
        );
      }
      const newCrfId = crfResult.rows[0].crf_id;

      // Create version
      const vOid = `${ocOid}_V1`;
      const vResult = await client.query(
        `INSERT INTO crf_version (crf_id,name,description,status_id,owner_id,date_created,oc_oid)
         VALUES ($1,$2,$3,2,$4,NOW(),$5) RETURNING crf_version_id`,
        [newCrfId, form.version || 'v1.0', form.description || 'Imported version', userId, vOid]
      );
      const newCrfVersionId = vResult.rows[0].crf_version_id;

      formRefToCrfId.set(form.refKey, newCrfId);
      createdForms.push({ refKey: form.refKey, newCrfId, newCrfVersionId });

      // Create sections
      const sectionIdMap = new Map<string, number>();
      if (form.sections?.length) {
        for (let si = 0; si < form.sections.length; si++) {
          const sec = form.sections[si];
          const sRes = await client.query(
            `INSERT INTO section (crf_version_id,status_id,label,title,ordinal,owner_id,date_created)
             VALUES ($1,1,$2,$3,$4,$5,NOW()) RETURNING section_id`,
            [newCrfVersionId, sec.name, sec.name, si + 1, userId]
          );
          sectionIdMap.set(sec.name, sRes.rows[0].section_id);
          sectionIdMap.set(sec.name.toLowerCase(), sRes.rows[0].section_id);
          if (sec.id) sectionIdMap.set(sec.id, sRes.rows[0].section_id);
        }
      }
      // Default section
      let defaultSectionId: number;
      if (sectionIdMap.size === 0) {
        const dsRes = await client.query(
          `INSERT INTO section (crf_version_id,status_id,label,title,ordinal,owner_id,date_created)
           VALUES ($1,1,$2,$3,1,$4,NOW()) RETURNING section_id`,
          [newCrfVersionId, form.category || 'Form Fields', formName, userId]
        );
        defaultSectionId = dsRes.rows[0].section_id;
      } else {
        defaultSectionId = sectionIdMap.values().next().value!;
      }

      // Create item group
      const grpSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
      const grpOid = `IG_${ocOid.substring(2, 16)}_${grpSuffix}`;
      const igRes = await client.query(
        `INSERT INTO item_group (name,crf_id,status_id,owner_id,date_created,oc_oid)
         VALUES ($1,$2,1,$3,NOW(),$4) RETURNING item_group_id`,
        [form.category || 'Form Fields', newCrfId, userId, grpOid]
      );
      const itemGroupId = igRes.rows[0].item_group_id;

      // Create fields — track refKey -> newItemId for remapping
      const fieldRefKeys: string[] = [];
      const newItemIds: number[] = [];

      for (let i = 0; i < (form.fields || []).length; i++) {
        const ef = form.fields[i];
        const fieldType = resolveFieldType(ef.type);
        const dataTypeId = mapTypeToDataTypeId(fieldType);
        const iOid = `I_${ocOid.substring(2, 12)}_${i}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        // Build extended props JSON for complex field data
        const extProps = buildExtendedProps(ef, fieldType);
        let description = ef.helpText || ef.description || '';
        if (extProps) {
          description = description
            ? `${description}\n---EXTENDED_PROPS---\n${extProps}`
            : `---EXTENDED_PROPS---\n${extProps}`;
        }

        const itemRes = await client.query(
          `INSERT INTO item (name,description,units,phi_status,item_data_type_id,status_id,owner_id,date_created,oc_oid)
           VALUES ($1,$2,$3,$4,$5,1,$6,NOW(),$7) RETURNING item_id`,
          [
            ef.label || ef.name || `Field ${i + 1}`,
            description,
            ef.unit || '',
            ef.isPhiField === true,
            dataTypeId,
            userId,
            iOid
          ]
        );
        const newItemId = itemRes.rows[0].item_id;
        fieldRefKeys.push(ef.refKey);
        newItemIds.push(newItemId);

        // item_group_metadata
        await client.query(
          `INSERT INTO item_group_metadata (item_group_id,crf_version_id,item_id,ordinal,show_group,repeating_group)
           VALUES ($1,$2,$3,$4,true,false)`,
          [itemGroupId, newCrfVersionId, newItemId, i + 1]
        );

        // response_set + item_form_metadata
        let responseSetId = 1;
        if (ef.options && ef.options.length > 0) {
          const rTypeId = mapTypeToResponseTypeId(fieldType);
          const optText = ef.options.map(o => o.label).join('\n');
          const optVals = ef.options.map(o => o.value).join('\n');
          const rsRes = await client.query(
            `INSERT INTO response_set (response_type_id,label,options_text,options_values,version_id)
             VALUES ($1,$2,$3,$4,$5) RETURNING response_set_id`,
            [rTypeId, ef.label || ef.name, optText, optVals, newCrfVersionId]
          );
          responseSetId = rsRes.rows[0].response_set_id;
        }

        const sectionId = (ef.section ? sectionIdMap.get(ef.section) ?? sectionIdMap.get(ef.section.toLowerCase()) : null) || defaultSectionId;
        await client.query(
          `INSERT INTO item_form_metadata (
             item_id,crf_version_id,response_set_id,section_id,ordinal,
             required,default_value,left_item_text,show_item,column_number
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            newItemId, newCrfVersionId, responseSetId, sectionId, i + 1,
            ef.required || false,
            ef.defaultValue || null,
            ef.placeholder || null,
            ef.hidden ? false : true,
            ef.columnNumber || ef.columnPosition || 1
          ]
        );
      }

      // ── PASS 2 for this form: Remap ID references ────────────────
      const nameToId = buildNameToIdMap(form.fields, newItemIds);

      // Update extended props with remapped showWhen/hideWhen/requiredWhen/dependsOn
      for (let i = 0; i < form.fields.length; i++) {
        const ef = form.fields[i];
        const itemId = newItemIds[i];
        const needsRemap = ef.showWhen || ef.hideWhen || ef.requiredWhen || ef.dependsOnRefs;
        if (!needsRemap) continue;

        // Reload current description to preserve extended props
        const curRow = await client.query(`SELECT description FROM item WHERE item_id=$1`, [itemId]);
        let desc = curRow.rows[0]?.description || '';
        let parsed: any = {};
        const marker = '---EXTENDED_PROPS---';
        const idx = desc.indexOf(marker);
        let baseDesc = desc;
        if (idx >= 0) {
          baseDesc = desc.substring(0, idx).trim();
          try { parsed = JSON.parse(desc.substring(idx + marker.length).trim()); } catch { parsed = {}; }
        }

        if (ef.showWhen) parsed.showWhen = remapConditions(ef.showWhen, nameToId);
        if (ef.hideWhen) parsed.hideWhen = remapConditions(ef.hideWhen, nameToId);
        if (ef.requiredWhen) parsed.requiredWhen = remapConditions(ef.requiredWhen, nameToId);
        if (ef.dependsOnRefs) {
          parsed.dependsOn = ef.dependsOnRefs.map(ref => nameToId.get(ref) || ref);
        }

        const newDesc = baseDesc
          ? `${baseDesc}\n${marker}\n${JSON.stringify(parsed)}`
          : `${marker}\n${JSON.stringify(parsed)}`;
        await client.query(`UPDATE item SET description=$1 WHERE item_id=$2`, [newDesc, itemId]);

        // Also create SCD (scd_item_metadata) records for showWhen conditions
        // so LibreClinica's native branching engine also picks them up
        if (ef.showWhen) {
          const targetIfmRow = await client.query(
            `SELECT item_form_metadata_id FROM item_form_metadata WHERE item_id=$1 AND crf_version_id=$2 LIMIT 1`,
            [itemId, newCrfVersionId]
          );
          const targetIfmId = targetIfmRow.rows[0]?.item_form_metadata_id;
          if (targetIfmId) {
            for (const cond of ef.showWhen) {
              const controlItemId = nameToId.get(cond.fieldRef);
              if (!controlItemId) continue;
              const controlIfmRow = await client.query(
                `SELECT ifm.item_form_metadata_id, i.name
                 FROM item_form_metadata ifm
                 INNER JOIN item i ON ifm.item_id = i.item_id
                 WHERE ifm.item_id=$1 AND ifm.crf_version_id=$2 LIMIT 1`,
                [parseInt(controlItemId), newCrfVersionId]
              );
              const controlIfmId = controlIfmRow.rows[0]?.item_form_metadata_id || null;
              const controlName = controlIfmRow.rows[0]?.name || cond.fieldRef;
              const scdMessage = JSON.stringify({
                operator: cond.operator || 'equals',
                message: cond.message || ''
              });
              try {
                await client.query(
                  `INSERT INTO scd_item_metadata (
                     scd_item_form_metadata_id, control_item_form_metadata_id,
                     control_item_name, option_value, message, version
                   ) VALUES ($1,$2,$3,$4,$5,1)`,
                  [targetIfmId, controlIfmId, controlName, cond.value || '', scdMessage]
                );
              } catch (e: any) {
                logger.warn('Could not create SCD record during import', { error: e.message, itemId });
              }
            }
          }
        }
      }

      // Create validation rules
      for (const rule of (form.validationRuleRecords || [])) {
        const fieldPath = nameToId.get(rule.fieldRef) || rule.fieldRef;
        const compareFieldPath = rule.compareFieldRef ? (nameToId.get(rule.compareFieldRef) || rule.compareFieldRef) : null;
        try {
          await client.query(
            `INSERT INTO validation_rules (
               crf_id,crf_version_id,name,description,rule_type,field_path,
               severity,error_message,warning_message,active,
               min_value,max_value,pattern,format_type,operator,
               compare_field_path,compare_value,custom_expression,
               bp_systolic_min,bp_systolic_max,bp_diastolic_min,bp_diastolic_max,
               table_cell_target,date_created,owner_id
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW(),$24)`,
            [
              newCrfId, newCrfVersionId, rule.name || '', rule.description || '',
              rule.ruleType, fieldPath, rule.severity || 'error',
              rule.errorMessage, rule.warningMessage || null, rule.active !== false,
              rule.minValue ?? null, rule.maxValue ?? null,
              rule.pattern || null, rule.formatType || null, rule.operator || null,
              compareFieldPath, rule.compareValue || null, rule.customExpression || null,
              rule.bpSystolicMin ?? null, rule.bpSystolicMax ?? null,
              rule.bpDiastolicMin ?? null, rule.bpDiastolicMax ?? null,
              rule.tableCellTarget ? JSON.stringify(rule.tableCellTarget) : null,
              userId
            ]
          );
        } catch (e: any) {
          warnings.push(`Could not create validation rule "${rule.name}" for form "${formName}": ${e.message}`);
        }
      }

      // Import edit checks — stored in source field's extended props
      if (form.editChecks?.length) {
        // Group edit checks by source field
        const checksByField = new Map<string, any[]>();
        for (const ec of form.editChecks) {
          const sourceId = nameToId.get(ec.sourceFieldRef);
          if (!sourceId) {
            warnings.push(`Edit check "${ec.name}" references unknown source field "${ec.sourceFieldRef}" — skipped`);
            continue;
          }
          const existing = checksByField.get(sourceId) || [];
          existing.push({
            id: `ec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: ec.name,
            description: ec.description,
            sourceFieldId: sourceId,
            targetFieldId: ec.targetFieldRef ? (nameToId.get(ec.targetFieldRef) || ec.targetFieldRef) : undefined,
            operator: ec.operator,
            value: ec.value,
            value2: ec.value2,
            customFormula: ec.customFormula,
            errorMessage: ec.errorMessage,
            severity: ec.severity || 'error',
            isActive: ec.isActive !== false,
            requiresQuery: ec.requiresQuery
          });
          checksByField.set(sourceId, existing);
        }

        for (const [itemIdStr, checks] of checksByField) {
          const itemId = parseInt(itemIdStr);
          const curRow = await client.query(`SELECT description FROM item WHERE item_id=$1`, [itemId]);
          let desc = curRow.rows[0]?.description || '';
          let parsed: any = {};
          const marker = '---EXTENDED_PROPS---';
          const mIdx = desc.indexOf(marker);
          let baseDesc = desc;
          if (mIdx >= 0) {
            baseDesc = desc.substring(0, mIdx).trim();
            try { parsed = JSON.parse(desc.substring(mIdx + marker.length).trim()); } catch { parsed = {}; }
          }
          parsed.editChecks = [...(parsed.editChecks || []), ...checks];
          const newDesc = baseDesc
            ? `${baseDesc}\n${marker}\n${JSON.stringify(parsed)}`
            : `${marker}\n${JSON.stringify(parsed)}`;
          await client.query(`UPDATE item SET description=$1 WHERE item_id=$2`, [newDesc, itemId]);
        }
      }
    }

    // ── PASS 3: Resolve cross-form links across all forms ──────────
    // We need the per-form nameToId maps, so rebuild them from DB
    for (const created of createdForms) {
      const form = bundle.forms.find(f => f.refKey === created.refKey);
      if (!form?.formLinks?.length) continue;

      // Load the item IDs for this form's fields
      const itemRows = await client.query(
        `SELECT i.item_id, i.oc_oid FROM item i
         INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
         WHERE igm.crf_version_id = $1 ORDER BY igm.ordinal`,
        [created.newCrfVersionId]
      );

      // Map field refKeys to new item IDs by position (fields were inserted in order)
      const nameToId = new Map<string, string>();
      for (let i = 0; i < form.fields.length && i < itemRows.rows.length; i++) {
        nameToId.set(form.fields[i].refKey, String(itemRows.rows[i].item_id));
      }

      for (const link of form.formLinks) {
        const targetCrfId = formRefToCrfId.get(link.targetFormRef);
        if (!targetCrfId) {
          warnings.push(`Form link "${link.name}" references form "${link.targetFormRef}" which is not in this bundle — link skipped`);
          continue;
        }

        const sourceItemId = nameToId.get(link.sourceFieldRef);
        if (!sourceItemId) {
          warnings.push(`Form link "${link.name}" references field "${link.sourceFieldRef}" which was not found — link skipped`);
          continue;
        }

        // Store the link in the source field's extended props
        const curRow = await client.query(`SELECT description FROM item WHERE item_id=$1`, [parseInt(sourceItemId)]);
        let desc = curRow.rows[0]?.description || '';
        let parsed: any = {};
        const marker = '---EXTENDED_PROPS---';
        const mIdx = desc.indexOf(marker);
        let baseDesc = desc;
        if (mIdx >= 0) {
          baseDesc = desc.substring(0, mIdx).trim();
          try { parsed = JSON.parse(desc.substring(mIdx + marker.length).trim()); } catch { parsed = {}; }
        }

        const existingLinks: any[] = parsed.formLinks || [];
        existingLinks.push({
          id: `link_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: link.name,
          description: link.description,
          targetFormId: targetCrfId,
          targetFormName: form.name,
          triggerConditions: remapConditions(link.triggerConditions, nameToId) || [],
          linkType: link.linkType || 'modal',
          required: link.required || false,
          autoOpen: link.autoOpen || false,
          prefillFields: link.prefillFields?.map(pf => ({
            sourceFieldId: nameToId.get(pf.sourceFieldRef) || pf.sourceFieldRef,
            targetFieldId: nameToId.get(pf.targetFieldRef) || pf.targetFieldRef
          })),
          enabled: link.enabled !== false
        });
        parsed.formLinks = existingLinks;

        const newDesc = baseDesc
          ? `${baseDesc}\n${marker}\n${JSON.stringify(parsed)}`
          : `${marker}\n${JSON.stringify(parsed)}`;
        await client.query(`UPDATE item SET description=$1 WHERE item_id=$2`, [newDesc, parseInt(sourceItemId)]);
      }
    }

    await client.query('COMMIT');
    logger.info('Template bundle imported successfully', { formCount: createdForms.length, warnings: warnings.length });

    return {
      success: true,
      createdForms,
      warnings,
      message: `Successfully imported ${createdForms.length} form(s)`
    };

  } catch (err: any) {
    await client.query('ROLLBACK');
    logger.error('Template bundle import failed', { error: err.message, stack: err.stack });
    return { success: false, createdForms: [], warnings, message: err.message };
  } finally {
    client.release();
  }
}

// ============================================================================
// HELPERS — field type mapping (mirrors form.service.ts logic)
// ============================================================================

function mapTypeToDataTypeId(fieldType: string): number {
  const map: Record<string, number> = {
    text: 9, number: 6, date: 9, time: 9, datetime: 9, textarea: 9,
    select: 9, radio: 9, checkbox: 9, yesno: 9, combobox: 9,
    file: 9, image: 9, barcode: 9,
    email: 9, phone: 9, url: 9,
    table: 12, inline_group: 12, blood_pressure: 12,
    criteria_list: 12, question_table: 12,
    section_header: 9, static_text: 9,
    calculated: 8, group_calculation: 9
  };
  return map[fieldType] || 9;
}

function mapTypeToResponseTypeId(fieldType: string): number {
  const map: Record<string, number> = {
    text: 1, textarea: 2, select: 3, radio: 5, checkbox: 6, yesno: 5,
    combobox: 7, file: 8, calculation: 9, group_calculation: 10
  };
  return map[fieldType] || 1;
}

function buildExtendedProps(ef: ExportedField, fieldType: string): string | null {
  const props: Record<string, any> = {};
  props.type = fieldType;
  if (ef.name) props.fieldName = ef.name;
  if (ef.width) props.width = ef.width;
  if (ef.columnPosition) props.columnPosition = ef.columnPosition;
  if (ef.groupId) props.groupId = ef.groupId;
  if (ef.format) props.format = ef.format;
  if (ef.isPhiField) props.isPhiField = true;
  if (ef.phiClassification) props.phiClassification = ef.phiClassification;
  if (ef.auditRequired) props.auditRequired = true;
  if (ef.criticalDataPoint) props.criticalDataPoint = true;
  if (ef.readonly) props.readonly = true;
  if (ef.required) props.required = true;
  if (ef.min !== undefined) props.min = ef.min;
  if (ef.max !== undefined) props.max = ef.max;
  if (ef.calculationFormula) props.calculationFormula = ef.calculationFormula;
  if (ef.calculationType) props.calculationType = ef.calculationType;
  if (ef.allowedFileTypes) props.allowedFileTypes = ef.allowedFileTypes;
  if (ef.maxFileSize) props.maxFileSize = ef.maxFileSize;
  if (ef.maxFiles) props.maxFiles = ef.maxFiles;
  if (ef.barcodeFormat) props.barcodeFormat = ef.barcodeFormat;
  if (ef.staticContent) props.staticContent = ef.staticContent;
  if (ef.headerLevel) props.headerLevel = ef.headerLevel;

  if (ef.tableColumns) props.tableColumns = ef.tableColumns;
  if (ef.tableRows) props.tableRows = ef.tableRows;
  if (ef.tableSettings) props.tableSettings = ef.tableSettings;
  if (ef.inlineFields) props.inlineFields = ef.inlineFields;
  if (ef.inlineGroupSettings) props.inlineGroupSettings = ef.inlineGroupSettings;
  if (ef.criteriaItems) props.criteriaItems = ef.criteriaItems;
  if (ef.criteriaListSettings) props.criteriaListSettings = ef.criteriaListSettings;
  if (ef.questionRows) props.questionRows = ef.questionRows;
  if (ef.questionTableSettings) props.questionTableSettings = ef.questionTableSettings;

  // showWhen/hideWhen/requiredWhen/dependsOn are handled in pass 2 after remapping
  // but we store placeholders so the structure exists
  if (ef.showWhen) props.showWhen = ef.showWhen;
  if (ef.hideWhen) props.hideWhen = ef.hideWhen;
  if (ef.requiredWhen) props.requiredWhen = ef.requiredWhen;
  if (ef.dependsOnRefs) props.dependsOn = ef.dependsOnRefs;

  if (Object.keys(props).length <= 1) return null;
  return JSON.stringify(props);
}
