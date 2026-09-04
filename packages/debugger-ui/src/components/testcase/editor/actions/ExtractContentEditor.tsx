import React, { useState, useEffect } from 'react';
import { Text } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { ExtractContentModal } from './ExtractContentModal';
import { useTranslations } from 'next-intl';

interface ExtractContentEditorProps {
  description: string;
  elementDescription?: string;
  variableName?: string;
  onExtractContentConfirm?: (elementDescription: string, variableName: string) => void;
  onExtractContentCancel?: () => void;
  isNewlyCreated?: boolean;
  /** When true, same UI but non-editable (no click to open modal) */
  readOnly?: boolean;
}

export const ExtractContentEditor: React.FC<ExtractContentEditorProps> = ({
  description,
  elementDescription: initialElementDescription = '',
  variableName: initialVariableName = '',
  onExtractContentConfirm,
  onExtractContentCancel,
  isNewlyCreated = false,
  readOnly = false,
}) => {
  const t = useTranslations('TestCases');
  const [modalOpen, setModalOpen] = useState(false);

  // Auto-open modal only when this is a newly created extract action (and not readOnly)
  useEffect(() => {
    if (!readOnly && isNewlyCreated && !initialElementDescription && !initialVariableName) {
      console.log('🚀 Auto-opening ExtractContent modal for newly created action');
      setModalOpen(true);
    }
  }, [readOnly, isNewlyCreated, initialElementDescription, initialVariableName]);

  const handleSave = (elementDesc: string, varName: string) => {
    if (onExtractContentConfirm) {
      onExtractContentConfirm(elementDesc, varName);
    }
    setModalOpen(false);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    
    // If no configuration exists and modal is closed, this is a cancellation
    if (!initialElementDescription && !initialVariableName && onExtractContentCancel) {
      onExtractContentCancel();
    }
  };

  const handleEdit = () => {
    setModalOpen(true);
  };

  // Show configured view if we have both element description and variable name (same UI; readOnly disables click)
  if (initialElementDescription && initialVariableName) {
    return (
      <>
        <div className="flex items-center gap-2 px-2 py-1">
          <div
            className={`flex items-center gap-2 flex-1 ${
              readOnly ? "cursor-default" : "cursor-pointer hover:opacity-80 transition-opacity"
            }`}
            onClick={readOnly ? undefined : handleEdit}
            title={readOnly ? undefined : t('extractContentEditor.clickToEdit')}
            role={readOnly ? undefined : "button"}
          >
            <IconDeviceFloppy size={16} />
            <Text size="sm" className="flex-1">
              {t.rich('extractContentEditor.extractAndSave', {
                elem: (chunks) => <span className="font-medium text-green-700">{chunks}</span>,
                var: (chunks) => <span className="font-mono text-blue-600">{chunks}</span>,
                element: initialElementDescription,
                variable: initialVariableName,
              })}
            </Text>
          </div>
        </div>

        {!readOnly && (
          <ExtractContentModal
            open={modalOpen}
            onClose={handleModalClose}
            onSave={handleSave}
            initialElementDescription={initialElementDescription}
            initialVariableName={initialVariableName}
          />
        )}
      </>
    );
  }

  // Show placeholder (or read-only empty state)
  if (readOnly) {
    return (
      <div className="flex items-center gap-2 px-2 py-1">
        <IconDeviceFloppy size={16} />
        <Text size="sm" c="dimmed">
          {t('extractContentEditor.clickToConfigure')}
        </Text>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 px-2 py-1">
        <div
          className="flex items-center gap-2 flex-1 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => setModalOpen(true)}
          title={t('extractContentEditor.clickToConfigure')}
        >
          <IconDeviceFloppy size={16} />
          <Text size="sm" className="flex-1 text-gray-500">
            {t('extractContentEditor.clickToConfigure')}
          </Text>
        </div>
      </div>

      <ExtractContentModal
        open={modalOpen}
        onClose={handleModalClose}
        onSave={handleSave}
        initialElementDescription={initialElementDescription}
        initialVariableName={initialVariableName}
      />
    </>
  );
};
