/**
 * ODM XML Builder Service
 *
 * Single source of truth for assembling ODM 1.3.2 XML imports for the
 * LibreClinica SOAP `data/v1` endpoint.
 *
 * EXPORTED BUILDERS:
 *   - `buildOdmFromSubjectData(subjects, opts)` — used by interop-middleware
 *     (FHIR → ODM bridge). Accepts the canonical `ImportSubjectData[]` DTOs
 *     from `@accura-trial/shared-types`.
 *   - `buildOdmFromCsvRows(rowsBySubject, opts)` — used by the legacy CSV
 *     upload path (`csv-to-odm.service.ts` re-exports + delegates).
 *
 * SHARED ENVELOPE:
 *   Both builders go through `buildOdmEnvelope()`, which is the ONE place
 *   the `<?xml ... ?><ODM ...>` header and `<ClinicalData>` wrapper are
 *   defined. Two parallel envelope formats would drift over time and
 *   create silent import-format mismatches.
 *
 * RATIONALE (no parallel ODM builders):
 *   The `interop-middleware` repository previously planned to build its
 *   own ODM XML serializer (`OpenClinicaOdmXmlSerializer`). That would
 *   have created two ODM builders in two repos with two sets of XML
 *   escape rules. This service consolidates them. The interop-middleware
 *   posts JSON `ImportSubjectData[]` to `POST /api/import/from-json`,
 *   and this service performs the conversion server-side.
 */

import type { ImportSubjectData } from '@accura-trial/shared-types';
import { logger } from '../../config/logger';

/**
 * Common options shared by both builders.
 */
export interface OdmEnvelopeOptions {
  readonly studyOID: string;
  readonly metaDataVersionOID: string;
  /** Optional override for the ODM `FileOID`. Defaults to a timestamped value. */
  readonly fileOID?: string;
  /** Optional override for `CreationDateTime`. Defaults to `new Date().toISOString()`. */
  readonly creationDateTimeIso?: string;
}

/**
 * XML escape — kept private and shared so two callers cannot diverge on
 * what gets escaped (e.g. one missing `'` becomes a parse error in the
 * Java SOAP service).
 */
export function escapeXml(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wrap the inner `<ClinicalData>...` payload in the standard ODM
 * envelope. The inner string MUST already include the `<ClinicalData>`
 * opening tag and `</ClinicalData>` closing tag.
 */
export function buildOdmEnvelope(
  clinicalDataXml: string,
  opts: OdmEnvelopeOptions,
): string {
  const fileOID = opts.fileOID ?? `Import-${Date.now()}`;
  const creationDateTime = opts.creationDateTimeIso ?? new Date().toISOString();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"',
    '     xmlns:OpenClinica="http://www.openclinica.org/ns/odm_ext_v130/v3.1"',
    '     ODMVersion="1.3"',
    '     FileType="Transactional"',
    `     FileOID="${escapeXml(fileOID)}"`,
    `     CreationDateTime="${escapeXml(creationDateTime)}">`,
    clinicalDataXml,
    '</ODM>',
  ].join('\n');
}

/**
 * Build a `<ClinicalData>` block from `ImportSubjectData[]` (the canonical
 * shared-types DTO). This is the entry point for the interop-middleware
 * FHIR → ODM bridge.
 *
 * - SubjectKey = `subjectOID`
 * - Demographic fields (gender, dateOfBirth, uniqueIdentifier,
 *   enrollmentDate) are emitted under `<OpenClinica:Subject ...>` so the
 *   downstream Java importer can create the patient implicitly when the
 *   subject does not yet exist.
 * - StartDate / EndDate are forwarded only when present.
 */
