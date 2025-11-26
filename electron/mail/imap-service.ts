/**
 * IMAP Service
 *
 * Handles IMAP connections, email fetching, folder syncing
 * Uses imapflow for modern async IMAP operations
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import * as crypto from 'crypto';
import {
  getMailDatabase,
  addEmail,
  addFolder,
  updateAccountSyncStatus,
  addAttachment,
  getAccountById,
} from './mail-database';
import { emailSecurityScanner } from './mail-security';

// Connection pool
const connectionPool = new Map<string, ImapFlow>();

interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

/**
 * Connect to IMAP server
 */
export async function connectIMAP(accountId: string, config: ImapConfig): Promise<ImapFlow> {
  // Check if already connected
  const existing = connectionPool.get(accountId);
  if (existing && existing.usable) {
    return existing;
  }

  console.log(`[IMAP] Connecting to ${config.host}:${config.port} for account ${accountId}`);

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    logger: false, // Set to console for debugging
    // Timeout settings for better reliability
    socketTimeout: 60000, // 60 seconds for socket operations
    greetingTimeout: 30000, // 30 seconds for server greeting
    connectionTimeout: 30000, // 30 seconds for connection establishment
    // TLS options
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates (change to true in production)
      minVersion: 'TLSv1.2',
    },
  });

  try {
    await client.connect();
    console.log(`[IMAP] Connected successfully to ${config.host}`);

    // Store in pool
    connectionPool.set(accountId, client);

    // Handle connection close
    client.on('close', () => {
      console.log(`[IMAP] Connection closed for account ${accountId}`);
      connectionPool.delete(accountId);
    });

    client.on('error', (err) => {
      console.error(`[IMAP] Connection error for account ${accountId}:`, err);
      connectionPool.delete(accountId);
    });

    return client;
  } catch (error) {
    console.error(`[IMAP] Connection failed:`, error);
    throw new Error(`Failed to connect to IMAP server: ${error.message}`);
  }
}

/**
 * Disconnect from IMAP server
 */
export async function disconnectIMAP(accountId: string): Promise<void> {
  const client = connectionPool.get(accountId);
  if (client) {
    try {
      await client.logout();
      console.log(`[IMAP] Logged out from account ${accountId}`);
    } catch (error) {
      console.error(`[IMAP] Logout error:`, error);
    } finally {
      connectionPool.delete(accountId);
    }
  }
}

/**
 * Test IMAP connection
 */
export async function testIMAPConnection(config: ImapConfig): Promise<boolean> {
  console.log(`[IMAP] Testing connection to ${config.host}:${config.port} (secure: ${config.secure})`);

  const testClient = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    logger: false,
    // Extended timeout settings for test connection
    socketTimeout: 60000, // 60 seconds
    greetingTimeout: 30000, // 30 seconds
    connectionTimeout: 30000, // 30 seconds
    // TLS options
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates
      minVersion: 'TLSv1.2',
    },
  });

  try {
    console.log(`[IMAP] Attempting to connect...`);
    await testClient.connect();
    console.log(`[IMAP] Connected successfully, logging out...`);
    await testClient.logout();
    console.log(`[IMAP] Test connection successful`);
    return true;
  } catch (error: any) {
    console.error('[IMAP] Test connection failed:', error);
    console.error('[IMAP] Error details:', {
      code: error.code,
      message: error.message,
      host: config.host,
      port: config.port,
      secure: config.secure,
    });

    // Provide more specific error messages
    let errorMessage = error.message;
    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
      errorMessage = `Connection timeout to ${config.host}:${config.port}. Check firewall, network, or server availability.`;
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = `Connection refused by ${config.host}:${config.port}. Check if server is running and port is correct.`;
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = `Server ${config.host} not found. Check hostname spelling and DNS settings.`;
    } else if (error.message?.includes('certificate')) {
      errorMessage = `SSL/TLS certificate error. Server may use self-signed certificate.`;
    } else if (error.message?.includes('authentication') || error.message?.includes('auth')) {
      errorMessage = `Authentication failed. Check username and password. For 2FA accounts, use an app-specific password.`;
    }

    const enhancedError = new Error(errorMessage);
    (enhancedError as any).originalError = error;
    throw enhancedError;
  }
}

/**
 * Sync folders from IMAP server
 */
