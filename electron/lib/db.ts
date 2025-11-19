import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================

export function initDb() {
  if (!db) {
    try {
      // Store database in app's userData directory
      const dbPath = path.join(app.getPath('userData'), 'database.sqlite');
      
      db = new Database(dbPath, { verbose: console.log });
      
      console.log('Database connected successfully at:', dbPath);

      // Enable foreign keys
      db.pragma('foreign_keys = ON');

      // Create users table
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create categories table
      db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          color TEXT DEFAULT '#6366f1',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(user_id, name)
        )
      `);

      // Create credentials table
      db.exec(`
        CREATE TABLE IF NOT EXISTS credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          category_id INTEGER,
          title TEXT NOT NULL,
          site_link TEXT,
          username TEXT,
          password TEXT NOT NULL,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
        )
      `);

      // Create notes table
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          content TEXT DEFAULT '',
          color TEXT DEFAULT '#fbbf24',
          is_pinned INTEGER DEFAULT 0,
          is_floating INTEGER DEFAULT 0,
          position_x INTEGER,
          position_y INTEGER,
          width INTEGER,
          height INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      console.log('All database tables created/verified');
    } catch (error) {
      console.error('Database initialization error:', error);
      throw error;
    }
  }
  
  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

// ============================================================================
// USER FUNCTIONS
// ============================================================================

export function createUser(username: string, passwordHash: string, salt: string) {
  const database = getDb();
  
  try {
    const stmt = database.prepare(
      'INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)'
    );
    const result = stmt.run(username, passwordHash, salt);
    return { success: true, userId: result.lastInsertRowid };
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return { success: false, error: 'Username already exists' };
    }
    console.error('Create user error:', error);
    return { success: false, error: 'Database error' };
  }
}

export function getUserByUsername(username: string) {
  const database = getDb();
  const stmt = database.prepare(
    'SELECT id, username, password_hash, salt FROM users WHERE username = ?'
  );
  return stmt.get(username);
}

export function getUserById(userId: number) {
  const database = getDb();
  const stmt = database.prepare(
    'SELECT id, username, created_at FROM users WHERE id = ?'
  );
  return stmt.get(userId);
}

// ============================================================================
// CATEGORY FUNCTIONS
// ============================================================================

export function createCategory(userId: number, name: string, color: string = '#6366f1') {
  const database = getDb();
  
  try {
    const stmt = database.prepare(
      'INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)'
    );
    const result = stmt.run(userId, name, color);
    return { success: true, categoryId: result.lastInsertRowid };
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return { success: false, error: 'Category already exists' };
    }
    console.error('Create category error:', error);
    return { success: false, error: 'Database error' };
  }
}

export function getCategories(userId: number) {
  const database = getDb();
  const stmt = database.prepare(
    'SELECT * FROM categories WHERE user_id = ? ORDER BY name'
  );
  return stmt.all(userId);
}

export function getCategoryById(categoryId: number, userId: number) {
  const database = getDb();
  const stmt = database.prepare(
    'SELECT * FROM categories WHERE id = ? AND user_id = ?'
  );
  return stmt.get(categoryId, userId);
}

export function updateCategory(categoryId: number, userId: number, name: string, color: string) {
  const database = getDb();
  const stmt = database.prepare(
    'UPDATE categories SET name = ?, color = ? WHERE id = ? AND user_id = ?'
  );
  const result = stmt.run(name, color, categoryId, userId);
  return result.changes > 0;
}

export function deleteCategory(categoryId: number, userId: number) {
  const database = getDb();
  const stmt = database.prepare(
    'DELETE FROM categories WHERE id = ? AND user_id = ?'
  );
  const result = stmt.run(categoryId, userId);
  return result.changes > 0;
}

// ============================================================================
// CREDENTIAL FUNCTIONS
// ============================================================================

export function createCredential(
  userId: number,
  categoryId: number | null,
  title: string,
  siteLink: string,
  username: string,
  password: string,
  description: string
) {
  const database = getDb();
  
  const stmt = database.prepare(
    `INSERT INTO credentials (user_id, category_id, title, site_link, username, password, description) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  
  const result = stmt.run(userId, categoryId, title, siteLink, username, password, description);
  
  return { success: true, credentialId: result.lastInsertRowid };
}

export function getCredentials(userId: number, categoryId?: number | null) {
  const database = getDb();
  
  let query = `
    SELECT c.*, cat.name as category_name, cat.color as category_color
    FROM credentials c
    LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE c.user_id = ?
  `;
  
  const params: any[] = [userId];
  
  if (categoryId !== undefined) {
    if (categoryId === null) {
      query += ' AND c.category_id IS NULL';
    } else {
      query += ' AND c.category_id = ?';
      params.push(categoryId);
    }
  }
  
  query += ' ORDER BY c.created_at DESC';
  
  const stmt = database.prepare(query);
  return stmt.all(...params);
}

export function getCredentialById(credentialId: number, userId: number) {
  const database = getDb();
  const stmt = database.prepare(
    `SELECT c.*, cat.name as category_name, cat.color as category_color
     FROM credentials c
     LEFT JOIN categories cat ON c.category_id = cat.id
     WHERE c.id = ? AND c.user_id = ?`
  );
  return stmt.get(credentialId, userId);
}

