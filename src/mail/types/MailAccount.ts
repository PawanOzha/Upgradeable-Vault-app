// Mail Account Types

export interface MailAccount {
  id: string;
  name: string;
  email: string;

  // IMAP Settings
  imapHost: string;
  imapPort: number;
  imapSecure: boolean; // true for SSL/TLS

  // SMTP Settings
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;

  // Credentials (stored encrypted in vault)
  credentialId?: number; // Reference to vault credential

  // Status
  isConnected: boolean;
  lastSyncTime?: string;
  unreadCount: number;

  // Metadata
  createdAt: string;
  updatedAt: string;
}

export interface MailAccountForm {
  name: string;
  email: string;
  password: string;

  imapHost: string;
  imapPort: number;
  imapSecure: boolean;

  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

// Common email provider presets
export interface EmailProvider {
  id: string;
  name: string;
  domains: string[];
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

export const EMAIL_PROVIDERS: EmailProvider[] = [
  {
    id: 'custom',
    name: 'Custom IMAP/SMTP',
    domains: [],
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    id: 'outlook',
    name: 'Outlook / Office 365',
    domains: ['outlook.com', 'hotmail.com', 'live.com'],
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false, // STARTTLS
  },
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    domains: ['yahoo.com', 'ymail.com'],
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    domains: ['zoho.com'],
    imapHost: 'imap.zoho.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.zoho.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    id: 'icloud',
    name: 'iCloud Mail',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false, // STARTTLS
  },
  {
    id: 'protonmail',
    name: 'ProtonMail Bridge',
    domains: ['protonmail.com', 'pm.me'],
    imapHost: '127.0.0.1',
    imapPort: 1143,
    imapSecure: false,
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    smtpSecure: false,
  },
];
