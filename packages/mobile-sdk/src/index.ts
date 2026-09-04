/**
 * Shiplight Mobile SDK - AI-Powered Mobile Test Automation
 *
 * Main entry point for the mobile-sdk package
 */

// =============================================================================
// Configuration - SDK-wide settings and agent initialization
// =============================================================================
export {
  configureMobileSdk,
  getMobileSdkConfig,
  initializeAgent,
  type MobileSdkConfig,
  type AIProvider,
  type AgentType,
  type InitializeAgentOptions,
} from './config';

// =============================================================================
// Agents - AI-powered mobile automation
// =============================================================================

// Everything is now organized under agents/
export * from './agents';

// =============================================================================
// Utilities
// =============================================================================
export { convertTrajectoryToTestFlow } from './utils/testFlowConverter';
export { agentLogger } from './utils/agentLogger';

// =============================================================================
// Devices - ADB/WDA wrappers
// =============================================================================
export * from './devices/common/types';
export * from './devices/common/utils';
export { VisionVerifier } from './devices/common/visionVerifier';
export type { VerificationResult } from './devices/common/visionVerifier';
export { AndroidDevice } from './devices/android/device';
export type { AndroidDeviceOptions } from './devices/android/device';
export { IOSDevice } from './devices/ios/device';
export type { IOSDeviceOptions } from './devices/ios/device';
export { WDAClient } from './devices/ios/wdaClient';
export type { WDAClientOptions } from './devices/ios/wdaClient';

// =============================================================================
// Elements - UI hierarchy extraction
// =============================================================================
export * from './elements';
export { AndroidElementService } from './elements/AndroidElementService';
export type { MobileElement, ElementBounds, ElementExtractionResult } from './elements/types';
