import React from 'react';
import { Tooltip } from '@mantine/core';
import {
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconArrowUp,
  IconArrowDown,
  IconCopy,
  IconTrash,
  IconEdit,
  IconCornerDownLeftDouble,
  IconCornerUpRightDouble,
} from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { StatementContextMenu, type MenuGroup } from './StatementContextMenu';

interface FloatingActionBarProps {
  onPlay?: () => void;
  onPlayUntil?: () => void;
  onSkipToStatement?: () => void;
  onRollBackToStatement?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  menuGroups?: MenuGroup[];
  extraActions?: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
  visible: boolean;
}

export const FloatingActionBar: React.FC<FloatingActionBarProps> = ({
  onPlay,
  onPlayUntil,
  onSkipToStatement,
  onRollBackToStatement,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onEdit,
  onDelete,
  menuGroups,
  extraActions,
  isFirst,
  isLast,
  visible,
}) => {
  const t = useTranslations('TestCases.floatingActionBar');

  const hasDebugActions = onPlay || onPlayUntil || onSkipToStatement || onRollBackToStatement;
  const hasMenu = menuGroups && menuGroups.some(g => g.actions.length > 0);
  const hasEditActions = onMoveUp || onMoveDown || onDuplicate || onEdit || onDelete || hasMenu || extraActions;

  return (
    <div
      className={`
        absolute -top-4 left-1/2 -translate-x-1/2 z-20
        transition-all duration-200 ease-in-out
        ${visible ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}
      `}
    >
      <div
        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full shadow-lg"
        style={{ backgroundColor: '#3b3b3b' }}
      >
        {/* Debug actions */}
        {onPlay && (
          <Tooltip label={t('run')} position="top" withArrow>
            <button
              onClick={(e) => { e.stopPropagation(); onPlay(); }}
              className="p-1 rounded-full hover:bg-white/15 transition-colors"
            >
              <IconPlayerPlay size={14} className="text-white" />
            </button>
          </Tooltip>
        )}
        {onPlayUntil && (
          <Tooltip label={t('runUntil')} position="top" withArrow>
            <button
              onClick={(e) => { e.stopPropagation(); onPlayUntil(); }}
              className="p-1 rounded-full hover:bg-white/15 transition-colors"
            >
              <IconPlayerSkipForward size={14} className="text-white" />
            </button>
          </Tooltip>
        )}
        {onRollBackToStatement && (
          <Tooltip label={t('rollback')} position="top" withArrow>
            <button
              onClick={(e) => { e.stopPropagation(); onRollBackToStatement(); }}
              className="p-1 rounded-full hover:bg-white/15 transition-colors"
            >
              <IconCornerDownLeftDouble size={14} className="text-white" />
            </button>
          </Tooltip>
        )}
        {onSkipToStatement && (
          <Tooltip label={t('skipTo')} position="top" withArrow>
            <button
              onClick={(e) => { e.stopPropagation(); onSkipToStatement(); }}
              className="p-1 rounded-full hover:bg-white/15 transition-colors"
            >
              <IconCornerUpRightDouble size={14} className="text-white" />
            </button>
          </Tooltip>
        )}

        {/* Separator */}
        {hasDebugActions && hasEditActions && (
          <div className="w-px h-4 bg-white/25 mx-0.5" />
        )}

        {/* Edit actions */}
        {onMoveUp && (
          <Tooltip label={t('moveUp')} position="top" withArrow>
            <button
              onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
              className="p-1 rounded-full hover:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={isFirst}
            >
              <IconArrowUp size={14} className="text-white" />
            </button>
          </Tooltip>
        )}
        {onMoveDown && (
          <Tooltip label={t('moveDown')} position="top" withArrow>
            <button
              onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
              className="p-1 rounded-full hover:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={isLast}
            >
              <IconArrowDown size={14} className="text-white" />
            </button>
          </Tooltip>
        )}
        {onDuplicate && (
          <Tooltip label={t('duplicate')} position="top" withArrow>
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
              className="p-1 rounded-full hover:bg-white/15 transition-colors"
            >
              <IconCopy size={14} className="text-white" />
            </button>
          </Tooltip>
        )}
        {onEdit && (
          <Tooltip label={t('edit')} position="top" withArrow>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1 rounded-full hover:bg-white/15 transition-colors"
            >
              <IconEdit size={14} className="text-white" />
            </button>
          </Tooltip>
        )}
        {extraActions}
        {onDelete && (
          <Tooltip label={t('delete')} position="top" withArrow>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded-full hover:bg-white/15 transition-colors"
            >
              <IconTrash size={14} className="text-red-400" />
            </button>
          </Tooltip>
        )}

        {/* Context menu - reuses v1's three-dot menu */}
        {hasMenu && (
          <>
            <div className="w-px h-4 bg-white/25 mx-0.5" />
            <StatementContextMenu menuGroups={menuGroups} size="xs" />
          </>
        )}
      </div>
    </div>
  );
};
