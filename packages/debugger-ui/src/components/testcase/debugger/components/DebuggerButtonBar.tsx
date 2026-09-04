import { ActionIcon, Button, ButtonProps, Popover, TextInput, Tooltip } from "@mantine/core";
import {
  IconArrowBackUp,
  IconArrowForward,
  IconChevronDown,
  IconDeviceFloppy,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconRefresh,
  IconX
} from "@tabler/icons-react";
import React, { MouseEventHandler, forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { useDebugger } from "../contexts/DebuggerContext";
import { useTranslations } from "next-intl";

/**
 * DebuggerButtonBar Component
 *
 * Provides debugging controls with keyboard shortcuts:
 * - Space: Step/Start debugging (when not in input fields)
 * - F5: Run all remaining statements
 */

interface DebuggerButtonBarProps {
  iconOnly?: boolean;
  onSave?: () => Promise<void>;
  onRevert?: () => Promise<void>;
  onUndo?: () => Promise<void>;
  canUndo?: boolean;
  hasUnsavedChanges?: boolean;
  enabled?: boolean;
  className?: string;
  urlOverride?: string;
  onUrlOverrideChange?: (url: string) => void;
  hasActiveSession?: boolean;
  onResetSession?: () => Promise<void>;
}

interface DebuggerButtonProps extends ButtonProps {
  iconOnly?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement> | undefined;
}

const DebuggerButton = forwardRef<HTMLButtonElement, DebuggerButtonProps>((props, ref) => {
  const { iconOnly, leftSection, children, ...rest } = props;

  if (!iconOnly) {
    return (
      <Button {...rest} leftSection={leftSection} ref={ref}>
        {children}
      </Button>
    );
  }

  return (
    <Button {...rest} aria-label={typeof children === 'string' ? children : undefined} ref={ref}>
      {leftSection}
    </Button>
  );
});

DebuggerButton.displayName = "DebuggerButton";

export const DebuggerButtonBar: React.FC<DebuggerButtonBarProps> = ({
  iconOnly,
  onSave,
  onRevert,
  onUndo,
  canUndo = false,
  hasUnsavedChanges = false,
  enabled,
  className = "",
  urlOverride = "",
  onUrlOverrideChange,
  hasActiveSession,
  onResetSession,
}) => {
  const { isDebugging, isStepping, isRunning, currentStatementId, startDebugging, stopDebugging, step, run, pauseExecution } = useDebugger();
  const t = useTranslations('TestCases');
  const tCommon = useTranslations('Common');
  const [stopRequested, setStopRequested] = useState(false);

  // URL Override dropdown state
  const [urlDropdownOpen, setUrlDropdownOpen] = useState(false);
  const [tempUrlOverride, setTempUrlOverride] = useState(urlOverride);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Sync temp value when dropdown opens
  useEffect(() => {
    if (urlDropdownOpen) {
      setTempUrlOverride(urlOverride);
      // Focus input when dropdown opens
      setTimeout(() => urlInputRef.current?.focus(), 50);
    }
  }, [urlDropdownOpen, urlOverride]);

  const handleUrlOverrideSave = useCallback(() => {
    if (onUrlOverrideChange) {
      onUrlOverrideChange(tempUrlOverride.trim());
    }
    setUrlDropdownOpen(false);
  }, [tempUrlOverride, onUrlOverrideChange]);

  const handleUrlOverrideCancel = useCallback(() => {
    setTempUrlOverride(urlOverride);
    setUrlDropdownOpen(false);
  }, [urlOverride]);

  const handleUrlInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleUrlOverrideSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleUrlOverrideCancel();
    }
  }, [handleUrlOverrideSave, handleUrlOverrideCancel]);

  const hasUrlOverride = urlOverride.trim().length > 0;

  const handleStartDebugging = async () => {
    console.log("🔥 handleStartDebugging called");
    try {
      await startDebugging();
      console.log("✅ startDebugging completed");
    } catch (error) {
      console.error("❌ Failed to start debugging:", error);
    }
  };

  const handleStep = useCallback(async () => {
    console.log("🔥 handleStep called, isDebugging:", isDebugging, "currentStatementId:", currentStatementId);

    // Additional safety check - don't step if at end of execution
    if (isDebugging && !currentStatementId) {
      console.log("⚠️ Cannot step: at end of execution (currentStatementId is null)");
      return;
    }

    try {
      await step();
      console.log("✅ step completed");
    } catch (error) {
      console.error("❌ Failed to step:", error);
    }
  }, [isDebugging, currentStatementId, step]);

  const handleRun = useCallback(async () => {
    try {
      setStopRequested(false); // Reset stop flag when starting a new run
      await run();
    } catch (error) {
      console.error("Failed to run:", error);
    } finally {
      setStopRequested(false); // Reset when done
    }
  }, [run]);

  const handleStop = useCallback(async () => {
    console.log("🛑 Stop requested");
    setStopRequested(true);
    await pauseExecution();
  }, [pauseExecution]);

  const handleReset = useCallback(async () => {
    try {
      if (isDebugging) {
        await stopDebugging();
      } else if (onResetSession) {
        await onResetSession();
      }
    } catch (error) {
      console.error("Failed to reset session:", error);
    }
  }, [isDebugging, stopDebugging, onResetSession]);

  const handleSave = useCallback(async () => {
    if (onSave) {
      try {
        await onSave();
      } catch (error) {
        console.error("Failed to save statements:", error);
      }
    }
  }, [onSave]);

  const handleRevert = useCallback(async () => {
    if (onRevert) {
      try {
        await onRevert();
      } catch (error) {
        console.error("Failed to revert statements:", error);
      }
    }
  }, [onRevert]);

  const handleUndo = useCallback(async () => {
    if (onUndo) {
      try {
        await onUndo();
      } catch (error) {
        console.error("Failed to undo revert:", error);
      }
    }
  }, [onUndo]);

  const stepButtonLabel = isDebugging ? t('debuggerButtonBar.step') : t('debuggerButtonBar.start');
  const hasMoreStatements = currentStatementId !== null;

  // Reset stop requested flag when continuous running ends
  React.useEffect(() => {
    if (!isRunning) {
      setStopRequested(false);
    }
  }, [isRunning]);

  const handleKeyDownRef = useRef<(event: KeyboardEvent) => void>((event: KeyboardEvent) => {
    if (!enabled) return;
    if (event.key.toLowerCase() === "r" && event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      // Only trigger if not in an input field or textarea
      const activeElement = document.activeElement as HTMLElement;
      const isInInput =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.contentEditable === "true";

      if (!isInInput && enabled && !isStepping && !isRunning && (isDebugging ? hasMoreStatements : true)) {
        event.preventDefault();
        event.stopPropagation();
        if (isDebugging) {
          handleStep();
        } else {
          handleStartDebugging();
        }
      }
    }
  });

  useEffect(() => {
    if (!enabled) return;

    // Store the current value to avoid stale closure issues
    const handleKeyDown = handleKeyDownRef.current;
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled]);

  return (
    <div
      className={`mx-6 flex justify-center gap-1.5 border border-subtle p-3 bg-surface rounded-md shadow-sm ${className}`}
    >
      {/* Statement Change Controls */}
      <div className="flex gap-1.5">
        {/* Revert Button */}
        <Tooltip label={canUndo ? t('debuggerButtonBar.undoRevert') : t('debuggerButtonBar.revertChanges')}>
          {canUndo ? <DebuggerButton size="xs"
            h={28}
            variant="outline"
            leftSection={<IconArrowForward size={16} className="hidden sm:block" />}
            iconOnly={iconOnly} onClick={handleUndo} disabled={!enabled || !canUndo || !onUndo}>
            {t('debuggerButtonBar.undo')}
          </DebuggerButton> : <DebuggerButton
            size="xs"
            h={28}
            variant="outline"
            onClick={handleRevert}
            disabled={!enabled || !hasUnsavedChanges || !onRevert}
            leftSection={<IconArrowBackUp size={16} className="hidden sm:block" />}
            iconOnly={iconOnly}
          >
            {t('debuggerButtonBar.revert')}
          </DebuggerButton>}
        </Tooltip>

        {/* Save Button */}
        <Tooltip label={hasUnsavedChanges ? t('debuggerButtonBar.saveChanges') : t('debuggerButtonBar.noChanges')}>
          <DebuggerButton
            size="xs"
            h={28}
            onClick={handleSave}
            disabled={!enabled || !hasUnsavedChanges || !onSave}
            variant={hasUnsavedChanges ? "filled" : "light"}
            leftSection={<IconDeviceFloppy size={16} className="hidden sm:block" />}
            iconOnly={iconOnly}
          >
            {hasUnsavedChanges ? tCommon('save') : t('debuggerButtonBar.saved')}
          </DebuggerButton>
        </Tooltip>
      </div>

      {/* Separator */}
      {/* <div className="w-px h-6 bg-gray-300 mx-0.5" /> */}

      {/* Debug Session Controls */}
      <div className="flex gap-1.5">
        {/* Start/Step Button with URL Override Dropdown */}
        <div className="flex">
          <Tooltip
            label={
              !enabled
                ? t('debuggerButtonBar.disabledDuringGeneration')
                : !isDebugging
                  ? hasUrlOverride
                    ? t('debuggerButtonBar.startWithOverride', { url: urlOverride })
                    : t('debuggerButtonBar.startDebugging')
                  : !hasMoreStatements
                    ? t('debuggerButtonBar.noMoreStatements')
                    : t('debuggerButtonBar.executeNext')
            }
          >
            <DebuggerButton
              size="xs"
              h={28}
              onClick={isDebugging ? handleStep : handleStartDebugging}
              loading={isStepping}
              disabled={!enabled || isRunning || (isDebugging && !hasMoreStatements)}
              leftSection={<IconPlayerPlay size={16} className="hidden sm:block" />}
              iconOnly={iconOnly}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
            >
              {stepButtonLabel}
            </DebuggerButton>
          </Tooltip>
          <Popover
            opened={urlDropdownOpen}
            onChange={setUrlDropdownOpen}
            position="bottom-end"
            shadow="md"
            withArrow
          >
            <Popover.Target>
              <Tooltip label={hasUrlOverride ? t('debuggerButtonBar.urlOverrideTooltip', { url: urlOverride }) : t('debuggerButtonBar.setUrlOverride')}>
                <ActionIcon
                  size={28}
                  variant="default"
                  aria-label="URL override"
                  onClick={() => setUrlDropdownOpen((o) => !o)}
                  disabled={!enabled || isDebugging}
                  style={{
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                    borderLeft: 0,
                    width: 16,
                    minWidth: 16,
                    padding: 0,
                  }}
                >
                  <div className="relative" style={{ marginTop: 12 }}>
                    <IconChevronDown size={10} />
                    {hasUrlOverride && (
                      <span className="absolute -top-2 left-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full" />
                    )}
                  </div>
                </ActionIcon>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown>
              <div className="flex flex-col gap-2 min-w-[280px]">
                <div className="text-sm font-medium text-secondary">{t('debuggerButtonBar.urlOverrideSection')}</div>
                <TextInput
                  ref={urlInputRef}
                  placeholder={t('debuggerButtonBar.urlOverridePlaceholder')}
                  value={tempUrlOverride}
                  onChange={(e) => setTempUrlOverride(e.currentTarget.value)}
                  onKeyDown={handleUrlInputKeyDown}
                  size="xs"
                  rightSection={
                    tempUrlOverride.length > 0 ? (
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        onClick={() => setTempUrlOverride("")}
                      >
                        <IconX size={12} />
                      </ActionIcon>
                    ) : null
                  }
                />
                <div className="flex justify-end gap-2">
                  <Button size="xs" variant="subtle" onClick={handleUrlOverrideCancel}>
                    {tCommon('cancel')}
                  </Button>
                  <Button size="xs" onClick={handleUrlOverrideSave}>
                    {tCommon('save')}
                  </Button>
                </div>
              </div>
            </Popover.Dropdown>
          </Popover>
        </div>

        {/* Parameter Set Selector — only shown when parameter sets are configured */}
        {/* Run/Stop Button */}
        <Tooltip label={
          !enabled
            ? t('debuggerButtonBar.disabledDuringGeneration')
            : isRunning
              ? stopRequested
                ? t('debuggerButtonBar.waitingForStep')
                : t('debuggerButtonBar.pauseExecution')
              : t('debuggerButtonBar.executeAll')
        }>
          <DebuggerButton
            size="xs"
            h={28}
            onClick={isRunning ? handleStop : handleRun}
            disabled={!enabled || stopRequested || (!isRunning && isDebugging && !hasMoreStatements)}
            loading={isRunning && stopRequested}
            leftSection={
              isRunning
                ? <IconPlayerPause size={16} className="hidden sm:block" />
                : <IconPlayerSkipForward size={16} className="hidden sm:block" />
            }
            iconOnly={iconOnly}
            color={isRunning ? "red" : undefined}
          >
            {isRunning ? t('debuggerButtonBar.pause') : t('debuggerButtonBar.run')}
          </DebuggerButton>
        </Tooltip>

        {/* Reset Button — enabled when debugging or when there's an active session */}
        <Tooltip label={!enabled ? t('debuggerButtonBar.disabledDuringGeneration') : t('debuggerButtonBar.resetSession')}>
          <DebuggerButton
            size="xs"
            h={28}
            variant="outline"
            onClick={handleReset}
            disabled={!enabled || (!isDebugging && !hasActiveSession) || isStepping || isRunning}
            leftSection={<IconRefresh size={16} className="hidden sm:block" />}
            iconOnly={iconOnly}
          >
            {t('debuggerButtonBar.reset')}
          </DebuggerButton>
        </Tooltip>
      </div>
    </div>
  );
};
