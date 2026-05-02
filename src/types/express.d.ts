/**
 * Express Type Extensions
 * 
 * Extends the Express namespace to add custom properties used by our middleware
 * (e.g., auth user, audit info). Does NOT override built-in Express types.
 */

import type { Part11Signature } from '@accura-trial/shared-types';

declare namespace Express {
  interface Request {
    user?: {
      userId: number;
      userName: string;
      username?: string;
      email: string;
      userType: string;
      role: string;
      studyIds?: number[];
      organizationIds?: number[];
    };
    auditId?: string;
    signature?: Part11Signature;
  }
}
