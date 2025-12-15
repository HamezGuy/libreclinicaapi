/**
 * eConsent Types
 * 
 * Type definitions for the electronic consent module.
 */

// ============================================================================
// Consent Document Types
// ============================================================================

export interface ConsentDocument {
  documentId: number;
  studyId: number;
  name: string;
  description?: string;
  documentType: 'main' | 'assent' | 'lar' | 'optional' | 'addendum';
  languageCode: string;
  status: 'draft' | 'active' | 'retired';
  requiresWitness: boolean;
  requiresLAR: boolean;
  ageOfMajority: number;
  minReadingTime: number;
  ownerId?: number;
  ownerName?: string;
  dateCreated: Date;
  dateUpdated: Date;
  activeVersion?: ConsentVersion;
}

export interface ConsentDocumentCreate {
  studyId: number;
  name: string;
  description?: string;
  documentType?: 'main' | 'assent' | 'lar' | 'optional' | 'addendum';
  languageCode?: string;
  requiresWitness?: boolean;
  requiresLAR?: boolean;
  ageOfMajority?: number;
  minReadingTime?: number;
  createdBy: number;
}

// ============================================================================
// Consent Version Types
// ============================================================================

export interface ConsentVersion {
  versionId: number;
  documentId: number;
  versionNumber: string;
  versionName?: string;
  content: ConsentContent;
  pdfTemplate?: string;
  effectiveDate: Date;
  expirationDate?: Date;
  irbApprovalDate?: Date;
  irbApprovalNumber?: string;
  changeSummary?: string;
  status: 'draft' | 'approved' | 'active' | 'superseded';
  approvedBy?: number;
  approvedByName?: string;
  approvedAt?: Date;
  createdBy?: number;
  dateCreated: Date;
  dateUpdated: Date;
}

export interface ConsentVersionCreate {
  documentId: number;
  versionNumber: string;
  versionName?: string;
  content: ConsentContent;
  pdfTemplate?: string;
  effectiveDate: Date;
  expirationDate?: Date;
  irbApprovalDate?: Date;
  irbApprovalNumber?: string;
  changeSummary?: string;
  createdBy: number;
}

// ============================================================================
// Consent Content Structure
// ============================================================================

export interface ConsentContent {
  pages: ConsentPage[];
  acknowledgments: ConsentAcknowledgment[];
  signatureRequirements: SignatureRequirement[];
}

export interface ConsentPage {
  pageNumber: number;
  title: string;
  content: string; // HTML content
  requiresView: boolean; // Must scroll/view to proceed
  hasVideo?: boolean;
  videoUrl?: string;
  estimatedReadingTime?: number; // seconds
}

export interface ConsentAcknowledgment {
  id: string;
  text: string;
  required: boolean;
  order: number;
}

export interface SignatureRequirement {
  type: 'subject' | 'witness' | 'lar' | 'investigator';
  label: string;
  required: boolean;
  order: number;
}

// ============================================================================
// Subject Consent Types
// ============================================================================

export interface SubjectConsent {
  consentId: number;
  studySubjectId: number;
  subjectLabel?: string;
  versionId: number;
  versionNumber?: string;
  documentName?: string;
  consentType: 'subject' | 'witness' | 'lar' | 'reconsent';
  consentStatus: 'pending' | 'in_progress' | 'consented' | 'declined' | 'withdrawn' | 'expired';
  
  // Subject signature
  subjectName?: string;
  subjectSignatureData?: any;
  subjectSignedAt?: Date;
  subjectIpAddress?: string;
  
  // Witness
  witnessName?: string;
  witnessRelationship?: string;
  witnessSignatureData?: any;
  witnessSignedAt?: Date;
  
  // LAR
  larName?: string;
  larRelationship?: string;
  larSignatureData?: any;
  larSignedAt?: Date;
  larReason?: string;
  
  // Process tracking
  presentedAt?: Date;
  timeSpentReading: number;
  pagesViewed?: any;
  acknowledgementsChecked?: any;
  questionsAsked?: string;
  
  // Copy
  copyEmailedTo?: string;
  copyEmailedAt?: Date;
  pdfFilePath?: string;
  
  // Withdrawal
  withdrawnAt?: Date;
  withdrawalReason?: string;
  withdrawnByName?: string;
  
  // Audit
  consentedBy?: number;
  consentedByName?: string;
  dateCreated: Date;
  dateUpdated: Date;
}

export interface SubjectConsentCreate {
  studySubjectId: number;
  versionId: number;
  consentType?: 'subject' | 'witness' | 'lar' | 'reconsent';
  
  // Subject signature
  subjectName: string;
  subjectSignatureData: any;
  subjectIpAddress?: string;
  subjectUserAgent?: string;
  
  // Witness (if required)
  witnessName?: string;
  witnessRelationship?: string;
  witnessSignatureData?: any;
  
  // LAR (if required)
  larName?: string;
  larRelationship?: string;
  larSignatureData?: any;
  larReason?: string;
  
  // Process tracking
  timeSpentReading: number;
  pagesViewed: any;
  acknowledgementsChecked: any;
  questionsAsked?: string;
  
  // Staff who obtained consent
  consentedBy: number;
}

// ============================================================================
// Re-consent Types
// ============================================================================

export interface ReconsentRequest {
  requestId: number;
  versionId: number;
  versionNumber?: string;
  studySubjectId: number;
  subjectLabel?: string;
  previousConsentId?: number;
  previousVersionNumber?: string;
  reason: string;
  requestedAt: Date;
  requestedBy?: number;
  requestedByName?: string;
  dueDate?: Date;
  completedConsentId?: number;
  status: 'pending' | 'completed' | 'declined' | 'waived';
  waivedBy?: number;
  waivedReason?: string;
  dateUpdated: Date;
}

export interface ReconsentRequestCreate {
  versionId: number;
  studySubjectId: number;
  reason: string;
  dueDate?: Date;
  requestedBy: number;
}

// ============================================================================
// Dashboard Types
// ============================================================================

export interface ConsentDashboard {
  stats: {
    totalSubjects: number;
    consented: number;
    pending: number;
    declined: number;
    withdrawn: number;
    pendingReconsent: number;
  };
  pendingConsents: Array<{
    studySubjectId: number;
    subjectLabel: string;
    siteName: string;
    enrolledAt: Date;
    daysWithoutConsent: number;
  }>;
  pendingReconsents: ReconsentRequest[];
  recentConsents: SubjectConsent[];
  documentVersions: Array<{
    documentId: number;
    documentName: string;
    activeVersion: string;
    subjectsConsented: number;
  }>;
}

// ============================================================================
// Consent Session Types
// ============================================================================

export interface ConsentSession {
  sessionId: string;
  studySubjectId: number;
  versionId: number;
  startedAt: Date;
  presentedBy: number;
  pagesViewed: number[];
  currentPage: number;
  timePerPage: Record<number, number>;
  totalTimeSpent: number;
  acknowledgementsChecked: string[];
}

