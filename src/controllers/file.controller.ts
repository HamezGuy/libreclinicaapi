/**
 * File Controller
 *
 * Handles file upload/download/delete endpoints.
 * Delegates SQL to file-uploads.service; keeps multer config in the route file.
 *
 * 21 CFR Part 11: audit trail via logger, soft-delete for traceability.
 */

import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { logger } from '../config/logger';
import { config } from '../config/environment';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import { NotFoundError, BadRequestError } from '../middleware/errorHandler.middleware';
import * as fileService from '../services/database/file-uploads.service';
import type { ApiResponse, UploadedFileResponse } from '@accura-trial/shared-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const resolveFilePath = (storedName: string): string => path.join(UPLOADS_DIR, storedName);

const userId = (req: Request): number => (req as unknown as { user: { userId: number } }).user?.userId || 1;

/**
 * Encrypt a file on disk in-place using AES-256-GCM.
 * Appends IV + authTag to the filename (.enc suffix).
 * HIPAA §164.312(a)(2)(iv) — file-level encryption at rest.
 */
function encryptFileOnDisk(filePath: string): { encryptedPath: string; iv: string; authTag: string } | null {
  if (!config.encryption?.enableFieldEncryption) return null;
  try {
    const masterKey = config.encryption.masterKey || '';
    const salt = config.encryption.salt || '';
    if (masterKey === 'change-me-in-production') return null;

    const key = crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha512');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const input = fs.readFileSync(filePath);
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const encPath = filePath + '.enc';
    fs.writeFileSync(encPath, encrypted);
    fs.unlinkSync(filePath);

    return { encryptedPath: encPath, iv: iv.toString('hex'), authTag: authTag.toString('hex') };
  } catch (err: any) {
    logger.warn('File encryption failed, keeping plaintext', { filePath, error: err.message });
    return null;
  }
}

/**
 * Decrypt an encrypted file for download.
 */
function decryptFileBuffer(filePath: string, iv: string, authTag: string): Buffer | null {
  if (!config.encryption?.enableFieldEncryption) return null;
  try {
    const masterKey = config.encryption.masterKey || '';
    const salt = config.encryption.salt || '';
    const key = crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha512');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    const encrypted = fs.readFileSync(filePath);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (err: any) {
    logger.error('File decryption failed', { filePath, error: err.message });
    return null;
  }
}

function toUploadedFileResponse(
  fileId: string,
  originalName: string,
  size: number,
  mimeType: string,
  crfVersionMediaId?: number,
  itemId?: number,
): UploadedFileResponse {
  const resp: UploadedFileResponse = {
    id: fileId,
    name: originalName,
    size,
    type: mimeType,
    url: `/api/files/${fileId}/download`,
    uploadedAt: new Date(),
    crfVersionMediaId,
    itemId,
  };
  if (mimeType.startsWith('image/')) {
    resp.thumbnailUrl = `/api/files/${fileId}/thumbnail`;
  }
  return resp;
}

function resolveStoredPath(storedName: string, filePath: string): string {
  const name = storedName || filePath;
  return path.isAbsolute(name) ? name : resolveFilePath(name);
}

// ─── Upload single file ───────────────────────────────────────────────────────

export const upload = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new BadRequestError('No file uploaded');

  const { crfVersionId, itemId, eventCrfId, studySubjectId, consentId } = req.body;
  const file = req.file;

  const fileBuffer = fs.readFileSync(file.path);
  const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
  const fileId = crypto.randomBytes(16).toString('hex');

  // Encrypt file on disk (HIPAA §164.312(a)(2)(iv))
  const encResult = encryptFileOnDisk(file.path);
  const storedName = encResult ? path.basename(encResult.encryptedPath) : file.filename;

  const crfVersionMediaId = await fileService.uploadFileTransaction(
    {
      fileId,
      originalName: file.originalname,
      storedName,
      mimeType: file.mimetype,
      fileSize: file.size,
      checksum: fileHash,
      crfVersionId: crfVersionId || null,
      itemId: itemId || null,
      crfVersionMediaId: null,
      eventCrfId: eventCrfId || null,
      studySubjectId: studySubjectId || null,
      consentId: consentId || null,
      uploadedBy: userId(req),
    },
    crfVersionId || null,
    file.originalname,
    storedName,
  );

  const data = toUploadedFileResponse(
    fileId, file.originalname, file.size, file.mimetype,
    crfVersionMediaId || undefined,
  );

  logger.info('File uploaded', { fileId, name: file.originalname, size: file.size });
  const response: ApiResponse<UploadedFileResponse> = { success: true, data };
  res.json(response);
});

// ─── Upload batch ─────────────────────────────────────────────────────────────

export const uploadBatch = asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) throw new BadRequestError('No files uploaded');

  const { crfVersionId, itemId, eventCrfId, studySubjectId, consentId } = req.body;

  const batchInput = files.map(file => {
    const fileBuffer = fs.readFileSync(file.path);
    const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    const fileId = crypto.randomBytes(16).toString('hex');
    return {
      fileId,
      file,
      params: {
        fileId,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        fileSize: file.size,
        checksum: fileHash,
        crfVersionId: crfVersionId || null,
        itemId: itemId || null,
        crfVersionMediaId: null as number | null,
        eventCrfId: eventCrfId || null,
        studySubjectId: studySubjectId || null,
        consentId: consentId || null,
        uploadedBy: userId(req),
      },
      crfVersionId: crfVersionId || null,
      originalName: file.originalname,
      storedName: file.filename,
    };
  });

  const mediaIds = await fileService.uploadBatchTransaction(batchInput);

  const uploadedFiles: UploadedFileResponse[] = batchInput.map((item, i) =>
    toUploadedFileResponse(
      item.fileId, item.file.originalname, item.file.size, item.file.mimetype,
      mediaIds[i] || undefined,
    )
  );

  logger.info('Batch file upload', { count: uploadedFiles.length });
  const response: ApiResponse<UploadedFileResponse[]> = { success: true, data: uploadedFiles };
  res.json(response);
});

