// Mail Module Types - Centralized Export

export * from './MailAccount';
export * from './Email';
export * from './Folder';

// IPC Event Types
export interface MailIPCEvents {
  // Account Management
  'mail:addAccount': { account: any; password: string };
  'mail:getAccounts': void;
  'mail:deleteAccount': { accountId: string };
  'mail:testConnection': { account: any; password: string };

  // Folder Management
  'mail:getFolders': { accountId: string };
  'mail:syncFolders': { accountId: string };

  // Email Operations
  'mail:getEmails': { accountId: string; folder: string; limit?: number; offset?: number };
  'mail:getEmail': { accountId: string; emailId: string };
  'mail:sendEmail': { accountId: string; draft: any };
  'mail:saveDraft': { accountId: string; draft: any };
  'mail:moveEmail': { accountId: string; emailId: string; toFolder: string };
  'mail:deleteEmail': { accountId: string; emailId: string };
  'mail:markAsRead': { accountId: string; emailIds: string[]; isRead: boolean };
  'mail:markAsFlagged': { accountId: string; emailIds: string[]; isFlagged: boolean };

  // Attachment Operations
  'mail:downloadAttachment': { accountId: string; emailId: string; attachmentId: string };
  'mail:openAttachment': { attachmentPath: string };

  // Sync Operations
  'mail:syncAccount': { accountId: string };
  'mail:syncFolder': { accountId: string; folder: string };
}

export interface MailIPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// Mail State Types (for UI)
export interface MailState {
  accounts: any[];
  selectedAccount: any | null;
  folders: any[];
  selectedFolder: any | null;
  emails: any[];
  selectedEmail: any | null;

  // UI State
  isLoading: boolean;
  isSyncing: boolean;
  isSendingEmail: boolean;

  // Compose
  isComposing: boolean;
  draft: any | null;

  // Filters
  searchQuery: string;
  showUnreadOnly: boolean;
}
