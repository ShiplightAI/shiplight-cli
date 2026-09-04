import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Text, Group, TextInput, Loader, Checkbox, CloseButton } from '@mantine/core';
import { IconUpload, IconTarget, IconSearch, IconFolderOpen } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { apiUrl } from '../../utils/apiBase';

interface LocalFileUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (files: Array<{ fileName: string; testDataId: number }>, targetDescription?: string) => void;
  selectedFileNames?: string[];
  initialTargetDescription?: string;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const LocalFileUploadModal: React.FC<LocalFileUploadModalProps> = ({
  open,
  onClose,
  onSelect,
  selectedFileNames = [],
  initialTargetDescription = '',
}) => {
  const t = useTranslations('TestCases');
  const tCommon = useTranslations('Common');

  const [fixtureFiles, setFixtureFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [targetDescription, setTargetDescription] = useState(initialTargetDescription);
  const [copying, setCopying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // Strip "fixtures/" prefix — paths are stored relative to project root but
      // the fixture list uses bare names.
      const bareNames = selectedFileNames.map(n => n.startsWith('fixtures/') ? n.slice('fixtures/'.length) : n);
      setSelectedFiles(new Set(bareNames));
      setTargetDescription(initialTargetDescription);
      setSearchQuery('');
      setError(null);
      loadFixtures();
    }
  }, [open]);

  const loadFixtures = async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/fixtures'));
      if (!res.ok) throw new Error('Failed to load fixtures');
      const data = await res.json();
      setFixtureFiles(data.files);
    } catch (err) {
      setError(t('fileUploadModal.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;
    copyFilesToFixtures(picked);
  };

  const copyFilesToFixtures = async (files: File[]) => {
    setCopying(true);
    setError(null);
    try {
      const added: string[] = [];
      for (const file of files) {
        const content = await readAsBase64(file);
        const res = await fetch(apiUrl('/api/fixtures'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, content }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any).error || 'Copy failed');
        }
        const { fileName } = await res.json();
        added.push(fileName);
      }
      // Refresh list and auto-select newly added files
      await loadFixtures();
      setSelectedFiles(prev => {
        const next = new Set(prev);
        added.forEach(f => next.add(f));
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy file');
    } finally {
      setCopying(false);
    }
  };

  const toggleFile = (name: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const handleConfirm = () => {
    const files = [...selectedFiles].map(name => ({ fileName: `fixtures/${name}`, testDataId: 0 }));
    onSelect(files, targetDescription || undefined);
    onClose();
  };

  const filtered = fixtureFiles.filter(f =>
    f.toLowerCase().includes(searchQuery.toLowerCase())
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
            onChange={e => setTargetDescription(e.currentTarget.value)}
            label={
              <div>
                <Text size="sm" fw={500} component="span">{t('fileUploadModal.targetLabel')}</Text>
                <Text size="xs" component="span" ml={4}>{t('fileUploadModal.targetSublabel')}</Text>
              </div>
            }
          />
        </div>

        <div className="mb-4 flex gap-2">
          <TextInput
            className="flex-1"
            placeholder={t('fileUploadModal.searchPlaceholder')}
            leftSection={<IconSearch size={16} />}
            value={searchQuery}
            onChange={e => setSearchQuery(e.currentTarget.value)}
          />
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleBrowse} />
          <Button
            variant="light"
            leftSection={<IconFolderOpen size={16} />}
            onClick={() => fileInputRef.current?.click()}
            loading={copying}
          >
            {t('fileUploadModal.pickFromLocal')}
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-8">
            <Loader size="md" />
          </div>
        ) : error ? (
          <Text c="red" ta="center" py="xl">{error}</Text>
        ) : filtered.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            {searchQuery ? t('fileUploadModal.noFilesMatch') : t('fileUploadModal.noFilesAvailable')}
          </Text>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            {filtered.map(name => (
              <div
                key={name}
                className="flex px-4 py-3 border-b border-secondary cursor-pointer hover:bg-surface-hover"
                onClick={() => toggleFile(name)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Checkbox
                    checked={selectedFiles.has(name)}
                    onChange={() => toggleFile(name)}
                    onClick={e => e.stopPropagation()}
                  />
                  <Text fw={selectedFiles.has(name) ? 500 : 400} className="truncate">{name}</Text>
                </div>
              </div>
            ))}
          </div>
        )}

        <Group justify="flex-end" gap="sm" mt="md">
          <Button variant="subtle" onClick={onClose}>{tCommon('cancel')}</Button>
          <Button onClick={handleConfirm} disabled={selectedFiles.size === 0}>
            {selectedFiles.size === 1
              ? t('fileUploadModal.selectFile')
              : t('fileUploadModal.selectFiles', { count: selectedFiles.size })}
          </Button>
        </Group>
      </div>
    </Modal>
  );
};
