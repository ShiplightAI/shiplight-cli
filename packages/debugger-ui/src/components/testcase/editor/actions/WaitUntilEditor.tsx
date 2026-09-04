import React, { useState, useRef } from "react";
import { MultilineTextInput } from '../../../common/MultilineTextInput';
import { useTranslations } from 'next-intl';

interface WaitUntilEditorProps {
  condition?: string;
  timeoutSeconds?: number;
  onWaitUntilConfirm?: (condition: string, timeoutSeconds: number) => void;
  /** When true, same UI but non-editable */
  readOnly?: boolean;
}

export const WaitUntilEditor: React.FC<WaitUntilEditorProps> = ({
  condition: initialCondition = "",
  timeoutSeconds: initialTimeout = 60,
  onWaitUntilConfirm,
  readOnly = false,
}) => {
  const t = useTranslations('TestCases');
  const [condition, setCondition] = useState(initialCondition);
  const [timeoutSeconds, setTimeoutSeconds] = useState<string>(String(initialTimeout));
  const timeoutRef = useRef<HTMLInputElement>(null);

  const handleConditionChange = (newCondition: string) => {
    setCondition(newCondition);
    const timeout = parseInt(timeoutSeconds) || 60;
    if (onWaitUntilConfirm) {
      onWaitUntilConfirm(newCondition, timeout);
    }
  };

  const handleTimeoutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    // Allow only numbers
    if (/^\d*$/.test(value)) {
      setTimeoutSeconds(value);
    }
  };

  const handleTimeoutBlur = () => {
    const raw = parseInt(timeoutSeconds) || 60;
    const timeout = Math.min(raw, 300);
    setTimeoutSeconds(String(timeout)); // Normalize the value
    if (onWaitUntilConfirm) {
      onWaitUntilConfirm(condition, timeout);
    }
  };

  const handleTimeoutKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const raw = parseInt(timeoutSeconds) || 60;
      const timeout = Math.min(raw, 300);
      if (onWaitUntilConfirm) {
        onWaitUntilConfirm(condition, timeout);
      }
      (e.target as HTMLElement).blur();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <MultilineTextInput
        value={condition}
        onChange={readOnly ? undefined : handleConditionChange}
        placeholder={t('waitUntilEditor.conditionPlaceholder')}
        emptyText={t('waitUntilEditor.clickToAdd')}
        disabled={readOnly}
        displayClassName="text-[14px] text-secondary cursor-text hover:bg-surface px-2 py-1 rounded border-transparent border hover:border-subtle transition-colors font-medium whitespace-pre-wrap break-words"
      />

      <div className="flex items-center gap-2 px-2">
        <input
          ref={timeoutRef}
          type="text"
          value={timeoutSeconds}
          onChange={handleTimeoutChange}
          onBlur={handleTimeoutBlur}
          onKeyDown={handleTimeoutKeyDown}
          placeholder="60"
          disabled={readOnly}
          readOnly={readOnly}
          className="w-16 px-2 py-0.5 text-[13px] text-secondary bg-transparent border border-transparent hover:border-subtle focus:border-primary focus:outline-none rounded transition-colors disabled:cursor-default disabled:opacity-90"
          style={{ minHeight: "24px" }}
        />
        <span className="text-[13px] text-gray-500">{t('waitUntilEditor.secondsMaxWait')}</span>
        {parseInt(timeoutSeconds) > 300 && (
          <span className="text-[12px] text-amber-500">{t('waitUntilEditor.maxTimeoutReached')}</span>
        )}
      </div>
    </div>
  );
};