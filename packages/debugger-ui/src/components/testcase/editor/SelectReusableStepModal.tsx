import React, { useState, useEffect } from 'react';
import { Modal, Button, Text, Group, TextInput, Loader, Tooltip } from '@mantine/core';
import { IconRecycle, IconSearch } from '@tabler/icons-react';
import { useReusableSteps } from '@/hooks/useReusableSteps';
import { useTranslations } from 'next-intl';

interface SelectReusableStepModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (stepId: number, copy?: boolean) => void;
  disableLink?: boolean;
}

export const SelectReusableStepModal: React.FC<SelectReusableStepModalProps> = ({
  open,
  onClose,
  onSelect,
  disableLink = false,
}) => {
  const t = useTranslations('TestCases');
  const tCommon = useTranslations('Common');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStepId, setSelectedStepId] = useState<number | null>(null);

  const { reusableSteps, isLoading } = useReusableSteps();

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setSearchQuery('');
      setSelectedStepId(null);
    }
  }, [open]);

  // Filter reusable steps based on search
  const filteredSteps = reusableSteps.filter((step) =>
    step.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (step.description && step.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleSelect = (copy: boolean = false) => {
    if (selectedStepId) {
      onSelect(selectedStepId, copy);
      onClose();
    }
  };

  const handleCancel = () => {
    setSearchQuery('');
    setSelectedStepId(null);
    onClose();
  };

  return (
    <Modal
      opened={open}
      onClose={handleCancel}
      title={
        <Group gap="xs">
          <IconRecycle size={20} />
          <Text fw={500}>{t('selectTemplate.title')}</Text>
        </Group>
      }
      size="xl"
    >
      <div className="px-0">
        {/* Search Input */}
        <div className="mb-4">
          <TextInput
            placeholder={t('selectTemplate.searchPlaceholder')}
            leftSection={<IconSearch size={16} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
          />
        </div>

        {/* Reusable Steps List */}
        {isLoading ? (
          <div className="flex justify-center py-xl">
            <Loader size="md" />
          </div>
        ) : filteredSteps.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            {searchQuery ? t('selectTemplate.noTemplatesMatchSearch') : t('selectTemplate.noTemplatesAvailable')}
          </Text>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            {/* Table Header */}
            <div className="grid grid-cols-[200px_1fr] gap-4 px-4 py-2 border-b border-secondary bg-surface-hover">
              <Text size="sm" fw={600}>
                {t('selectTemplate.columnName')}
              </Text>
              <Text size="sm" fw={600}>
                {t('selectTemplate.columnDescription')}
              </Text>
            </div>

            {/* Reusable Step Rows */}
            {filteredSteps.map((step) => (
              <div
                key={step.id}
                className={`grid grid-cols-[200px_1fr] gap-4 px-4 py-3 border-b border-secondary cursor-pointer hover:bg-surface-hover ${
                  selectedStepId === step.id ? 'bg-surface-active' : ''
                }`}
                onClick={() => setSelectedStepId(step.id)}
              >
                <Text size="sm" fw={selectedStepId === step.id ? 500 : 400}>
                  {step.name}
                </Text>
                <Text size="sm" c="dimmed" className="line-clamp-2">
                  {step.description || ''}
                </Text>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <Group justify="flex-end" gap="sm" mt="md">
          <Button variant="outline" onClick={handleCancel}>
            {tCommon('cancel')}
          </Button>
          <Tooltip label={t('selectTemplate.copyTooltip')}>
            <Button
              variant="light"
              onClick={() => handleSelect(true)}
              disabled={!selectedStepId}
            >
              {t('selectTemplate.copy')}
            </Button>
          </Tooltip>
          <Tooltip
            label={
              disableLink
                ? t('selectTemplate.linkDisabledTooltip')
                : t('selectTemplate.linkTooltip')
            }
          >
            <Button
              onClick={() => handleSelect(false)}
              disabled={!selectedStepId || disableLink}
            >
              {t('selectTemplate.link')}
            </Button>
          </Tooltip>
        </Group>
      </div>
    </Modal>
  );
};
