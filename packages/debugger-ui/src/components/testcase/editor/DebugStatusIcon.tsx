import React from 'react';
import { Tooltip } from '@mantine/core';
import {
  IconLoader2,
  IconCircleCheck,
  IconCircleX,
  IconCircle,
  IconCircleDashedX,
  IconSparkles,
} from '@tabler/icons-react';
import type { ExecutionStatus } from '../types/debugger';
import { useTranslations } from 'next-intl';

// Helper function to generate dynamic tooltip props based on content length
const getDynamicTooltipProps = (content: string) => {
  const isLongContent = content.length > 50; // Threshold for long content

  return {
    multiline: isLongContent,
    w: isLongContent ? 300 : 'auto',
    styles: isLongContent ? {
      tooltip: {
        whiteSpace: 'pre-wrap' as const,
        wordBreak: 'break-word' as const
      }
    } : undefined
  };
};

interface StreamingProgressIndicatorProps {
  details?: string;
  streamingLabel: string;
}

const StreamingProgressIndicator: React.FC<StreamingProgressIndicatorProps> = ({ details, streamingLabel }) => {
  const content = details || streamingLabel;

  return (
    <Tooltip label={content} {...getDynamicTooltipProps(content)}>
      <div className="relative">
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <div className="absolute inset-0 w-4 h-4 border border-blue-300 rounded-full animate-pulse" />
      </div>
    </Tooltip>
  );
};

interface DebugStatusIconProps {
  debugStatus?: ExecutionStatus;
  isCurrentStatement?: boolean;
  debugDetails?: string;
  isAiConverted?: boolean;
  size?: number;
}

export const DebugStatusIcon: React.FC<DebugStatusIconProps> = ({
  debugStatus,
  isCurrentStatement,
  debugDetails,
  isAiConverted = false,
  size = 16
}) => {
  const t = useTranslations('TestCases.debugStatusIcon');

  if (!debugStatus) return null;

  // Streaming takes priority over all other statuses
  if (debugStatus === 'streaming') {
    return <StreamingProgressIndicator details={debugDetails} streamingLabel={t('streaming')} />;
  }

  if (debugStatus === 'skipped') {
    return (
      <Tooltip label={t('skipped')}>
        <div>
          <IconCircleDashedX size={size} className="text-gray-500" />
        </div>
      </Tooltip>
    );
  }

  if (debugStatus === 'running') {
    const content = debugDetails || t('executing');
    return (
      <Tooltip label={content} {...getDynamicTooltipProps(content)}>
        <div>
          <IconCircleDashedX size={size} className="text-blue-500 animate-spin" />
        </div>
      </Tooltip>
    );
  }

  if (debugStatus === 'success') {
    const content = debugDetails || t('executionSuccessful');

    if (isAiConverted) {
      const aiConversionContent = t('convertedToAi');
      return (
        <div className="flex items-center gap-1">
          <Tooltip label={content} {...getDynamicTooltipProps(content)}>
            <div>
              <IconCircleCheck size={size} className="text-green-500" />
            </div>
          </Tooltip>
          <Tooltip label={aiConversionContent} {...getDynamicTooltipProps(aiConversionContent)}>
            <div>
              <IconSparkles size={size} className="text-purple-500" />
            </div>
          </Tooltip>
        </div>
      );
    }

    return (
      <Tooltip label={content} {...getDynamicTooltipProps(content)}>
        <div>
          <IconCircleCheck size={size} className="text-green-500" />
        </div>
      </Tooltip>
    );
  }

  if (debugStatus === 'failed') {
    const content = debugDetails || t('executionFailed');
    return (
      <Tooltip label={content} {...getDynamicTooltipProps(content)}>
        <div>
          <IconCircleX size={size} className="text-red-500" />
        </div>
      </Tooltip>
    );
  }

  if (debugStatus === 'pending' && isCurrentStatement) {
    const content = t('nextStatement');
    return (
      <Tooltip label={content} {...getDynamicTooltipProps(content)}>
        <div>
          <IconCircle size={size} className="text-violet-400" />
        </div>
      </Tooltip>
    );
  }

  return null;
};