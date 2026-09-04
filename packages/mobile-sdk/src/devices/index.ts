/**
 * mobile-sdk/devices
 * Mobile device abstraction layer for Android and iOS automation
 * Device abstraction follows the approach Midscene.js takes; the
 * implementation here is our own.
 * (formerly the internal mobile-device package)
 */

// Common types and utilities
export * from './common/types';
export * from './common/utils';
export { VisionVerifier } from './common/visionVerifier';
export type { VerificationResult } from './common/visionVerifier';

// Android
export { AndroidDevice } from './android/device';
export type { AndroidDeviceOptions } from './android/device';

// iOS
export { IOSDevice } from './ios/device';
export type { IOSDeviceOptions } from './ios/device';
export { WDAClient } from './ios/wdaClient';
export type { WDAClientOptions } from './ios/wdaClient';
