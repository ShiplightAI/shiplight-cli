import React, { useState } from 'react';
import { Button, Text, ActionIcon } from '@mantine/core';
import { MultilineTextInput } from '@/components/common/MultilineTextInput';
import { IconFunction, IconEdit } from '@tabler/icons-react';
import { useFunctions } from '@/hooks/useFunctions';
import { TestFunction } from '@/common/models/testFunction';
import FunctionModal from '@/components/editor/FunctionModal';
import { isSystemParameter } from '@/common/utils/functionUtils';
import { useTranslations } from 'next-intl';
import { findFunctionDefinition, mapFunctionArgumentsForDisplay } from './functionActionUtils';

interface FunctionEditorProps {
  functionName?: string;
  functionId?: number;
  parameters?: Record<string, string>;
  argumentValues?: readonly unknown[];
  parameterNames?: readonly string[];
  onFunctionSelect?: (func: TestFunction, paramValues?: Record<string, string>) => void;
  onFunctionCancel?: () => void;
  placeholder?: string;
  isNewlyCreated?: boolean;
  /** When true, same UI but non-editable (params disabled, no modal) */
  readOnly?: boolean;
}

export const FunctionEditor: React.FC<FunctionEditorProps> = ({
  functionName,
  functionId,
  parameters = {},
  argumentValues = [],
  parameterNames = [],
  onFunctionSelect,
  onFunctionCancel,
  placeholder = "Click to configure function...",
  isNewlyCreated = false,
  readOnly = false,
}) => {
  const t = useTranslations('TestCases');
  if (!readOnly) {
    console.log("🎯 FunctionEditor rendered with props:");
    console.log("  - functionName:", functionName);
    console.log("  - functionId:", functionId);
    console.log("  - parameters:", parameters);
    console.log("  - isNewlyCreated:", isNewlyCreated);
  }

  // Self-contained function modal state
  const [functionModalOpen, setFunctionModalOpen] = useState(false);
  const { functions } = useFunctions();
  const selectedFunction = findFunctionDefinition(
    functions as TestFunction[],
    functionName,
    functionId,
  );
  const displayedParameters = Object.keys(parameters).length > 0
    ? parameters
    : mapFunctionArgumentsForDisplay(argumentValues, selectedFunction?.code, parameterNames);

  // Local state for inline parameter editing
  const [editingParamIndex, setEditingParamIndex] = useState<number | null>(null);

  // Auto-open modal only when this is a newly created function action (and not readOnly)
  React.useEffect(() => {
    if (!readOnly && isNewlyCreated && !functionName) {
      console.log("🚀 Auto-opening function modal for newly created action");
      setFunctionModalOpen(true);
    }
  }, [readOnly, isNewlyCreated, functionName]);

  // Handle function selection from modal
  const handleFunctionSelect = (func: TestFunction, paramValues?: Record<string, string>) => {
    console.log("Function selected:", func.name);
    console.log("With parameters:", paramValues);
    console.log("🔗 FunctionEditor - calling onFunctionSelect prop:", !!onFunctionSelect);

    // Close modal
    setFunctionModalOpen(false);

    // Notify parent component
    if (onFunctionSelect) {
      console.log("📞 FunctionEditor - calling onFunctionSelect with:", func, paramValues);
      onFunctionSelect(func, paramValues);
    } else {
      console.log("❌ FunctionEditor - onFunctionSelect prop is not provided!");
    }
  };

  // Handle modal close (including cancel)
  const handleModalClose = () => {
    console.log("🚪 FunctionModal closed");
    setFunctionModalOpen(false);

    // If no function is selected and modal is closed, this is a cancellation
    if (!functionName && onFunctionCancel) {
      console.log("🚫 Function selection cancelled - calling onFunctionCancel");
      onFunctionCancel();
    }
  };

  // Handle parameter value change during inline editing
  const handleParameterValueChange = (index: number, value: string) => {
    if (onFunctionSelect && selectedFunction) {
      const customParams = getCustomParameters();
      const updatedParams: Record<string, string> = { ...displayedParameters };

      customParams.forEach((param, paramIndex) => {
        updatedParams[param.name] = paramIndex === index ? value : param.value;
      });

      onFunctionSelect(selectedFunction, updatedParams);
    }

    // Reset editing state
    setEditingParamIndex(null);
  };

  // Get custom parameters (exclude system parameters)
  const getCustomParameters = () => {
    return Object.entries(displayedParameters)
      .map(([name, value]) => ({
        name,
        value: value || ''
      }))
      .filter(param => !isSystemParameter(param.name));
  };

  // If function is selected, show function UI (same as edit; readOnly disables inputs)
  if (functionName) {
    const customParameters = getCustomParameters();
    return (
      <>
        <div className="space-y-0.5 px-2">
          <div className="grid gap-y-0.5" style={{ gridTemplateColumns: 'max-content 1fr' }}>
            {customParameters.length > 0 ? (
              customParameters.map((param, index) => (
                <React.Fragment key={index}>
                  <span className="font-medium text-gray-600 text-right pr-2 pt-1 text-sm">{param.name}:</span>
                  <div className="min-w-0">
                    <MultilineTextInput
                      value={param.value}
                      onChange={readOnly ? undefined : (value) => handleParameterValueChange(index, value)}
                      placeholder="Enter value..."
                      disabled={readOnly}
                    />
                  </div>
                </React.Fragment>
              ))
            ) : (
              <div className="text-xs text-gray-500 italic text-center py-0.5 col-span-2">{t('functionEditor.noParameters')}</div>
            )}
          </div>
        </div>

        {!readOnly && (
          <FunctionModal
            opened={functionModalOpen}
            onClose={handleModalClose}
            onSelectFunction={handleFunctionSelect}
            functions={functions || []}
          />
        )}
      </>
    );
  }

  // If no function selected: show placeholder or read-only empty state
  if (readOnly) {
    return (
      <Text size="sm" c="dimmed" className="px-2 py-1">
        {placeholder}
      </Text>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <Button
          variant="outline"
          size="xs"
          leftSection={<IconFunction size={16} />}
          onClick={() => setFunctionModalOpen(true)}
          className="w-full"
        >
          {placeholder}
        </Button>
        <Text size="xs" c="dimmed" className="mt-1">
          {t('functionEditor.configuredViaModal')}
        </Text>
      </div>

      <FunctionModal
        opened={functionModalOpen}
        onClose={handleModalClose}
        onSelectFunction={handleFunctionSelect}
        functions={functions || []}
      />
    </>
  );
};