export async function syncFolders(accountId: string, client: ImapFlow): Promise<any[]> {
  console.log(`[IMAP] Syncing folders for account ${accountId}`);

  try {
    const list = await client.list();
    const folders: any[] = [];

    for (const item of list) {
      const folderId = crypto.randomUUID();

      // Get REAL unread count from server by checking mailbox status
      let totalMessages = 0;
      let unreadMessages = 0;

      try {
        // Open mailbox to get status (fast, doesn't fetch emails)
        const status = await client.status(item.path, {
          messages: true,
          unseen: true
        });

        totalMessages = status.messages || 0;
        unreadMessages = status.unseen || 0;

        console.log(`[IMAP] ${item.path}: ${unreadMessages}/${totalMessages} unread/total`);
      } catch (statusError) {
        console.warn(`[IMAP] Could not get status for ${item.path}:`, statusError);
        // Continue with 0 counts if folder status check fails
      }

      const folder = {
        id: folderId,
        accountId: accountId,
        name: item.name,
        path: item.path,
        specialUse: item.specialUse || null,
        totalMessages: totalMessages,
        unreadMessages: unreadMessages,
        hasChildren: item.listed === false,
      };

      // Save to database
      addFolder(folder);
      folders.push(folder);
    }

    console.log(`[IMAP] Synced ${folders.length} folders`);
    return folders;
  } catch (error) {
    console.error('[IMAP] Folder sync error:', error);
    throw error;
  }
}

/**
 * Fetch emails from a folder - HEADERS ONLY (Thunderbird-level speed!)
 */
