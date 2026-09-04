import React, { useState, useEffect } from 'react';
import { Button, Text, Badge } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';
import { FileUploadModal } from './FileUploadModal';
import { useTranslations } from 'next-intl';

interface FileUploadEditorProps {
  description: string;
  fileNames?: string[];
  targetDescription?: string;
  onFileSelect?: (files: Array<{ fileName: string; testDataId: number }>, targetDescription?: string) => void;
  onCancel?: () => void;
  isNewlyCreated?: boolean;
  /** When true, same UI but non-editable (no click to open modal) */
  readOnly?: boolean;
}

export const FileUploadEditor: React.FC<FileUploadEditorProps> = ({
  description,
  fileNames = [],
  targetDescription = '',
  onFileSelect,
  onCancel,
  isNewlyCreated = false,
  readOnly = false,
}) => {
  const t = useTranslations('TestCases');
  // Initialize selectedFiles based on fileNames prop
  // Ensure we handle both arrays and single strings for fileNames
  const normalizedFileNames = Array.isArray(fileNames) ? fileNames : (fileNames ? [fileNames] : []);
    
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Array<{ fileName: string; testDataId: number }>>([]);
  const [target, setTarget] = useState(targetDescription);
  
  // Update selectedFiles when fileNames prop changes
  useEffect(() => {
    const normalizedNames = Array.isArray(fileNames) ? fileNames : (fileNames ? [fileNames] : []);
    if (normalizedNames.length > 0) {
      // Create temporary file objects from file names (testDataId will be set when selecting from modal)
      const files = normalizedNames.map((name, index) => ({
        fileName: name,
        testDataId: 0  // Placeholder ID, will be updated when selecting from modal
      }));
      setSelectedFiles(files);
    } else {
      // Clear selected files when fileNames is empty (e.g., after revert)
      setSelectedFiles([]);
    }
  }, [fileNames]);
  
  // Update target from props when it changes (needed for revert)
  useEffect(() => {
    setTarget(targetDescription);
  }, [targetDescription]);

  // Auto-open modal only when this is a newly created action (and not readOnly)
  useEffect(() => {
    if (!readOnly && isNewlyCreated && normalizedFileNames.length === 0) {
      console.log("🚀 Auto-opening file upload modal for newly created action");
      setModalOpen(true);
    }
  }, [readOnly, isNewlyCreated, normalizedFileNames.length]);

  const handleFileSelect = (files: Array<{ fileName: string; testDataId: number }>, targetDesc?: string) => {
    setModalOpen(false);
    setSelectedFiles(files);
    setTarget(targetDesc || '');
    if (onFileSelect) {
      onFileSelect(files, targetDesc);
    }
  };

  const handleModalClose = () => {
    setModalOpen(false);
    
    // If no files were ever selected (initial state) and modal is closed, this is a cancellation
    // This matches the FunctionEditor behavior
    if (normalizedFileNames.length === 0 && selectedFiles.length === 0 && onCancel) {
      console.log("🚫 File upload selection cancelled - calling onCancel");
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      {selectedFiles.length > 0 ? (
        <div
          className={`flex items-center gap-2 flex-1 flex-wrap gap-y-0.5 ${
            readOnly ? "cursor-default" : "cursor-pointer hover:opacity-80 transition-opacity"
          }`}
          onClick={readOnly ? undefined : () => setModalOpen(true)}
          title={readOnly ? undefined : t('fileUploadEditor.clickToChange')}
          role={readOnly ? undefined : "button"}
        >
          <IconUpload size={16} className="text-secondary" />
          <Text size="sm" className="flex-1 flex items-center flex-wrap gap-0.5">
            <span>{t('fileUploadEditor.uploadFile', { count: selectedFiles.length })}:</span>
            {selectedFiles.map((file, index) => (
              <Badge key={index} color="violet" variant="light" tt="none" className="ml-1">
                {file.fileName}
              </Badge>
            ))}
            {target && (
              <>
                <span className="ml-1">to</span>
                <span className="underline ml-1">{target}</span>
              </>
            )}
          </Text>
        </div>
      ) : readOnly ? (
        <Text size="sm" c="dimmed" className="px-2">
          {t('fileUploadEditor.noFilesSelected')}
        </Text>
      ) : (
        <Button
          size="xs"
          variant="light"
          color="violet"
          leftSection={<IconUpload size={14} />}
          onClick={() => setModalOpen(true)}
        >
          {t('fileUploadEditor.selectFiles')}
        </Button>
      )}

      {!readOnly && (
        <FileUploadModal
          open={modalOpen}
          onClose={handleModalClose}
          onSelect={handleFileSelect}
          selectedFileNames={selectedFiles.map(f => f.fileName)}
          initialTargetDescription={target}
        />
      )}
    </div>
  );
};