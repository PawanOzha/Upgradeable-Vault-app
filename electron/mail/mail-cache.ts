/**
 * Mail Memory Cache - Superhuman-level Speed
 *
 * Keeps email data in RAM for instant UI rendering
 * Zero database reads during normal operation
 */

interface CachedEmail {
  id: string;
  uid: number;
  messageId: string;
  accountId: string;
  folder: string;
  from: any[];
  to: any[];
  cc: any[];
  subject: string;
  date: string;
  textBody: string | null;
  htmlBody: string | null;
  hasAttachments: boolean;
  isRead: boolean;
  isFlagged: boolean;
  size: number;
  isSuspicious: boolean;
  securityScore: number | null;
  securityRating: string | null;
  // Full body loaded on demand
  bodyLoaded: boolean;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  lastUpdate: number;
}

class MailMemoryCache {
  // Main cache: accountId -> folder -> email[]
  private cache: Map<string, Map<string, CachedEmail[]>> = new Map();

  // Quick lookup: emailId -> email
  private emailIndex: Map<string, CachedEmail> = new Map();

  // Prefetch queue for predictive loading
  private prefetchQueue: Set<string> = new Set();

  // Stats for monitoring
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    lastUpdate: Date.now()
  };

  // Max emails in memory per folder
  private readonly MAX_EMAILS_PER_FOLDER = 1000;

  /**
   * Get emails from cache (instant, no DB read)
   */
  getEmails(accountId: string, folder: string): CachedEmail[] | null {
    const accountCache = this.cache.get(accountId);
    if (!accountCache) {
      this.stats.misses++;
      return null;
    }

    const emails = accountCache.get(folder);
    if (!emails) {
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return emails;
  }

  /**
   * Get single email by ID (instant lookup)
   */
  getEmail(emailId: string): CachedEmail | null {
    const email = this.emailIndex.get(emailId);
    if (email) {
      this.stats.hits++;
      return email;
    }
    this.stats.misses++;
    return null;
  }

  /**
   * Update cache with fresh emails from database
   */
  updateCache(accountId: string, folder: string, emails: any[]): void {
    // Ensure account cache exists
    if (!this.cache.has(accountId)) {
      this.cache.set(accountId, new Map());
    }

    const accountCache = this.cache.get(accountId)!;

    // Get existing cache to preserve local changes
    const existingEmails = accountCache.get(folder) || [];
    const existingEmailMap = new Map(existingEmails.map(e => [e.id, e]));

    // Convert to cached format (lightweight)
    const cachedEmails: CachedEmail[] = emails.map(email => {
      const existing = existingEmailMap.get(email.id);

      // If email exists in cache and has been marked as read locally, preserve that
      const preserveReadStatus = existing && existing.isRead && !email.isRead;

      return {
        id: email.id,
        uid: email.uid,
        messageId: email.messageId || email.message_id,
        accountId: email.accountId || email.account_id,
        folder: email.folder,
        from: typeof email.from === 'string' ? JSON.parse(email.from) : email.from,
        to: typeof email.to === 'string' ? JSON.parse(email.to) : email.to,
        cc: typeof email.cc === 'string' ? JSON.parse(email.cc || '[]') : (email.cc || []),
        subject: email.subject,
        date: email.date,
        textBody: email.textBody || email.text_body || null,
        htmlBody: email.htmlBody || email.html_body || null,
        hasAttachments: email.hasAttachments || email.has_attachments || false,
        // PRESERVE LOCAL READ STATUS if user marked it read but server hasn't synced yet
        isRead: preserveReadStatus ? true : (email.isRead !== undefined ? email.isRead : (email.is_read === 1)),
        isFlagged: email.isFlagged !== undefined ? email.isFlagged : (email.is_flagged === 1),
        size: email.size || 0,
        isSuspicious: email.isSuspicious !== undefined ? email.isSuspicious : (email.is_suspicious === 1),
        securityScore: email.securityScore || email.security_score || null,
        securityRating: email.securityRating || email.security_rating || null,
        bodyLoaded: !!(email.textBody || email.text_body || email.htmlBody || email.html_body)
      };
    });

    // Keep only latest emails (memory management)
    const limitedEmails = cachedEmails.slice(0, this.MAX_EMAILS_PER_FOLDER);

    // Update folder cache
    accountCache.set(folder, limitedEmails);

    // Update email index for quick lookup
    for (const email of limitedEmails) {
      this.emailIndex.set(email.id, email);
    }

    this.stats.size = this.emailIndex.size;
    this.stats.lastUpdate = Date.now();

    console.log(`[Memory Cache] Updated ${limitedEmails.length} emails for ${accountId}/${folder} (Total in cache: ${this.stats.size})`);
  }

  /**
   * Add or update single email in cache
   */
  upsertEmail(email: any): void {
    const accountId = email.accountId || email.account_id;
    const folder = email.folder;

    if (!accountId || !folder) return;

    // Ensure account cache exists
    if (!this.cache.has(accountId)) {
      this.cache.set(accountId, new Map());
    }

    const accountCache = this.cache.get(accountId)!;
    const folderEmails = accountCache.get(folder) || [];

    // Convert to cached format
    const cachedEmail: CachedEmail = {
      id: email.id,
      uid: email.uid,
      messageId: email.messageId || email.message_id,
      accountId,
      folder,
      from: typeof email.from === 'string' ? JSON.parse(email.from) : email.from,
      to: typeof email.to === 'string' ? JSON.parse(email.to) : email.to,
      cc: typeof email.cc === 'string' ? JSON.parse(email.cc || '[]') : (email.cc || []),
      subject: email.subject,
      date: email.date,
      textBody: email.textBody || email.text_body || null,
      htmlBody: email.htmlBody || email.html_body || null,
      hasAttachments: email.hasAttachments || email.has_attachments || false,
      isRead: email.isRead !== undefined ? email.isRead : (email.is_read === 1),
      isFlagged: email.isFlagged !== undefined ? email.isFlagged : (email.is_flagged === 1),
      size: email.size || 0,
      isSuspicious: email.isSuspicious !== undefined ? email.isSuspicious : (email.is_suspicious === 1),
      securityScore: email.securityScore || email.security_score || null,
      securityRating: email.securityRating || email.security_rating || null,
      bodyLoaded: !!(email.textBody || email.text_body || email.htmlBody || email.html_body)
    };

    // Find and update existing, or add new
    const existingIndex = folderEmails.findIndex(e => e.id === cachedEmail.id);
    if (existingIndex >= 0) {
      folderEmails[existingIndex] = cachedEmail;
    } else {
      folderEmails.unshift(cachedEmail); // Add to front (newest first)
    }

    // Keep size limit
    if (folderEmails.length > this.MAX_EMAILS_PER_FOLDER) {
      const removed = folderEmails.pop();
      if (removed) {
        this.emailIndex.delete(removed.id);
      }
    }

    accountCache.set(folder, folderEmails);
    this.emailIndex.set(cachedEmail.id, cachedEmail);
    this.stats.size = this.emailIndex.size;
  }

  /**
   * Mark email as read in cache (instant UI update)
   */
  markAsRead(emailId: string, isRead: boolean): boolean {
    const email = this.emailIndex.get(emailId);
    if (!email) return false;

    email.isRead = isRead;
    return true;
  }

  /**
   * Delete email from cache
   */
  deleteEmail(emailId: string): boolean {
    const email = this.emailIndex.get(emailId);
    if (!email) return false;

    // Remove from folder cache
    const accountCache = this.cache.get(email.accountId);
    if (accountCache) {
      const folderEmails = accountCache.get(email.folder);
      if (folderEmails) {
        const filtered = folderEmails.filter(e => e.id !== emailId);
        accountCache.set(email.folder, filtered);
      }
    }

    // Remove from index
    this.emailIndex.delete(emailId);
    this.stats.size = this.emailIndex.size;
    return true;
  }

  /**
   * Add emails to prefetch queue for predictive loading
   */
  schedulePrefetch(emailIds: string[]): void {
    for (const id of emailIds) {
      this.prefetchQueue.add(id);
    }
  }

  /**
   * Get next batch of emails to prefetch
   */
  getPrefetchBatch(size: number = 10): string[] {
    const batch: string[] = [];
    const iterator = this.prefetchQueue.values();

    for (let i = 0; i < size; i++) {
      const next = iterator.next();
      if (next.done) break;
      batch.push(next.value);
    }

    // Remove from queue
    for (const id of batch) {
      this.prefetchQueue.delete(id);
    }

    return batch;
  }

  /**
   * Check if email body is loaded
   */
  isBodyLoaded(emailId: string): boolean {
    const email = this.emailIndex.get(emailId);
    return email?.bodyLoaded || false;
  }

  /**
   * Update email body in cache
   */
  updateEmailBody(emailId: string, textBody: string | null, htmlBody: string | null): boolean {
    const email = this.emailIndex.get(emailId);
    if (!email) return false;

    email.textBody = textBody;
    email.htmlBody = htmlBody;
    email.bodyLoaded = true;
    return true;
  }

  /**
   * Clear cache for account
   */
  clearAccount(accountId: string): void {
    const accountCache = this.cache.get(accountId);
    if (!accountCache) return;

    // Remove all emails from index
    for (const [, emails] of accountCache) {
      for (const email of emails) {
        this.emailIndex.delete(email.id);
      }
    }

    this.cache.delete(accountId);
    this.stats.size = this.emailIndex.size;
    console.log(`[Memory Cache] Cleared cache for account ${accountId}`);
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.emailIndex.clear();
    this.prefetchQueue.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      lastUpdate: Date.now()
    };
    console.log('[Memory Cache] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;

    return {
      ...this.stats,
      hitRate: Math.round(hitRate * 100) / 100
    };
  }

  /**
   * Get memory usage estimate (in MB)
   */
  getMemoryUsage(): number {
    // Rough estimate: average email ~5KB
    return (this.stats.size * 5) / 1024;
  }
}

// Export singleton instance
export const mailCache = new MailMemoryCache();
