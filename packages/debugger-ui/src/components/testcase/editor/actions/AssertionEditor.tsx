import React from 'react';
import { useTranslations } from 'next-intl';
import { MultilineTextInput } from '../../../common/MultilineTextInput';

interface AssertionEditorProps {
  description: string;
  onDescriptionChange: (newDescription: string) => void;
  placeholder?: string;
  emptyText?: string;
  enabled?: boolean;
}

export const AssertionEditor: React.FC<AssertionEditorProps> = ({
  description,
  onDescriptionChange,
  placeholder,
  emptyText,
  enabled,
}) => {
  const t = useTranslations('TestCases.assertions');
  return (
    <MultilineTextInput
      value={description}
      onChange={onDescriptionChange}
      placeholder={placeholder ?? t('placeholder')}
      emptyText={emptyText ?? t('emptyText')}
      disabled={!enabled}
    />
  );
};