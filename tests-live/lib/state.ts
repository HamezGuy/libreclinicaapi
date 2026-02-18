import * as fs from 'fs';
import * as path from 'path';

const STATE_DIR = path.resolve(__dirname, '..', 'state');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

export interface TestState {
  // Organization
  orgId?: number;
  orgName?: string;

  // Admin
  adminUserId?: number;
  adminUsername?: string;
  adminEmail?: string;
  accessToken?: string;
  refreshToken?: string;

  // Members
  member1UserId?: number;
  member1Username?: string;
  member1MembershipId?: number;
  member2UserId?: number;
  member2Username?: string;
  member2MembershipId?: number;

  // Base eCRFs
  baseCrf1Id?: number;
  baseCrf1VersionId?: number;
  baseCrf2Id?: number;
  baseCrf2VersionId?: number;

  // Validation eCRF copies
  validationCrf1Id?: number;
  validationCrf1VersionId?: number;
  validationCrf2Id?: number;
  validationCrf2VersionId?: number;

  // Workflow eCRF copies
  workflowCrf1Id?: number;
  workflowCrf1VersionId?: number;
  workflowCrf2Id?: number;
  workflowCrf2VersionId?: number;

  // Study
  studyId?: number;
  studyOid?: string;
  siteIds?: number[];
  eventDefinitionIds?: number[];

  // Validation rule IDs
  validationRuleIds?: number[];

  // Patient
  subjectId?: number;
  studySubjectId?: string;
  studyEventIds?: number[];

  // Form instances (eventCrfIds created during data entry)
  eventCrfIds?: number[];

  // Any extra data scripts want to stash
  [key: string]: any;
}

export function loadState(): TestState {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  if (!fs.existsSync(STATE_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveState(state: TestState): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function updateState(partial: Partial<TestState>): TestState {
  const current = loadState();
  const merged = { ...current, ...partial };
  saveState(merged);
  return merged;
}
