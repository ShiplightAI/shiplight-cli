import React, { useRef, useState } from 'react';
import { Group, ActionIcon, Tooltip } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import dynamic from 'next/dynamic';
import { ActionDataEntity, ActionEntity } from 'shiplight-types';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { useTranslations } from 'next-intl';

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

interface ValidActionDetails {
  action_description?: string;
  action_data: ActionDataEntity;
  locator?: string;
  xpath?: string;
  frame_path?: string[];
}

// JSON Schema for ValidActionDetails - similar to pydantic models
// To extend validation, simply modify this schema object - no code changes needed!
const validActionDetailsSchema = {
  type: "object",
  properties: {
    action_data: {
      type: "object",
      properties: {
        action_name: {
          type: "string",
          minLength: 1,
          description: "The name of the action to execute"
        },
        args: {
          type: "array",
          description: "Positional arguments for the action"
        },
        kwargs: {
          type: "object",
          description: "Keyword arguments for the action"
        }
      },
      required: ["action_name", "kwargs"],  // args is optional
      additionalProperties: true // Allow additional properties for flexibility
    },
    locator: {
      type: "string",
      description: "Element locator string (optional)"
    },
    xpath: {
      type: "string",
      description: "XPath selector for the element (optional)"
    },
    frame_path: {
      type: "array",
      items: { type: "string" },
      description: "Frame path for iframe elements (optional)"
    }
  },
  required: ["action_data"], // Only action_data is required, locator is optional
  additionalProperties: true // Allow additional properties for future extensions
};

// Initialize AJV validator
const ajv = new Ajv({ allErrors: true, verbose: true });
addFormats(ajv);
const validateSchema = ajv.compile(validActionDetailsSchema);

interface ActionEntityEditorProps {
  initialActionEntity?: ActionEntity;
  /** Used by YamlActionEntityEditor; accepted here for API compatibility */
  description?: string;
  /** Used by YamlActionEntityEditor; accepted here for API compatibility */
  locator?: string;
  onConfirm?: (
    actionEntity: ActionEntity,
    updates?: { description?: string; locator?: string }
  ) => void;
  onCancel?: () => void;
  height?: string;
  emptyText?: string;
  readOnly?: boolean;
}

