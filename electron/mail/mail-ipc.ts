/**
 * Mail IPC Handlers
 *
 * Handles communication between renderer and main process for mail operations
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as crypto from 'crypto';
import { deriveEncryptionKey, encryptPassword, decryptPassword } from '../lib/encryption.js';
import {
  initMailDatabase,
  getAllAccounts,
  getAccountById,
  addAccount,
  deleteAccount,
  getFoldersByAccount,
  getEmailsByFolder,
  getEmailById,
  markEmailAsRead,
  deleteEmail as dbDeleteEmail,
  getAttachmentsByEmail,
  updateEmailBody,
  getSignaturesByAccount,
  getSignatureById,
  getDefaultSignature,
  addSignature as dbAddSignature,
  updateSignature as dbUpdateSignature,
  deleteSignature as dbDeleteSignature,
} from './mail-database';
import {
  connectIMAP,
  disconnectIMAP,
  testIMAPConnection,
  syncFolders,
  fetchEmails,
  fetchEmailBody,
  markAsRead,
  markAsFlagged,
  moveMessage,
  deleteMessage,
  getIMAPConnection,
  appendMessage,
  startIdle,
  stopIdle,
} from './imap-service';
import {
  createSMTPTransporter,
  testSMTPConnection,
  sendEmailWithRetry,
  getSMTPTransporter,
} from './smtp-service';
import {
  openAttachment,
} from './attachment-manager';
import { mailCache } from './mail-cache';
import { reputationChecker } from './reputation-checker';

// Will be set by main.ts
let getActiveSession: (() => any) | null = null;
let getDb: (() => any) | null = null;
let mailWindow: Electron.BrowserWindow | null = null;

// Cache decrypted passwords in memory for performance
// This avoids needing master password for every mail operation
const passwordCache = new Map<string, string>(); // accountId -> decrypted password

/**
 * Get account password with caching
 * Returns cached password if available, otherwise decrypts from vault
 */
async function getAccountPassword(accountId: string): Promise<string | null> {
  // Check cache first
  if (passwordCache.has(accountId)) {
    console.log('[Mail IPC] Using cached password for account:', accountId);
    return passwordCache.get(accountId)!;
  }

  // Try to decrypt from vault
  const account = getAccountById(accountId);
  if (!account || !account.credential_id) {
    console.log('[Mail IPC] No credential_id for account:', accountId);
    return null;
  }

  const activeSession = getActiveSession?.();
  if (!activeSession || !activeSession.masterPassword) {
    console.log('[Mail IPC] No active session with master password');
    return null;
  }

  const db = getDb?.();
  if (!db) {
    console.log('[Mail IPC] Database not available');
    return null;
  }

  try {
    const credential: any = db.prepare('SELECT * FROM credentials WHERE id = ?').get(account.credential_id);
    if (!credential) {
      console.log('[Mail IPC] Credential not found in vault');
      return null;
    }

    const encryptionKey = deriveEncryptionKey(activeSession.masterPassword, activeSession.salt);
    const password = decryptPassword(credential.password, encryptionKey);

    // Cache the decrypted password
    passwordCache.set(accountId, password);
    console.log('[Mail IPC] Password decrypted and cached for account:', accountId);

    return password;
  } catch (error) {
    console.error('[Mail IPC] Error decrypting password:', error);
    return null;
  }
}

/**
 * Background sync: Only fetch NEW emails (delta sync)
 * This makes syncing super fast - only gets emails we don't have!
 */
async function syncNewEmails(accountId: string, folder: string, limit: number = 50) {
  try {
    console.log(`[Mail IPC] Background sync: Checking for new emails in ${folder}...`);

    const account = getAccountById(accountId);
    if (!account) return;

    // Get password from vault
    const activeSession = getActiveSession?.();
    if (!activeSession || !activeSession.masterPassword) return;

    const db = getDb?.();
    if (!db) return;

    const credential: any = db.prepare('SELECT * FROM credentials WHERE id = ?').get(account.credential_id);
    if (!credential) return;

    const encryptionKey = deriveEncryptionKey(activeSession.masterPassword, activeSession.salt);
    const accountPassword = decryptPassword(credential.password, encryptionKey);

    const imapConfig = {
      host: account.imap_host,
      port: account.imap_port,
      secure: account.imap_secure === 1,
      auth: {
        user: account.email,
        pass: accountPassword,
      },
    };

    // Connect and fetch only new emails
    const client = await connectIMAP(accountId, imapConfig);
    const newEmails = await fetchEmails(accountId, client, folder, limit);

    // Update memory cache with fresh data (keep UI in sync!)
    if (newEmails && newEmails.length > 0) {
      mailCache.updateCache(accountId, folder, newEmails);
      console.log(`[Mail IPC] ⚡ Memory cache updated with ${newEmails.length} emails`);
    }

    console.log(`[Mail IPC] Background sync complete for ${folder}`);
  } catch (error: any) {
    console.error('[Mail IPC] Background sync error:', error);
  }
}

