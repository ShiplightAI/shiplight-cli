/**
 * Login configuration types
 * Shared across common, web-sdk, and test-fixtures packages
 */

import type { ActionEntity } from '../test-flow/actionEntity';

export enum LoginType {
  PASSWORD = "password",
  OAUTH2 = "oauth2",
  SSO = "sso",
  API = "api",
}

export enum TwoFactorAuthType {
  SMS = "sms",
  EMAIL = "email",
  TOTP = "totp",
}

export interface TwoFactorAuthConfig {
  type: TwoFactorAuthType;
  /** Secret key for TOTP, phone for SMS, etc. */
  data: string;
}

export interface EmailVerificationConfig {
  /** Whether to enable email verification during login */
  enabled: boolean;
  /** Email verification method */
  method: "verification_code" | "activation_link";
  /** IMAP configuration for email access */
  imap_config: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
  /** Email filters for finding verification emails */
  filters?: {
    from?: string;
    subject?: string;
    since?: string;
    body_contains?: string;
  };
  /** Custom prompt for email content extraction (when method is not standard) */
  custom_prompt?: string;
  /** Whether to use forward email (mailgun) instead of direct IMAP */
  use_forward_email?: boolean;
  /** Timeout for waiting for email (in seconds) */
  timeout_seconds?: number;
}

export interface EmailExtractionConfig {
  method: 'verification_code' | 'activation_link' | 'custom';
  /**
   * The email address to forward emails to.
   * Fixed email suffix is @forward.shiplight.ai, the prefix is a string
   * combined with the user email, for example user123@example.com's forward
   * email is user123_example_com@forward.shiplight.ai
   */
  forward_email: string;
  /** Custom prompt for email content extraction (when method is not standard) */
  custom_prompt?: string;
  /** Timeout for waiting for email (in seconds) */
  timeout_seconds?: number;
  filters?: {
    /** The email sender */
    from: string;
    /** The email subject */
    subject?: string;
    /** The keyword in the email body */
    body_contains?: string;
  };
}

export interface AccountBase {
  type: LoginType;
  username: string;
  password: string;
  two_factor_auth_config?: TwoFactorAuthConfig;
  /** Email verification/activation configuration */
  email_verification_config?: EmailVerificationConfig;
  /**
   * If enabled, save the storage state after the first successful login.
   * When the storage state is expired, it will be refreshed.
   */
  disable_storage_state?: boolean;
  /**
   * If enabled, cache actions used to login during the first attempt.
   * This is less-reliable because the UI can change, locator may change, etc.
   */
  disable_action_cache?: boolean;
}

export interface PasswordAccount extends AccountBase {
  type: LoginType.PASSWORD;
}

export interface OAuth2Account extends AccountBase {
  type: LoginType.OAUTH2;
  provider_name: string;
}

/**
 * Simplified login account for test-fixtures
 */
export interface LoginAccount {
  type: LoginType;
  username: string;
  password: string;
  two_factor_auth_config?: TwoFactorAuthConfig;
  /** For OAuth2 */
  provider_name?: string;
}

export interface LoginConfig {
  site_url: string;
  account: AccountBase | LoginAccount;
  /** Additional signin instructions */
  additional_prompt?: string;
  /** Hint for generate verification code */
  verification_hint?: string;
  /**
   * If enabled, use AI + verification_hint to check whether the page is already signed in,
   * instead of using cached login_validation_exprs for the initial already-logged-in check.
   */
  use_ai_verification_for_login_check?: boolean;
  /** Skip login verification */
  skip_verification?: boolean;
  /** Number of validation expressions to generate (default: 1, set to 0 to disable) */
  num_verification_exprs?: number;
  email_extraction_config?: EmailExtractionConfig;
}

/**
 * Cache for login.
 * If the cache files are not provided, the login will be performed without cache.
 */
export interface LoginCache {
  cached_actions?: ActionEntity[];
  validation_exprs?: string[];
}

/**
 * Result of login.
 * If the login is successful, the page will be returned.
 * If storage_state is provided, the caller needs to refresh the storage state.
 * If cached_actions are updated, the new cached_actions will be returned.
 * If validation_exprs are updated, the new validation_exprs will be returned.
 *
 * @template TPage - The page type (e.g., playwright's Page). Defaults to unknown.
 */
export interface LoginResult<TPage = unknown> {
  success: boolean;
  page: TPage;
  storage_state?: any;
  cached_actions?: ActionEntity[];
  validation_exprs?: string[];
  /** True if login was validated from existing storage state (no new login performed) */
  alreadyLoggedIn?: boolean;
}