export const ActionEntityEditor: React.FC<ActionEntityEditorProps> = ({
  initialActionEntity,
  onConfirm,
  onCancel,
  height = "200px",
  emptyText = "Click to edit action entity",
  readOnly = false,
}) => {
  const t = useTranslations('TestCases');
  // Format the initial JSON for display
  const getFormattedJson = () => {
    // Accept the legacy `action` field so older cached/editor payloads still render.
    const initialActionData = initialActionEntity?.action_data ?? initialActionEntity?.action;
    if (!initialActionEntity || !initialActionData) return '';

    // Create the ValidActionDetails object, including locator only if it exists
    const actionDetails: ValidActionDetails = {
      action_description: initialActionEntity?.action_description,
      action_data: initialActionData
    };

    // Only include locator fields if they exist and are not empty
    if (initialActionEntity?.locator) {
      actionDetails.locator = initialActionEntity.locator;
    }
    if (initialActionEntity?.xpath) {
      actionDetails.xpath = initialActionEntity.xpath;
    }
    if (initialActionEntity?.frame_path && initialActionEntity.frame_path.length > 0) {
      actionDetails.frame_path = initialActionEntity.frame_path;
    }

    return JSON.stringify(actionDetails, null, 2);
  };

  const [jsonContent, setJsonContent] = useState(getFormattedJson());
  const [hasChanges, setHasChanges] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const monacoEditorRef = useRef<any>(null);

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

  const handleJsonChange = (value: string | undefined) => {
    if (value !== undefined) {
      setJsonContent(value);
      setHasChanges(value !== getFormattedJson());

      // Real-time validation
      try {
        const parsed = JSON.parse(value);
        const isValid = validateSchema(parsed);
        if (!isValid) {
          setValidationError(ajv.errorsText(validateSchema.errors) || 'Validation failed');
        } else {
          setValidationError(null);
        }
      } catch (error) {
        setValidationError(`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  const handleConfirm = () => {
    // Get the current value directly from the Monaco editor to avoid timing issues
    const currentValue = monacoEditorRef.current ? monacoEditorRef.current.getValue() : jsonContent;

    // Validate before confirming
    try {
      const parsed = JSON.parse(currentValue);
      const isValid = validateSchema(parsed);
      if (!isValid) {
        setValidationError(ajv.errorsText(validateSchema.errors) || 'Validation failed');
        return;
      }
      const parsedDetails = parsed as unknown as ValidActionDetails;

      if (onConfirm) {
        // Convert the validated data back to the full action_entity format
        const actionEntity: ActionEntity = {
          ...initialActionEntity,
          action_description:
            (typeof parsedDetails.action_description === 'string'
              ? parsedDetails.action_description
              : initialActionEntity?.action_description) || '',
          action_data: parsedDetails.action_data,
          locator: parsedDetails.locator,
          xpath: parsedDetails.xpath,
          frame_path: parsedDetails.frame_path,
        };
        onConfirm(actionEntity);
      }

      setIsEditorOpen(false);
      setHasChanges(false);
      setValidationError(null);
    } catch (error) {
      setValidationError(`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCancel = () => {
    // Reset to original content
    setJsonContent(getFormattedJson());
    setHasChanges(false);
    setValidationError(null);
    setIsEditorOpen(false);
    if (onCancel) {
      onCancel();
    }
  };

  const handleTextAreaClick = () => {
    if (readOnly) return;
    setIsEditorOpen(true);
  };

  if (!isEditorOpen) {
    // Show read-only display - matching the style from ActionStatement.tsx
    return (
      <div>
        <div
          className={`pl-2 border-l-2 border-green-100 bg-gray-50 rounded p-1.5 transition-colors overflow-hidden ${
            readOnly ? "cursor-default" : "cursor-text hover:bg-gray-100"
          }`}
          onClick={handleTextAreaClick}
          title={readOnly ? t('actionEntityEditor.viewTitle') : t('actionEntityEditor.editTitle')}
        >
          {initialActionEntity ? (
            <pre className="text-xs font-mono text-gray-800 whitespace-pre-wrap overflow-x-auto" style={{ wordBreak: 'break-word' }}>
              {getFormattedJson()}
            </pre>
          ) : (
            <div className="text-xs text-gray-400 italic">{emptyText}</div>
          )}
        </div>
      </div>
    );
  }

  // Show Monaco editor mode
  return (
    <div>
      <div className="flex items-center justify-end mb-1.5">
        <Group gap="xs">
          <Tooltip label={t('actionEntityEditor.cancelTooltip')}>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={handleCancel}
            >
              <IconX size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('actionEntityEditor.confirmTooltip')}>
            <ActionIcon
              size="sm"
              variant="filled"
              color="green"
              onClick={handleConfirm}
              disabled={!hasChanges || validationError !== null}
            >
              <IconCheck size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      <div className="relative">
        <MonacoEditor
          height={height}
          defaultLanguage="json"
          value={jsonContent}
          onChange={handleJsonChange}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            wordWrap: 'on',
            automaticLayout: true,
            contextmenu: true,
            selectOnLineNumbers: true,
            tabSize: 2,
            insertSpaces: true,
            formatOnPaste: true,
            formatOnType: true,
          }}
        />
      </div>

      <div className="mt-1.5 text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>{t('actionEntityEditor.hint')}</span>
          <div className="flex items-center gap-2">
            {validationError && (
              <span className="text-red-600 font-medium">• {validationError}</span>
            )}
            {hasChanges && !validationError && (
              <span className="text-orange-600 font-medium">• {t('actionEntityEditor.unsavedChanges')}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
