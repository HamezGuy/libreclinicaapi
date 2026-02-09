/**
 * Express Type Extensions
 * 
 * Extends the Express namespace to add custom properties used by our middleware
 * (e.g., auth user, audit info). Does NOT override built-in Express types.
 */

declare namespace Express {
  interface Request {
    user?: {
      userId: number;
      userName: string;
      email: string;
      userType: string;
      role: string;
      studyIds?: number[];
    };
    auditId?: string;
    signatureVerified?: boolean;
    signatureMeaning?: string;
  }
}
