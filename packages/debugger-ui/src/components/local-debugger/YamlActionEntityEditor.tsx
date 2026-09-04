import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { ActionEntity } from 'shiplight-types';
import { actionEntityToYaml, yamlToActionEntity } from 'shiplight-types';
import { useTranslations } from 'next-intl';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

interface YamlActionEntityEditorProps {
  initialActionEntity?: ActionEntity;
  description?: string;
  locator?: string;
  onConfirm?: (actionEntity: ActionEntity, updates?: { description?: string; locator?: string }) => void;
  onCancel?: () => void;
  /** Accepted for API compatibility with ActionEntityEditor; not used */
  height?: string;
  readOnly?: boolean;
}

export const YamlActionEntityEditor: React.FC<YamlActionEntityEditorProps> = ({
  initialActionEntity,
  description,
  locator,
  onConfirm,
  onCancel,
  readOnly = false,
}) => {
  const t = useTranslations('TestCases');

  const getFormattedYaml = useCallback(() => {
    if (!initialActionEntity) return '';
    try {
      return actionEntityToYaml(initialActionEntity, description, locator);
    } catch {
      return JSON.stringify(initialActionEntity, null, 2);
    }
  }, [initialActionEntity, description, locator]);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const yamlDisplay = getFormattedYaml();

  const startEditing = useCallback(() => {
    if (readOnly) return;
    setEditContent(yamlDisplay);
    setValidationError(null);
    setIsEditing(true);
  }, [readOnly, yamlDisplay]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
  }, [isEditing]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditContent(e.target.value);
    setValidationError(null);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }, []);

  const handleConfirm = useCallback(() => {
    try {
      const result = yamlToActionEntity(editContent);
      if (!result.actionEntity?.action_data?.action_name) {
        setValidationError(t('actionEntityEditor.missingActionName'));
        return;
      }
      if (onConfirm) {
        // Use result.actionEntity as base, only keep non-overlapping fields from initial.
        // This ensures removed fields (e.g. deleted locator) don't survive the merge.
        onConfirm({
          ...initialActionEntity,
          ...result.actionEntity,
          locator: result.locator ?? undefined,
        }, {
          description: result.description,
          locator: result.locator,
        });
      }
      setIsEditing(false);
      setValidationError(null);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : t('actionEntityEditor.invalidYaml'));
    }
  }, [editContent, onConfirm, initialActionEntity, t]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditContent('');
    setValidationError(null);
    onCancel?.();
  }, [onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target as HTMLTextAreaElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const value = ta.value;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      setEditContent(newValue);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [handleConfirm, handleCancel]);

  // Hide entirely when there's no action entity or YAML display is empty
  // (e.g. VERIFY without js: — description already shown in the UI)
  if (!initialActionEntity || !yamlDisplay) {
    return null;
  }

  const hasChanges = editContent !== yamlDisplay;

  return (
    <div
      className={`pl-2 border-l-2 rounded p-1.5 transition-colors overflow-hidden ${
        isEditing
          ? 'border-primary bg-surface ring-1 ring-primary/30'
          : readOnly
            ? 'border-subtle bg-surface-hover cursor-default'
            : 'border-subtle bg-surface-hover cursor-text hover:bg-surface-active'
      }`}
      onClick={!isEditing ? startEditing : undefined}
      onKeyDown={!isEditing ? (e) => { if (e.key === 'Enter') startEditing(); } : undefined}
      role={!isEditing && !readOnly ? 'button' : undefined}
      tabIndex={!isEditing && !readOnly ? 0 : undefined}
      title={readOnly ? t('actionEntityEditor.viewTitle') : isEditing ? undefined : t('actionEntityEditor.editTitle')}
    >
      {isEditing ? (
        <div>
          <textarea
            ref={textareaRef}
            className="w-full text-xs font-mono bg-transparent border-none outline-none resize-none p-0 text-primary leading-relaxed"
            style={{ minHeight: 0 }}
            rows={1}
            value={editContent}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
          <div className="flex items-center justify-between text-[10px] text-tertiary select-none">
            <span>
              {validationError
                ? <span className="text-red-500">{validationError}</span>
                : hasChanges
                  ? <span className="text-orange-500">{t('actionEntityEditor.unsavedChanges')}</span>
                  : null
              }
            </span>
            <span>{t('actionEntityEditor.shortcutHint', { modifier: isMac ? '⌘' : 'Ctrl' })}</span>
          </div>
        </div>
      ) : (
        <pre className="text-xs font-mono text-primary whitespace-pre-wrap overflow-x-auto leading-relaxed" style={{ wordBreak: 'break-word' }}>
          {yamlDisplay}
        </pre>
      )}
    </div>
  );
};
