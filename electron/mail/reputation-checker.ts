/**
 * GLOBAL EMAIL REPUTATION CHECKER
 *
 * Checks domain and IP reputation across multiple global sources:
 * - DNS Blacklists (RBLs)
 * - SPF/DKIM/DMARC configuration
 * - Domain reputation services
 * - SSL/TLS certificate validation
 * - MX record health
 */

import dns from 'dns';
import { promisify } from 'util';
import https from 'https';

const dnsResolve = promisify(dns.resolve);
const dnsResolveMx = promisify(dns.resolveMx);
const dnsResolveTxt = promisify(dns.resolveTxt);
const dnsReverse = promisify(dns.reverse);

// ============================================================================
// TYPES
// ============================================================================

export interface ReputationCheck {
  name: string;
  status: 'good' | 'warning' | 'bad' | 'unknown';
  message: string;
  details?: string;
  score?: number; // 0-100
}

export interface DomainReputation {
  domain: string;
  overallScore: number; // 0-100
  rating: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

  // DNS Configuration
  spfRecord: ReputationCheck;
  dkimRecord: ReputationCheck;
  dmarcRecord: ReputationCheck;
  mxRecords: ReputationCheck;

  // Blacklist Status
  blacklistStatus: ReputationCheck[];

  // Domain Health
  domainAge: ReputationCheck;
  sslCertificate: ReputationCheck;

  // Summary
  issues: string[];
  recommendations: string[];

  lastChecked: string;
}

export interface IPReputation {
  ip: string;
  overallScore: number; // 0-100
  rating: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

  // IP Checks
  blacklistStatus: ReputationCheck[];
  reverseDNS: ReputationCheck;

  // Summary
  issues: string[];
  recommendations: string[];

  lastChecked: string;
}

export interface EmailReputationReport {
  domain: DomainReputation;
  ip: IPReputation;
  deliverabilityScore: number; // 0-100 (combined score)
  status: 'healthy' | 'needs_attention' | 'critical';
  summary: string;
}

// ============================================================================
// REPUTATION CHECKER
// ============================================================================

export class EmailReputationChecker {

  // Major DNS Blacklists (RBLs)
  private readonly RBL_LISTS = [
    { name: 'Spamhaus ZEN', dns: 'zen.spamhaus.org', weight: 30 },
    { name: 'Spamhaus DBL', dns: 'dbl.spamhaus.org', weight: 25, isDomain: true },
    { name: 'Barracuda', dns: 'b.barracudacentral.org', weight: 20 },
    { name: 'SpamCop', dns: 'bl.spamcop.net', weight: 15 },
    { name: 'UCEPROTECT Level 1', dns: 'dnsbl-1.uceprotect.net', weight: 10 },
    { name: 'SORBS', dns: 'dnsbl.sorbs.net', weight: 15 },
    { name: 'PSBL', dns: 'psbl.surriel.com', weight: 10 },
    { name: 'SURBL', dns: 'multi.surbl.org', weight: 20, isDomain: true },
  ];

  /**
   * Check complete email reputation for a domain and its sending IP
   */
  async checkEmailReputation(email: string, sendingIP?: string): Promise<EmailReputationReport> {
    const domain = this.extractDomain(email);
    if (!domain) {
      throw new Error('Invalid email address');
    }

    console.log(`[Reputation] Checking reputation for ${domain}...`);

    // Resolve sending IP if not provided
    let ip = sendingIP;
    if (!ip) {
      try {
        const mxRecords = await dnsResolveMx(domain);
        if (mxRecords && mxRecords.length > 0) {
          const mxHost = mxRecords[0].exchange;
          const addresses = await dnsResolve(mxHost, 'A');
          ip = addresses[0];
        }
      } catch (error) {
        console.error('[Reputation] Could not resolve sending IP:', error);
      }
    }

    // Check domain and IP reputation in parallel
    const [domainRep, ipRep] = await Promise.all([
      this.checkDomainReputation(domain),
      ip ? this.checkIPReputation(ip) : this.getEmptyIPReputation()
    ]);

    // Calculate overall deliverability score
    const deliverabilityScore = Math.round((domainRep.overallScore + ipRep.overallScore) / 2);

    let status: 'healthy' | 'needs_attention' | 'critical';
    if (deliverabilityScore >= 80) status = 'healthy';
    else if (deliverabilityScore >= 60) status = 'needs_attention';
    else status = 'critical';

    // Generate summary
    const summary = this.generateSummary(domainRep, ipRep, deliverabilityScore);

    return {
      domain: domainRep,
      ip: ipRep,
      deliverabilityScore,
      status,
      summary
    };
  }

