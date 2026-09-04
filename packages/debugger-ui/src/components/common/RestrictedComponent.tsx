import React, { ReactNode, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import styles from "./RestrictedComponent.module.css";

type RestrictionType = "development" | "internal" | "debugging";

interface RestrictedComponentProps {
  children: ReactNode;
  type: RestrictionType;
  alternative?: ReactNode; // Content to show when condition is not met
  className?: string;
  showBadge?: boolean; // Allow disabling badge for specific cases
  checkCondition: () => boolean; // Function to check if content should be shown
  useWrapper?: boolean; // Use a wrapper span instead of cloning children (better for Tooltips, etc.)
}

export const RestrictedComponent: React.FC<RestrictedComponentProps> = ({
  children,
  type,
  alternative = null,
  className = "",
  showBadge = true,
  checkCondition,
  useWrapper = false,
}) => {
  const [badgeVisible, setBadgeVisible] = useState(true);
  const [badgeHovered, setBadgeHovered] = useState(false);
  const [badgePosition, setBadgePosition] = useState<{ top: number; left: number } | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);

  const shouldShow = checkCondition();

  useEffect(() => {
    if (!showBadge || !badgeVisible || !elementRef.current) return;

    const updateBadgePosition = () => {
      if (elementRef.current) {
        const rect = elementRef.current.getBoundingClientRect();
        setBadgePosition({
          top: rect.top - 20,
          left: rect.right - 20,
        });
      }
    };

    updateBadgePosition();
    window.addEventListener('scroll', updateBadgePosition, true);
    window.addEventListener('resize', updateBadgePosition);

    return () => {
      window.removeEventListener('scroll', updateBadgePosition, true);
      window.removeEventListener('resize', updateBadgePosition);
    };
  }, [showBadge, badgeVisible]);

  if (!shouldShow) {
    return <>{alternative}</>;
  }

  // Get the first child and clone it with border styling
  const childArray = React.Children.toArray(children);
  if (childArray.length === 0) {
    return <>{children}</>;
  }

  const firstChild = childArray[0];
  if (!React.isValidElement(firstChild)) {
    return <>{children}</>;
  }

  const wrapperClass =
    type === "development" ? styles.developmentWrapper :
    type === "debugging" ? styles.debuggingWrapper :
    styles.internalWrapper;

  // Configuration based on restriction type
  const config = {
    development: {
      icon: "🛠️",
      text: "DEV ONLY",
      backgroundColor: "#3b82f6",
    },
    internal: {
      icon: "⚠️",
      text: "INTERNAL ONLY",
      backgroundColor: "#dc2626",
    },
    debugging: {
      icon: "🐛",
      text: "DEBUG",
      backgroundColor: "#6b7280",
    },
  };

  const { icon, text, backgroundColor } = config[type];

  // When useWrapper is true, wrap children in a span instead of cloning
  // This preserves child component behavior (like Tooltips)
  if (useWrapper) {
    return (
      <span
        ref={elementRef}
        className={`${wrapperClass} ${className}`.trim()}
        data-restriction-type={type}
      >
        {children}
      </span>
    );
  }

  const enhancedChild = React.cloneElement(firstChild as React.ReactElement<any>, {
    ref: elementRef,
    className: `${(firstChild.props as any).className || ''} ${wrapperClass} ${className}`.trim(),
    'data-restriction-type': type,
  });

  return (
    <>
      {enhancedChild}
      {childArray.slice(1)}
      {/** showBadge && badgeVisible && badgePosition && createPortal(
        <div
          className={styles.badge}
          style={{
            position: 'fixed',
            top: badgePosition.top,
            left: badgePosition.left,
            backgroundColor,
          }}
          onMouseEnter={() => setBadgeHovered(true)}
          onMouseLeave={() => setBadgeHovered(false)}
          onClick={(e) => {
            e.stopPropagation();
            setBadgeVisible(false);
          }}
        >
          <span className={styles.badgeIcon}>{icon}</span>
          {badgeHovered && <span className={styles.badgeText}>{text}</span>}
        </div>,
        document.body
      ) **/}
    </>
  );
};
