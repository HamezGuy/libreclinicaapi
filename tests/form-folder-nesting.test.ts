/**
 * Form Folder Nesting Tests
 * 
 * Tests the hierarchical folder system:
 *   - CRUD with parent_folder_id
 *   - Depth limit enforcement (max 4 levels)
 *   - Move folder between parents
 *   - Circular reference prevention
 *   - Move children to parent before delete
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as folderService from '../src/services/database/form-folder.service';

const TEST_USER_ID = 1;
const createdFolderIds: number[] = [];

describe('Form Folder Nesting', () => {

  afterAll(async () => {
    // Cleanup all created folders (deepest first)
    for (const id of createdFolderIds.reverse()) {
      try {
        await folderService.deleteFolder(id);
      } catch { /* may already be deleted */ }
    }
  });

  it('should create a root folder with null parent', async () => {
    const folder = await folderService.createFolder('Test Root', TEST_USER_ID, undefined, undefined, null);
    expect(folder).toBeDefined();
    expect(folder.folderId).toBeGreaterThan(0);
    expect(folder.parentFolderId).toBeNull();
    expect(folder.name).toBe('Test Root');
    createdFolderIds.push(folder.folderId);
  });

  it('should create a child folder under root', async () => {
    const parentId = createdFolderIds[0];
    const folder = await folderService.createFolder('Test Child', TEST_USER_ID, undefined, undefined, parentId);
    expect(folder).toBeDefined();
    expect(folder.parentFolderId).toBe(parentId);
    createdFolderIds.push(folder.folderId);
  });

  it('should create level-3 folder', async () => {
    const parentId = createdFolderIds[1];
    const folder = await folderService.createFolder('Test L3', TEST_USER_ID, undefined, undefined, parentId);
    expect(folder).toBeDefined();
    expect(folder.parentFolderId).toBe(parentId);
    createdFolderIds.push(folder.folderId);
  });

  it('should create level-4 folder (max depth)', async () => {
    const parentId = createdFolderIds[2];
    const folder = await folderService.createFolder('Test L4', TEST_USER_ID, undefined, undefined, parentId);
    expect(folder).toBeDefined();
    expect(folder.parentFolderId).toBe(parentId);
    createdFolderIds.push(folder.folderId);
  });

  it('should reject level-5 folder (exceeds max depth)', async () => {
    const parentId = createdFolderIds[3];
    await expect(
      folderService.createFolder('Test L5 FAIL', TEST_USER_ID, undefined, undefined, parentId)
    ).rejects.toThrow(/depth/i);
  });

  it('should list folders filtered by parentFolderId', async () => {
    const rootId = createdFolderIds[0];
    const folders = await folderService.getFolders(undefined, undefined, rootId);
    expect(folders.length).toBeGreaterThanOrEqual(1);
    expect(folders.every(f => f.parentFolderId === rootId)).toBe(true);
  });

  it('should list root folders with parentFolderId=0', async () => {
    const folders = await folderService.getFolders(undefined, undefined, 0);
    expect(folders.every(f => f.parentFolderId === null || f.parentFolderId === undefined)).toBe(true);
  });

  it('should return child_count on getFolderById', async () => {
    const rootId = createdFolderIds[0];
    const folder = await folderService.getFolderById(rootId);
    expect(folder).toBeDefined();
    expect(folder!.childCount).toBeGreaterThanOrEqual(1);
  });

  it('should move folder to root', async () => {
    const childId = createdFolderIds[1];
    const moved = await folderService.moveFolder(childId, null);
    expect(moved).toBeDefined();
    expect(moved!.parentFolderId).toBeNull();
    // Move it back for cleanup consistency
    await folderService.moveFolder(childId, createdFolderIds[0]);
  });

  it('should prevent moving folder to itself', async () => {
    const folderId = createdFolderIds[0];
    await expect(
      folderService.moveFolder(folderId, folderId)
    ).rejects.toThrow(/own parent/i);
  });

  it('should prevent circular reference', async () => {
    const rootId = createdFolderIds[0];
    const childId = createdFolderIds[1];
    await expect(
      folderService.moveFolder(rootId, childId)
    ).rejects.toThrow(/descendants/i);
  });

  it('should move children to parent', async () => {
    // Create a temp folder with a child
    const tempParent = await folderService.createFolder('TempParent', TEST_USER_ID);
    createdFolderIds.push(tempParent.folderId);
    const tempChild = await folderService.createFolder('TempChild', TEST_USER_ID, undefined, undefined, tempParent.folderId);
    createdFolderIds.push(tempChild.folderId);

    const count = await folderService.moveChildrenToParent(tempParent.folderId);
    expect(count).toBeGreaterThanOrEqual(1);

    const movedChild = await folderService.getFolderById(tempChild.folderId);
    expect(movedChild!.parentFolderId).toBeNull();
  });

  it('should get folder depth', async () => {
    const rootId = createdFolderIds[0];
    const depth = await folderService.getFolderDepth(rootId);
    expect(depth).toBeGreaterThanOrEqual(1);
  });

  it('should get subtree depth', async () => {
    const rootId = createdFolderIds[0];
    const subtreeDepth = await folderService.getSubtreeDepth(rootId);
    expect(subtreeDepth).toBeGreaterThanOrEqual(1);
  });
});
