/**
 * Attachment Manager
 *
 * Handles attachment storage and retrieval
 * Stores attachments in userData/attachments/{accountId}/
 */

import { app, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Get attachments directory for an account
 */
export function getAttachmentsDir(accountId: string): string {
  const userDataPath = app.getPath('userData');
  const attachmentsPath = path.join(userDataPath, 'attachments', accountId);

  // Ensure directory exists
  if (!fs.existsSync(attachmentsPath)) {
    fs.mkdirSync(attachmentsPath, { recursive: true });
  }

  return attachmentsPath;
}

/**
 * Save attachment to disk
 */
export function saveAttachment(
  accountId: string,
  emailId: string,
  filename: string,
  content: Buffer
): string {
  const attachmentsDir = getAttachmentsDir(accountId);

  // Create a unique filename to avoid conflicts
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fullFilename = `${uniqueId}_${safeFilename}`;
  const filePath = path.join(attachmentsDir, fullFilename);

  // Write file
  fs.writeFileSync(filePath, content);

  console.log(`[Attachments] Saved: ${filePath}`);
  return filePath;
}

/**
 * Get attachment file path
 */
export function getAttachmentPath(
  accountId: string,
  filename: string
): string | null {
  const attachmentsDir = getAttachmentsDir(accountId);
  const filePath = path.join(attachmentsDir, filename);

  if (fs.existsSync(filePath)) {
    return filePath;
  }

  return null;
}

/**
 * Delete attachment from disk
 */
export function deleteAttachment(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Attachments] Deleted: ${filePath}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('[Attachments] Delete error:', error);
    return false;
  }
}

/**
 * Open attachment in default application
 */
export async function openAttachment(filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    throw new Error('Attachment file not found');
  }

  try {
    await shell.openPath(filePath);
    console.log(`[Attachments] Opened: ${filePath}`);
  } catch (error) {
    console.error('[Attachments] Open error:', error);
    throw error;
  }
}

/**
 * Get attachment size
 */
export function getAttachmentSize(filePath: string): number {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (error) {
    return 0;
  }
}

/**
 * Clean up attachments for deleted emails
 */
export function cleanupAttachments(accountId: string, emailId: string): void {
  // This would be called when an email is permanently deleted
  // For now, we keep attachments unless manually deleted
  console.log(`[Attachments] Cleanup requested for email ${emailId}`);
}

/**
 * Get total storage used by attachments
 */
export function getTotalAttachmentStorage(accountId: string): number {
  const attachmentsDir = getAttachmentsDir(accountId);

  try {
    const files = fs.readdirSync(attachmentsDir);
    let totalSize = 0;

    for (const file of files) {
      const filePath = path.join(attachmentsDir, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
    }

    return totalSize;
  } catch (error) {
    console.error('[Attachments] Storage calculation error:', error);
    return 0;
  }
}
