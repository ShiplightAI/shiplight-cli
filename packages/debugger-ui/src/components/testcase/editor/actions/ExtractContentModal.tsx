import React, { useState } from 'react';
import { Modal, Button, Text, Group, TextInput, Textarea } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

interface ExtractContentModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (elementDescription: string, variableName: string) => void;
  initialElementDescription?: string;
  initialVariableName?: string;
}

export const ExtractContentModal: React.FC<ExtractContentModalProps> = ({
  open,
  onClose,
  onSave,
  initialElementDescription = '',
  initialVariableName = '',
}) => {
  const t = useTranslations('TestCases');
  const tCommon = useTranslations('Common');
  const [elementDesc, setElementDesc] = useState(initialElementDescription);
  const [varName, setVarName] = useState(initialVariableName);

  // Reset values when modal opens
  React.useEffect(() => {
    if (open) {
      setElementDesc(initialElementDescription);
      setVarName(initialVariableName);
    }
  }, [open, initialElementDescription, initialVariableName]);

  const handleSave = () => {
    if (elementDesc && varName) {
      onSave(elementDesc, varName);
      onClose();
    }
  };

  const handleCancel = () => {
    setElementDesc(initialElementDescription);
    setVarName(initialVariableName);
    onClose();
  };

  return (
    <Modal
      opened={open}
      onClose={handleCancel}
      title={
        <Group gap="xs">
          <IconDeviceFloppy size={20} />
          <Text fw={500}>{t('extractContentModal.title')}</Text>
        </Group>
      }
      size="xl"
    >
      <div className="px-0">
        <div className="space-y-4">
          <Textarea
            label={t('extractContentModal.whatToExtract')}
            placeholder={t('extractContentModal.whatToExtract')}
            description={t('extractContentModal.extractDescription')}
            value={elementDesc}
            onChange={(e) => setElementDesc(e.target.value)}
            minRows={3}
            maxRows={5}
            required
            autoFocus
          />
          
          <TextInput
            label={t('extractContentModal.variableName')}
            placeholder={t('extractContentModal.variableName')}
            description={t('extractContentModal.variableDescription')}
            value={varName}
            onChange={(e) => setVarName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
            required
          />
        </div>

        {/* Action Buttons */}
        <Group justify="flex-end" gap="sm" mt="md">
          <Button variant="subtle" onClick={handleCancel}>
            {tCommon('cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!elementDesc || !varName}
          >
            {t('extractContentModal.extractContent')}
          </Button>
        </Group>
      </div>
    </Modal>
  );
};
