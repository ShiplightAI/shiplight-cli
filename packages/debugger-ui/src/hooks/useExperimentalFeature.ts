import { useAuthContext } from "@/contexts/AuthContext";
import { useLocalStorage } from "@mantine/hooks";
import { useMemo } from "react";

export const EXPERIMENTAL_FEATURES = {
  TEST_CASE_DEVICE_SELECTION: "test_case_device_selection",
  ISSUES: "issues",
  PURE_VISION_MODE: "pure_vision_mode",
  UNIFIED_AI_ACTION_AND_STEP: "unified_ai_action_and_step",
  VIEWS: "views",
  BROWSER_EXTENSION: "browser_extension",
  ANALYTICS: "analytics",
  ENVIRONMENT_BROWSER_SETTINGS: "environment_browser_settings",
  RUN_RECORDS: "run_records",
} as const;

// Internal users are users with shiplight.ai email addresses, or shiplight-test accounts
export const useIsInternal = () => {
  const { user } = useAuthContext();
  if (!user?.email) return false;
  return (
    user?.email?.endsWith("@shiplight.ai") ||
    user?.email?.startsWith("shiplight-test")
  );
};

export function useExperimentalFeatureVisible() {
  const [_isVisible, setVisible] = useLocalStorage({ key: "experienceFeaturesVisible", defaultValue: false });
  const isInternal = useIsInternal();
  const isVisible = useMemo(() => isInternal && _isVisible, [_isVisible, isInternal]);
  return { isVisible, setVisible };
}

export function useDebugging() {
  const [isEnabled, setEnabled] = useLocalStorage({ key: "debuggingEnabled", defaultValue: false });
  const isInternal = useIsInternal();
  const envEnabled = process.env.NEXT_PUBLIC_SHOW_DEBUG_INFO === 'true';
  const isDebuggingEnabled = useMemo(
    () => envEnabled || (isInternal && isEnabled),
    [isEnabled, isInternal, envEnabled]
  );
  return { isDebuggingEnabled, setEnabled };
}

export function useExperimentalFeature(featureName: string): boolean {
  const { organization } = useAuthContext();

  const { isVisible } = useExperimentalFeatureVisible();

  if (featureName === EXPERIMENTAL_FEATURES.TEST_CASE_DEVICE_SELECTION) {
    return true;
  }
  if (featureName === EXPERIMENTAL_FEATURES.ISSUES) {
    return true;
  }
  if (featureName === EXPERIMENTAL_FEATURES.ANALYTICS) {
    return true;
  }
  if (organization?.settings?.features?.[featureName] === true) {
    return true;
  }
  return isVisible;
}

