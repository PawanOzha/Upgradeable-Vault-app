/**
 * Mail Database Service
 *
 * SQLite database for caching emails, attachments, and mail metadata
 * Uses better-sqlite3 for synchronous, fast operations
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

/**
 * Initialize the mail database
 * Creates tables if they don't exist
 */
export function initMailDatabase(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'mail.db');

  // Ensure directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Create tables
  createTables();

  console.log('[Mail DB] Database initialized at:', dbPath);
  return db;
}

/**
 * Create database tables
 */
function createTables() {
  if (!db) throw new Error('Database not initialized');

  // Mail Accounts Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS mail_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,

      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL,
      imap_secure INTEGER NOT NULL DEFAULT 1,

      smtp_host TEXT NOT NULL,
      smtp_port INTEGER NOT NULL,
      smtp_secure INTEGER NOT NULL DEFAULT 1,

      credential_id INTEGER,

      is_connected INTEGER NOT NULL DEFAULT 0,
      last_sync_time TEXT,
      unread_count INTEGER NOT NULL DEFAULT 0,

      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Mail Folders Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS mail_folders (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      special_use TEXT,

      total_messages INTEGER NOT NULL DEFAULT 0,
      unread_messages INTEGER NOT NULL DEFAULT 0,

      parent_path TEXT,
      has_children INTEGER NOT NULL DEFAULT 0,

      last_sync_time TEXT,
      uid_validity INTEGER,

      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (account_id) REFERENCES mail_accounts(id) ON DELETE CASCADE,
      UNIQUE(account_id, path)
    )
  `);

  // Emails Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      uid INTEGER NOT NULL,
      message_id TEXT NOT NULL,

      account_id TEXT NOT NULL,
      folder TEXT NOT NULL,

      from_addresses TEXT NOT NULL,
      to_addresses TEXT NOT NULL,
      cc_addresses TEXT,
      bcc_addresses TEXT,
      reply_to_addresses TEXT,

      subject TEXT NOT NULL,
      date TEXT NOT NULL,

      text_body TEXT,
      html_body TEXT,
      has_attachments INTEGER NOT NULL DEFAULT 0,

      is_read INTEGER NOT NULL DEFAULT 0,
      is_flagged INTEGER NOT NULL DEFAULT 0,
      is_answered INTEGER NOT NULL DEFAULT 0,
      is_draft INTEGER NOT NULL DEFAULT 0,

      in_reply_to TEXT,
      email_references TEXT,
      thread_id TEXT,

      size INTEGER NOT NULL DEFAULT 0,
      labels TEXT,

      is_synced INTEGER NOT NULL DEFAULT 1,
      synced_at TEXT,

      is_suspicious INTEGER NOT NULL DEFAULT 0,
      security_score REAL,
      security_rating TEXT,
      security_issues TEXT,
      security_summary TEXT,

      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (account_id) REFERENCES mail_accounts(id) ON DELETE CASCADE,
      UNIQUE(account_id, folder, uid)
    )
  `);

  // Email Attachments Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_attachments (
      id TEXT PRIMARY KEY,
      email_id TEXT NOT NULL,

      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      content_id TEXT,
      is_inline INTEGER NOT NULL DEFAULT 0,
      local_path TEXT,

      created_at TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
    )
  `);

  // Email Drafts Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_drafts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,

      to_addresses TEXT NOT NULL,
      cc_addresses TEXT,
      bcc_addresses TEXT,

      subject TEXT NOT NULL,
      text_body TEXT,
      html_body TEXT,

      in_reply_to TEXT,
      email_references TEXT,

      saved_at TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (account_id) REFERENCES mail_accounts(id) ON DELETE CASCADE
    )
  `);

  // Email Signatures Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_signatures (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      html_content TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (account_id) REFERENCES mail_accounts(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for faster queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_emails_account_folder ON emails(account_id, folder);
    CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date DESC);
    CREATE INDEX IF NOT EXISTS idx_emails_is_read ON emails(is_read);
    CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);
    CREATE INDEX IF NOT EXISTS idx_folders_account ON mail_folders(account_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_email ON email_attachments(email_id);
    CREATE INDEX IF NOT EXISTS idx_signatures_account ON email_signatures(account_id);
  `);

  // Run migrations
  runMigrations();

  console.log('[Mail DB] Tables created successfully');
}

/**
 * Run database migrations
 */
function runMigrations() {
  if (!db) throw new Error('Database not initialized');

  // Check if security columns exist
  const tableInfo = db.prepare("PRAGMA table_info(emails)").all() as any[];
  const hasSecurityColumns = tableInfo.some((col: any) => col.name === 'is_suspicious');

  if (!hasSecurityColumns) {
    console.log('[Mail DB] Migrating: Adding security columns to emails table...');

    try {
      db.exec(`
        ALTER TABLE emails ADD COLUMN is_suspicious INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE emails ADD COLUMN security_score REAL;
        ALTER TABLE emails ADD COLUMN security_rating TEXT;
        ALTER TABLE emails ADD COLUMN security_issues TEXT;
        ALTER TABLE emails ADD COLUMN security_summary TEXT;
      `);

      // Create index for suspicious emails
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_emails_suspicious ON emails(is_suspicious);
      `);

      console.log('[Mail DB] Migration complete: Security columns added');
    } catch (error) {
      console.error('[Mail DB] Migration error:', error);
      throw error;
    }
  }
}

