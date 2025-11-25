/**
 * Medical Coding Controller
 * Placeholder for external coding system integration (MedDRA, WHO Drug)
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';

export const list = asyncHandler(async (req: Request, res: Response) => {
  // Medical coding is typically handled by external systems
  // This is a placeholder for integration
  res.json({
    success: true,
    data: [],
    message: 'Medical coding integration pending - connect to MedDRA/WHO Drug'
  });
});

export const code = asyncHandler(async (req: Request, res: Response) => {
  const { verbatimTerm, dictionary } = req.body;

  // Placeholder for coding logic
  res.json({
    success: true,
    data: {
      verbatimTerm,
      dictionary: dictionary || 'MedDRA',
      status: 'pending',
      message: 'Coding request submitted'
    }
  });
});

export default { list, code };
