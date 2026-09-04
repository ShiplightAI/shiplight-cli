import React, { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';

interface MultilineTextInputProps {
  /** Current value of the text */
  value: string;
  /** Callback when value changes */
  onChange?: (newValue: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** CSS classes for the display div */
  displayClassName?: string;
  /** Fallback text to show when value is empty */
  emptyText?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
}

export const MultilineTextInput: React.FC<MultilineTextInputProps> = ({
  value,
  onChange,
  placeholder,
  displayClassName="text-[14px] text-secondary cursor-text hover:bg-surface px-2 py-1 rounded border-transparent border hover:border-subtle transition-colors font-medium whitespace-pre-wrap break-words",
  emptyText,
  disabled,
}) => {
  const tCommon = useTranslations("Common");
  const resolvedEmptyText = emptyText ?? tCommon("clickToAddText");
  const [isEditing, setIsEditing] = useState(false);
  const editableRef = useRef<HTMLDivElement>(null);

  // Update editable content when value changes (but avoid during active editing)
  useEffect(() => {
    if (editableRef.current && editableRef.current.textContent !== value) {
      // Only update if we're not currently editing or if the element doesn't have focus
      if (!isEditing || document.activeElement !== editableRef.current) {
        editableRef.current.textContent = value;
      }
    }
  }, [value, isEditing]);

  // Handle click to enter edit mode
  const handleClick = () => {
    if (disabled) return;
    setIsEditing(true);
    setTimeout(() => editableRef.current?.focus(), 0);
  };

  // Handle input changes (don't call onChange immediately to avoid cursor issues)
  const handleInput = () => {
    // Don't call onChange during input to avoid cursor jumping
    // Changes will be saved on blur
  };

  // Handle blur to exit edit mode and save changes
  const handleBlur = () => {
    if (!editableRef.current) return;

    const newValue = editableRef.current.textContent || '';

    // Save changes if they're different from the current value
    if (onChange && newValue !== value) {
      onChange(newValue);
    }

    setIsEditing(false);
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      // Enter saves and exits
      e.preventDefault();
      setIsEditing(false);
      editableRef.current?.blur();
    } else if (e.key === "Escape") {
      // Escape cancels and reverts
      e.preventDefault();
      if (editableRef.current) {
        editableRef.current.textContent = value;
      }
      setIsEditing(false);
      editableRef.current?.blur();
    }
    // Shift+Enter creates new line (default behavior)
  };

  const isDisabled = disabled;
  const isEmpty = !String(value ?? '').trim();
  const showPlaceholder = isEmpty && !isEditing;

  return (
    <div className="relative">
      {/* Placeholder overlay */}
      {showPlaceholder && (
        <div
          className={`
            absolute inset-0 pointer-events-none text-zinc-400 italic
            ${displayClassName}
          `}
          style={{ minHeight: "1.5em", overflowWrap: "anywhere" }}
        >
          {isDisabled ? tCommon("disabled") : resolvedEmptyText}
        </div>
      )}

      {/* Actual contentEditable */}
      <div
        ref={editableRef}
        contentEditable={!isDisabled}
        suppressContentEditableWarning
        onBlur={handleBlur}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        className={`
          ${displayClassName}
          ${isDisabled ? 'opacity-60 cursor-not-allowed' : ''}
          ${isEditing ? 'bg-surface-active border-secondary' : ''}
          outline-none
        `}
        style={{ minHeight: "1.5em", overflowWrap: "anywhere" }}
      >
        {value}
      </div>
    </div>
  );
};