// ─── Get file metadata ────────────────────────────────────────────────────────

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const file = await fileService.getFileById(req.params.id);
  if (!file) throw new NotFoundError('File not found');

  const data: UploadedFileResponse = {
    id: file.fileId,
    name: file.originalName,
    size: file.fileSize,
    type: file.mimeType,
    url: `/api/files/${file.fileId}/download`,
    uploadedAt: file.uploadedAt,
    crfVersionMediaId: file.crfVersionMediaId,
  };
  if (file.mimeType?.startsWith('image/')) {
    data.thumbnailUrl = `/api/files/${file.fileId}/thumbnail`;
  }

  const response: ApiResponse<UploadedFileResponse> = { success: true, data };
  res.json(response);
});

// ─── Download file ────────────────────────────────────────────────────────────

export const download = asyncHandler(async (req: Request, res: Response) => {
  const file = await fileService.getFileForDownload(req.params.id);
  if (!file) throw new NotFoundError('File not found');

  const diskPath = resolveStoredPath(file.storedName, file.filePath);
  if (!fs.existsSync(diskPath)) {
    logger.warn('File not found on disk', { fileId: req.params.id, diskPath, storedName: file.storedName });
    throw new NotFoundError('File not found on disk');
  }

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
  const stream = fs.createReadStream(diskPath);
  stream.pipe(res);
});

// ─── Get thumbnail ────────────────────────────────────────────────────────────

export const thumbnail = asyncHandler(async (req: Request, res: Response) => {
  const file = await fileService.getImageFile(req.params.id);
  if (!file) throw new NotFoundError('Image not found');

  const diskPath = resolveStoredPath(file.storedName, file.filePath);
  if (!fs.existsSync(diskPath)) {
    logger.warn('Thumbnail file not found on disk', { fileId: req.params.id, diskPath });
    throw new NotFoundError('File not found on disk');
  }

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const stream = fs.createReadStream(diskPath);
  stream.pipe(res);
});

// ─── List by item ─────────────────────────────────────────────────────────────

export const listByItem = asyncHandler(async (req: Request, res: Response) => {
  const files = await fileService.getFilesForItem(parseInt(req.params.itemId));
  const data: UploadedFileResponse[] = files.map(f => toFileResponse(f));
  const response: ApiResponse<UploadedFileResponse[]> = { success: true, data };
  res.json(response);
});

// ─── List by CRF version ─────────────────────────────────────────────────────

export const listByCrfVersion = asyncHandler(async (req: Request, res: Response) => {
  const files = await fileService.getFilesForCrfVersion(parseInt(req.params.crfVersionId));
  const data: UploadedFileResponse[] = files.map(f => toFileResponse(f));
  const response: ApiResponse<UploadedFileResponse[]> = { success: true, data };
  res.json(response);
});

// ─── List by event CRF ───────────────────────────────────────────────────────

export const listByEventCrf = asyncHandler(async (req: Request, res: Response) => {
  const files = await fileService.getFilesByEventCrf(parseInt(req.params.eventCrfId));
  const data: UploadedFileResponse[] = files.map(f => ({
    ...toFileResponse(f),
    itemId: f.itemId,
  }));
  const response: ApiResponse<UploadedFileResponse[]> = { success: true, data };
  res.json(response);
});

// ─── List by consent ──────────────────────────────────────────────────────────

export const listByConsent = asyncHandler(async (req: Request, res: Response) => {
  const files = await fileService.getFilesByConsent(parseInt(req.params.consentId));
  const data: UploadedFileResponse[] = files.map(f => toFileResponse(f));
  const response: ApiResponse<UploadedFileResponse[]> = { success: true, data };
  res.json(response);
});

// ─── Delete file ──────────────────────────────────────────────────────────────

export const deleteFile = asyncHandler(async (req: Request, res: Response) => {
  const fileRecord = await fileService.getFileForDeletion(req.params.id);
  if (!fileRecord) throw new NotFoundError('File not found');

  await fileService.deleteFileTransaction(req.params.id, userId(req), fileRecord.crfVersionMediaId);

  const storedName = fileRecord.storedName || fileRecord.filePath;
  const diskPath = path.isAbsolute(storedName) ? storedName : resolveFilePath(storedName);
  if (fs.existsSync(diskPath)) {
    fs.unlinkSync(diskPath);
  }

  logger.info('File deleted', { fileId: req.params.id });
  const response: ApiResponse = { success: true };
  res.json(response);
});

// ─── Internal mapper: UploadedFile → UploadedFileResponse ─────────────────────

function toFileResponse(f: { fileId: string; originalName: string; fileSize: number; mimeType: string; uploadedAt: Date | string; crfVersionMediaId?: number }): UploadedFileResponse {
  const resp: UploadedFileResponse = {
    id: f.fileId,
    name: f.originalName,
    size: f.fileSize,
    type: f.mimeType,
    url: `/api/files/${f.fileId}/download`,
    uploadedAt: f.uploadedAt,
    crfVersionMediaId: f.crfVersionMediaId,
  };
  if (f.mimeType?.startsWith('image/')) {
    resp.thumbnailUrl = `/api/files/${f.fileId}/thumbnail`;
  }
  return resp;
}