  /**
   * Check domain reputation (DNS configuration, blacklists, etc.)
   */
  private async checkDomainReputation(domain: string): Promise<DomainReputation> {
    console.log(`[Reputation] Checking domain: ${domain}`);

    const checks = await Promise.allSettled([
      this.checkSPF(domain),
      this.checkDKIM(domain),
      this.checkDMARC(domain),
      this.checkMXRecords(domain),
      this.checkDomainBlacklists(domain),
      this.checkSSLCertificate(domain),
    ]);

    const spfRecord = this.getResult(checks[0], 'SPF check failed');
    const dkimRecord = this.getResult(checks[1], 'DKIM check failed');
    const dmarcRecord = this.getResult(checks[2], 'DMARC check failed');
    const mxRecords = this.getResult(checks[3], 'MX check failed');
    const blacklistStatus = this.getResult(checks[4], 'Blacklist check failed', []) as ReputationCheck[];
    const sslCertificate = this.getResult(checks[5], 'SSL check failed');

    // Calculate overall score
    const scores = [
      spfRecord.score || 0,
      dkimRecord.score || 0,
      dmarcRecord.score || 0,
      mxRecords.score || 0,
      sslCertificate.score || 0,
      this.calculateBlacklistScore(blacklistStatus)
    ];

    const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const rating = this.calculateRating(overallScore);

    // Collect issues and recommendations
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (spfRecord.status !== 'good') {
      issues.push('SPF record missing or invalid');
      recommendations.push('Add a valid SPF record to authorize your mail servers');
    }
    if (dmarcRecord.status !== 'good') {
      issues.push('DMARC policy not configured');
      recommendations.push('Implement DMARC policy to prevent domain spoofing');
    }
    if (blacklistStatus.some(b => b.status === 'bad')) {
      issues.push('Domain is listed on one or more blacklists');
      recommendations.push('Request delisting from blacklists and investigate spam complaints');
    }

    return {
      domain,
      overallScore,
      rating,
      spfRecord,
      dkimRecord,
      dmarcRecord,
      mxRecords,
      blacklistStatus,
      domainAge: { name: 'Domain Age', status: 'unknown', message: 'Domain age check not available' },
      sslCertificate,
      issues,
      recommendations,
      lastChecked: new Date().toISOString()
    };
  }

  /**
   * Check IP reputation (blacklists, reverse DNS, etc.)
   */
  private async checkIPReputation(ip: string): Promise<IPReputation> {
    console.log(`[Reputation] Checking IP: ${ip}`);

    const checks = await Promise.allSettled([
      this.checkIPBlacklists(ip),
      this.checkReverseDNS(ip),
    ]);

    const blacklistStatus = this.getResult(checks[0], 'IP blacklist check failed', []) as ReputationCheck[];
    const reverseDNS = this.getResult(checks[1], 'Reverse DNS check failed');

    // Calculate overall score
    const blacklistScore = this.calculateBlacklistScore(blacklistStatus);
    const reverseDNSScore = reverseDNS.score || 0;
    const overallScore = Math.round((blacklistScore + reverseDNSScore) / 2);
    const rating = this.calculateRating(overallScore);

    // Collect issues and recommendations
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (blacklistStatus.some(b => b.status === 'bad')) {
      issues.push('IP is listed on one or more blacklists');
      recommendations.push('Request delisting from blacklists and improve sending practices');
    }
    if (reverseDNS.status !== 'good') {
      issues.push('Reverse DNS not properly configured');
      recommendations.push('Set up reverse DNS (PTR record) for your mail server IP');
    }

    return {
      ip,
      overallScore,
      rating,
      blacklistStatus,
      reverseDNS,
      issues,
      recommendations,
      lastChecked: new Date().toISOString()
    };
  }

