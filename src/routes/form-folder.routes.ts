/**
 * Form Folder Routes
 * 
 * Visual-only folder organization for forms in the dashboard.
 * Does not affect form behavior, assignments, or clinical data.
 */

import express, { Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as folderService from '../services/database/form-folder.service';
import { asyncHandler } from '../middleware/errorHandler.middleware';

const router = express.Router();

router.use(authMiddleware);

// GET /api/form-folders — List all folders (optionally filtered by studyId and parentFolderId)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const studyId = req.query.studyId ? parseInt(req.query.studyId as string) : undefined;
  const parentFolderId = req.query.parentFolderId !== undefined
    ? (req.query.parentFolderId === 'null' || req.query.parentFolderId === '0' ? 0 : parseInt(req.query.parentFolderId as string))
    : undefined;
  const userId = (req as AuthRequest).user?.userId;
  const organizationIds = (req as AuthRequest).user?.organizationIds;
  const folders = await folderService.getFolders(studyId, userId, parentFolderId, organizationIds);
  res.json({ success: true, data: folders });
}));

// GET /api/form-folders/:id — Get a single folder with its form IDs
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const organizationIds = (req as AuthRequest).user?.organizationIds;
  const folderId = parseInt(req.params.id);
  await folderService.assertFolderOrgAccess(folderId, organizationIds);
  const folder = await folderService.getFolderById(folderId);
  if (!folder) {
    res.status(404).json({ success: false, message: 'Folder not found' });
    return;
  }
  res.json({ success: true, data: folder });
}));

// POST /api/form-folders — Create a new folder
router.post('/',
  requireRole('admin', 'data_manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, description, studyId, parentFolderId } = req.body;
    const userId = (req as AuthRequest).user?.userId;
    const organizationIds = (req as AuthRequest).user?.organizationIds;
    const organizationId = organizationIds && organizationIds.length > 0 ? organizationIds[0] : undefined;

    if (!name || !name.trim()) {
      res.status(400).json({ success: false, message: 'Folder name is required' });
      return;
    }

    const folder = await folderService.createFolder(name.trim(), userId!, studyId, description, parentFolderId || null, organizationId);
    res.status(201).json({ success: true, data: folder });
  })
);

// PUT /api/form-folders/:id — Rename / update folder
router.put('/:id',
  requireRole('admin', 'data_manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const folderId = parseInt(req.params.id);
    const { name, description } = req.body;
    const organizationIds = (req as AuthRequest).user?.organizationIds;

    await folderService.assertFolderOrgAccess(folderId, organizationIds);

    if (name !== undefined && !name.trim()) {
      res.status(400).json({ success: false, message: 'Folder name cannot be empty' });
      return;
    }

    const folder = await folderService.updateFolder(folderId, {
      name: name?.trim(),
      description
    });

    if (!folder) {
      res.status(404).json({ success: false, message: 'Folder not found' });
      return;
    }
    res.json({ success: true, data: folder });
  })
);

// DELETE /api/form-folders/:id — Delete a folder (items are cascade-deleted)
router.delete('/:id',
  requireRole('admin', 'data_manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const folderId = parseInt(req.params.id);
    const organizationIds = (req as AuthRequest).user?.organizationIds;

    await folderService.assertFolderOrgAccess(folderId, organizationIds);

    const result = await folderService.deleteFolder(folderId);
    if (!result.success) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  })
);

// POST /api/form-folders/:id/forms — Add a form to a folder
router.post('/:id/forms',
  requireRole('admin', 'data_manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const folderId = parseInt(req.params.id);
    const { crfId } = req.body;
    const organizationIds = (req as AuthRequest).user?.organizationIds;

    await folderService.assertFolderOrgAccess(folderId, organizationIds);

    if (!crfId) {
      res.status(400).json({ success: false, message: 'crfId is required' });
      return;
    }

    const item = await folderService.addFormToFolder(folderId, crfId);
    res.status(201).json({ success: true, data: item });
  })
);

// DELETE /api/form-folders/:id/forms/:crfId — Remove a form from a folder
router.delete('/:id/forms/:crfId',
  requireRole('admin', 'data_manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const folderId = parseInt(req.params.id);
    const crfId = parseInt(req.params.crfId);
    const organizationIds = (req as AuthRequest).user?.organizationIds;

    await folderService.assertFolderOrgAccess(folderId, organizationIds);

    const removed = await folderService.removeFormFromFolder(folderId, crfId);
    res.json({ success: removed, message: removed ? 'Form removed from folder' : 'Form was not in folder' });
  })
);

// POST /api/form-folders/:id/move-all-out — Move all forms out before deletion
router.post('/:id/move-all-out',
  requireRole('admin', 'data_manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const folderId = parseInt(req.params.id);
    const organizationIds = (req as AuthRequest).user?.organizationIds;

    await folderService.assertFolderOrgAccess(folderId, organizationIds);

    const count = await folderService.moveAllFormsOut(folderId);
    res.json({ success: true, message: `Moved ${count} forms out of folder` });
  })
);

// PUT /api/form-folders/:id/move — Move a folder to a new parent (or root)
router.put('/:id/move',
  requireRole('admin', 'data_manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const folderId = parseInt(req.params.id);
    const { parentFolderId } = req.body;
    const organizationIds = (req as AuthRequest).user?.organizationIds;

    await folderService.assertFolderOrgAccess(folderId, organizationIds);

    const folder = await folderService.moveFolder(folderId, parentFolderId ?? null);
    if (!folder) {
      res.status(404).json({ success: false, message: 'Folder not found' });
      return;
    }
    res.json({ success: true, data: folder });
  })
);

// POST /api/form-folders/:id/move-children — Move all subfolders to the folder's parent
router.post('/:id/move-children',
  requireRole('admin', 'data_manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const folderId = parseInt(req.params.id);
    const organizationIds = (req as AuthRequest).user?.organizationIds;

    await folderService.assertFolderOrgAccess(folderId, organizationIds);

    const count = await folderService.moveChildrenToParent(folderId);
    res.json({ success: true, message: `Moved ${count} subfolders to parent` });
  })
);

export default router;
