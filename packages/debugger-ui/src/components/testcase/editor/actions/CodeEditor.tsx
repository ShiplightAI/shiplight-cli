import React, { useRef, useState } from 'react';
import { Box, Group, Button, ActionIcon, Tooltip } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import dynamic from 'next/dynamic';
import { useTheme } from '@/contexts/ThemeContext';
import { useTranslations } from 'next-intl';

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

interface CodeEditorProps {
  initialCode?: string;
  onConfirm?: (code: string) => void;
  onCancel?: () => void;
  height?: string;
  placeholder?: string;
  emptyText?: string;
  /** When true, show the same UI but non-editable (no click to open Monaco) */
  readOnly?: boolean;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  initialCode = "",
  onConfirm,
  onCancel,
  height = "200px",
  placeholder = "// Enter your JavaScript code here...",
  emptyText = "Click to edit JavaScript code",
  readOnly = false,
}) => {
  const t = useTranslations('TestCases');
  const [codeContent, setCodeContent] = useState(initialCode || placeholder);
  const [hasChanges, setHasChanges] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const monacoEditorRef = useRef<any>(null);

  const { resolvedTheme } = useTheme();

    const handleEditorDidMount = (editor: any) => {
    monacoEditorRef.current = editor;
    // Focus the editor when it mounts
    editor.focus();

    // Add keyboard shortcuts using Monaco's KeyMod and KeyCode
    const monaco = (window as any).monaco;
    if (monaco) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        handleConfirm();
      });

      editor.addCommand(monaco.KeyCode.Escape, () => {
        handleCancel();
      });
    }
  };

  const handleCodeChange = (value: string | undefined) => {
    if (value !== undefined) {
      setCodeContent(value);
      setHasChanges(value !== (initialCode || placeholder));
    }
  };

  const handleConfirm = () => {
    // Get the current value directly from the Monaco editor to avoid timing issues
    const currentValue = monacoEditorRef.current ? monacoEditorRef.current.getValue() : codeContent;
    
    if (onConfirm) {
      onConfirm(currentValue);
    }
    setIsEditorOpen(false);
    setHasChanges(false);
  };

  const handleCancel = () => {
    // Reset to original content
    setCodeContent(initialCode || placeholder);
    setHasChanges(false);
    setIsEditorOpen(false);
    if (onCancel) {
      onCancel();
    }
  };

  const handleTextAreaClick = () => {
    if (!readOnly) setIsEditorOpen(true);
  };

  if (!isEditorOpen) {
    // Show text area mode - same UI as edit, readOnly disables click
    return (
      <div>
        <div
          className={`font-mono text-sm text-secondary p-2 rounded border-transparent border whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-hidden min-h-[40px] ${
            readOnly
              ? "cursor-default opacity-90"
              : "cursor-text hover:bg-surface-hover hover:border-secondary transition-colors"
          }`}
          onClick={handleTextAreaClick}
          title={readOnly ? undefined : t('codeEditor.clickToOpen')}
          role={readOnly ? undefined : "button"}
        >
          {codeContent || <span className="text-secondary italic">{emptyText}</span>}
        </div>
      </div>
    );
  }

  // Show Monaco editor mode
  return (
    <div>
      <div className="flex items-center justify-end mb-1.5">
        <Group gap="xs">
          <Tooltip label={t('codeEditor.cancelTooltip')}>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={handleCancel}
            >
              <IconX size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('codeEditor.confirmTooltip')}>
            <ActionIcon
              size="sm"
              variant="filled"
              color="green"
              onClick={handleConfirm}
              disabled={!hasChanges}
            >
              <IconCheck size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      <Box className="relative">
        <MonacoEditor
          height={height}
          defaultLanguage="javascript"
          value={codeContent}
          onChange={handleCodeChange}
          onMount={handleEditorDidMount}
          theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 14,
            wordWrap: 'on',
            automaticLayout: true,
            contextmenu: !readOnly,
            selectOnLineNumbers: true,
            readOnly,
          }}
        />
            </Box>

      <div className="mt-1.5 text-xs text-secondary">
        <div className="flex items-center justify-between">
          <span>{t('codeEditor.hint')}</span>
          {hasChanges && (
            <span className="text-secondary font-medium">• {t('codeEditor.unsavedChanges')}</span>
          )}
        </div>
      </div>
    </div>
  );
};