/**
 * Get database instance
 */
export function getMailDatabase(): Database.Database {
  if (!db) {
    return initMailDatabase();
  }
  return db;
}

/**
 * Close database connection
 */
export function closeMailDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('[Mail DB] Database connection closed');
  }
}

// ===========================================
// ACCOUNT QUERIES
// ===========================================

export function getAllAccounts() {
  const db = getMailDatabase();
  return db.prepare('SELECT * FROM mail_accounts ORDER BY created_at ASC').all();
}

export function getAccountById(accountId: string) {
  const db = getMailDatabase();
  return db.prepare('SELECT * FROM mail_accounts WHERE id = ?').get(accountId);
}

export function addAccount(account: any) {
  const db = getMailDatabase();
  const stmt = db.prepare(`
    INSERT INTO mail_accounts (
      id, name, email, imap_host, imap_port, imap_secure,
      smtp_host, smtp_port, smtp_secure, credential_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    account.id,
    account.name,
    account.email,
    account.imapHost,
    account.imapPort,
    account.imapSecure ? 1 : 0,
    account.smtpHost,
    account.smtpPort,
    account.smtpSecure ? 1 : 0,
    account.credentialId || null
  );
}

export function deleteAccount(accountId: string) {
  const db = getMailDatabase();
  return db.prepare('DELETE FROM mail_accounts WHERE id = ?').run(accountId);
}

export function updateAccountSyncStatus(accountId: string, lastSyncTime: string) {
  const db = getMailDatabase();
  return db.prepare(`
    UPDATE mail_accounts
    SET last_sync_time = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(lastSyncTime, accountId);
}

// ===========================================
// FOLDER QUERIES
// ===========================================

export function getFoldersByAccount(accountId: string) {
  const db = getMailDatabase();
  const folders = db.prepare('SELECT * FROM mail_folders WHERE account_id = ?').all(accountId);

  // Define custom folder order: Inbox, Sent, Spam, Trash, Drafts, Archive, Suspicious, then others
  const folderOrder = ['INBOX', 'Sent', 'Spam', 'Trash', 'Drafts', 'Archive', 'Suspicious'];

  return (folders as any[]).sort((a, b) => {
    // Normalize folder names for comparison
    const nameA = a.name.toUpperCase();
    const nameB = b.name.toUpperCase();
    const pathA = a.path.toUpperCase();
    const pathB = b.path.toUpperCase();

    // Check if folder names or paths match priority folders
    let indexA = -1;
    let indexB = -1;

    for (let i = 0; i < folderOrder.length; i++) {
      const priority = folderOrder[i].toUpperCase();
      if (nameA.includes(priority) || pathA.includes(priority)) indexA = i;
      if (nameB.includes(priority) || pathB.includes(priority)) indexB = i;
    }

    // If both are priority folders, sort by priority order
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }

    // Priority folders come first
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;

    // Non-priority folders sort alphabetically
    return a.name.localeCompare(b.name);
  });
}

export function addFolder(folder: any) {
  const db = getMailDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO mail_folders (
      id, account_id, name, path, special_use, total_messages,
      unread_messages, has_children
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    folder.id,
    folder.accountId,
    folder.name,
    folder.path,
    folder.specialUse || null,
    folder.totalMessages || 0,
    folder.unreadMessages || 0,
    folder.hasChildren ? 1 : 0
  );
}

// ===========================================
// EMAIL QUERIES
// ===========================================