  // ============================================================================
  // DNS CONFIGURATION CHECKS
  // ============================================================================

  private async checkSPF(domain: string): Promise<ReputationCheck> {
    try {
      const records = await dnsResolveTxt(domain);
      const spfRecord = records.flat().find(r => r.startsWith('v=spf1'));

      if (!spfRecord) {
        return {
          name: 'SPF Record',
          status: 'bad',
          message: 'No SPF record found',
          details: 'SPF (Sender Policy Framework) is missing. This may cause emails to be rejected.',
          score: 0
        };
      }

      // Check for common SPF issues
      const issues: string[] = [];
      if (spfRecord.includes('~all')) {
        issues.push('Using soft fail (~all) - consider hard fail (-all) for better security');
      }
      if (!spfRecord.includes('include:') && !spfRecord.includes('a:') && !spfRecord.includes('mx')) {
        issues.push('SPF record may be too restrictive or incomplete');
      }

      return {
        name: 'SPF Record',
        status: 'good',
        message: 'SPF record configured',
        details: `SPF: ${spfRecord}${issues.length > 0 ? '\n' + issues.join('\n') : ''}`,
        score: issues.length === 0 ? 100 : 80
      };
    } catch (error) {
      return {
        name: 'SPF Record',
        status: 'bad',
        message: 'No SPF record found',
        details: 'SPF lookup failed or record is missing',
        score: 0
      };
    }
  }

  private async checkDKIM(domain: string): Promise<ReputationCheck> {
    // DKIM requires knowing the selector, which varies by provider
    // We'll check for common selectors used by popular providers
    const commonSelectors = [
      'default', 'google', 'k1', 's1', 's2', 'selector1', 'selector2',
      'dkim', 'mail', 'email', 'smtp'
    ];

    for (const selector of commonSelectors) {
      try {
        const dkimDomain = `${selector}._domainkey.${domain}`;
        const records = await dnsResolveTxt(dkimDomain);
        const dkimRecord = records.flat().find(r => r.includes('v=DKIM1') || r.includes('p='));

        if (dkimRecord) {
          return {
            name: 'DKIM Record',
            status: 'good',
            message: `DKIM configured (selector: ${selector})`,
            details: 'DKIM digital signature is properly configured',
            score: 100
          };
        }
      } catch (error) {
        // Continue to next selector
      }
    }

    return {
      name: 'DKIM Record',
      status: 'warning',
      message: 'DKIM not detected',
      details: 'DKIM signature not found with common selectors. May be using a custom selector.',
      score: 50
    };
  }

  private async checkDMARC(domain: string): Promise<ReputationCheck> {
    try {
      const dmarcDomain = `_dmarc.${domain}`;
      const records = await dnsResolveTxt(dmarcDomain);
      const dmarcRecord = records.flat().find(r => r.startsWith('v=DMARC1'));

      if (!dmarcRecord) {
        return {
          name: 'DMARC Policy',
          status: 'bad',
          message: 'No DMARC policy found',
          details: 'DMARC is not configured. This allows anyone to spoof your domain.',
          score: 0
        };
      }

      // Check DMARC policy strength
      let score = 100;
      let status: 'good' | 'warning' | 'bad' = 'good';
      const issues: string[] = [];

      if (dmarcRecord.includes('p=none')) {
        issues.push('Policy is set to "none" (monitoring only)');
        score = 70;
        status = 'warning';
      } else if (dmarcRecord.includes('p=quarantine')) {
        issues.push('Policy is "quarantine" - consider upgrading to "reject"');
        score = 85;
      } else if (dmarcRecord.includes('p=reject')) {
        issues.push('Strong policy: "reject" - excellent!');
        score = 100;
      }

      return {
        name: 'DMARC Policy',
        status,
        message: 'DMARC policy configured',
        details: `DMARC: ${dmarcRecord}\n${issues.join('\n')}`,
        score
      };
    } catch (error) {
      return {
        name: 'DMARC Policy',
        status: 'bad',
        message: 'No DMARC policy found',
        details: 'DMARC lookup failed or policy is missing',
        score: 0
      };
    }
  }

