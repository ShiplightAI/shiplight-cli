import React from 'react';
import { Button, Switch, Tooltip } from '@mantine/core';
import { IconChevronDown, IconInfoCircle, IconTrash } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import type { ActionEntity } from 'shiplight-types';
import { StatementContextMenu, type MenuGroup } from '../StatementContextMenu';
import { ActionEntityEditor } from './ActionEntityEditor';
import { CodeEditor } from './CodeEditor';

interface V2ActionSettingsPanelProps {
  isAI: boolean;
  onAIToggle: () => void;
  showAIToggle?: boolean;
  isUsingJsCode?: boolean;
  onJsCodeToggle?: (checked: boolean) => void;
  jsCode?: string;
  onJsCodeChange?: (code: string) => void;
  isPureVision: boolean;
  onPureVisionToggle: (checked: boolean) => void;
  showPureVision: boolean;
  showCache?: boolean;
  hasCache: boolean;
  onClearCache: () => void;
  cachedActionEntity?: ActionEntity;
  description?: string;
  locator?: string;
  onActionEntityChange?: (entity: ActionEntity) => void;
  typeMenuGroups?: MenuGroup[];
  currentTypeName?: string;
  disabled?: boolean;
  editable?: boolean;
}

export const V2ActionSettingsPanel: React.FC<V2ActionSettingsPanelProps> = ({
  isAI,
  onAIToggle,
  showAIToggle = true,
  isUsingJsCode,
  onJsCodeToggle,
  jsCode,
  onJsCodeChange,
  isPureVision,
  onPureVisionToggle,
  showPureVision,
  showCache = true,
  hasCache,
  onClearCache,
  cachedActionEntity,
  description,
  locator,
  onActionEntityChange,
  typeMenuGroups,
  currentTypeName,
  disabled = false,
  editable = true,
}) => {
  const t = useTranslations('TestCases.actionStatement');

  return (
    <div className="mt-2 rounded-md border border-subtle bg-surface p-3 space-y-2">
      {/* Switch type */}
      {typeMenuGroups && typeMenuGroups.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-secondary">{t('switchType')}</span>
          <StatementContextMenu
            menuGroups={typeMenuGroups}
            disabled={disabled}
            size="xs"
            trigger={
              <Button size="compact-xs" variant="default" color="gray" rightSection={<IconChevronDown size={12} />}>
                {currentTypeName || t('switchType')}
              </Button>
            }
          />
        </div>
      )}

      {/* Using JS Code toggle (assertions only) */}
      {onJsCodeToggle && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-secondary">{t('usingJsCode')}</span>
            <Tooltip label={t('usingJsCodeInfo')} position="top" withArrow multiline maw={280}>
              <IconInfoCircle size={13} className="text-tertiary cursor-help" />
            </Tooltip>
          </div>
          <Switch
            size="xs"
            checked={isUsingJsCode || false}
            onChange={(e) => onJsCodeToggle(e.currentTarget.checked)}
            disabled={disabled}
            color={isUsingJsCode ? 'green' : 'gray'}
          />
        </div>
      )}

      {/* JS Code editor (assertions with JS code enabled) */}
      {isUsingJsCode && onJsCodeChange && (
        <div className="border-t border-subtle pt-2">
          <CodeEditor
            initialCode={jsCode}
            onConfirm={!disabled ? onJsCodeChange : undefined}
            height="120px"
            readOnly={disabled || !editable}
          />
        </div>
      )}

      {/* Disable Cache toggle */}
      {showAIToggle && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-secondary">{t('disableCacheLabel')}</span>
            <Tooltip label={t('disableCacheInfo')} position="top" withArrow multiline maw={280}>
              <IconInfoCircle size={13} className="text-tertiary cursor-help" />
            </Tooltip>
          </div>
          <Switch
            size="xs"
            checked={isAI}
            onChange={() => onAIToggle()}
            disabled={disabled}
            color={isAI ? 'green' : 'gray'}
          />
        </div>
      )}

      {/* Pure Vision toggle */}
      {showPureVision && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-secondary">{t('pureVisionLabel')}</span>
            <Tooltip label={t('pureVisionInfo')} position="top" withArrow multiline maw={280}>
              <IconInfoCircle size={13} className="text-tertiary cursor-help" />
            </Tooltip>
          </div>
          <Switch
            size="xs"
            checked={isPureVision}
            onChange={(e) => onPureVisionToggle(e.currentTarget.checked)}
            disabled={disabled}
            color={isPureVision ? 'green' : 'gray'}
          />
        </div>
      )}

      {/* Cached action entity details (hidden when cache is disabled or showCache is false) */}
      {showCache && !isAI && (
        <div className="border-t border-subtle pt-2">
          {hasCache ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-secondary">
                  {t('cachedAction', { actionName: cachedActionEntity?.action_data?.action_name || 'unknown' })}
                </span>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconTrash size={12} />}
                  onClick={(e) => { e.stopPropagation(); onClearCache(); }}
                  disabled={disabled}
                >
                  {t('clearCache')}
                </Button>
              </div>
              <ActionEntityEditor
                initialActionEntity={cachedActionEntity}
                description={description}
                locator={locator}
                onConfirm={editable ? onActionEntityChange : undefined}
                height="150px"
                emptyText="No action data"
                readOnly={!editable}
              />
            </div>
          ) : (
            <div className="text-xs text-tertiary">
              {t('noCache')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
