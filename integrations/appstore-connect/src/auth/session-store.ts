/**
 * App Store Connect Skill - Session Storage
 *
 * Manages browser session state persistence using Playwright's storageState.
 * Enables login state reuse across CLI invocations.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SessionState } from '../types.js';
import { SessionError } from '../utils/errors.js';
import { getDataDir, ensureDataDir } from '../utils/config.js';

// Session validity duration (7 days)
const SESSION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

// File permissions for session file (owner read/write only)
const SESSION_FILE_MODE = 0o600;

/**
 * Session Storage Manager
 */
export class SessionStore {
  private readonly storagePath: string;
  private cachedState: SessionState | null = null;

  constructor(storagePath?: string) {
    ensureDataDir();
    this.storagePath = storagePath || path.join(getDataDir(), 'browser-state.json');
  }

  /**
   * Check if session file exists
   */
  public exists(): boolean {
    return fs.existsSync(this.storagePath);
  }

  /**
   * Load session state from file
   */
  public load(): SessionState | null {
    if (this.cachedState) {
      return this.cachedState;
    }

    if (!this.exists()) {
      return null;
    }

    try {
      const content = fs.readFileSync(this.storagePath, 'utf-8');
      const state = JSON.parse(content) as SessionState;

      // Validate session structure
      if (!this.isValidSessionState(state)) {
        console.warn('Invalid session state format, removing...');
        this.clear();
        return null;
      }

      this.cachedState = state;
      return state;
    } catch (error) {
      console.warn('Failed to load session state:', error);
      return null;
    }
  }

  /**
   * Save session state to file
   */
  public save(state: SessionState): void {
    try {
      // Add timestamps
      const stateWithMeta: SessionState = {
        ...state,
        createdAt: state.createdAt || Date.now(),
        lastUsedAt: Date.now(),
      };

      const content = JSON.stringify(stateWithMeta, null, 2);

      // Write with secure permissions
      fs.writeFileSync(this.storagePath, content, {
        encoding: 'utf-8',
        mode: SESSION_FILE_MODE,
      });

      // Update cache
      this.cachedState = stateWithMeta;
    } catch (error) {
      throw new SessionError(
        `Failed to save session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Clear session state
   */
  public clear(): void {
    this.cachedState = null;

    if (this.exists()) {
      try {
        fs.unlinkSync(this.storagePath);
      } catch (error) {
        console.warn('Failed to delete session file:', error);
      }
    }
  }

  /**
   * Check if session is valid (exists and not expired)
   */
  public isValid(): boolean {
    const state = this.load();

    if (!state) {
      return false;
    }

    // Check expiration
    const age = Date.now() - (state.createdAt || 0);
    if (age > SESSION_VALIDITY_MS) {
      console.warn('Session expired, clearing...');
      this.clear();
      return false;
    }

    // Check for required cookies
    if (!state.cookies || state.cookies.length === 0) {
      return false;
    }

    // Check for Apple session cookies
    const hasAppleSession = state.cookies.some(
      (cookie) =>
        cookie.domain.includes('apple.com') &&
        (cookie.name.includes('session') ||
          cookie.name.includes('myacinfo') ||
          cookie.name.includes('itctx'))
    );

    return hasAppleSession;
  }

  /**
   * Get session age in human-readable format
   */
  public getSessionAge(): string | null {
    const state = this.load();

    if (!state?.createdAt) {
      return null;
    }

    const ageMs = Date.now() - state.createdAt;
    const hours = Math.floor(ageMs / (60 * 60 * 1000));
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }

    if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    }

    const minutes = Math.floor(ageMs / (60 * 1000));
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }

  /**
   * Get session info for display
   */
  public getInfo(): {
    exists: boolean;
    valid: boolean;
    appleId?: string;
    createdAt?: string;
    lastUsedAt?: string;
    age?: string;
    cookieCount?: number;
  } {
    const state = this.load();

    if (!state) {
      return { exists: false, valid: false };
    }

    return {
      exists: true,
      valid: this.isValid(),
      appleId: state.appleId,
      createdAt: state.createdAt
        ? new Date(state.createdAt).toISOString()
        : undefined,
      lastUsedAt: state.lastUsedAt
        ? new Date(state.lastUsedAt).toISOString()
        : undefined,
      age: this.getSessionAge() || undefined,
      cookieCount: state.cookies?.length,
    };
  }

  /**
   * Update last used timestamp
   */
  public touch(): void {
    const state = this.load();

    if (state) {
      this.save(state);
    }
  }

  /**
   * Get storage path (for Playwright context)
   */
  public getStoragePath(): string {
    return this.storagePath;
  }

  /**
   * Validate session state structure
   */
  private isValidSessionState(state: unknown): state is SessionState {
    if (!state || typeof state !== 'object') {
      return false;
    }

    const s = state as Record<string, unknown>;

    // Must have cookies array
    if (!Array.isArray(s.cookies)) {
      return false;
    }

    // Must have origins array
    if (!Array.isArray(s.origins)) {
      return false;
    }

    return true;
  }
}

/**
 * Create a session store instance
 */
export function createSessionStore(storagePath?: string): SessionStore {
  return new SessionStore(storagePath);
}

/**
 * Get the default session store
 */
let defaultSessionStore: SessionStore | null = null;

export function getDefaultSessionStore(): SessionStore {
  if (!defaultSessionStore) {
    defaultSessionStore = createSessionStore();
  }
  return defaultSessionStore;
}