  private async checkMXRecords(domain: string): Promise<ReputationCheck> {
    try {
      const mxRecords = await dnsResolveMx(domain);

      if (!mxRecords || mxRecords.length === 0) {
        return {
          name: 'MX Records',
          status: 'bad',
          message: 'No MX records found',
          details: 'Domain cannot receive emails',
          score: 0
        };
      }

      const recordList = mxRecords
        .sort((a, b) => a.priority - b.priority)
        .map(mx => `${mx.exchange} (priority: ${mx.priority})`)
        .join('\n');

      return {
        name: 'MX Records',
        status: 'good',
        message: `${mxRecords.length} MX record(s) configured`,
        details: `Mail servers:\n${recordList}`,
        score: 100
      };
    } catch (error) {
      return {
        name: 'MX Records',
        status: 'bad',
        message: 'No MX records found',
        details: 'MX lookup failed',
        score: 0
      };
    }
  }

  private async checkSSLCertificate(domain: string): Promise<ReputationCheck> {
    return new Promise((resolve) => {
      const options = {
        host: domain,
        port: 443,
        method: 'HEAD',
        rejectUnauthorized: false,
        timeout: 5000
      };

      const req = https.request(options, (res) => {
        const cert = (res.socket as any)?.getPeerCertificate();

        if (cert && cert.subject) {
          const validTo = new Date(cert.valid_to);
          const now = new Date();
          const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          if (daysUntilExpiry < 0) {
            resolve({
              name: 'SSL Certificate',
              status: 'bad',
              message: 'SSL certificate expired',
              details: `Certificate expired on ${validTo.toLocaleDateString()}`,
              score: 0
            });
          } else if (daysUntilExpiry < 30) {
            resolve({
              name: 'SSL Certificate',
              status: 'warning',
              message: 'SSL certificate expiring soon',
              details: `Certificate expires in ${daysUntilExpiry} days`,
              score: 70
            });
          } else {
            resolve({
              name: 'SSL Certificate',
              status: 'good',
              message: 'Valid SSL certificate',
              details: `Issued to: ${cert.subject.CN}\nExpires: ${validTo.toLocaleDateString()} (${daysUntilExpiry} days)`,
              score: 100
            });
          }
        } else {
          resolve({
            name: 'SSL Certificate',
            status: 'warning',
            message: 'Could not verify SSL certificate',
            score: 50
          });
        }
      });

      req.on('error', () => {
        resolve({
          name: 'SSL Certificate',
          status: 'unknown',
          message: 'SSL check not available',
          details: 'Could not connect to verify certificate',
          score: 50
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          name: 'SSL Certificate',
          status: 'unknown',
          message: 'SSL check timed out',
          score: 50
        });
      });

      req.end();
    });
  }

  // ============================================================================
  // BLACKLIST CHECKS
  // ============================================================================

