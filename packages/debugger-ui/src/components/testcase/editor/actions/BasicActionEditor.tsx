import React from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconTarget } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { MultilineTextInput } from '../../../common/MultilineTextInput';

interface BasicActionEditorProps {
  description: string;
  onDescriptionChange: (newDescription: string) => void;
  onFindElement?: () => void;
  placeholder?: string;
  emptyText?: string;
  enabled?: boolean;
}

export const BasicActionEditor: React.FC<BasicActionEditorProps> = ({
  description,
  onDescriptionChange,
  onFindElement,
  placeholder,
  emptyText,
  enabled,
}) => {
  const t = useTranslations('TestCases.basicAction');
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1">
        <MultilineTextInput
          value={description}
          onChange={onDescriptionChange}
          placeholder={placeholder ?? t('placeholder')}
          emptyText={emptyText ?? t('emptyText')}
          disabled={!enabled}
        />
      </div>
      {onFindElement && (
        <Tooltip label={t('findElement')}>
          <ActionIcon
            size="sm"
            variant="subtle"
            onClick={(e) => {
              e.stopPropagation();
              onFindElement();
            }}
          >
            <IconTarget size={16} />
          </ActionIcon>
        </Tooltip>
      )}
    </div>
  );
};