export function buildOdmFromSubjectData(
  subjects: ReadonlyArray<ImportSubjectData>,
  opts: OdmEnvelopeOptions,
): string {
  const inner: string[] = [];
  inner.push(
    `  <ClinicalData StudyOID="${escapeXml(opts.studyOID)}" MetaDataVersionOID="${escapeXml(opts.metaDataVersionOID)}">`,
  );

  for (const subject of subjects) {
    inner.push(`    <SubjectData SubjectKey="${escapeXml(subject.subjectOID)}">`);

    // Optional patient demographics under the OpenClinica extension namespace.
    // Emitted only when at least one demographic field is present, so the
    // import endpoint can still apply UPDATE-only semantics for callers
    // that only want to push event data for an existing subject.
    const hasDemographics =
      subject.gender !== undefined ||
      subject.dateOfBirth !== undefined ||
      subject.uniqueIdentifier !== undefined ||
      subject.studySubjectId !== undefined ||
      subject.enrollmentDate !== undefined;
    if (hasDemographics) {
      const subjAttrs: string[] = [];
      if (subject.uniqueIdentifier !== undefined) {
        subjAttrs.push(`UniqueIdentifier="${escapeXml(subject.uniqueIdentifier)}"`);
      }
      if (subject.dateOfBirth !== undefined) {
        subjAttrs.push(`DateOfBirth="${escapeXml(subject.dateOfBirth)}"`);
      }
      if (subject.gender !== undefined) {
        subjAttrs.push(`Sex="${escapeXml(subject.gender)}"`);
      }
      if (subject.studySubjectId !== undefined) {
        subjAttrs.push(`StudySubjectID="${escapeXml(subject.studySubjectId)}"`);
      }
      if (subject.enrollmentDate !== undefined) {
        subjAttrs.push(`EnrollmentDate="${escapeXml(subject.enrollmentDate)}"`);
      }
      inner.push(`      <OpenClinica:Subject ${subjAttrs.join(' ')}/>`);
    }

    for (const event of subject.studyEventData) {
      const eventAttrs: string[] = [
        `StudyEventOID="${escapeXml(event.studyEventOID)}"`,
        `StudyEventRepeatKey="${escapeXml(event.studyEventRepeatKey)}"`,
      ];
      if (event.startDate !== undefined) {
        eventAttrs.push(`StartDate="${escapeXml(event.startDate)}"`);
      }
      if (event.endDate !== undefined) {
        eventAttrs.push(`EndDate="${escapeXml(event.endDate)}"`);
      }
      if (event.location !== undefined) {
        eventAttrs.push(`Location="${escapeXml(event.location)}"`);
      }
      inner.push(`      <StudyEventData ${eventAttrs.join(' ')}>`);

      for (const form of event.formData) {
        inner.push(`        <FormData FormOID="${escapeXml(form.formOID)}">`);

        for (const itemGroup of form.itemGroupData) {
          const igAttrs: string[] = [
            `ItemGroupOID="${escapeXml(itemGroup.itemGroupOID)}"`,
            `ItemGroupRepeatKey="${escapeXml(itemGroup.itemGroupRepeatKey)}"`,
          ];
          if (itemGroup.transactionType !== undefined) {
            igAttrs.push(`TransactionType="${escapeXml(itemGroup.transactionType)}"`);
          }
          inner.push(`          <ItemGroupData ${igAttrs.join(' ')}>`);

          for (const item of itemGroup.itemData) {
            const itemAttrs: string[] = [
              `ItemOID="${escapeXml(item.itemOID)}"`,
              `Value="${escapeXml(item.value)}"`,
            ];
            if (item.measurementUnitOID !== undefined) {
              itemAttrs.push(
                `MeasurementUnitOID="${escapeXml(item.measurementUnitOID)}"`,
              );
            }
            if (item.isNull === true) {
              itemAttrs.push('IsNull="Yes"');
              if (item.reasonForNull !== undefined) {
                itemAttrs.push(`ReasonForNull="${escapeXml(item.reasonForNull)}"`);
              }
            }
            inner.push(`            <ItemData ${itemAttrs.join(' ')}/>`);
          }

          inner.push('          </ItemGroupData>');
        }

        inner.push('        </FormData>');
      }

      inner.push('      </StudyEventData>');
    }

    inner.push('    </SubjectData>');
  }

  inner.push('  </ClinicalData>');

  const xml = buildOdmEnvelope(inner.join('\n'), opts);

  logger.info('ODM XML built from ImportSubjectData[]', {
    subjectCount: subjects.length,
    studyOID: opts.studyOID,
    xmlLength: xml.length,
  });

  return xml;
}

