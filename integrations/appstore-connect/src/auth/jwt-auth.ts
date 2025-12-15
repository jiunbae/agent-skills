/**
 * App Store Connect API - JWT Authentication
 *
 * Generates JWT tokens for App Store Connect API authentication.
 * Uses ES256 algorithm as required by Apple.
 */

import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import type { AppStoreConnectConfig, JWTPayload } from '../types.js';
import { AuthenticationError, ConfigurationError } from '../utils/errors.js';
import { readPrivateKey } from '../utils/config.js';

// Token expiration buffer (refresh 1 minute before expiry)
const EXPIRY_BUFFER_MS = 60 * 1000;

// Maximum token lifetime (20 minutes as per Apple docs)
const MAX_TOKEN_LIFETIME_MS = 20 * 60 * 1000;

// Default token lifetime (15 minutes)
const DEFAULT_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

/**
 * JWT Authentication Manager for App Store Connect API
 */
export class JWTAuthManager {
  private readonly config: AppStoreConnectConfig;
  private privateKey: string | null = null;
  private currentToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: AppStoreConnectConfig) {
    this.config = config;
  }

  /**
   * Get the private key (lazy loading)
   */
  private getPrivateKey(): string {
    if (this.privateKey) {
      return this.privateKey;
    }

    if (this.config.privateKey) {
      this.privateKey = this.config.privateKey;
    } else if (this.config.privateKeyPath) {
      this.privateKey = readPrivateKey(this.config.privateKeyPath);
    } else {
      throw new ConfigurationError('No private key available');
    }

    // Validate key format
    if (!this.privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      throw new ConfigurationError(
        'Invalid private key format. Expected PEM format with "-----BEGIN PRIVATE KEY-----" header.'
      );
    }

    return this.privateKey;
  }

  /**
   * Generate a new JWT token
   */
  public generateToken(): string {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = DEFAULT_TOKEN_LIFETIME_MS / 1000;

    const payload: JWTPayload = {
      iss: this.config.issuerId,
      iat: now,
      exp: now + expiresIn,
      aud: 'appstoreconnect-v1',
    };

    try {
      const privateKey = this.getPrivateKey();

      const token = jwt.sign(payload, privateKey, {
        algorithm: 'ES256',
        header: {
          alg: 'ES256',
          kid: this.config.keyId,
          typ: 'JWT',
        },
      });

      // Cache the token
      this.currentToken = token;
      this.tokenExpiry = (now + expiresIn) * 1000;

      return token;
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }

      throw new AuthenticationError(
        `Failed to generate JWT: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: String(error) }
      );
    }
  }

  /**
   * Check if the current token is expired or about to expire
   */
  public isTokenExpired(): boolean {
    if (!this.currentToken) {
      return true;
    }

    return Date.now() >= this.tokenExpiry - EXPIRY_BUFFER_MS;
  }

  /**
   * Get a valid token (generate new if expired)
   */
  public getValidToken(): string {
    if (this.isTokenExpired()) {
      return this.generateToken();
    }

    return this.currentToken!;
  }

  /**
   * Get authorization headers for API requests
   */
  public getAuthHeaders(): Record<string, string> {
    const token = this.getValidToken();

    return {
      Authorization: `Bearer ${token}`,
    };
  }

  /**
   * Decode token payload (for debugging)
   */
  public decodeToken(token?: string): JWTPayload | null {
    const tokenToDecode = token || this.currentToken;

    if (!tokenToDecode) {
      return null;
    }

    try {
      const decoded = jwt.decode(tokenToDecode) as JWTPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Get remaining token lifetime in seconds
   */
  public getRemainingLifetime(): number {
    if (!this.currentToken || this.isTokenExpired()) {
      return 0;
    }

    return Math.max(0, Math.floor((this.tokenExpiry - Date.now()) / 1000));
  }

  /**
   * Invalidate the current token (force regeneration)
   */
  public invalidateToken(): void {
    this.currentToken = null;
    this.tokenExpiry = 0;
  }

  /**
   * Test the JWT configuration by generating a token
   */
  public async testConfiguration(): Promise<{
    success: boolean;
    message: string;
    tokenInfo?: {
      issuerId: string;
      keyId: string;
      expiresAt: string;
      remainingSeconds: number;
    };
  }> {
    try {
      const token = this.generateToken();
      const decoded = this.decodeToken(token);

      if (!decoded) {
        return {
          success: false,
          message: 'Failed to decode generated token',
        };
      }

      return {
        success: true,
        message: 'JWT configuration is valid',
        tokenInfo: {
          issuerId: decoded.iss,
          keyId: this.config.keyId,
          expiresAt: new Date(decoded.exp * 1000).toISOString(),
          remainingSeconds: this.getRemainingLifetime(),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Create a JWT auth manager from environment configuration
 */
export function createJWTAuthManager(
  config: AppStoreConnectConfig
): JWTAuthManager {
  return new JWTAuthManager(config);
}
