/**
 * SuiteSectionDivider — visual separator between suite sections in the debugger.
 */

import { Badge } from '@mantine/core';
import React from 'react';
import type { SectionType } from 'shiplight-types';
import { useTranslations } from 'next-intl';

export type { SectionType };

interface SuiteSectionDividerProps {
  type: SectionType;
  label: string;
  skip?: boolean;
}

const SECTION_COLORS: Record<SectionType, string> = {
  beforeAll: 'gray',
  beforeEach: 'gray',
  test: 'blue',
  afterEach: 'gray',
  afterAll: 'gray',
  teardown: 'orange',
};

export const SuiteSectionDivider: React.FC<SuiteSectionDividerProps> = ({ type, label, skip }) => {
  const t = useTranslations('TestCases');
  const color = SECTION_COLORS[type];

  return (
    <div className={`flex items-center gap-2 my-3 ${skip ? 'opacity-50' : ''}`}>
      <div className="flex-1 border-t border-subtle" />
      <Badge
        size="sm"
        variant="light"
        color={color}
        radius="sm"
      >
        {label}{skip ? ` ${t('suiteSectionDivider.skippedSuffix')}` : ''}
      </Badge>
      <div className="flex-1 border-t border-subtle" />
    </div>
  );
};
