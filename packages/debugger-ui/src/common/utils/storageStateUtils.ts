// Define the storage state bucket name
import { STORAGE_STATE_BUCKET } from "../constants";

/**
 * Sanitizes a username to make it safe for use in filenames.
 * @param {string} username - The raw username.
 * @returns {string} - The sanitized username with invalid chars replaced by underscores.
 */
export function sanitizeUsername(username: string): string {
  return username.replace(/[^a-zA-Z0-9-_]/g, "_");
}

/**
 * Generates the S3 path for a user's storage state file.
 * @param {string} orgId - The organization ID.
 * @param {string} username - The username.
 * @param {number} environmentId - The environment ID.
 * @param {string} platform - The platform (desktop or mobile), optional for backwards compatibility.
 * @returns {string} - The full S3 URI for the storage state file.
 */
export function getStorageStateS3Path(orgId: string, username: string, environmentId: number, platform?: string): string {
  // Sanitize the username to ensure it's valid for a filename
  const sanitizedUsername = sanitizeUsername(username);

  // Generate the S3 key with platform support
  let s3Key: string;
  if (platform) {
    s3Key = `${orgId}/${sanitizedUsername}-${environmentId}-${platform}.json`;
  } else {
    // Backwards compatibility: use old format without platform
    s3Key = `${orgId}/${sanitizedUsername}-${environmentId}.json`;
  }

  // Return the full S3 URI
  return `s3://${STORAGE_STATE_BUCKET}/${s3Key}`;
}