/**
 * Build raw email message in RFC 822 format for saving to Sent folder
 */
function buildRawMessage(email: any): string {
  const lines: string[] = [];
  const date = new Date().toUTCString();

  // Headers
  lines.push(`From: ${email.from}`);
  lines.push(`To: ${Array.isArray(email.to) ? email.to.join(', ') : email.to}`);

  if (email.cc && email.cc.length > 0) {
    lines.push(`Cc: ${Array.isArray(email.cc) ? email.cc.join(', ') : email.cc}`);
  }

  lines.push(`Subject: ${email.subject || '(no subject)'}`);
  lines.push(`Date: ${date}`);
  lines.push(`Message-ID: <${crypto.randomUUID()}@sent-mail>`);

  if (email.inReplyTo) {
    lines.push(`In-Reply-To: ${email.inReplyTo}`);
  }

  if (email.references && Array.isArray(email.references) && email.references.length > 0) {
    lines.push(`References: ${email.references.join(' ')}`);
  }

  lines.push(`MIME-Version: 1.0`);

  // Body
  if (email.html) {
    lines.push(`Content-Type: text/html; charset=utf-8`);
    lines.push(`Content-Transfer-Encoding: quoted-printable`);
    lines.push('');
    lines.push(email.html);
  } else {
    lines.push(`Content-Type: text/plain; charset=utf-8`);
    lines.push(`Content-Transfer-Encoding: quoted-printable`);
    lines.push('');
    lines.push(email.text || '');
  }

  return lines.join('\r\n');
}

/**
 * Initialize all mail IPC handlers
 */