  private async checkDomainBlacklists(domain: string): Promise<ReputationCheck[]> {
    const domainRBLs = this.RBL_LISTS.filter(rbl => rbl.isDomain);
    const checks = await Promise.allSettled(
      domainRBLs.map(rbl => this.checkSingleBlacklist(domain, rbl.dns, rbl.name, rbl.weight))
    );

    return checks.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          name: domainRBLs[index].name,
          status: 'unknown' as const,
          message: 'Check failed',
          score: 50
        };
      }
    });
  }

  private async checkIPBlacklists(ip: string): Promise<ReputationCheck[]> {
    const ipRBLs = this.RBL_LISTS.filter(rbl => !rbl.isDomain);
    const reversedIP = ip.split('.').reverse().join('.');

    const checks = await Promise.allSettled(
      ipRBLs.map(rbl => this.checkSingleBlacklist(reversedIP, rbl.dns, rbl.name, rbl.weight))
    );

    return checks.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          name: ipRBLs[index].name,
          status: 'unknown' as const,
          message: 'Check failed',
          score: 50
        };
      }
    });
  }

  private async checkSingleBlacklist(
    query: string,
    blacklist: string,
    name: string,
    weight: number
  ): Promise<ReputationCheck> {
    try {
      const lookupDomain = `${query}.${blacklist}`;
      await dnsResolve(lookupDomain, 'A');

      // If resolve succeeds, the domain/IP is blacklisted
      return {
        name,
        status: 'bad',
        message: '❌ BLACKLISTED',
        details: `Listed on ${name}. This severely impacts deliverability.`,
        score: 0
      };
    } catch (error) {
      // If resolve fails, it's not blacklisted (good!)
      return {
        name,
        status: 'good',
        message: '✅ Clean',
        details: `Not listed on ${name}`,
        score: 100
      };
    }
  }

  private async checkReverseDNS(ip: string): Promise<ReputationCheck> {
    try {
      const hostnames = await dnsReverse(ip);

      if (!hostnames || hostnames.length === 0) {
        return {
          name: 'Reverse DNS',
          status: 'bad',
          message: 'No reverse DNS configured',
          details: 'Reverse DNS (PTR record) is missing. Many mail servers will reject emails without this.',
          score: 0
        };
      }

      return {
        name: 'Reverse DNS',
        status: 'good',
        message: 'Reverse DNS configured',
        details: `PTR record: ${hostnames.join(', ')}`,
        score: 100
      };
    } catch (error) {
      return {
        name: 'Reverse DNS',
        status: 'bad',
        message: 'No reverse DNS configured',
        details: 'Reverse DNS lookup failed',
        score: 0
      };
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private extractDomain(email: string): string | null {
    const match = email.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase() : null;
  }

  private getResult<T>(
    result: PromiseSettledResult<T>,
    errorMessage: string,
    defaultValue?: T
  ): T {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      return {
        name: 'Check Failed',
        status: 'unknown',
        message: errorMessage,
        score: 50
      } as T;
    }
  }

  private calculateBlacklistScore(blacklists: ReputationCheck[]): number {
    if (blacklists.length === 0) return 50;

    const goodCount = blacklists.filter(b => b.status === 'good').length;
    const badCount = blacklists.filter(b => b.status === 'bad').length;

    if (badCount > 0) return 0; // Any blacklist = 0 score
    if (goodCount === blacklists.length) return 100; // All clean = 100
    return 50; // Some unknown
  }

  private calculateRating(score: number): 'excellent' | 'good' | 'fair' | 'poor' | 'critical' {
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'fair';
    if (score >= 40) return 'poor';
    return 'critical';
  }

  private generateSummary(
    domain: DomainReputation,
    ip: IPReputation,
    deliverabilityScore: number
  ): string {
    const criticalIssues = [
      ...domain.blacklistStatus.filter(b => b.status === 'bad'),
      ...ip.blacklistStatus.filter(b => b.status === 'bad')
    ];

    if (criticalIssues.length > 0) {
      return `⚠️ CRITICAL: Your ${domain.domain} is blacklisted on ${criticalIssues.length} list(s). Emails are likely being blocked.`;
    }

    if (deliverabilityScore >= 90) {
      return `✅ Excellent! Your email reputation is strong. Emails should deliver successfully.`;
    }

    if (deliverabilityScore >= 75) {
      return `✓ Good reputation with minor improvements needed. Most emails will deliver successfully.`;
    }

    if (deliverabilityScore >= 60) {
      return `⚠️ Fair reputation. Some emails may be filtered. Address the issues below.`;
    }

    return `❌ Poor reputation. Email deliverability is severely impacted. Immediate action required.`;
  }

  private getEmptyIPReputation(): IPReputation {
    return {
      ip: 'Unknown',
      overallScore: 50,
      rating: 'fair',
      blacklistStatus: [],
      reverseDNS: {
        name: 'Reverse DNS',
        status: 'unknown',
        message: 'IP not available',
        score: 50
      },
      issues: [],
      recommendations: [],
      lastChecked: new Date().toISOString()
    };
  }
}

// ============================================================================
// EXPORT SINGLETON
// ============================================================================

export const reputationChecker = new EmailReputationChecker();
