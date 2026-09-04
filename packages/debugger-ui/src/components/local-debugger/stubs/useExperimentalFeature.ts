/**
 * Stub for useExperimentalFeature in the local debugger.
 * All features and debugging are always enabled.
 */

export const EXPERIMENTAL_FEATURES = {
  TEST_CASE_DEVICE_SELECTION: "test_case_device_selection",
  ISSUES: "issues",
  PURE_VISION_MODE: "pure_vision_mode",
  UNIFIED_AI_ACTION_AND_STEP: "unified_ai_action_and_step",
  VIEWS: "views",
} as const;

export const useIsInternal = () => true;

export function useExperimentalFeatureVisible() {
  return { isVisible: true, setVisible: () => {} };
}

export function useDebugging() {
  return { isDebuggingEnabled: true, setEnabled: () => {} };
}

export function useExperimentalFeature(featureName: string): boolean {
  return true;
}