export function initMailIPC(sessionGetter: () => any, dbGetter: () => any) {
  console.log('[Mail IPC] Initializing handlers...');

  // Store the getters
  getActiveSession = sessionGetter;
  getDb = dbGetter;

  // Initialize database
  initMailDatabase();

  // ===== ACCOUNT MANAGEMENT =====

  /**
   * Get all mail accounts
   */
  ipcMain.handle('mail:getAccounts', async () => {
    try {
      const accounts = getAllAccounts();
      return { success: true, data: accounts };
    } catch (error: any) {
      console.error('[Mail IPC] Get accounts error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Add new mail account
   */
  ipcMain.handle('mail:addAccount', async (event, { account, password }) => {
    try {
      // Ensure user is logged in
      const activeSession = getActiveSession?.();
      if (!activeSession) {
        return { success: false, error: 'Not authenticated. Please log in first.' };
      }

      // Generate account ID
      const accountId = crypto.randomUUID();

      // Test IMAP connection first
      const imapConfig = {
        host: account.imapHost,
        port: account.imapPort,
        secure: account.imapSecure,
        auth: {
          user: account.email,
          pass: password,
        },
      };

      await testIMAPConnection(imapConfig);

      // Test SMTP connection
      const smtpConfig = {
        host: account.smtpHost,
        port: account.smtpPort,
        secure: account.smtpSecure,
        auth: {
          user: account.email,
          pass: password,
        },
      };

      await testSMTPConnection(smtpConfig);

      // Store password encrypted in vault
      console.log('[Mail IPC] Storing mail account password in vault...');
      const db = getDb?.();
      if (!db) {
        throw new Error('Database not available');
      }

      // Create or get "EsMails Crds" category
      let esMailsCategory = db.prepare(`
        SELECT id FROM categories WHERE user_id = ? AND name = 'EsMails Crds'
      `).get(activeSession.userId) as { id: number } | undefined;

      if (!esMailsCategory) {
        // Create the category if it doesn't exist
        const categoryResult = db.prepare(`
          INSERT INTO categories (user_id, name, color)
          VALUES (?, 'EsMails Crds', '#10b981')
        `).run(activeSession.userId);

        esMailsCategory = { id: categoryResult.lastInsertRowid as number };
        console.log('[Mail IPC] Created "EsMails Crds" category with ID:', esMailsCategory.id);
      }

      // Create credential entry for mail account password
      const encryptionKey = deriveEncryptionKey(activeSession.masterPassword, activeSession.salt);
      const encryptedPassword = encryptPassword(password, encryptionKey);
      const encryptedEmail = encryptPassword(account.email, encryptionKey);

      const credResult = db.prepare(`
        INSERT INTO credentials (user_id, category_id, title, site_link, username, password, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        activeSession.userId,
        esMailsCategory.id,
        `Mail Account: ${account.name}`,
        `mail://${account.imapHost}`,
        encryptedEmail,
        encryptedPassword,
        'Auto-stored password for email account'
      );

      const credentialId = credResult.lastInsertRowid;
      console.log('[Mail IPC] Password stored in vault with ID:', credentialId);

      // Cache the password in memory for instant access
      passwordCache.set(accountId, password);
      console.log('[Mail IPC] Password cached for instant mail sync');

      // Save account with credential reference
      const newAccount = {
        id: accountId,
        name: account.name,
        email: account.email,
        imapHost: account.imapHost,
        imapPort: account.imapPort,
        imapSecure: account.imapSecure,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        smtpSecure: account.smtpSecure,
        credentialId: credentialId,
      };

      addAccount(newAccount);

      // Connect and sync folders
      const imapClient = await connectIMAP(accountId, imapConfig);
      const folders = await syncFolders(accountId, imapClient);

      // Create SMTP transporter
      createSMTPTransporter(accountId, smtpConfig);

      console.log(`[Mail IPC] Account added: ${account.email}`);
      console.log(`[Mail IPC] ✅ IMAP connection ready for IDLE push notifications`);

      return { success: true, data: { account: newAccount, folders } };
    } catch (error: any) {
      console.error('[Mail IPC] Add account error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete mail account
   */
  ipcMain.handle('mail:deleteAccount', async (event, { accountId }) => {
    try {
      await disconnectIMAP(accountId);
      deleteAccount(accountId);
      console.log(`[Mail IPC] Account deleted: ${accountId}`);
      return { success: true };
    } catch (error: any) {
      console.error('[Mail IPC] Delete account error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Test connection before adding account
   */
  ipcMain.handle('mail:testConnection', async (event, { account, password }) => {
    try {
      // Test IMAP
      const imapConfig = {
        host: account.imapHost,
        port: account.imapPort,
        secure: account.imapSecure,
        auth: {
          user: account.email,
          pass: password,
        },
      };

      await testIMAPConnection(imapConfig);

      // Test SMTP
      const smtpConfig = {
        host: account.smtpHost,
        port: account.smtpPort,
        secure: account.smtpSecure,
        auth: {
          user: account.email,
          pass: password,
        },
      };

      await testSMTPConnection(smtpConfig);

      return { success: true, message: 'Connection successful' };
    } catch (error: any) {
      console.error('[Mail IPC] Test connection error:', error);
      return { success: false, error: error.message };
    }
  });

  // ===== FOLDER MANAGEMENT =====

  /**
   * Get folders for account
   */
  ipcMain.handle('mail:getFolders', async (event, { accountId }) => {
    try {
      const folders = getFoldersByAccount(accountId);
      return { success: true, data: folders };
    } catch (error: any) {
      console.error('[Mail IPC] Get folders error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Sync folders from server
   */
  ipcMain.handle('mail:syncFolders', async (event, { accountId, password }) => {
    try {
      const account = getAccountById(accountId);
      if (!account) {
        throw new Error('Account not found');
      }

      // Get password from cache or vault
      let accountPassword = password;
      if (!accountPassword) {
        accountPassword = await getAccountPassword(accountId);
        if (!accountPassword) {
          throw new Error('Password not available. Please re-add your mail account or restart the app after logging in.');
        }
      }

      const imapConfig = {
        host: account.imap_host,
        port: account.imap_port,
        secure: account.imap_secure === 1,
        auth: {
          user: account.email,
          pass: accountPassword,
        },
      };

      const client = await connectIMAP(accountId, imapConfig);
      const folders = await syncFolders(accountId, client);

      return { success: true, data: folders };
    } catch (error: any) {
      console.error('[Mail IPC] Sync folders error:', error);
      return { success: false, error: error.message };
    }
  });

  // ===== EMAIL OPERATIONS =====

  /**
   * Get emails from folder - SUPERHUMAN SPEED with Memory Cache
   */
  ipcMain.handle('mail:getEmails', async (event, { accountId, folder, password, limit = 50 }) => {
    try {
      // STEP 1: Check memory cache first (INSTANT - 0ms response!)
      const memCached = mailCache.getEmails(accountId, folder);
      if (memCached && memCached.length > 0) {
        console.log(`[Mail IPC] ⚡ INSTANT from memory cache: ${memCached.length} emails (0ms)`);

        // Start background sync for new emails (non-blocking)
        setImmediate(async () => {
          try {
            await syncNewEmails(accountId, folder, limit);
          } catch (error) {
            console.error('[Mail IPC] Background sync error:', error);
          }
        });

        return { success: true, data: memCached, cached: true, source: 'memory', syncing: true };
      }

      // STEP 2: Check database cache (Fast - ~5-10ms)
      const cachedEmails = getEmailsByFolder(accountId, folder, limit);
      const hasCache = cachedEmails.length > 0;

      if (hasCache) {
        console.log(`[Mail IPC] Fast from database: ${cachedEmails.length} emails (~10ms)`);

        // Parse and return cached emails
        const emails = cachedEmails.map((email: any) => {
          // Load attachments if email has them
          const attachments = email.has_attachments === 1 ? getAttachmentsByEmail(email.id) : [];

          return {
            ...email,
            from: JSON.parse(email.from_addresses || '[]'),
            to: JSON.parse(email.to_addresses || '[]'),
            cc: JSON.parse(email.cc_addresses || '[]'),
            bcc: JSON.parse(email.bcc_addresses || '[]'),
            replyTo: JSON.parse(email.reply_to_addresses || '[]'),
            emailReferences: JSON.parse(email.email_references || '[]'),
            labels: JSON.parse(email.labels || '[]'),
            isRead: email.is_read === 1,
            isFlagged: email.is_flagged === 1,
            isAnswered: email.is_answered === 1,
            isDraft: email.is_draft === 1,
            hasAttachments: email.has_attachments === 1,
            attachments: attachments.map((att: any) => ({
              filename: att.filename,
              contentType: att.content_type,
              size: att.size,
              contentId: att.content_id,
              isInline: att.is_inline === 1,
              content: att.content, // base64 encoded
            })),
            isSuspicious: email.is_suspicious === 1,
            securityScore: email.security_score,
            securityRating: email.security_rating,
            securityIssues: email.security_issues,
            securitySummary: email.security_summary,
            textBody: email.text_body,
            htmlBody: email.html_body,
          };
        });

        // Update memory cache for next time (instant loading!)
        mailCache.updateCache(accountId, folder, emails);

        // Start background sync for new emails
        setImmediate(async () => {
          try {
            await syncNewEmails(accountId, folder, limit);
          } catch (error) {
            console.error('[Mail IPC] Background sync error:', error);
          }
        });

        return { success: true, data: emails, cached: true, source: 'database', syncing: true };
      }

      // STEP 3: Fetch from server (first time only)
      const account = getAccountById(accountId);
      if (!account) {
        throw new Error('Account not found');
      }

      // Get password from cache or vault
      let accountPassword = password;
      if (!accountPassword) {
        accountPassword = await getAccountPassword(accountId);
        if (!accountPassword) {
          throw new Error('Password not available. Please re-add your mail account or restart the app after logging in.');
        }
      }

      const imapConfig = {
        host: account.imap_host,
        port: account.imap_port,
        secure: account.imap_secure === 1,
        auth: {
          user: account.email,
          pass: accountPassword,
        },
      };

      console.log(`[Mail IPC] First fetch from server for ${account.email}`);
      const client = await connectIMAP(accountId, imapConfig);
      const emails = await fetchEmails(accountId, client, folder, limit);

      // Load into memory cache
      mailCache.updateCache(accountId, folder, emails);

      return { success: true, data: emails, cached: false, source: 'server' };
    } catch (error: any) {
      console.error('[Mail IPC] Get emails error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get emails from folder - FRESH FETCH (bypass all caches)
   * Used for IMAP IDLE push notifications to guarantee fresh data
   */
  ipcMain.handle('mail:getEmailsFresh', async (event, { accountId, folder, password, limit = 50 }) => {
    try {
      console.log(`[Mail IPC] 🔥 FRESH FETCH requested for ${folder} (bypassing all caches)`);

      // CRITICAL: Clear memory cache to guarantee fresh data
      mailCache.clearFolder(accountId, folder);
      console.log('[Mail IPC] ✅ Memory cache cleared');

      // Get account
      const account = getAccountById(accountId);
      if (!account) {
        throw new Error('Account not found');
      }

      // Get password from cache or vault
      let accountPassword = password;
      if (!accountPassword) {
        accountPassword = await getAccountPassword(accountId);
        if (!accountPassword) {
          throw new Error('Password not available. Please re-add your mail account or restart the app after logging in.');
        }
      }

      const imapConfig = {
        host: account.imap_host,
        port: account.imap_port,
        secure: account.imap_secure === 1,
        auth: {
          user: account.email,
          pass: accountPassword,
        },
      };

      // Force fresh fetch from IMAP server
      console.log(`[Mail IPC] 📡 Fetching fresh emails from server for ${account.email}`);
      const client = await connectIMAP(accountId, imapConfig);
      const emails = await fetchEmails(accountId, client, folder, limit);

      // Update memory cache with fresh data
      mailCache.updateCache(accountId, folder, emails);
      console.log(`[Mail IPC] ✅ Fresh emails loaded and cached: ${emails.length} emails`);

      return { success: true, data: emails, cached: false, source: 'server', fresh: true };
    } catch (error: any) {
      console.error('[Mail IPC] Fresh fetch error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get single email by ID
   */
  ipcMain.handle('mail:getEmail', async (event, { emailId }) => {
    try {
      const email = getEmailById(emailId);
      if (!email) {
        throw new Error('Email not found');
      }

      // Parse JSON fields
      const parsedEmail = {
        ...email,
        from: JSON.parse(email.from_addresses || '[]'),
        to: JSON.parse(email.to_addresses || '[]'),
        cc: JSON.parse(email.cc_addresses || '[]'),
        bcc: JSON.parse(email.bcc_addresses || '[]'),
        replyTo: JSON.parse(email.reply_to_addresses || '[]'),
        emailReferences: JSON.parse(email.email_references || '[]'),
        labels: JSON.parse(email.labels || '[]'),
        isRead: email.is_read === 1,
        isFlagged: email.is_flagged === 1,
        isAnswered: email.is_answered === 1,
        isDraft: email.is_draft === 1,
        hasAttachments: email.has_attachments === 1,
      };

      // Get attachments
      const attachments = getAttachmentsByEmail(emailId);
      parsedEmail.attachments = attachments;

      return { success: true, data: parsedEmail };
    } catch (error: any) {
      console.error('[Mail IPC] Get email error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Fetch email body on-demand (Thunderbird-level optimization!)
   * Only called when user clicks to view an email
   */
  ipcMain.handle('mail:fetchEmailBody', async (event, { accountId, emailId, password }) => {
    try {
      console.log(`[Mail IPC] 📖 Fetching email body on-demand for ${emailId}`);

      // Check if body is already loaded in cache
      const cached = mailCache.getEmail(emailId);
      if (cached && cached.bodyLoaded) {
        console.log(`[Mail IPC] ⚡ Body already in cache!`);
        return {
          success: true,
          data: {
            textBody: cached.textBody,
            htmlBody: cached.htmlBody,
            attachments: [],
            isSuspicious: cached.isSuspicious,
            securityScore: cached.securityScore,
            securityRating: cached.securityRating,
          },
          cached: true,
        };
      }

      // Try to get email from memory cache first (may not have body yet)
      let email = cached;

      // If not in memory cache, try database
      if (!email) {
        const dbEmail = getEmailById(emailId);
        if (dbEmail) {
          email = {
            id: dbEmail.id,
            uid: dbEmail.uid,
            messageId: dbEmail.message_id,
            accountId: dbEmail.account_id,
            folder: dbEmail.folder,
          };
        }
      }

      if (!email) {
        throw new Error('Email not found in cache or database');
      }

      // Get account
      const account = getAccountById(accountId);
      if (!account) {
        throw new Error('Account not found');
      }

      // Get password from vault if not provided
      let accountPassword = password;
      if (!accountPassword && account.credential_id) {
        const session = getActiveSession?.();
        if (!session?.masterPassword || !session?.salt) {
          throw new Error('No active session. Please login first.');
        }

        const db = getDb?.();
        if (!db) {
          throw new Error('Database not available');
        }

        const credential: any = db.prepare('SELECT * FROM credentials WHERE id = ?').get(account.credential_id);
        if (!credential) {
          throw new Error('Credential not found in vault');
        }

        const encryptionKey = deriveEncryptionKey(session.masterPassword, session.salt);
        accountPassword = decryptPassword(credential.password, encryptionKey);
      }

      if (!accountPassword) {
        throw new Error('Password required');
      }

      // Connect to IMAP
      const client = await connectIMAP(accountId, {
        host: account.imap_host,
        port: account.imap_port,
        secure: account.imap_secure === 1,
        auth: {
          user: account.email,
          pass: accountPassword,
        },
      });

      // Fetch email body
      const bodyData = await fetchEmailBody(accountId, client, email.folder, email.uid, emailId);

      // Update database
      updateEmailBody(
        emailId,
        bodyData.textBody,
        bodyData.htmlBody,
        bodyData.securityReport?.isSuspicious || false,
        bodyData.securityReport?.score || null,
        bodyData.securityReport?.rating || null,
        bodyData.securityReport ? JSON.stringify(bodyData.securityReport.issues) : null,
        bodyData.securityReport?.summary || null
      );

      // Update memory cache
      mailCache.updateEmailBody(emailId, bodyData.textBody, bodyData.htmlBody);

      console.log(`[Mail IPC] ✅ Email body loaded and cached`);

      return {
        success: true,
        data: {
          textBody: bodyData.textBody,
          htmlBody: bodyData.htmlBody,
          attachments: bodyData.attachments,
          isSuspicious: bodyData.securityReport?.isSuspicious || false,
          securityScore: bodyData.securityReport?.score || null,
          securityRating: bodyData.securityReport?.rating || null,
          securityIssues: bodyData.securityReport?.issues || [],
          securitySummary: bodyData.securityReport?.summary || null,
        },
        cached: false,
      };
    } catch (error: any) {
      console.error('[Mail IPC] Fetch email body error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Send email
   */
  ipcMain.handle('mail:sendEmail', async (event, { accountId, draft, password }) => {
    try {
      const account = getAccountById(accountId);
      if (!account) {
        throw new Error('Account not found');
      }

      // Get password from vault if not provided
      let accountPassword = password;
      if (!accountPassword && account.credential_id) {
        console.log('[Mail IPC] Retrieving password from vault for sending...');
        const activeSession = getActiveSession?.();
        if (!activeSession || !activeSession.masterPassword) {
          throw new Error('No password configured. Please enter your master password first.');
        }

        const db = getDb?.();
        if (!db) {
          throw new Error('Database not available');
        }

        const credential: any = db.prepare('SELECT * FROM credentials WHERE id = ?').get(account.credential_id);

        if (credential) {
          const encryptionKey = deriveEncryptionKey(activeSession.masterPassword, activeSession.salt);
          accountPassword = decryptPassword(credential.password, encryptionKey);
          console.log('[Mail IPC] Password retrieved from vault for sending');
        } else {
          throw new Error('Mail account password not found in vault');
        }
      }

      if (!accountPassword) {
        throw new Error('No password configured');
      }

      const smtpConfig = {
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_secure === 1,
        auth: {
          user: account.email,
          pass: accountPassword,
        },
      };

      const transporter = createSMTPTransporter(accountId, smtpConfig);

      const emailToSend = {
        from: account.email,
        to: draft.to.map((addr: any) => addr.address || addr),
        cc: draft.cc?.map((addr: any) => addr.address || addr),
        bcc: draft.bcc?.map((addr: any) => addr.address || addr),
        subject: draft.subject,
        text: draft.textBody,
        html: draft.htmlBody,
        inReplyTo: draft.inReplyTo,
        references: draft.references,
        attachments: draft.attachments,
      };

      const result = await sendEmailWithRetry(accountId, transporter, emailToSend);

      console.log(`[Mail IPC] Email sent from ${account.email}`);

      // Save sent message to Sent folder via IMAP
      try {
        console.log('[Mail IPC] Saving sent message to Sent folder...');

        // Build raw email message
        const rawMessage = buildRawMessage(emailToSend);

        // Get or create IMAP connection
        const imapConfig = {
          host: account.imap_host,
          port: account.imap_port,
          secure: account.imap_secure === 1,
          auth: {
            user: account.email,
            pass: accountPassword,
          },
        };

        let imapClient = getIMAPConnection(accountId);
        if (!imapClient) {
          imapClient = await connectIMAP(accountId, imapConfig);
        }

        // Append to Sent folder (try different common names)
        const sentFolderNames = ['Sent', 'INBOX.Sent', 'Sent Messages', 'Sent Items'];
        let savedToSent = false;

        for (const folderName of sentFolderNames) {
          try {
            await appendMessage(imapClient, folderName, rawMessage, ['\\Seen']);
            console.log(`[Mail IPC] Sent message saved to ${folderName}`);
            savedToSent = true;
            break;
          } catch (error: any) {
            console.log(`[Mail IPC] Could not save to ${folderName}, trying next...`);
          }
        }

        if (!savedToSent) {
          console.warn('[Mail IPC] Could not save sent message to Sent folder');
        }
      } catch (error: any) {
        console.error('[Mail IPC] Error saving sent message:', error);
        // Don't fail the whole send operation if saving to Sent fails
      }

      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Mail IPC] Send email error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Mark email as read/unread - Instant with Memory Cache
   */
  ipcMain.handle('mail:markAsRead', async (event, { accountId, emailId, isRead, password }) => {
    try {
      const email = getEmailById(emailId);
      if (!email) {
        throw new Error('Email not found');
      }

      // Update in memory cache FIRST (instant UI update!)
      mailCache.markAsRead(emailId, isRead);

      // Update in database (background)
      markEmailAsRead(emailId, isRead);

      // Update on server (background, non-blocking)
      setImmediate(async () => {
        try {
          const account = getAccountById(accountId);
          if (account) {
            const client = getIMAPConnection(accountId);
            if (client) {
              await markAsRead(client, email.folder, email.uid, isRead);
            }
          }
        } catch (error) {
          console.error('[Mail IPC] Background mark as read error:', error);
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('[Mail IPC] Mark as read error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete email - Instant with Memory Cache
   */
  ipcMain.handle('mail:deleteEmail', async (event, { accountId, emailId, password }) => {
    try {
      const email = getEmailById(emailId);
      if (!email) {
        throw new Error('Email not found');
      }

      // Delete from memory cache FIRST (instant UI update!)
      mailCache.deleteEmail(emailId);

      // Delete from database (background)
      dbDeleteEmail(emailId);

      // Delete on server (background, non-blocking)
      setImmediate(async () => {
        try {
          const client = getIMAPConnection(accountId);
          if (client) {
            await deleteMessage(client, email.folder, email.uid, false);
          }
        } catch (error) {
          console.error('[Mail IPC] Background delete error:', error);
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('[Mail IPC] Delete email error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Open attachment
   */
  ipcMain.handle('mail:openAttachment', async (event, { attachmentPath }) => {
    try {
      await openAttachment(attachmentPath);
      return { success: true };
    } catch (error: any) {
      console.error('[Mail IPC] Open attachment error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Start IMAP IDLE for instant push notifications
   */
  ipcMain.handle('mail:startIdle', async (event, { accountId, folder }) => {
    try {
      console.log(`[Mail IPC] Starting IDLE for ${accountId} on ${folder}...`);

      // Callback to notify renderer when new mail arrives
      const onNewMail = () => {
        console.log('[Mail IPC] 📬 IDLE detected new mail! Clearing cache and notifying windows...');

        // CRITICAL: Clear memory cache so frontend gets FRESH data from server
        mailCache.clearFolder(accountId, folder);
        console.log('[Mail IPC] ✅ Cache cleared for', folder, '- next fetch will be fresh!');

        // Send event to ALL windows (main + mail window) to refresh emails
        const allWindows = BrowserWindow.getAllWindows();
        allWindows.forEach(window => {
          if (window && !window.isDestroyed()) {
            window.webContents.send('mail:newMail', { accountId, folder, fresh: true });
          }
        });
      };

      await startIdle(accountId, folder, onNewMail);
      return { success: true };
    } catch (error: any) {
      console.error('[Mail IPC] Start IDLE error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Stop IMAP IDLE
   */
  ipcMain.handle('mail:stopIdle', async (event, { accountId }) => {
    try {
      await stopIdle(accountId);
      return { success: true };
    } catch (error: any) {
      console.error('[Mail IPC] Stop IDLE error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Check Email Reputation - GLOBAL reputation check
   * Checks domain/IP against multiple blacklists, DNS configuration, etc.
   */
  ipcMain.handle('mail:checkReputation', async (event, { accountId }) => {
    try {
      console.log(`[Mail IPC] Checking global reputation for account ${accountId}`);

      const account = getAccountById(accountId);
      if (!account) {
        throw new Error('Account not found');
      }

      // Check reputation for the account email
      const reputation = await reputationChecker.checkEmailReputation(account.email);

      // Transform data to match UI expectations
      const transformedData = {
        overallScore: reputation.deliverabilityScore,
        overallRating: reputation.status,
        domainReputation: {
          score: reputation.domain.overallScore,
          rating: reputation.domain.rating,
          dnsConfig: {
            spf: reputation.domain.spfRecord?.status === 'good',
            dkim: reputation.domain.dkimRecord?.status === 'good',
            dmarc: reputation.domain.dmarcRecord?.status === 'good',
            mx: reputation.domain.mxRecords?.status === 'good',
            ssl: reputation.domain.sslCertificate?.status === 'good'
          },
          blacklists: reputation.domain.blacklistStatus?.map((bl: any) => ({
            name: bl.name,
            listed: bl.status === 'bad'
          })) || []
        },
        ipReputation: {
          score: reputation.ip.overallScore,
          rating: reputation.ip.rating,
          reverseDns: reputation.ip.reverseDNS?.status === 'good',
          blacklists: reputation.ip.blacklistStatus?.map((bl: any) => ({
            name: bl.name,
            listed: bl.status === 'bad'
          })) || []
        },
        issues: [...(reputation.domain.issues || []), ...(reputation.ip.issues || [])],
        recommendations: [...(reputation.domain.recommendations || []), ...(reputation.ip.recommendations || [])]
      };

      console.log('[Mail IPC] Reputation check complete:', transformedData);

      return {
        success: true,
        data: transformedData
      };
    } catch (error: any) {
      console.error('[Mail IPC] Reputation check error:', error);
      return { success: false, error: error.message };
    }
  });

  // ========== SIGNATURE OPERATIONS ==========

  /**
   * Get all signatures for an account
   */
  ipcMain.handle('mail:getSignatures', async (event, { accountId }) => {
    try {
      const signatures = getSignaturesByAccount(accountId);
      return {
        success: true,
        data: signatures.map((sig: any) => ({
          id: sig.id,
          accountId: sig.account_id,
          name: sig.name,
          htmlContent: sig.html_content,
          isDefault: sig.is_default === 1,
          createdAt: sig.created_at,
          updatedAt: sig.updated_at,
        }))
      };
    } catch (error: any) {
      console.error('[Mail IPC] Get signatures error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get default signature for an account
   */
  ipcMain.handle('mail:getDefaultSignature', async (event, { accountId }) => {
    try {
      const signature = getDefaultSignature(accountId);
      if (!signature) {
        return { success: true, data: null };
      }
      return {
        success: true,
        data: {
          id: signature.id,
          accountId: signature.account_id,
          name: signature.name,
          htmlContent: signature.html_content,
          isDefault: signature.is_default === 1,
          createdAt: signature.created_at,
          updatedAt: signature.updated_at,
        }
      };
    } catch (error: any) {
      console.error('[Mail IPC] Get default signature error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Add new signature
   */
  ipcMain.handle('mail:addSignature', async (event, { accountId, name, htmlContent, isDefault }) => {
    try {
      const signatureId = crypto.randomUUID();
      dbAddSignature({
        id: signatureId,
        accountId,
        name,
        htmlContent,
        isDefault: isDefault || false,
      });

      return { success: true, data: { id: signatureId } };
    } catch (error: any) {
      console.error('[Mail IPC] Add signature error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update signature
   */
  ipcMain.handle('mail:updateSignature', async (event, { signatureId, name, htmlContent, isDefault }) => {
    try {
      dbUpdateSignature(signatureId, name, htmlContent, isDefault);
      return { success: true };
    } catch (error: any) {
      console.error('[Mail IPC] Update signature error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete signature
   */
  ipcMain.handle('mail:deleteSignature', async (event, { signatureId }) => {
    try {
      dbDeleteSignature(signatureId);
      return { success: true };
    } catch (error: any) {
      console.error('[Mail IPC] Delete signature error:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Mail IPC] Handlers initialized successfully');
}

// Export function to set mail window reference
export function setMailWindow(window: Electron.BrowserWindow | null) {
  mailWindow = window;
}
