import crypto from 'crypto';

// ============================================================================
// ENCRYPTION KEY DERIVATION
// ============================================================================

/**
 * Derives an encryption key from the user's master password using scrypt
 * This key is used to encrypt/decrypt vault passwords
 * 
 * Note: Using scrypt (built into Node.js) which is memory-hard and secure.
 * Alternative: Can use argon2 package for production if needed.
 * 
 * @param masterPassword - User's master password
 * @param salt - Salt for key derivation (user's salt from database)
 * @returns 32-byte encryption key
 */
export function deriveEncryptionKey(
  masterPassword: string,
  salt: string
): Buffer {
  // Synchronous version for better-sqlite3 compatibility
  return crypto.scryptSync(masterPassword, salt, 32);
}

/**
 * Async version of deriveEncryptionKey (for compatibility if needed)
 */
export async function deriveEncryptionKeyAsync(
  masterPassword: string,
  salt: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(masterPassword, salt, 32, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// ============================================================================
// PASSWORD ENCRYPTION/DECRYPTION
// ============================================================================

/**
 * Encrypts a password using AES-256-GCM (authenticated encryption)
 * 
 * AES-256-GCM provides both confidentiality and authenticity:
 * - Confidentiality: Data is encrypted
 * - Authenticity: Auth tag ensures data hasn't been tampered with
 * 
 * @param plaintext - The password to encrypt
 * @param encryptionKey - Derived from user's master password (32 bytes)
 * @returns Encrypted data with IV and auth tag (format: iv:authTag:encrypted)
 */
export function encryptPassword(
  plaintext: string,
  encryptionKey: Buffer
): string {
  try {
    // Generate a random initialization vector (IV)
    // IV must be unique for each encryption operation
    const iv = crypto.randomBytes(16);
    
    // Create cipher using AES-256-GCM (authenticated encryption)
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    
    // Encrypt the password
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get authentication tag for integrity verification
    const authTag = cipher.getAuthTag();
    
    // Return format: iv:authTag:encryptedData (all in hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt password');
  }
}

/**
 * Decrypts a password using AES-256-GCM
 * 
 * Verifies authentication tag to ensure data integrity before decrypting
 * 
 * @param encryptedData - Format: iv:authTag:encrypted (all hex)
 * @param encryptionKey - Derived from user's master password (32 bytes)
 * @returns Decrypted password
 * @throws Error if decryption fails or data has been tampered with
 */
export function decryptPassword(
  encryptedData: string,
  encryptionKey: Buffer
): string {
  try {
    // Split the encrypted data
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const [ivHex, authTagHex, encryptedHex] = parts;
    
    // Validate hex strings
    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error('Invalid encrypted data: missing components');
    }
    
    // Convert from hex back to Buffer
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    // Validate buffer sizes
    if (iv.length !== 16) {
      throw new Error('Invalid IV length');
    }
    if (authTag.length !== 16) {
      throw new Error('Invalid auth tag length');
    }
    
    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    // Decrypt
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error: any) {
    console.error('Decryption error:', error.message);
    
    // Provide more specific error messages
    if (error.message.includes('Unsupported state or unable to authenticate data')) {
      throw new Error('Decryption failed: Wrong password or corrupted data');
    }
    
    throw new Error('Failed to decrypt password');
  }
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Encrypts multiple passwords at once
 * Useful for bulk operations or initial vault encryption
 * 
 * @param passwords - Array of plaintext passwords
 * @param encryptionKey - Derived encryption key
 * @returns Array of encrypted passwords
 */
export function encryptPasswords(
  passwords: string[],
  encryptionKey: Buffer
): string[] {
  return passwords.map(pwd => encryptPassword(pwd, encryptionKey));
}

/**
 * Decrypts multiple passwords at once
 * Useful for bulk operations or displaying multiple credentials
 * 
 * @param encryptedPasswords - Array of encrypted passwords
 * @param encryptionKey - Derived encryption key
 * @returns Array of decrypted passwords
 */
export function decryptPasswords(
  encryptedPasswords: string[],
  encryptionKey: Buffer
): string[] {
  return encryptedPasswords.map(enc => decryptPassword(enc, encryptionKey));
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a secure random password
 * @param length - Password length (default: 16)
 * @param includeSymbols - Include special characters (default: true)
 * @returns Generated password
 */
export function generateSecurePassword(
  length: number = 16,
  includeSymbols: boolean = true
): string {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  let charset = lowercase + uppercase + numbers;
  if (includeSymbols) {
    charset += symbols;
  }
  
  // Ensure at least one character from each category
  let password = '';
  password += lowercase[crypto.randomInt(lowercase.length)];
  password += uppercase[crypto.randomInt(uppercase.length)];
  password += numbers[crypto.randomInt(numbers.length)];
  if (includeSymbols) {
    password += symbols[crypto.randomInt(symbols.length)];
  }
  
  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += charset[crypto.randomInt(charset.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => crypto.randomInt(3) - 1).join('');
}

/**
 * Validate encryption key format
 * @param key - Encryption key to validate
 * @returns True if key is valid
 */
export function isValidEncryptionKey(key: Buffer): boolean {
  return Buffer.isBuffer(key) && key.length === 32;
}

/**
 * Securely zero out sensitive data from memory
 * @param buffer - Buffer to clear
 */
export function secureClear(buffer: Buffer): void {
  if (Buffer.isBuffer(buffer)) {
    buffer.fill(0);
  }
}

/**
 * Test encryption/decryption with a sample password
 * Useful for verifying the master password is correct
 * 
 * @param encryptionKey - Key to test
 * @returns True if encryption/decryption works
 */
export function testEncryptionKey(encryptionKey: Buffer): boolean {
  try {
    const testData = 'test_password_verification';
    const encrypted = encryptPassword(testData, encryptionKey);
    const decrypted = decryptPassword(encrypted, encryptionKey);
    return decrypted === testData;
  } catch {
    return false;
  }
}