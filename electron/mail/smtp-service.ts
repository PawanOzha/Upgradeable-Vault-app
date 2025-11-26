/**
 * SMTP Service
 *
 * Handles email sending via SMTP
 * Uses nodemailer for reliable email delivery
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import * as fs from 'fs';

// Transporter pool
const transporterPool = new Map<string, Transporter>();

interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface EmailToSend {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer | string;
    contentType?: string;
  }>;
  inReplyTo?: string;
  references?: string[];
}

/**
 * Create SMTP transporter
 */
export function createSMTPTransporter(accountId: string, config: SMTPConfig): Transporter {
  // Check if already exists
  const existing = transporterPool.get(accountId);
  if (existing) {
    return existing;
  }

  console.log(`[SMTP] Creating transporter for ${config.host}:${config.port}`);

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure, // true for 465, false for other ports
    auth: {
      user: config.auth.user,
      pass: config.auth.pass,
    },
    // Extended timeout settings
    connectionTimeout: 30000, // 30 seconds
    greetingTimeout: 30000, // 30 seconds
    socketTimeout: 60000, // 60 seconds
    // Enable TLS/STARTTLS
    requireTLS: !config.secure,
    // TLS options
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates
      minVersion: 'TLSv1.2',
    },
  });

  // Store in pool
  transporterPool.set(accountId, transporter);

  return transporter;
}

/**
 * Test SMTP connection
 */
export async function testSMTPConnection(config: SMTPConfig): Promise<boolean> {
  console.log(`[SMTP] Testing connection to ${config.host}:${config.port} (secure: ${config.secure})`);

  const testTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    // Extended timeout settings
    connectionTimeout: 30000, // 30 seconds for connection
    greetingTimeout: 30000, // 30 seconds for greeting
    socketTimeout: 60000, // 60 seconds for socket
    // TLS options
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates
      minVersion: 'TLSv1.2',
    },
    // Debug logging (set to true for troubleshooting)
    debug: false,
  });

  try {
    console.log(`[SMTP] Attempting to verify connection...`);
    await testTransporter.verify();
    console.log('[SMTP] Connection test successful');
    testTransporter.close();
    return true;
  } catch (error: any) {
    console.error('[SMTP] Connection test failed:', error);
    console.error('[SMTP] Error details:', {
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
      errorMessage = `Connection refused by ${config.host}:${config.port}. Check if SMTP server is running and port is correct.`;
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = `Server ${config.host} not found. Check hostname spelling and DNS settings.`;
    } else if (error.message?.includes('certificate')) {
      errorMessage = `SSL/TLS certificate error. Server may use self-signed certificate.`;
    } else if (error.responseCode === 535 || error.message?.includes('authentication') || error.message?.includes('auth')) {
      errorMessage = `Authentication failed. Check username and password. For 2FA accounts, use an app-specific password.`;
    }

    testTransporter.close();

    const enhancedError = new Error(errorMessage);
    (enhancedError as any).originalError = error;
    throw enhancedError;
  }
}

/**
 * Send email
 */
export async function sendEmail(
  accountId: string,
  transporter: Transporter,
  email: EmailToSend
): Promise<any> {
  console.log(`[SMTP] Sending email from ${email.from} to ${email.to.join(', ')}`);

  try {
    // Prepare mail options
    const mailOptions: any = {
      from: email.from,
      to: email.to.join(', '),
      subject: email.subject,
    };

    // Add CC if present
    if (email.cc && email.cc.length > 0) {
      mailOptions.cc = email.cc.join(', ');
    }

    // Add BCC if present
    if (email.bcc && email.bcc.length > 0) {
      mailOptions.bcc = email.bcc.join(', ');
    }

    // Add body (prefer HTML, fallback to text)
    if (email.html) {
      mailOptions.html = email.html;
      if (email.text) {
        mailOptions.text = email.text;
      }
    } else if (email.text) {
      mailOptions.text = email.text;
    }

    // Add threading headers for replies
    if (email.inReplyTo) {
      mailOptions.inReplyTo = email.inReplyTo;
    }
    if (email.references && email.references.length > 0) {
      mailOptions.references = email.references.join(' ');
    }

    // Add attachments if present
    if (email.attachments && email.attachments.length > 0) {
      mailOptions.attachments = email.attachments.map((att) => {
        // If it's a file path, use it
        if (att.path && fs.existsSync(att.path)) {
          return {
            filename: att.filename,
            path: att.path,
            contentType: att.contentType,
          };
        }
        // If it's content, use it
        if (att.content) {
          return {
            filename: att.filename,
            content: att.content,
            contentType: att.contentType,
          };
        }
        return null;
      }).filter(Boolean);
    }

    // Send the email
    const info = await transporter.sendMail(mailOptions);

    console.log('[SMTP] Email sent successfully:', info.messageId);
    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
    };
  } catch (error) {
    console.error('[SMTP] Send email error:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

/**
 * Send email with retry logic
 */
export async function sendEmailWithRetry(
  accountId: string,
  transporter: Transporter,
  email: EmailToSend,
  maxRetries: number = 3
): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[SMTP] Send attempt ${attempt}/${maxRetries}`);
      const result = await sendEmail(accountId, transporter, email);
      return result;
    } catch (error) {
      lastError = error as Error;
      console.error(`[SMTP] Attempt ${attempt} failed:`, error.message);

      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[SMTP] Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Failed to send email after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Get transporter for account
 */
export function getSMTPTransporter(accountId: string): Transporter | null {
  return transporterPool.get(accountId) || null;
}

/**
 * Close transporter
 */
export function closeSMTPTransporter(accountId: string): void {
  const transporter = transporterPool.get(accountId);
  if (transporter) {
    transporter.close();
    transporterPool.delete(accountId);
    console.log(`[SMTP] Closed transporter for account ${accountId}`);
  }
}

/**
 * Close all transporters
 */
export function closeAllTransporters(): void {
  console.log('[SMTP] Closing all transporters...');
  for (const [accountId, transporter] of transporterPool.entries()) {
    transporter.close();
    transporterPool.delete(accountId);
  }
  console.log('[SMTP] All transporters closed');
}
