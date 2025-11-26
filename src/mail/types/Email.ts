// Email Message Types

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId?: string; // For inline images
  isInline: boolean;
  localPath?: string; // Path to cached file
}

export interface Email {
  // Unique identifiers
  id: string; // Local database ID
  uid: number; // IMAP UID
  messageId: string; // Email Message-ID header

  // Account & Folder
  accountId: string;
  folder: string; // e.g., 'INBOX', 'Sent', 'Drafts'

  // Headers
  from: EmailAddress[];
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress[];
  subject: string;
  date: string;

  // Content
  textBody?: string; // Plain text version
  htmlBody?: string; // HTML version
  hasAttachments: boolean;
  attachments: EmailAttachment[];

  // Flags
  isRead: boolean;
  isFlagged: boolean;
  isAnswered: boolean;
  isDraft: boolean;

  // Threading
  inReplyTo?: string;
  references?: string[];
  threadId?: string;

  // Metadata
  size: number; // Size in bytes
  labels?: string[]; // For Gmail-style labels

  // Sync status
  isSynced: boolean;
  syncedAt?: string;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface EmailDraft {
  id?: string;
  accountId: string;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  textBody?: string;
  htmlBody?: string;
  attachments: EmailAttachment[];
  inReplyTo?: string; // For replies
  references?: string[]; // For threading
  savedAt?: string;
}

export interface EmailThread {
  id: string;
  subject: string;
  emails: Email[];
  participants: EmailAddress[];
  latestDate: string;
  hasUnread: boolean;
  messageCount: number;
}
