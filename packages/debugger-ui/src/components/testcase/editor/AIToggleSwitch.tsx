import React from 'react';
import { Switch, Tooltip } from '@mantine/core';

interface AIToggleSwitchProps {
  /** Whether the switch is currently checked/active */
  checked: boolean;
  /** Callback when the switch is toggled */
  onChange: (checked: boolean) => void;
  /** Icon to show when switch is ON */
  onIcon: React.ReactNode;
  /** Icon to show when switch is OFF */
  offIcon: React.ReactNode;
  /** Tooltip text when switch is ON */
  onTooltip: string;
  /** Tooltip text when switch is OFF */
  offTooltip: string;
  /** Whether the switch is disabled */
  disabled?: boolean;
  /** Custom color for the switch when checked */
  color?: string;
  /** Custom size for the switch */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Custom wrapper class for the switch */
  wrapperClassName?: string;
  /** Custom gradient class for the switch track */
  gradientClassName?: string;
  /** Warning tooltip - when set, shows yellow background and asterisk badge */
  warningTooltip?: string;
}

export const AIToggleSwitch: React.FC<AIToggleSwitchProps> = ({
  checked,
  onChange,
  onIcon,
  offIcon,
  onTooltip,
  offTooltip,
  disabled = false,
  color = "dark",
  size = "xs",
  wrapperClassName = "switch-dynamic-mode",
  gradientClassName = "animate-gradient",
  warningTooltip,
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange(event.currentTarget.checked);
  };

  // Warning state only applies when not checked (in code/non-AI mode)
  const showWarning = !checked && !!warningTooltip;

  // Determine tooltip text - warning takes precedence when applicable
  const tooltipLabel = showWarning ? warningTooltip : (checked ? onTooltip : offTooltip);

  return (
    <Tooltip
      label={tooltipLabel}
      position="top"
      withArrow
    >
      <div className={`relative ${checked ? wrapperClassName : ""}`}>
        <Switch
          size={size}
          color={color}
          checked={checked}
          onChange={handleChange}
          disabled={disabled}
          onLabel={onIcon}
          offLabel={offIcon}
          styles={{
            track: {
              cursor: disabled ? "not-allowed" : "pointer",
              backgroundColor: checked
                ? "transparent"
                : showWarning
                  ? "rgb(251 191 36)" // yellow-400 for warning
                  : "var(--shiplight-bg-surface-active)",
            },
          }}
          classNames={{
            track: checked ? gradientClassName : "",
          }}
        />
        {/* Warning badge asterisk */}
        {showWarning && (
          <span className="absolute -top-1 -right-1 text-orange-600 font-bold text-xs leading-none">
            *
          </span>
        )}
      </div>
    </Tooltip>
  );
};