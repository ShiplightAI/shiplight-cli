import React, { ReactNode } from "react";
import { RestrictedComponent } from "./RestrictedComponent";

interface DevelopmentOnlyProps {
  children: ReactNode;
  alternative?: ReactNode; // Content to show in production
  className?: string;
  showBadge?: boolean; // Allow disabling badge for specific cases
}

export const DevelopmentOnly: React.FC<DevelopmentOnlyProps> = ({
  children,
  alternative = null,
  className = "",
  showBadge = true
}) => {
  return (
    <RestrictedComponent
      type="development"
      checkCondition={() => process.env.NODE_ENV === 'development'}
      alternative={alternative}
      className={className}
      showBadge={showBadge}
    >
      {children}
    </RestrictedComponent>
  );
};