import crypto from 'crypto';

// ============================================================================
// PASSWORD HASHING (for master password authentication)
// ============================================================================

/**
 * Generate a random salt for password hashing
 * @returns Hex-encoded salt string
 */
export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Hash a password with a salt using PBKDF2
 * This is used for storing the master password hash
 * @param password - The password to hash
 * @param salt - The salt to use
 * @returns Hex-encoded hash string
 */
export function hashPassword(password: string, salt: string): string {
  return crypto
    .pbkdf2Sync(password, salt, 100000, 64, 'sha512')
    .toString('hex');
}

/**
 * Verify a password against a hash and salt
 * @param password - The password to verify
 * @param salt - The salt used for hashing
 * @param storedHash - The stored hash to compare against
 * @returns True if password matches, false otherwise
 */
export function verifyPassword(
  password: string,
  salt: string,
  storedHash: string
): boolean {
  const hash = hashPassword(password, salt);
  
  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(storedHash, 'hex')
  );
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Generate a secure session token
 * @returns Hex-encoded token string
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a random user ID for anonymous usage tracking
 * @returns Hex-encoded ID string
 */
export function generateUserId(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ============================================================================
// PASSWORD STRENGTH VALIDATION
// ============================================================================

export interface PasswordStrength {
  isValid: boolean;
  score: number; // 0-4
  feedback: string[];
}

/**
 * Check password strength
 * @param password - Password to check
 * @returns Password strength analysis
 */
export function checkPasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];
  let score = 0;

  // Minimum length check
  if (password.length < 8) {
    feedback.push('Password must be at least 8 characters long');
  } else if (password.length >= 8) {
    score++;
  }

  if (password.length >= 12) {
    score++;
  }

  // Contains lowercase
  if (/[a-z]/.test(password)) {
    score++;
  } else {
    feedback.push('Add lowercase letters');
  }

  // Contains uppercase
  if (/[A-Z]/.test(password)) {
    score++;
  } else {
    feedback.push('Add uppercase letters');
  }

  // Contains numbers
  if (/[0-9]/.test(password)) {
    score++;
  } else {
    feedback.push('Add numbers');
  }

  // Contains special characters
  if (/[^A-Za-z0-9]/.test(password)) {
    score++;
  } else {
    feedback.push('Add special characters (!@#$%^&*)');
  }

  // Check for common passwords (basic check)
  const commonPasswords = ['password', '123456', 'qwerty', 'admin'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    feedback.push('Avoid common passwords');
    score = Math.max(0, score - 2);
  }

  // Normalize score to 0-4
  score = Math.min(4, Math.max(0, Math.floor(score / 1.5)));

  return {
    isValid: score >= 3 && password.length >= 8,
    score,
    feedback
  };
}

// ============================================================================
// RATE LIMITING (for login attempts)
// ============================================================================

interface LoginAttempt {
  count: number;
  firstAttempt: number;
  blockedUntil: number | null;
}

const loginAttempts = new Map<string, LoginAttempt>();

/**
 * Check if login attempts should be rate limited
 * @param username - Username attempting to login
 * @returns Object with isBlocked status and wait time
 */
export function checkLoginRateLimit(username: string): {
  isBlocked: boolean;
  waitTime: number;
  attemptsRemaining: number;
} {
  const now = Date.now();
  const attempt = loginAttempts.get(username);

  if (!attempt) {
    return { isBlocked: false, waitTime: 0, attemptsRemaining: 5 };
  }

  // Check if still blocked
  if (attempt.blockedUntil && attempt.blockedUntil > now) {
    return {
      isBlocked: true,
      waitTime: Math.ceil((attempt.blockedUntil - now) / 1000),
      attemptsRemaining: 0
    };
  }

  // Reset if more than 15 minutes passed
  if (now - attempt.firstAttempt > 15 * 60 * 1000) {
    loginAttempts.delete(username);
    return { isBlocked: false, waitTime: 0, attemptsRemaining: 5 };
  }

  return {
    isBlocked: false,
    waitTime: 0,
    attemptsRemaining: Math.max(0, 5 - attempt.count)
  };
}

/**
 * Record a failed login attempt
 * @param username - Username that failed to login
 */
export function recordFailedLogin(username: string): void {
  const now = Date.now();
  const attempt = loginAttempts.get(username);

  if (!attempt) {
    loginAttempts.set(username, {
      count: 1,
      firstAttempt: now,
      blockedUntil: null
    });
    return;
  }

  attempt.count++;

  // Block after 5 failed attempts
  if (attempt.count >= 5) {
    // Block for progressively longer periods
    const blockDuration = Math.min(
      30 * 60 * 1000, // Max 30 minutes
      5 * 60 * 1000 * Math.pow(2, attempt.count - 5) // Exponential backoff
    );
    attempt.blockedUntil = now + blockDuration;
  }

  loginAttempts.set(username, attempt);
}

/**
 * Clear login attempts for a user (after successful login)
 * @param username - Username to clear attempts for
 */
export function clearLoginAttempts(username: string): void {
  loginAttempts.delete(username);
}

/**
 * Clean up old login attempt records (call periodically)
 */
export function cleanupLoginAttempts(): void {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour

  for (const [username, attempt] of loginAttempts.entries()) {
    if (now - attempt.firstAttempt > maxAge) {
      loginAttempts.delete(username);
    }
  }
}

// Clean up every hour
setInterval(cleanupLoginAttempts, 60 * 60 * 1000);