export function getEmailsByFolder(accountId: string, folder: string, limit = 50, offset = 0) {
  const db = getMailDatabase();
  return db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND folder = ?
    ORDER BY date DESC
    LIMIT ? OFFSET ?
  `).all(accountId, folder, limit, offset);
}

export function getEmailById(emailId: string) {
  const db = getMailDatabase();
  return db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
}

export function addEmail(email: any) {
  const db = getMailDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO emails (
      id, uid, message_id, account_id, folder,
      from_addresses, to_addresses, cc_addresses, bcc_addresses, reply_to_addresses,
      subject, date, text_body, html_body, has_attachments,
      is_read, is_flagged, is_answered, is_draft,
      in_reply_to, email_references, thread_id, size, labels,
      is_suspicious, security_score, security_rating, security_issues, security_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    email.id,
    email.uid,
    email.messageId,
    email.accountId,
    email.folder,
    JSON.stringify(email.from),
    JSON.stringify(email.to),
    JSON.stringify(email.cc || []),
    JSON.stringify(email.bcc || []),
    JSON.stringify(email.replyTo || []),
    email.subject,
    email.date,
    email.textBody || null,
    email.htmlBody || null,
    email.hasAttachments ? 1 : 0,
    email.isRead ? 1 : 0,
    email.isFlagged ? 1 : 0,
    email.isAnswered ? 1 : 0,
    email.isDraft ? 1 : 0,
    email.inReplyTo || null,
    JSON.stringify(email.emailReferences || []),
    email.threadId || null,
    email.size || 0,
    JSON.stringify(email.labels || []),
    email.isSuspicious ? 1 : 0,
    email.securityScore || null,
    email.securityRating || null,
    email.securityIssues || null,
    email.securitySummary || null
  );
}

export function markEmailAsRead(emailId: string, isRead: boolean) {
  const db = getMailDatabase();
  return db.prepare(`
    UPDATE emails
    SET is_read = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(isRead ? 1 : 0, emailId);
}

export function deleteEmail(emailId: string) {
  const db = getMailDatabase();
  return db.prepare('DELETE FROM emails WHERE id = ?').run(emailId);
}

export function updateEmailBody(
  emailId: string,
  textBody: string | null,
  htmlBody: string | null,
  isSuspicious: boolean,
  securityScore: number | null,
  securityRating: string | null,
  securityIssues: string | null,
  securitySummary: string | null
) {
  const db = getMailDatabase();
  return db.prepare(`
    UPDATE emails
    SET text_body = ?, html_body = ?,
        is_suspicious = ?, security_score = ?, security_rating = ?,
        security_issues = ?, security_summary = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    textBody,
    htmlBody,
    isSuspicious ? 1 : 0,
    securityScore,
    securityRating,
    securityIssues,
    securitySummary,
    emailId
  );
}

// ===========================================
// ATTACHMENT QUERIES
// ===========================================

export function getAttachmentsByEmail(emailId: string) {
  const db = getMailDatabase();
  return db.prepare('SELECT * FROM email_attachments WHERE email_id = ?').all(emailId);
}

export function addAttachment(attachment: any) {
  const db = getMailDatabase();
  const stmt = db.prepare(`
    INSERT INTO email_attachments (
      id, email_id, filename, content_type, size,
      content_id, is_inline, local_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    attachment.id,
    attachment.emailId,
    attachment.filename,
    attachment.contentType,
    attachment.size,
    attachment.contentId || null,
    attachment.isInline ? 1 : 0,
    attachment.localPath || null
  );
}

// ===== SIGNATURE OPERATIONS =====

export function getSignaturesByAccount(accountId: string) {
  const db = getMailDatabase();
  return db.prepare('SELECT * FROM email_signatures WHERE account_id = ? ORDER BY is_default DESC, created_at DESC').all(accountId);
}

export function getSignatureById(signatureId: string) {
  const db = getMailDatabase();
  return db.prepare('SELECT * FROM email_signatures WHERE id = ?').get(signatureId);
}

export function getDefaultSignature(accountId: string) {
  const db = getMailDatabase();
  return db.prepare('SELECT * FROM email_signatures WHERE account_id = ? AND is_default = 1 LIMIT 1').get(accountId);
}

export function addSignature(signature: any) {
  const db = getMailDatabase();

  // If this is set as default, unset all other defaults for this account
  if (signature.isDefault) {
    db.prepare('UPDATE email_signatures SET is_default = 0 WHERE account_id = ?').run(signature.accountId);
  }

  const stmt = db.prepare(`
    INSERT INTO email_signatures (id, account_id, name, html_content, is_default)
    VALUES (?, ?, ?, ?, ?)
  `);

  return stmt.run(
    signature.id,
    signature.accountId,
    signature.name,
    signature.htmlContent,
    signature.isDefault ? 1 : 0
  );
}

export function updateSignature(signatureId: string, name: string, htmlContent: string, isDefault: boolean) {
  const db = getMailDatabase();

  // Get the signature to know which account it belongs to
  const signature = getSignatureById(signatureId);
  if (!signature) {
    throw new Error('Signature not found');
  }

  // If this is set as default, unset all other defaults for this account
  if (isDefault) {
    db.prepare('UPDATE email_signatures SET is_default = 0 WHERE account_id = ?').run(signature.account_id);
  }

  return db.prepare(`
    UPDATE email_signatures
    SET name = ?, html_content = ?, is_default = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, htmlContent, isDefault ? 1 : 0, signatureId);
}

export function deleteSignature(signatureId: string) {
  const db = getMailDatabase();
  return db.prepare('DELETE FROM email_signatures WHERE id = ?').run(signatureId);
}
