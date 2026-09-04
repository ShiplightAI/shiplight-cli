import React, { ReactNode } from "react";
import { useDebugging } from "@/hooks/useExperimentalFeature";
import { RestrictedComponent } from "./RestrictedComponent";

interface DebuggingOnlyProps {
  children: ReactNode;
  alternative?: ReactNode; // Content to show for non-debugging users
  className?: string;
  showBadge?: boolean; // Allow disabling badge for specific cases
  useWrapper?: boolean; // Use a wrapper span instead of cloning children (better for Tooltips, etc.)
}

export const DebuggingOnly: React.FC<DebuggingOnlyProps> = ({
  children,
  alternative = null,
  className = "",
  showBadge = true,
  useWrapper = false
}) => {
  const { isDebuggingEnabled } = useDebugging();

  return (
    <RestrictedComponent
      type="debugging"
      checkCondition={() => isDebuggingEnabled}
      alternative={alternative}
      className={className}
      showBadge={showBadge}
      useWrapper={useWrapper}
    >
      {children}
    </RestrictedComponent>
  );
};
