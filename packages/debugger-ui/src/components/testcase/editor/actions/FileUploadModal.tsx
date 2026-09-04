import React, { useState, useEffect } from 'react';
import { Modal, Button, Text, Group, TextInput, Loader, Checkbox, CloseButton } from '@mantine/core';
import { IconUpload, IconSearch, IconTarget } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

interface FileUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (files: Array<{ fileName: string; testDataId: number }>, targetDescription?: string) => void;
  selectedFileNames?: string[];
  initialTargetDescription?: string;
}

interface TestDataFile {
  id: number;
  name: string;
  description?: string;
  organizationId: number;
  createdAt: string;
  updatedAt: string;
}

export const FileUploadModal: React.FC<FileUploadModalProps> = ({
  open,
  onClose,
  onSelect,
  selectedFileNames = [],
  initialTargetDescription = '',
}) => {
  const t = useTranslations('TestCases');
  const tCommon = useTranslations('Common');
  const [testDataFiles, setTestDataFiles] = useState<TestDataFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [targetDescription, setTargetDescription] = useState(initialTargetDescription);

  // Load test data files when modal opens
  useEffect(() => {
    if (open) {
      loadTestDataFiles();
    }
  }, [open]);

  // Initialize selected files and target description when modal opens
  useEffect(() => {
    if (open) {
      setSelectedFiles(new Set(selectedFileNames));
      setTargetDescription(initialTargetDescription);
    }
  }, [open]); // Only run when modal opens/closes, not when props change

  const loadTestDataFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/test-data');

      if (response.ok) {
        const data = await response.json();
        setTestDataFiles(data);
      } else {
        setError(t('fileUploadModal.loadError'));
      }
    } catch (err) {
      console.error('Error loading test data files:', err);
      setError(t('fileUploadModal.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = () => {
    const selected = testDataFiles.filter(file => selectedFiles.has(file.name));
    const filesData = selected.map(file => ({
      fileName: file.name,
      testDataId: file.id
    }));

    if (filesData.length > 0) {
      onSelect(filesData, targetDescription || undefined);
      onClose();
    }
  };

  const toggleFileSelection = (fileName: string) => {
    const newSelection = new Set(selectedFiles);

    if (newSelection.has(fileName)) {
      newSelection.delete(fileName);
    } else {
      newSelection.add(fileName);
    }

    setSelectedFiles(newSelection);
  };

  const filteredFiles = testDataFiles.filter(file =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Modal
      opened={open}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconUpload size={20} />
          <Text fw={500}>{t('fileUploadModal.title')}</Text>
        </Group>
      }
      size="xl"
    >
      <div className="px-0">
        {/* Target Description Input */}
        <div className="mb-4">
          <TextInput
            placeholder={t('fileUploadModal.targetPlaceholder')}
            leftSection={<IconTarget size={16} />}
            rightSection={
              targetDescription && (
                <CloseButton
                  size="sm"
                  onClick={() => setTargetDescription('')}
                  aria-label={t('fileUploadModal.clearTarget')}
                />
              )
            }
            value={targetDescription}
            onChange={(e) => setTargetDescription(e.currentTarget.value)}
            label={
              <div>
                <Text size="sm" fw={500} component="span">
                  {t('fileUploadModal.targetLabel')}
                </Text>
                <Text size="xs" component="span" ml={4}>
                  {t('fileUploadModal.targetSublabel')}
                </Text>
              </div>
            }
          />
        </div>

        {/* Search Input */}
        <div className="mb-4">
          <TextInput
            placeholder={t('fileUploadModal.searchPlaceholder')}
            leftSection={<IconSearch size={16} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
          />
        </div>

        {/* File List */}
        {loading ? (
          <div className="flex justify-center items-center py-8">
            <Loader size="md" />
          </div>
        ) : error ? (
          <Text c="red" ta="center" py="xl">
            {error}
          </Text>
        ) : filteredFiles.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            {searchQuery ? t('fileUploadModal.noFilesMatch') : t('fileUploadModal.noFilesAvailable')}
          </Text>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                className="flex px-4 py-3 border-b border-secondary cursor-pointer hover:bg-surface-hover"
                onClick={() => toggleFileSelection(file.name)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Checkbox
                    checked={selectedFiles.has(file.name)}
                    onChange={() => toggleFileSelection(file.name)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="min-w-0 flex-1">
                    <Text fw={selectedFiles.has(file.name) ? 500 : 400} className="truncate">
                      {file.name}
                    </Text>
                    {file.description && (
                      <Text size="sm" c="dimmed" className="truncate">
                        {file.description}
                      </Text>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <Group justify="flex-end" gap="sm" mt="md">
          <Button variant="subtle" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            onClick={handleSelect}
            disabled={selectedFiles.size === 0}
          >
            {selectedFiles.size === 1
              ? t('fileUploadModal.selectFile')
              : t('fileUploadModal.selectFiles', { count: selectedFiles.size })}
          </Button>
        </Group>
      </div>
    </Modal>
  );
};
