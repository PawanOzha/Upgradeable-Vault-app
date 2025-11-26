/**
 * Email Auto-Configuration
 *
 * Automatically detects IMAP/SMTP settings based on email domain
 * Similar to Thunderbird's auto-config
 */

interface EmailConfig {
  provider: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

// Common email provider configurations
const PROVIDER_CONFIGS: Record<string, EmailConfig> = {
  // Microsoft
  'outlook.com': {
    provider: 'Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  'hotmail.com': {
    provider: 'Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  'live.com': {
    provider: 'Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },

  // Yahoo
  'yahoo.com': {
    provider: 'Yahoo Mail',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  'ymail.com': {
    provider: 'Yahoo Mail',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecure: true,
  },

  // Zoho
  'zoho.com': {
    provider: 'Zoho Mail',
    imapHost: 'imap.zoho.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.zoho.com',
    smtpPort: 465,
    smtpSecure: true,
  },

  // iCloud
  'icloud.com': {
    provider: 'iCloud',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  'me.com': {
    provider: 'iCloud',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false,
  },

  // AOL
  'aol.com': {
    provider: 'AOL',
    imapHost: 'imap.aol.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.aol.com',
    smtpPort: 465,
    smtpSecure: true,
  },

  // GMX
  'gmx.com': {
    provider: 'GMX',
    imapHost: 'imap.gmx.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmx.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  'gmx.net': {
    provider: 'GMX',
    imapHost: 'imap.gmx.net',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmx.net',
    smtpPort: 465,
    smtpSecure: true,
  },

  // ProtonMail (Bridge required)
  'protonmail.com': {
    provider: 'ProtonMail Bridge',
    imapHost: '127.0.0.1',
    imapPort: 1143,
    imapSecure: false,
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    smtpSecure: false,
  },
  'pm.me': {
    provider: 'ProtonMail Bridge',
    imapHost: '127.0.0.1',
    imapPort: 1143,
    imapSecure: false,
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    smtpSecure: false,
  },

  // Entegra Sources (Custom domain)
  'entegrasources.com.np': {
    provider: 'Entegra Sources Mail',
    imapHost: 'mail.entegrasources.com.np',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'mail.entegrasources.com.np',
    smtpPort: 465,
    smtpSecure: true,
  },
};

/**
 * Auto-detect email configuration based on email address
 */
export function autoDetectConfig(email: string): EmailConfig | null {
  if (!email || !email.includes('@')) {
    return null;
  }

  const domain = email.split('@')[1].toLowerCase();

  // Direct match
  if (PROVIDER_CONFIGS[domain]) {
    return PROVIDER_CONFIGS[domain];
  }

  // Try common patterns for custom domains
  // Many hosting providers use standard patterns
  const commonPatterns: EmailConfig[] = [
    // Try mail.domain.com pattern
    {
      provider: 'Custom',
      imapHost: `mail.${domain}`,
      imapPort: 993,
      imapSecure: true,
      smtpHost: `mail.${domain}`,
      smtpPort: 465,
      smtpSecure: true,
    },
    // Try imap.domain.com pattern
    {
      provider: 'Custom',
      imapHost: `imap.${domain}`,
      imapPort: 993,
      imapSecure: true,
      smtpHost: `smtp.${domain}`,
      smtpPort: 465,
      smtpSecure: true,
    },
  ];

  return commonPatterns[0]; // Return first pattern as suggestion
}

/**
 * Get configuration suggestions for manual setup
 */
export function getConfigSuggestions(email: string): EmailConfig[] {
  if (!email || !email.includes('@')) {
    return [];
  }

  const domain = email.split('@')[1].toLowerCase();
  const suggestions: EmailConfig[] = [];

  // Add detected config if available
  const detected = autoDetectConfig(email);
  if (detected) {
    suggestions.push(detected);
  }

  // Add common alternatives
  if (!PROVIDER_CONFIGS[domain]) {
    suggestions.push(
      {
        provider: 'Try Pattern 1',
        imapHost: `imap.${domain}`,
        imapPort: 993,
        imapSecure: true,
        smtpHost: `smtp.${domain}`,
        smtpPort: 587,
        smtpSecure: false,
      },
      {
        provider: 'Try Pattern 2',
        imapHost: `mail.${domain}`,
        imapPort: 993,
        imapSecure: true,
        smtpHost: `mail.${domain}`,
        smtpPort: 465,
        smtpSecure: true,
      }
    );
  }

  return suggestions;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