/**
 * Mapping configuration consumed by `buildOdmFromCsvRows`.
 *
 * (Mirrors `CSVMapping` from `csv-to-odm.service.ts` — kept here so the
 * legacy CSV path can re-export it from the canonical location.)
 */
export interface CsvOdmMapping {
  readonly subjectIdColumn: string;
  readonly eventOIDColumn?: string;
  readonly formOIDColumn?: string;
  readonly itemGroupOIDColumn?: string;
  readonly repeatKeyColumn?: string;
  readonly defaultEventOID: string;
  readonly defaultFormOID: string;
  readonly defaultItemGroupOID: string;
  readonly columnToItemOID: Readonly<Record<string, string>>;
}

/**
 * Build a `<ClinicalData>` block from CSV rows already parsed and grouped
 * by subject. Used by the legacy CSV import path to share the same
 * envelope, escape rules, and structural ordering as the JSON path.
 */
export function buildOdmFromCsvRows(
  rowsBySubject: ReadonlyMap<string, ReadonlyArray<Readonly<Record<string, string>>>>,
  mapping: CsvOdmMapping,
  opts: OdmEnvelopeOptions,
): string {
  const inner: string[] = [];
  inner.push(
    `  <ClinicalData StudyOID="${escapeXml(opts.studyOID)}" MetaDataVersionOID="${escapeXml(opts.metaDataVersionOID)}">`,
  );

  for (const [subjectId, rows] of rowsBySubject) {
    inner.push(`    <SubjectData SubjectKey="${escapeXml(subjectId)}">`);

    const firstRow = rows[0];
    const eventOID =
      (mapping.eventOIDColumn && firstRow[mapping.eventOIDColumn]) ||
      mapping.defaultEventOID;

    inner.push(
      `      <StudyEventData StudyEventOID="${escapeXml(eventOID)}" StudyEventRepeatKey="1">`,
    );

    const formOID =
      (mapping.formOIDColumn && firstRow[mapping.formOIDColumn]) ||
      mapping.defaultFormOID;

    inner.push(`        <FormData FormOID="${escapeXml(formOID)}">`);

    const itemGroupOID =
      (mapping.itemGroupOIDColumn && firstRow[mapping.itemGroupOIDColumn]) ||
      mapping.defaultItemGroupOID;

    let repeatKey = 1;
    for (const row of rows) {
      const currentRepeatKey =
        (mapping.repeatKeyColumn && row[mapping.repeatKeyColumn]) ||
        String(repeatKey);
      inner.push(
        `          <ItemGroupData ItemGroupOID="${escapeXml(itemGroupOID)}" ItemGroupRepeatKey="${escapeXml(currentRepeatKey)}" TransactionType="Insert">`,
      );

      for (const [csvColumn, itemOID] of Object.entries(mapping.columnToItemOID)) {
        const value = row[csvColumn];
        if (value !== undefined && value !== '') {
          inner.push(
            `            <ItemData ItemOID="${escapeXml(itemOID)}" Value="${escapeXml(value)}"/>`,
          );
        }
      }

      inner.push('          </ItemGroupData>');
      repeatKey++;
    }

    inner.push('        </FormData>');
    inner.push('      </StudyEventData>');
    inner.push('    </SubjectData>');
  }

  inner.push('  </ClinicalData>');

  const xml = buildOdmEnvelope(inner.join('\n'), opts);

  logger.info('ODM XML built from CSV rows', {
    subjectCount: rowsBySubject.size,
    studyOID: opts.studyOID,
    xmlLength: xml.length,
  });

  return xml;
}
