import dns from 'dns';
import { promisify } from 'util';

const dnsResolve = promisify(dns.resolve);
const dnsReverse = promisify(dns.reverse);

// ============================================================================
// TYPES
// ============================================================================

export interface SecurityIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  description: string;
  details?: string;
}

export interface EmailSecurityReport {
  score: number; // 0-10 (10 = completely safe, 0 = extremely dangerous)
  rating: 'safe' | 'suspicious' | 'dangerous';
  isSuspicious: boolean;
  issues: SecurityIssue[];
  summary: string;
}

interface EmailHeaders {
  from?: string;
  'return-path'?: string;
  'message-id'?: string;
  'authentication-results'?: string;
  received?: string | string[];
  'reply-to'?: string;
}

interface ParsedEmail {
  from: { address: string; name?: string }[];
  subject: string;
  headers: EmailHeaders;
  html?: string;
  text?: string;
  attachments?: { filename: string; contentType: string }[];
}

// ============================================================================
// SECURITY SCANNER
// ============================================================================

export class EmailSecurityScanner {
  private issues: SecurityIssue[] = [];
  private score: number = 10; // Start with perfect score, deduct for issues

  /**
   * Main entry point - scans an email and returns security report
   */
  async scanEmail(email: ParsedEmail): Promise<EmailSecurityReport> {
    this.issues = [];
    this.score = 10;

    // Run all security checks
    this.checkAuthenticationHeaders(email.headers);
    this.checkDomainMismatch(email);
    this.checkDisplayNameSpoofing(email);
    this.checkMessageIdDomain(email);
    this.checkReceivedHeaders(email.headers);
    this.checkAttachments(email.attachments);
    this.checkPhishingLinks(email.html);
    this.checkSubjectSpam(email.subject);

    // Async checks
    await this.checkIPReputation(email.headers);
    await this.checkReverseDNS(email.headers);

    // Calculate final rating
    const rating = this.calculateRating();
    const isSuspicious = this.score < 7;

    return {
      score: Math.max(0, this.score),
      rating,
      isSuspicious,
      issues: this.issues,
      summary: this.generateSummary()
    };
  }

  /**
   * 1. Check SPF/DKIM/DMARC Authentication
   */
  private checkAuthenticationHeaders(headers: EmailHeaders): void {
    const authResults = headers['authentication-results'];
    if (!authResults) {
      this.addIssue('high', 'Authentication',
        'Missing authentication results - cannot verify sender authenticity');
      this.score -= 2;
      return;
    }

    // Check for SPF failures
    if (/spf\s*=\s*fail/i.test(authResults)) {
      this.addIssue('critical', 'SPF Authentication',
        'SPF check failed - sender is not authorized to send from this domain',
        'The sending server is not authorized by the domain owner');
      this.score -= 3;
    }

    // Check for DKIM failures
    if (/dkim\s*=\s*fail/i.test(authResults)) {
      this.addIssue('critical', 'DKIM Authentication',
        'DKIM signature verification failed - email may have been tampered with',
        'Cryptographic signature does not match');
      this.score -= 3;
    }

    // Check for DMARC failures
    if (/dmarc\s*=\s*fail/i.test(authResults)) {
      this.addIssue('high', 'DMARC Authentication',
        'DMARC policy check failed - this domain does not authorize this sender',
        'Email fails domain alignment checks');
      this.score -= 2;
    }
  }

  /**
   * 2. Check From domain vs Return-Path domain
   */
  private checkDomainMismatch(email: ParsedEmail): void {
    const fromAddress = email.from[0]?.address;
    const returnPath = email.headers['return-path'];

    if (!fromAddress || !returnPath) return;

    const fromDomain = this.extractDomain(fromAddress);
    const returnDomain = this.extractDomain(returnPath);

    if (fromDomain && returnDomain && fromDomain !== returnDomain) {
      this.addIssue('high', 'Domain Mismatch',
        `From domain (${fromDomain}) does not match Return-Path domain (${returnDomain})`,
        'This is a common tactic used by scammers to hide their real identity');
      this.score -= 2.5;
    }
  }

  /**
   * 3. Check Display Name vs Email Address Mismatch
   */
  private checkDisplayNameSpoofing(email: ParsedEmail): void {
    const from = email.from[0];
    if (!from || !from.name) return;

    const name = from.name.toLowerCase();
    const address = from.address.toLowerCase();
    const domain = this.extractDomain(address) || '';

    // List of common companies/brands
    const brands = [
      'paypal', 'amazon', 'google', 'microsoft', 'apple', 'facebook',
      'netflix', 'instagram', 'twitter', 'bank', 'irs', 'dhl', 'fedex',
      'ups', 'ebay', 'visa', 'mastercard', 'amex', 'wells fargo', 'chase'
    ];

    // Check if display name mentions a brand but email is from personal/unrelated domain
    const mentionedBrand = brands.find(brand => name.includes(brand));
    if (mentionedBrand) {
      const personalDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'];
      const isPersonalDomain = personalDomains.includes(domain);
      const isDomainRelated = domain.includes(mentionedBrand);

      if (isPersonalDomain || !isDomainRelated) {
        this.addIssue('critical', 'Display Name Spoofing',
          `Display name "${from.name}" suggests ${mentionedBrand} but email is from ${domain}`,
          'Scammers often use trusted brand names to trick recipients');
        this.score -= 3;
      }
    }
  }