export async function fetchEmails(
  accountId: string,
  client: ImapFlow,
  folderPath: string,
  limit: number = 50
): Promise<any[]> {
  console.log(`[IMAP] ⚡ Fetching emails with bodies from ${folderPath} (limit: ${limit})`);

  try {
    // Select mailbox
    const mailbox = await client.mailboxOpen(folderPath);
    console.log(`[IMAP] Opened mailbox: ${folderPath}, exists: ${mailbox.exists}`);

    if (mailbox.exists === 0) {
      console.log(`[IMAP] Mailbox is empty`);
      return [];
    }

    // Calculate range (get latest N messages)
    const start = Math.max(1, mailbox.exists - limit + 1);
    const end = mailbox.exists;
    const range = `${start}:${end}`;

    console.log(`[IMAP] Fetching messages ${range}`);

    const emails: any[] = [];

    // OPTIMIZED: Fetch headers + body parts (text/html) but NOT attachments
    // This is much faster than full source while still getting body content
    for await (const message of client.fetch(range, {
      envelope: true,
      bodyStructure: true,
      // Fetch headers + text/html body parts (no attachments yet)
      bodyParts: ['HEADER', 'TEXT', '1'],
      flags: true,
      uid: true,
      source: true, // Get full source for body parsing
    })) {
      try {
        // Generate unique ID
        const emailId = crypto.randomUUID();

        // Extract addresses - Use envelope as primary source (more reliable)
        let from = [];
        let to = [];
        let cc = [];
        let bcc = [];
        let replyTo = [];
        let subject = '(No Subject)';
        let date = new Date();
        let messageId = `${emailId}@local`;
        let inReplyTo = null;
        let references: string[] = [];

        // TRY 1: Use bodyParts if available (includes more metadata)
        if (message.bodyParts && message.bodyParts.get('HEADER')) {
          try {
            const headerSource = message.bodyParts.get('HEADER');
            const parsed = await simpleParser(headerSource as Buffer);

            from = parsed.from?.value || [];
            to = parsed.to?.value || [];
            cc = parsed.cc?.value || [];
            bcc = parsed.bcc?.value || [];
            replyTo = parsed.replyTo?.value || [];
            subject = parsed.subject || '(No Subject)';
            date = parsed.date || new Date();
            messageId = parsed.messageId || `${emailId}@local`;
            inReplyTo = parsed.inReplyTo || null;
            references = parsed.references || [];
          } catch (parseError) {
            console.warn('[IMAP] ⚠️ Failed to parse bodyParts, falling back to envelope');
          }
        }

        // TRY 2: Fallback to envelope data (always available, but less detailed)
        if (from.length === 0 && message.envelope) {
          console.log('[IMAP] Using envelope data for UID:', message.uid);

          // Convert envelope addresses to parsed format
          const convertAddress = (addr: any) => ({
            name: addr.name || '',
            address: addr.address || ''
          });

          from = message.envelope.from ? message.envelope.from.map(convertAddress) : [];
          to = message.envelope.to ? message.envelope.to.map(convertAddress) : [];
          cc = message.envelope.cc ? message.envelope.cc.map(convertAddress) : [];
          bcc = message.envelope.bcc ? message.envelope.bcc.map(convertAddress) : [];
          replyTo = message.envelope.replyTo ? message.envelope.replyTo.map(convertAddress) : [];
          subject = message.envelope.subject || '(No Subject)';
          date = message.envelope.date || new Date();
          messageId = message.envelope.messageId || `${emailId}@local`;
          inReplyTo = message.envelope.inReplyTo || null;
        }

        // Check for attachments from bodyStructure (no need to download them yet)
        let hasAttachments = false;
        if (message.bodyStructure && message.bodyStructure.childNodes) {
          hasAttachments = message.bodyStructure.childNodes.some((node: any) =>
            node.disposition === 'attachment' ||
            (node.type && !node.type.includes('text') && !node.type.includes('multipart'))
          );
        }

        // Parse email body if source is available
        let textBody = null;
        let htmlBody = null;

        if (message.source) {
          try {
            const parsed = await simpleParser(message.source);
            textBody = parsed.text || null;
            htmlBody = parsed.html || null;
          } catch (parseError) {
            console.warn('[IMAP] ⚠️ Failed to parse email body:', parseError);
          }
        }

        // Create email object with headers AND body
        const email = {
          id: emailId,
          uid: message.uid,
          messageId: messageId,
          accountId: accountId,
          folder: folderPath,

          from: from,
          to: to,
          cc: cc,
          bcc: bcc,
          replyTo: replyTo,

          subject: subject,
          date: date instanceof Date ? date.toISOString() : new Date().toISOString(),

          // Body content included now
          textBody: textBody,
          htmlBody: htmlBody,
          hasAttachments: hasAttachments,

          isRead: message.flags.has('\\Seen'),
          isFlagged: message.flags.has('\\Flagged'),
          isAnswered: message.flags.has('\\Answered'),
          isDraft: message.flags.has('\\Draft'),

          inReplyTo: inReplyTo,
          emailReferences: references,
          threadId: null,

          size: message.size || 0,
          labels: [],

          // Security scan will be done in background
          isSuspicious: false,
          securityScore: null,
          securityRating: null,
          securityIssues: null,
          securitySummary: null,
        };

        // Save to database
        addEmail(email);
        emails.push(email);
      } catch (parseError) {
        console.error('[IMAP] Error parsing message:', parseError);
        // Continue with next message
      }
    }

    console.log(`[IMAP] ✅ Fetched ${emails.length} emails with bodies`);

    // Update sync time
    updateAccountSyncStatus(accountId, new Date().toISOString());

    return emails.reverse(); // Return newest first
  } catch (error) {
    console.error('[IMAP] Fetch emails error:', error);
    throw error;
  }
}

/**
 * Fetch email body on-demand (when user clicks email)
 * This is called AFTER the headers are loaded, for instant UI
 */