export function updateCredential(
  credentialId: number,
  userId: number,
  data: {
    categoryId?: number | null;
    title?: string;
    siteLink?: string;
    username?: string;
    password?: string;
    description?: string;
  }
) {
  const database = getDb();
  
  const fields: string[] = [];
  const values: any[] = [];
  
  if (data.categoryId !== undefined) {
    fields.push('category_id = ?');
    values.push(data.categoryId);
  }
  if (data.title !== undefined) {
    fields.push('title = ?');
    values.push(data.title);
  }
  if (data.siteLink !== undefined) {
    fields.push('site_link = ?');
    values.push(data.siteLink);
  }
  if (data.username !== undefined) {
    fields.push('username = ?');
    values.push(data.username);
  }
  if (data.password !== undefined) {
    fields.push('password = ?');
    values.push(data.password);
  }
  if (data.description !== undefined) {
    fields.push('description = ?');
    values.push(data.description);
  }
  
  if (fields.length === 0) {
    return false; // Nothing to update
  }
  
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(credentialId, userId);
  
  const stmt = database.prepare(
    `UPDATE credentials SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  );
  
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteCredential(credentialId: number, userId: number) {
  const database = getDb();
  const stmt = database.prepare(
    'DELETE FROM credentials WHERE id = ? AND user_id = ?'
  );
  const result = stmt.run(credentialId, userId);
  return result.changes > 0;
}

export function searchCredentials(userId: number, searchTerm: string) {
  const database = getDb();
  
  const searchPattern = `%${searchTerm}%`;
  
  const stmt = database.prepare(
    `SELECT c.*, cat.name as category_name, cat.color as category_color
     FROM credentials c
     LEFT JOIN categories cat ON c.category_id = cat.id
     WHERE c.user_id = ? 
     AND (c.title LIKE ? OR c.description LIKE ? OR cat.name LIKE ? OR c.site_link LIKE ?)
     ORDER BY c.created_at DESC`
  );
  
  return stmt.all(userId, searchPattern, searchPattern, searchPattern, searchPattern);
}

// ============================================================================
// NOTE FUNCTIONS
// ============================================================================

export function createNote(
  userId: number,
  title: string,
  content: string = '',
  color: string = '#fbbf24'
) {
  const database = getDb();
  
  const stmt = database.prepare(
    'INSERT INTO notes (user_id, title, content, color) VALUES (?, ?, ?, ?)'
  );
  
  const result = stmt.run(userId, title, content, color);
  
  return { success: true, noteId: result.lastInsertRowid };
}

export function getNotes(userId: number) {
  const database = getDb();
  const stmt = database.prepare(
    'SELECT * FROM notes WHERE user_id = ? ORDER BY is_pinned DESC, updated_at DESC'
  );
  return stmt.all(userId);
}

export function getNote(noteId: number, userId: number) {
  const database = getDb();
  const stmt = database.prepare(
    'SELECT * FROM notes WHERE id = ? AND user_id = ?'
  );
  return stmt.get(noteId, userId);
}

export function updateNote(
  noteId: number,
  userId: number,
  data: {
    title?: string;
    content?: string;
    color?: string;
    is_pinned?: number;
    is_floating?: number;
    position_x?: number;
    position_y?: number;
    width?: number;
    height?: number;
  }
) {
  const database = getDb();
  
  const fields: string[] = [];
  const values: any[] = [];
  
  if (data.title !== undefined) {
    fields.push('title = ?');
    values.push(data.title);
  }
  if (data.content !== undefined) {
    fields.push('content = ?');
    values.push(data.content);
  }
  if (data.color !== undefined) {
    fields.push('color = ?');
    values.push(data.color);
  }
  if (data.is_pinned !== undefined) {
    fields.push('is_pinned = ?');
    values.push(data.is_pinned);
  }
  if (data.is_floating !== undefined) {
    fields.push('is_floating = ?');
    values.push(data.is_floating);
  }
  if (data.position_x !== undefined) {
    fields.push('position_x = ?');
    values.push(data.position_x);
  }
  if (data.position_y !== undefined) {
    fields.push('position_y = ?');
    values.push(data.position_y);
  }
  if (data.width !== undefined) {
    fields.push('width = ?');
    values.push(data.width);
  }
  if (data.height !== undefined) {
    fields.push('height = ?');
    values.push(data.height);
  }
  
  if (fields.length === 0) {
    return false; // Nothing to update
  }
  
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(noteId, userId);
  
  const stmt = database.prepare(
    `UPDATE notes SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  );
  
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteNote(noteId: number, userId: number) {
  const database = getDb();
  const stmt = database.prepare(
    'DELETE FROM notes WHERE id = ? AND user_id = ?'
  );
  const result = stmt.run(noteId, userId);
  return result.changes > 0;
}

export function toggleNotePin(noteId: number, userId: number) {
  const database = getDb();
  const stmt = database.prepare(
    'UPDATE notes SET is_pinned = NOT is_pinned, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
  );
  const result = stmt.run(noteId, userId);
  return result.changes > 0;
}

export function updateNotePosition(
  noteId: number,
  userId: number,
  positionX: number,
  positionY: number,
  width: number,
  height: number
) {
  const database = getDb();
  const stmt = database.prepare(
    'UPDATE notes SET position_x = ?, position_y = ?, width = ?, height = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
  );
  const result = stmt.run(positionX, positionY, width, height, noteId, userId);
  return result.changes > 0;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('Database connection closed');
  }
}

// Export for backup/restore functionality
export function getDatabasePath(): string {
  return path.join(app.getPath('userData'), 'database.sqlite');
}