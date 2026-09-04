import React, { useState, useEffect } from 'react';
import { Modal, Button, Text, Group, Stack, TextInput } from '@mantine/core';
import { IconRecycle } from '@tabler/icons-react';
import { useReusableSteps } from '@/hooks/useReusableSteps';
import { useTranslations } from 'next-intl';

interface SaveReusableStepModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (templateName: string) => void;
}

export const SaveReusableStepModal: React.FC<SaveReusableStepModalProps> = ({
  open,
  onClose,
  onSave,
}) => {
  const t = useTranslations('TestCases');
  const tCommon = useTranslations('Common');
  const [templateName, setTemplateName] = useState('');
  const [errors, setErrors] = useState<{ templateName?: string }>({});
  const [isChecking, setIsChecking] = useState(false);

  const { reusableStepExists } = useReusableSteps();

  // Reset values when modal opens
  useEffect(() => {
    if (open) {
      setTemplateName('');
      setErrors({});
    }
  }, [open]);

  const validateForm = async () => {
    const newErrors: { templateName?: string } = {};

    if (!templateName || templateName.trim() === '') {
      newErrors.templateName = t('saveTemplate.nameRequired');
    } else {
      // Check if name already exists
      setIsChecking(true);
      try {
        const exists = await reusableStepExists(templateName.trim());
        if (exists) {
          newErrors.templateName = t('saveTemplate.nameAlreadyExists', { name: templateName });
        }
      } catch (error) {
        console.error('Error checking template existence:', error);
      } finally {
        setIsChecking(false);
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (await validateForm()) {
      onSave(templateName.trim());
      onClose();
    }
  };

  const handleCancel = () => {
    setTemplateName('');
    setErrors({});
    onClose();
  };

  return (
    <Modal
      opened={open}
      onClose={handleCancel}
      title={
        <Group gap="xs">
          <IconRecycle size={20} />
          <Text fw={500}>{t('saveTemplate.title')}</Text>
        </Group>
      }
      size="md"
    >
      <Stack gap="md">
        {/* Name Input */}
        <div className="flex flex-col gap-1">
          <Text size="sm" fw={500} className="text-secondary mb-1">
            {t('saveTemplate.nameLabel')} <span className="text-red-500">*</span>
          </Text>
          <TextInput
            placeholder={t('saveTemplate.namePlaceholder')}
            value={templateName}
            onChange={(e) => {
              setTemplateName(e.currentTarget.value);
              if (errors.templateName) {
                setErrors({ ...errors, templateName: undefined });
              }
            }}
            error={errors.templateName}
            disabled={isChecking}
            autoFocus
          />
          <Text size="xs" c="dimmed">
            {t('saveTemplate.description')}
          </Text>
        </div>

        {/* Action Buttons */}
        <Group justify="flex-end" gap="sm">
          <Button variant="outline" onClick={handleCancel}>
            {tCommon('cancel')}
          </Button>
          <Button
            onClick={handleSave}
            leftSection={<IconRecycle size={16} />}
            loading={isChecking}
          >
            {tCommon('save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