export async function fetchEmailBody(
  accountId: string,
  client: ImapFlow,
  folderPath: string,
  uid: number,
  emailId: string
): Promise<{ textBody: string | null; htmlBody: string | null; attachments: any[]; securityReport: any | null }> {
  console.log(`[IMAP] 📖 Loading email body on-demand for UID ${uid}`);

  try {
    // Open mailbox
    await client.mailboxOpen(folderPath);

    // Fetch FULL message body
    const messages = client.fetch(`${uid}`, {
      uid: true,
      source: true, // Now we fetch the full source
    });

    let result: any = null;

    for await (const message of messages) {
      // Parse full email
      const parsed = await simpleParser(message.source);

      // Process attachments
      const attachments: any[] = [];
      if (parsed.attachments) {
        for (const att of parsed.attachments) {
          const attachmentId = crypto.randomUUID();
          const attachment = {
            id: attachmentId,
            emailId: emailId,
            filename: att.filename || 'unnamed',
            contentType: att.contentType || 'application/octet-stream',
            size: att.size || 0,
            contentId: att.contentId || null,
            isInline: att.contentDisposition === 'inline',
            localPath: null,
          };

          addAttachment(attachment);
          attachments.push(attachment);
        }
      }

      // Run security scan now that we have the body
      let securityReport = null;
      try {
        const from = parsed.from?.value || [];
        securityReport = await emailSecurityScanner.scanEmail({
          from: from,
          subject: parsed.subject || '(No Subject)',
          headers: parsed.headers as any,
          html: parsed.html,
          text: parsed.text,
          attachments: attachments.map(att => ({
            filename: att.filename,
            contentType: att.contentType
          }))
        });

        // Log suspicious emails
        if (securityReport.isSuspicious) {
          console.log(`[IMAP] ⚠️ SUSPICIOUS EMAIL DETECTED:`);
          console.log(`  Subject: ${parsed.subject}`);
          console.log(`  From: ${from.map((f: any) => f.address).join(', ')}`);
          console.log(`  Score: ${securityReport.score}/10 (${securityReport.rating})`);
          console.log(`  Issues: ${securityReport.issues.length}`);
        }
      } catch (scanError) {
        console.error('[IMAP] Security scan error:', scanError);
      }

      result = {
        textBody: parsed.text || null,
        htmlBody: parsed.html || null,
        attachments: attachments,
        securityReport: securityReport,
      };
    }

    console.log(`[IMAP] ✅ Email body loaded successfully`);
    return result;
  } catch (error) {
    console.error('[IMAP] Fetch email body error:', error);
    throw error;
  }
}

/**
 * Mark message as read/unread
 */
export async function markAsRead(
  client: ImapFlow,
  folderPath: string,
  uid: number,
  isRead: boolean
): Promise<void> {
  try {
    await client.mailboxOpen(folderPath);

    if (isRead) {
      await client.messageFlagsAdd({ uid }, ['\\Seen']);
    } else {
      await client.messageFlagsRemove({ uid }, ['\\Seen']);
    }

    console.log(`[IMAP] Marked UID ${uid} as ${isRead ? 'read' : 'unread'}`);
  } catch (error) {
    console.error('[IMAP] Mark as read error:', error);
    throw error;
  }
}

/**
 * Mark message as flagged/unflagged
 */
export async function markAsFlagged(
  client: ImapFlow,
  folderPath: string,
  uid: number,
  isFlagged: boolean
): Promise<void> {
  try {
    await client.mailboxOpen(folderPath);

    if (isFlagged) {
      await client.messageFlagsAdd({ uid }, ['\\Flagged']);
    } else {
      await client.messageFlagsRemove({ uid }, ['\\Flagged']);
    }

    console.log(`[IMAP] Marked UID ${uid} as ${isFlagged ? 'flagged' : 'unflagged'}`);
  } catch (error) {
    console.error('[IMAP] Mark as flagged error:', error);
    throw error;
  }
}

/**
 * Move message to another folder
 */
export async function moveMessage(
  client: ImapFlow,
  fromFolder: string,
  toFolder: string,
  uid: number
): Promise<void> {
  try {
    await client.mailboxOpen(fromFolder);
    await client.messageMove({ uid }, toFolder);
    console.log(`[IMAP] Moved UID ${uid} from ${fromFolder} to ${toFolder}`);
  } catch (error) {
    console.error('[IMAP] Move message error:', error);
    throw error;
  }
}

/**
 * Delete message (move to trash or permanently delete)
 */
export async function deleteMessage(
  client: ImapFlow,
  folderPath: string,
  uid: number,
  permanent: boolean = false
): Promise<void> {
  try {
    await client.mailboxOpen(folderPath);

    if (permanent) {
      await client.messageFlagsAdd({ uid }, ['\\Deleted']);
      await client.expunge();
      console.log(`[IMAP] Permanently deleted UID ${uid}`);
    } else {
      // Move to Trash
      await client.messageMove({ uid }, 'Trash');
      console.log(`[IMAP] Moved UID ${uid} to Trash`);
    }
  } catch (error) {
    console.error('[IMAP] Delete message error:', error);
    throw error;
  }
}

/**
 * Append message to folder (e.g., save sent message to Sent folder)
 */