  /**
   * 4. Check Message-ID domain
   */
  private checkMessageIdDomain(email: ParsedEmail): void {
    const messageId = email.headers['message-id'];
    const fromAddress = email.from[0]?.address;

    if (!messageId || !fromAddress) return;

    const messageIdDomain = this.extractDomain(messageId);
    const fromDomain = this.extractDomain(fromAddress);

    if (messageIdDomain && fromDomain && messageIdDomain !== fromDomain) {
      this.addIssue('medium', 'Message-ID Mismatch',
        `Message-ID domain (${messageIdDomain}) does not match sender domain (${fromDomain})`,
        'Legitimate mail servers typically use the same domain in Message-ID');
      this.score -= 1;
    }
  }

  /**
   * 5. Analyze Received Headers
   */
  private checkReceivedHeaders(headers: EmailHeaders): void {
    const received = headers.received;
    if (!received) return;

    const receivedArray = Array.isArray(received) ? received : [received];

    // Check for too many hops (>5 is suspicious)
    if (receivedArray.length > 5) {
      this.addIssue('medium', 'Routing Anomaly',
        `Email passed through ${receivedArray.length} servers (normal is 2-3)`,
        'Multiple hops can indicate forwarding through compromised servers');
      this.score -= 1;
    }

    // Check for suspicious relay patterns
    const suspiciousPatterns = [
      /unknown/i,
      /localhost/i,
      /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}.*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/  // Multiple IPs
    ];

