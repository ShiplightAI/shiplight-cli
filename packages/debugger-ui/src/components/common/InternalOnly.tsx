import React, { ReactNode } from "react";
import { useIsInternal } from "@/hooks/useIsInternal";
import { RestrictedComponent } from "./RestrictedComponent";

interface InternalOnlyProps {
  children: ReactNode;
  alternative?: ReactNode; // Content to show for non-internal users
  className?: string;
  showBadge?: boolean; // Allow disabling badge for specific cases
  useWrapper?: boolean; // Use a wrapper span instead of cloning children (better for Tooltips, etc.)
}

export const InternalOnly: React.FC<InternalOnlyProps> = ({
  children,
  alternative = null,
  className = "",
  showBadge = true,
  useWrapper = false,
}) => {
  const isInternal = useIsInternal();

  return (
    <RestrictedComponent
      type="internal"
      checkCondition={() => isInternal}
      alternative={alternative}
      className={className}
      showBadge={showBadge}
      useWrapper={useWrapper}
    >
      {children}
    </RestrictedComponent>
  );
};