export async function appendMessage(
  client: ImapFlow,
  folder: string,
  rawMessage: string,
  flags: string[] = ['\\Seen']
): Promise<void> {
  try {
    console.log(`[IMAP] Appending message to ${folder}`);

    await client.append(folder, rawMessage, flags);

    console.log(`[IMAP] Message appended to ${folder} successfully`);
  } catch (error) {
    console.error(`[IMAP] Append message to ${folder} error:`, error);
    throw error;
  }
}

/**
 * Get connection for account
 */
export function getIMAPConnection(accountId: string): ImapFlow | null {
  return connectionPool.get(accountId) || null;
}

/**
 * Close all IMAP connections
 */
export async function closeAllConnections(): Promise<void> {
  console.log('[IMAP] Closing all connections...');
  const promises: Promise<void>[] = [];

  for (const [accountId, client] of connectionPool.entries()) {
    promises.push(disconnectIMAP(accountId));
  }

  await Promise.all(promises);
  console.log('[IMAP] All connections closed');
}

// IMAP IDLE listeners (for push notifications)
const idleListeners = new Map<string, { folder: string; listening: boolean; callback: () => void }>();

/**
 * Start IMAP IDLE for instant push notifications (like Thunderbird!)
 * This monitors a folder and triggers callback when new emails arrive
 */
export async function startIdle(
  accountId: string,
  folder: string = 'INBOX',
  onNewMail: () => void
): Promise<void> {
  try {
    const client = connectionPool.get(accountId);
    if (!client || !client.usable) {
      console.log(`[IMAP IDLE] No active connection for ${accountId}`);
      return;
    }

    // Stop existing IDLE if any
    await stopIdle(accountId);

    console.log(`[IMAP IDLE] Starting IDLE on ${folder} for instant notifications...`);

    // Open mailbox in IDLE mode
    await client.mailboxOpen(folder);

    // Set up event listener for new mail (EXISTS event only - prevents duplicates!)
    const existsHandler = async (data: any) => {
      console.log(`[IMAP IDLE] 📬 NEW MAIL! Count changed: ${data.count} emails in ${folder}`);

      // Trigger callback to refresh UI (ONCE per new mail)
      const listener = idleListeners.get(accountId);
      if (listener && listener.callback) {
        console.log(`[IMAP IDLE] Triggering notification callback...`);
        listener.callback();
      }
    };

    // ONLY listen to 'exists' event (NOT flags!) to prevent duplicate notifications
    // EXISTS = new mail arrived
    // FLAGS = mail marked as read/starred (we don't want notifications for this)
    client.on('exists', existsHandler);

    // Store listener info FIRST with callback
    idleListeners.set(accountId, { folder, listening: true, callback: onNewMail });

    // Start IDLE mode - this needs to run in background
    // ImapFlow automatically maintains IDLE connection and sends NOOP to keep alive
    client.idle().catch(err => {
      console.log(`[IMAP IDLE] IDLE ended for ${accountId}: ${err.message}`);
      // Auto-restart IDLE after brief delay
      setTimeout(() => {
        const listener = idleListeners.get(accountId);
        if (listener && listener.listening) {
          console.log(`[IMAP IDLE] Restarting IDLE for ${accountId}...`);
          startIdle(accountId, folder, listener.callback);
        }
      }, 5000);
    });

    console.log(`[IMAP IDLE] ✅ IDLE mode active on ${folder} - you'll get INSTANT notifications!`);

  } catch (error) {
    console.error('[IMAP IDLE] Error starting IDLE:', error);
  }
}

/**
 * Stop IMAP IDLE
 */
export async function stopIdle(accountId: string): Promise<void> {
  try {
    const listener = idleListeners.get(accountId);
    if (!listener) return;

    console.log(`[IMAP IDLE] Stopping IDLE for ${accountId}...`);

    const client = connectionPool.get(accountId);
    if (client && client.usable) {
      // Remove event listener
      client.removeAllListeners('exists');

      // ImapFlow automatically handles stopping IDLE when you call other commands
      // Just close the mailbox
      await client.mailboxClose();
    }

    idleListeners.delete(accountId);
    console.log(`[IMAP IDLE] IDLE stopped for ${accountId}`);
  } catch (error) {
    console.error('[IMAP IDLE] Error stopping IDLE:', error);
  }
}