    for (const header of receivedArray) {
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(header)) {
          this.addIssue('medium', 'Suspicious Relay',
            'Email routed through unknown or suspicious relay servers');
          this.score -= 0.5;
          break;
        }
      }
    }
  }

  /**
   * 6. Check Attachments for Dangerous Types
   */
  private checkAttachments(attachments?: { filename: string; contentType: string }[]): void {
    if (!attachments || attachments.length === 0) return;

    const dangerousExtensions = [
      '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js',
      '.jar', '.ps1', '.msi', '.dll', '.hta', '.cpl', '.docm', '.xlsm'
    ];

    for (const attachment of attachments) {
      const filename = attachment.filename.toLowerCase();

      for (const ext of dangerousExtensions) {
        if (filename.endsWith(ext)) {
          this.addIssue('critical', 'Dangerous Attachment',
            `Attachment "${attachment.filename}" has dangerous extension ${ext}`,
            'Legitimate businesses rarely send executable files via email');
          this.score -= 4;
          break;
        }
      }

      // Check for double extensions (e.g., invoice.pdf.exe)
      const doubleExtPattern = /\.(pdf|doc|jpg|png|txt)\.(exe|bat|cmd|scr|vbs|js)/i;
      if (doubleExtPattern.test(filename)) {
        this.addIssue('critical', 'Double Extension Attack',
          `Attachment "${attachment.filename}" uses double extension to hide malware`,
          'This is a classic malware distribution technique');
        this.score -= 5;
      }
    }
  }

  /**
   * 7. Check HTML for Phishing Links
   */
  private checkPhishingLinks(html?: string): void {
    if (!html) return;

    // Extract all anchor tags
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1];
      const text = match[2];

      // Check if link text looks like a URL but actual URL is different
      if (this.looksLikeURL(text)) {
        const textDomain = this.extractDomain(text);
        const urlDomain = this.extractDomain(url);

        if (textDomain && urlDomain && textDomain !== urlDomain) {
          this.addIssue('high', 'Phishing Link',
            `Link text shows "${textDomain}" but actual link goes to "${urlDomain}"`,
            'This is a common phishing technique to trick users');
          this.score -= 2.5;
        }
      }

      // Check for URL shorteners
      const shorteners = ['bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'cutt.ly'];
      if (shorteners.some(s => url.includes(s))) {
        this.addIssue('medium', 'URL Shortener',
          'Email contains shortened URLs which hide the real destination',
          'Legitimate businesses typically use direct links');
        this.score -= 1;
      }

      // Check for suspicious TLDs
      const suspiciousTLDs = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top'];
      if (suspiciousTLDs.some(tld => url.toLowerCase().endsWith(tld))) {
        this.addIssue('medium', 'Suspicious Domain',
          'Email contains links to domains with suspicious top-level domains',
          'These TLDs are commonly used by scammers due to low cost');
        this.score -= 1;
      }
    }
  }

  /**
   * 8. Check Subject Line for Spam Indicators
   */
  private checkSubjectSpam(subject: string): void {
    if (!subject) return;

    const spamTriggers = [
      { pattern: /\bFREE\b/i, text: 'FREE' },
      { pattern: /\bWINNER\b/i, text: 'WINNER' },
      { pattern: /\bURGENT\b/i, text: 'URGENT' },
      { pattern: /\bACT NOW\b/i, text: 'ACT NOW' },
      { pattern: /\bCLAIM\b/i, text: 'CLAIM' },
      { pattern: /!!!+/, text: 'multiple exclamation marks' },
      { pattern: /\$\$\$/, text: 'multiple dollar signs' }
    ];

    const foundTriggers: string[] = [];
    for (const trigger of spamTriggers) {
      if (trigger.pattern.test(subject)) {
        foundTriggers.push(trigger.text);
      }
    }

    if (foundTriggers.length > 0) {
      this.addIssue('low', 'Spam Indicators',
        `Subject contains spam trigger words: ${foundTriggers.join(', ')}`,
        'Professional emails avoid these attention-grabbing tactics');
      this.score -= 0.5 * foundTriggers.length;
    }

    // Check for ALL CAPS
    if (subject === subject.toUpperCase() && subject.length > 5) {
      this.addIssue('low', 'All Caps Subject',
        'Subject line is in ALL CAPS',
        'This is a common spam technique');
      this.score -= 0.5;
    }
  }

  /**
   * 9. Check IP Reputation via RBLs
   */
  private async checkIPReputation(headers: EmailHeaders): Promise<void> {
    try {
      const ip = this.extractIPFromReceived(headers.received);
      if (!ip) return;

      // Check major blacklists
      const blacklists = [
        'zen.spamhaus.org',
        'b.barracudacentral.org',
        'dnsbl-1.uceprotect.net'
      ];

      for (const bl of blacklists) {
        const isListed = await this.checkBlacklist(ip, bl);
        if (isListed) {
          this.addIssue('critical', 'IP Blacklisted',
            `Sending server IP (${ip}) is listed on ${bl}`,
            'This IP has been reported for sending spam or malicious content');
          this.score -= 3;
          break; // Only report once
        }
      }
    } catch (error) {
      // Silently fail - DNS lookups can fail for various reasons
    }
  }

  /**
   * 10. Check Reverse DNS
   */
  private async checkReverseDNS(headers: EmailHeaders): Promise<void> {
    try {
      const ip = this.extractIPFromReceived(headers.received);
      if (!ip) return;

      const hostnames = await dnsReverse(ip);
      if (!hostnames || hostnames.length === 0) {
        this.addIssue('medium', 'No Reverse DNS',
          `Sending server IP (${ip}) has no reverse DNS record`,
          'Legitimate mail servers typically have proper reverse DNS configured');
        this.score -= 1;
      }
    } catch (error) {
      this.addIssue('medium', 'Reverse DNS Failed',
        'Could not verify reverse DNS for sending server',
        'This may indicate a misconfigured or suspicious mail server');
      this.score -= 1;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private addIssue(severity: SecurityIssue['severity'], category: string, description: string, details?: string): void {
    this.issues.push({ severity, category, description, details });
  }

  private extractDomain(email: string): string | null {
    const match = email.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase() : null;
  }

  private looksLikeURL(text: string): boolean {
    return /^(https?:\/\/)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text);
  }

  private extractIPFromReceived(received?: string | string[]): string | null {
    if (!received) return null;

    const receivedStr = Array.isArray(received) ? received[0] : received;
    const ipMatch = receivedStr.match(/\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/);
    return ipMatch ? ipMatch[1] : null;
  }

  private async checkBlacklist(ip: string, blacklist: string): Promise<boolean> {
    try {
      const reversed = ip.split('.').reverse().join('.');
      const query = `${reversed}.${blacklist}`;
      await dnsResolve(query, 'A');
      return true; // IP is blacklisted
    } catch {
      return false; // IP is clean
    }
  }

  private calculateRating(): 'safe' | 'suspicious' | 'dangerous' {
    if (this.score >= 8) return 'safe';
    if (this.score >= 5) return 'suspicious';
    return 'dangerous';
  }

  private generateSummary(): string {
    const criticalCount = this.issues.filter(i => i.severity === 'critical').length;
    const highCount = this.issues.filter(i => i.severity === 'high').length;

    if (criticalCount > 0) {
      return `This email has ${criticalCount} critical security issue(s) and is likely malicious.`;
    }
    if (highCount > 0) {
      return `This email has ${highCount} high-severity issue(s) and should be treated with caution.`;
    }
    if (this.issues.length > 0) {
      return `This email has ${this.issues.length} minor issue(s) but appears relatively safe.`;
    }
    return 'This email passed all security checks and appears safe.';
  }
}

// ============================================================================
// EXPORT SINGLETON
// ============================================================================

export const emailSecurityScanner = new EmailSecurityScanner();
