// lib/api-client.ts
// API Client that uses Electron IPC instead of HTTP fetch

export class APIClient {
  private getMasterPassword(): string {
    const masterPassword = sessionStorage.getItem("mp");
    if (!masterPassword) {
      throw new Error("Session expired. Please log in again.");
    }
    return masterPassword;
  }

  private get electronAPI() {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI;
    }
    throw new Error('Electron API not available');
  }

  // ========== AUTH API ==========
  async login(username: string, password: string) {
    const result = await this.electronAPI.auth.login(username, password);
    if (!result.success) {
      throw new Error(result.error || 'Login failed');
    }
    return result;
  }

  async signup(username: string, password: string) {
    const result = await this.electronAPI.auth.signup(username, password);
    if (!result.success) {
      throw new Error(result.error || 'Signup failed');
    }
    return result;
  }

  async verify() {
    const result = await this.electronAPI.auth.verify();
    return result;
  }

  async logout() {
    const result = await this.electronAPI.auth.logout();
    return result;
  }

  // ========== CREDENTIALS API ==========
  async fetchCredentials(categoryId?: number | null, search?: string) {
    const masterPassword = this.getMasterPassword();
    const result = await this.electronAPI.credentials.fetch(masterPassword, categoryId, search);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch credentials');
    }
    
    return { credentials: result.credentials || [] };
  }

  async createCredential(data: {
    categoryId?: number | null;
    title: string;
    siteLink?: string;
    username?: string;
    password: string;
    description?: string;
  }) {
    const masterPassword = this.getMasterPassword();
    
    const result = await this.electronAPI.credentials.create({
      ...data,
      masterPassword
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to create credential');
    }
    
    return result;
  }

  async updateCredential(id: number, data: any) {
    const masterPassword = this.getMasterPassword();
    
    const result = await this.electronAPI.credentials.update({
      id,
      ...data,
      masterPassword
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to update credential');
    }
    
    return result;
  }

  async deleteCredential(id: number) {
    const result = await this.electronAPI.credentials.delete(id);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete credential');
    }
    
    return result;
  }

  // ========== CATEGORIES API ==========
  async fetchCategories() {
    const result = await this.electronAPI.categories.fetch();
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch categories');
    }
    
    return { categories: result.categories || [] };
  }

  async createCategory(data: { name: string; color: string }) {
    const result = await this.electronAPI.categories.create(data.name, data.color);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to create category');
    }
    
    return result;
  }

  async updateCategory(data: { id: number; name: string; color: string }) {
    const result = await this.electronAPI.categories.update(data.id, data.name, data.color);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to update category');
    }
    
    return result;
  }

  async deleteCategory(id: number) {
    const result = await this.electronAPI.categories.delete(id);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete category');
    }
    
    return result;
  }

  // ========== NOTES API ==========
  async fetchNotes() {
    const result = await this.electronAPI.notes.fetch();
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch notes');
    }
    
    return { notes: result.notes || [] };
  }

  async createNote(data: { title: string; content?: string; color?: string }) {
    const result = await this.electronAPI.notes.create(data.title, data.content, data.color);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to create note');
    }
    
    return result;
  }

  async updateNote(
    id: number,
    data: {
      title?: string;
      content?: string;
      color?: string;
      position_x?: number;
      position_y?: number;
      width?: number;
      height?: number;
    }
  ) {
    const result = await this.electronAPI.notes.update(id, data);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to update note');
    }
    
    return result;
  }

  async deleteNote(id: number) {
    const result = await this.electronAPI.notes.delete(id);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete note');
    }
    
    return result;
  }
}

// Export singleton instance
export const apiClient = new APIClient();




