/**
 * Unit tests for `services/import/odm-builder.service.ts`.
 *
 * These tests are DB-free and run via `jest.unit.config.js`. They prove
 * the ONE shared ODM envelope is structurally correct for both the
 * CSV and JSON (interop-middleware) import paths.
 */

import {
  buildOdmEnvelope,
  buildOdmFromSubjectData,
  buildOdmFromCsvRows,
  escapeXml,
  type OdmEnvelopeOptions,
  type CsvOdmMapping,
} from '../../src/services/import/odm-builder.service';
import type { ImportSubjectData } from '@accura-trial/shared-types';

const DEFAULT_OPTS: OdmEnvelopeOptions = {
  studyOID: 'S_001',
  metaDataVersionOID: 'v1.0.0',
  fileOID: 'TEST-FILE',
  creationDateTimeIso: '2026-04-21T12:00:00Z',
};

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe(
      'a&amp;b&lt;c&gt;d&quot;e&apos;f',
    );
  });
  it('coerces undefined / null to empty string', () => {
    expect(escapeXml(undefined)).toBe('');
    expect(escapeXml(null)).toBe('');
  });
  it('coerces numbers to their string form', () => {
    expect(escapeXml(42)).toBe('42');
  });
});

describe('buildOdmEnvelope', () => {
  it('wraps inner ClinicalData with header + ODM root + closing tag', () => {
    const xml = buildOdmEnvelope('  <ClinicalData/>', DEFAULT_OPTS);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.cdisc.org/ns/odm/v1.3"');
    expect(xml).toContain(
      'xmlns:OpenClinica="http://www.openclinica.org/ns/odm_ext_v130/v3.1"',
    );
    expect(xml).toContain('FileOID="TEST-FILE"');
    expect(xml).toContain('CreationDateTime="2026-04-21T12:00:00Z"');
    expect(xml).toContain('  <ClinicalData/>');
    expect(xml.trimEnd().endsWith('</ODM>')).toBe(true);
  });

  it('defaults FileOID and CreationDateTime when omitted', () => {
    const xml = buildOdmEnvelope('  <ClinicalData/>', {
      studyOID: 'S',
      metaDataVersionOID: 'v',
    });
    expect(xml).toMatch(/FileOID="Import-\d+"/);
    expect(xml).toMatch(
      /CreationDateTime="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });
});

describe('buildOdmFromSubjectData', () => {
  const ONE_SUBJECT: ImportSubjectData = {
    subjectOID: 'SUB-001',
    studySubjectId: 'SITE-001-PT-001',
    uniqueIdentifier: 'MRN-001',
    dateOfBirth: '1980-01-01',
    gender: 'm',
    enrollmentDate: '2026-04-21',
    studyEventData: [
      {
        studyEventOID: 'SE_VITALS',
        studyEventRepeatKey: '1',
        startDate: '2026-04-21',
        formData: [
          {
            formOID: 'F_VS',
            itemGroupData: [
              {
                itemGroupOID: 'IG_VS',
                itemGroupRepeatKey: '1',
                transactionType: 'Upsert',
                itemData: [
                  {
                    itemOID: 'I_VS_TEMP',
                    value: '37.0',
                    measurementUnitOID: 'MU_CEL',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it('emits canonical ODM structure for one subject', () => {
    const xml = buildOdmFromSubjectData([ONE_SUBJECT], DEFAULT_OPTS);

    expect(xml).toContain('<ClinicalData StudyOID="S_001" MetaDataVersionOID="v1.0.0">');
    expect(xml).toContain('<SubjectData SubjectKey="SUB-001">');
    expect(xml).toContain('<OpenClinica:Subject');
    expect(xml).toContain('UniqueIdentifier="MRN-001"');
    expect(xml).toContain('Sex="m"');
    expect(xml).toContain('DateOfBirth="1980-01-01"');
    expect(xml).toContain('StudySubjectID="SITE-001-PT-001"');
    expect(xml).toContain('EnrollmentDate="2026-04-21"');
    expect(xml).toContain(
      '<StudyEventData StudyEventOID="SE_VITALS" StudyEventRepeatKey="1" StartDate="2026-04-21">',
    );
    expect(xml).toContain('<FormData FormOID="F_VS">');
    expect(xml).toContain(
      '<ItemGroupData ItemGroupOID="IG_VS" ItemGroupRepeatKey="1" TransactionType="Upsert">',
    );
    expect(xml).toContain(
      '<ItemData ItemOID="I_VS_TEMP" Value="37.0" MeasurementUnitOID="MU_CEL"/>',
    );
  });

  it('omits the OpenClinica:Subject element when no demographics are supplied', () => {
    const minimal: ImportSubjectData = {
      subjectOID: 'SUB-MIN',
      studyEventData: [
        {
          studyEventOID: 'SE',
          studyEventRepeatKey: '1',
          formData: [
            {
              formOID: 'F',
              itemGroupData: [
                {
                  itemGroupOID: 'IG',
                  itemGroupRepeatKey: '1',
                  itemData: [{ itemOID: 'I', value: 'v' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const xml = buildOdmFromSubjectData([minimal], DEFAULT_OPTS);
    expect(xml).not.toContain('<OpenClinica:Subject');
    expect(xml).toContain('<SubjectData SubjectKey="SUB-MIN">');
  });

  it('serializes IsNull + ReasonForNull when present', () => {
    const subj: ImportSubjectData = {
      subjectOID: 'SUB-N',
      studyEventData: [
        {
          studyEventOID: 'SE',
          studyEventRepeatKey: '1',
          formData: [
            {
              formOID: 'F',
              itemGroupData: [
                {
                  itemGroupOID: 'IG',
                  itemGroupRepeatKey: '1',
                  itemData: [
                    {
                      itemOID: 'I',
                      value: '',
                      isNull: true,
                      reasonForNull: 'NA',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const xml = buildOdmFromSubjectData([subj], DEFAULT_OPTS);
    expect(xml).toContain('IsNull="Yes"');
    expect(xml).toContain('ReasonForNull="NA"');
  });

  it('escapes special characters inside attribute values', () => {
    const subj: ImportSubjectData = {
      subjectOID: 'SUB"<&>',
      studyEventData: [
        {
          studyEventOID: 'SE',
          studyEventRepeatKey: '1',
          formData: [
            {
              formOID: 'F',
              itemGroupData: [
                {
                  itemGroupOID: 'IG',
                  itemGroupRepeatKey: '1',
                  itemData: [{ itemOID: 'I', value: 'v&w' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const xml = buildOdmFromSubjectData([subj], DEFAULT_OPTS);
    expect(xml).toContain('SubjectKey="SUB&quot;&lt;&amp;&gt;"');
    expect(xml).toContain('Value="v&amp;w"');
  });

  it('handles multiple subjects and preserves ordering', () => {
    const a: ImportSubjectData = {
      subjectOID: 'A',
      studyEventData: [
        {
          studyEventOID: 'SE',
          studyEventRepeatKey: '1',
          formData: [
            {
              formOID: 'F',
              itemGroupData: [
                {
                  itemGroupOID: 'IG',
                  itemGroupRepeatKey: '1',
                  itemData: [{ itemOID: 'I', value: '1' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const b: ImportSubjectData = { ...a, subjectOID: 'B' };
    const xml = buildOdmFromSubjectData([a, b], DEFAULT_OPTS);
    const aIdx = xml.indexOf('SubjectKey="A"');
    const bIdx = xml.indexOf('SubjectKey="B"');
    expect(aIdx).toBeGreaterThan(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });
});

describe('buildOdmFromCsvRows (legacy CSV path uses same envelope)', () => {
  const MAPPING: CsvOdmMapping = {
    subjectIdColumn: 'SubjectID',
    defaultEventOID: 'SE',
    defaultFormOID: 'F',
    defaultItemGroupOID: 'IG',
    columnToItemOID: { Temp: 'I_TEMP', HR: 'I_HR' },
  };

  it('builds equivalent envelope for one CSV-shaped subject', () => {
    const rows = new Map<string, Record<string, string>[]>();
    rows.set('SUB-1', [{ SubjectID: 'SUB-1', Temp: '37.0', HR: '72' }]);
    const xml = buildOdmFromCsvRows(rows, MAPPING, DEFAULT_OPTS);

    expect(xml).toContain('xmlns="http://www.cdisc.org/ns/odm/v1.3"');
    expect(xml).toContain('SubjectKey="SUB-1"');
    expect(xml).toContain('<ItemData ItemOID="I_TEMP" Value="37.0"/>');
    expect(xml).toContain('<ItemData ItemOID="I_HR" Value="72"/>');
  });

  it('omits empty values', () => {
    const rows = new Map<string, Record<string, string>[]>();
    rows.set('SUB-2', [{ SubjectID: 'SUB-2', Temp: '', HR: '80' }]);
    const xml = buildOdmFromCsvRows(rows, MAPPING, DEFAULT_OPTS);
    expect(xml).not.toContain('I_TEMP');
    expect(xml).toContain('I_HR');
  });
});
