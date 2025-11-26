// Mail Folder Types

export interface MailFolder {
  id: string;
  accountId: string;
  name: string; // Display name
  path: string; // IMAP path (e.g., 'INBOX', 'Sent Items')
  specialUse?: FolderSpecialUse;

  // Counts
  totalMessages: number;
  unreadMessages: number;

  // Hierarchy
  parentPath?: string;
  hasChildren: boolean;

  // Sync
  lastSyncTime?: string;
  uidValidity?: number; // IMAP UID validity

  // UI
  icon?: string;
  color?: string;
  isExpanded?: boolean;

  createdAt: string;
  updatedAt: string;
}

export type FolderSpecialUse =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'spam'
  | 'archive'
  | 'all'
  | 'flagged';

export const DEFAULT_FOLDERS: Partial<MailFolder>[] = [
  {
    name: 'Inbox',
    path: 'INBOX',
    specialUse: 'inbox',
    icon: 'inbox',
  },
  {
    name: 'Sent',
    path: 'Sent',
    specialUse: 'sent',
    icon: 'send',
  },
  {
    name: 'Drafts',
    path: 'Drafts',
    specialUse: 'drafts',
    icon: 'file-edit',
  },
  {
    name: 'Archive',
    path: 'Archive',
    specialUse: 'archive',
    icon: 'archive',
  },
  {
    name: 'Spam',
    path: 'Spam',
    specialUse: 'spam',
    icon: 'shield-alert',
  },
  {
    name: 'Trash',
    path: 'Trash',
    specialUse: 'trash',
    icon: 'trash-2',
  },
];

// Folder path mappings for common providers
export const FOLDER_MAPPINGS: Record<string, Record<FolderSpecialUse, string[]>> = {
  gmail: {
    inbox: ['INBOX'],
    sent: ['[Gmail]/Sent Mail'],
    drafts: ['[Gmail]/Drafts'],
    trash: ['[Gmail]/Trash'],
    spam: ['[Gmail]/Spam'],
    archive: ['[Gmail]/All Mail'],
    all: ['[Gmail]/All Mail'],
    flagged: ['[Gmail]/Starred'],
  },
  outlook: {
    inbox: ['INBOX'],
    sent: ['Sent Items', 'Sent'],
    drafts: ['Drafts'],
    trash: ['Deleted Items', 'Trash'],
    spam: ['Junk Email', 'Spam'],
    archive: ['Archive'],
    all: ['All Mail'],
    flagged: ['Flagged'],
  },
  yahoo: {
    inbox: ['Inbox'],
    sent: ['Sent'],
    drafts: ['Draft'],
    trash: ['Trash'],
    spam: ['Bulk Mail'],
    archive: ['Archive'],
    all: ['All Mail'],
    flagged: ['Flagged'],
  },
};
