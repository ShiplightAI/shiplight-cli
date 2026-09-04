import React, { ReactNode, useState, createContext, useContext, useEffect, useRef, useCallback, useMemo } from "react";
import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import { Switch, Tooltip } from "@mantine/core";
import { useTranslations } from "next-intl";
import {
  IconGripVertical,
  IconEdit,
  IconTrash,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconCopy,
  IconCode,
  IconFunction,
  IconCheck,
  IconCircleDashed,
  IconCircleX,
  IconClick,
  IconGitBranch,
  IconRepeat,
  IconMail,
  IconUpload,
  IconDeviceFloppy,
  IconClock,
  IconCornerUpRightDouble,
  IconCornerDownLeftDouble,
  IconFolders,
  IconPencil,
  IconPlus,
  IconArrowsUpDown,
  IconRobot,
} from "@tabler/icons-react";
import type { ExecutionStatus } from "../types/debugger";
import { StatementContextMenu, type MenuGroup } from "./StatementContextMenu";

// Re-export MenuGroup type for other components to use
export type { MenuGroup };
import { createDebuggerMenuGroup, useOptionalDebugger } from "../debugger/contexts/DebuggerContext";
import { StatementBadge } from "./StatementBadge";
import { DebugStatusIcon } from "./DebugStatusIcon";
import { StatementType, Statement } from "shiplight-types";
import type { ExecutionStatusEntry } from "./contexts/EditorContext";
import { TestStepActionType } from "@/common/constants";
import { useEditor } from "./contexts/EditorContext";
import { FloatingActionBar } from "./FloatingActionBar";

// Utility functions to create common menu groups

/**
 * Normalizes a key for shortcut comparison
 * Handles case-insensitive matching and special key mappings
 */
const normalizeKeyForShortcut = (key: string): string => {
  return key.toLowerCase().trim();
};

/**
 * Maps event.code to the expected key for shortcuts
 * Handles special cases where event.key might not match the expected shortcut
 */
const getKeyFromEvent = (event: KeyboardEvent): string => {
  // For letter keys, use event.key directly
  if (event.key.length === 1 && /[a-zA-Z]/.test(event.key)) {
    return event.key;
  }
  
  // For special keys, try to map from event.code
  const codeMap: Record<string, string> = {
    'KeyA': 'a',
    'KeyB': 'b', 
    'KeyC': 'c',
    'KeyD': 'd',
    'KeyE': 'e',
    'KeyF': 'f',
    'KeyG': 'g',
    'KeyH': 'h',
    'KeyI': 'i',
    'KeyJ': 'j',
    'KeyK': 'k',
    'KeyL': 'l',
    'KeyM': 'm',
    'KeyN': 'n',
    'KeyO': 'o',
    'KeyP': 'p',
    'KeyQ': 'q',
    'KeyR': 'r',
    'KeyS': 's',
    'KeyT': 't',
    'KeyU': 'u',
    'KeyV': 'v',
    'KeyW': 'w',
    'KeyX': 'x',
    'KeyY': 'y',
    'KeyZ': 'z',
  };
  
  return codeMap[event.code] || event.key;
};

/** Badge showing run result execution status (passed/failed/skipped + duration). */
function RunResultStatusBadge({
  status = undefined,
  onToggleOriginal,
  showingOriginal,
  onToggleHealed,
  showingHealed,
}: {
  status?: ExecutionStatusEntry | null;
  onToggleOriginal?: () => void;
  showingOriginal?: boolean;
  onToggleHealed?: () => void;
  showingHealed?: boolean;
}) {
  const t = useTranslations('TestCases.statementWrapper');
  const skipped = status == null;
  if (skipped) {
    return (
      <Tooltip label={t('skipped')}>
        <span className="flex items-center gap-0.5 text-xs text-placeholder">
          <IconCircleDashed size={14} className="flex-shrink-0" />
        </span>
      </Tooltip>
    );
  }
  const failed = status.failed ?? !status.success;
  const statusLabel =
    status.duration != null
      ? `${failed ? t('failed') : t('passed')} (${(status.duration / 1000).toFixed(2)}s)`
      : failed
        ? t('failed')
        : t('passed');
  const diffSuffix = status.diffType === 'added'
    ? t('addedByAiFix')
    : status.diffType === 'modified'
      ? t('modifiedByAiFix')
      : status.diffType === 'moved'
        ? t('movedByAiFix')
        : '';
  const autoHealSuffix = status.autoHealed ? t('autoHealed') : '';
  const tooltipLabel = status.noteMessage ? (
    <div className="max-w-md">
      <div>{statusLabel}{diffSuffix}{autoHealSuffix}</div>
      <div className="mt-1.5 pt-1.5 border-t border-border-subtle text-xs whitespace-pre-wrap break-words">
        {status.noteMessage}
      </div>
    </div>
  ) : (
    `${statusLabel}${diffSuffix}${autoHealSuffix}`
  );
  return (
    <Tooltip label={tooltipLabel} multiline>
      <span className="flex items-center gap-0.5 text-xs">
        {failed ? (
          <IconCircleX size={14} className="text-red-600 flex-shrink-0" />
        ) : (
          <IconCheck size={14} className="text-green-600 flex-shrink-0" />
        )}
        {status.duration != null && (
          <span className="text-placeholder tabular-nums">
            {(status.duration / 1000).toFixed(1)}s
          </span>
        )}
        {status.autoHealed && (
          <Tooltip
            label={showingHealed ? t('showingHealed') : t('showingOriginal')}
            withArrow
          >
            <span
              className="ml-1 inline-flex items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <Switch
                size="xs"
                color="teal"
                checked={!!showingHealed}
                onChange={() => onToggleHealed?.()}
                aria-label="Toggle healed action step view"
                thumbIcon={
                  showingHealed ? <IconRobot size={10} stroke={2.5} /> : undefined
                }
              />
            </span>
          </Tooltip>
        )}
        {status.diffType === 'added' && (
          <span className="ml-0.5 inline-flex items-center rounded px-1 py-0 text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <IconPlus size={10} className="mr-0.5" />
            {t('added')}
          </span>
        )}
        {status.diffType === 'modified' && (
          <span
            className={`ml-0.5 inline-flex items-center rounded px-1 py-0 text-[10px] font-medium cursor-pointer ${
              showingOriginal
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleOriginal?.();
            }}
          >
            <IconPencil size={10} className="mr-0.5" />
            {showingOriginal ? t('original') : t('modified')}
          </span>
        )}
        {status.diffType === 'moved' && (
          <span className="ml-0.5 inline-flex items-center rounded px-1 py-0 text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
            <IconArrowsUpDown size={10} className="mr-0.5" />
            {t('moved')}
          </span>
        )}
      </span>
    </Tooltip>
  );
}

export const createEditorMenuGroup = (callbacks: {
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}, t: (key: string) => string): MenuGroup => ({
  id: "editor",
  actions: [
    ...(callbacks.onEdit
      ? [
          {
            id: "edit",
            label: t('editStatement'),
            icon: <IconEdit size={14} />,
            onClick: callbacks.onEdit,
            instructionComponent: (
              <div className="space-y-2">
                <div className="text-sm">
                  <ul className="mt-1 ml-3 list-disc space-y-1">
                    <li>{t('editInstruction1')}</li>
                    <li>{t('editInstruction2')}</li>
                    <li>{t('editInstruction3')}</li>
                  </ul>
                </div>
              </div>
            ),
          },
        ]
      : []),
    ...(callbacks.onDuplicate
      ? [
          {
            id: "duplicate",
            label: t('duplicate'),
            icon: <IconCopy size={14} />,
            tooltip:
              t('duplicateTooltip'),
            onClick: callbacks.onDuplicate,
            instructionComponent: (
              <div className="space-y-2">
                <div className="text-sm">
                  <ul className="mt-1 ml-3 list-disc space-y-1">
                    <li>{t('duplicateInstruction1')}</li>
                    <li>{t('duplicateInstruction2')}</li>
                    <li>{t('duplicateInstruction3')}</li>
                  </ul>
                </div>
              </div>
            ),
          },
        ]
      : []),
    ...(callbacks.onDelete
      ? [
          {
            id: "delete",
            label: t('delete'),
            icon: <IconTrash size={14} />,
            shortcut: "d",
            tooltip:
              t('deleteTooltip'),
            onClick: callbacks.onDelete,
            instructionComponent: (
              <div className="space-y-2">
                <div className="text-sm">
                  <ul className="mt-1 ml-3 list-disc space-y-1">
                    <li>{t('deleteInstruction1')}</li>
                    <li>{t('deleteInstruction2')}</li>
                    <li>{t('deleteInstruction3')}</li>
                  </ul>
                </div>
              </div>
            ),
          },
        ]
      : []),
  ],
});

export const createActionsMenuGroup = (
  onStatementTypeChange?: (statementType: StatementType, actionType?: TestStepActionType) => void,
  isReusableGroupsEnabled: boolean = true,
  disableReusableConversion: boolean = false,
  t?: (key: string) => string,
): MenuGroup => ({
  id: "convertToAction",
  label: t ? t('actionsLabel') : "Actions",
  actions: onStatementTypeChange
    ? [
        {
          id: "convertToDraft",
          label: t ? t('draft') : "Draft",
          icon: <IconPencil size={14} />,
          color: "var(--shiplight-badge-draft-bg, #ea580c)",
          shortcut: "b",
          tooltip:
            t
              ? t('draftTooltip')
              : 'A Draft is a flexible statement that converts to Action or Group after execution. Use this when you\'re not sure if your instruction will need one or multiple steps. After execution, it automatically becomes an Action (single step) or Group (multiple steps) based on what the AI produces. (Ctrl+Alt+B)',
          onClick: () => onStatementTypeChange(StatementType.DRAFT),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('draftInstruction1') : 'A Draft is a flexible statement that converts after execution.'}</li>
                  <li>{t ? t('draftInstruction2') : 'If the AI produces one action, it becomes an Action.'}</li>
                  <li>{t ? t('draftInstruction3') : 'If the AI produces multiple actions, it becomes a Group.'}</li>
                  <li>{t ? t('draftInstruction4') : 'Use this when you\'re not sure how many steps your instruction will need.'}</li>
                </ul>
              </div>
            </div>
          ),
        },
        {
          id: "convertToAction",
          label: t ? t('action') : "Action",
          icon: <IconClick size={14} />,
          color: "var(--shiplight-badge-action-bg)",
          shortcut: "a",
          tooltip:
            t
              ? t('actionTooltip')
              : 'An Action performs interactions with the page using natural language descriptions. Examples: "Click the submit button", "Fill in the email field with user@example.com", "Select California from the state dropdown". The AI agent interprets your description and executes the appropriate browser action. (Ctrl+Alt+A)',
          onClick: () => onStatementTypeChange(StatementType.ACTION, TestStepActionType.Action),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('actionInstruction1') : 'An Action performs interactions with the page using natural language descriptions.'}</li>
                  <li>{t ? t('actionInstruction2') : 'The AI agent interprets your description and executes the appropriate browser action.'}</li>
                  <li>
                    {t ? t('actionInstruction3') : 'Examples: "Click the first search result", "Scroll to the reviews section", "Wait for the page to load"'}
                  </li>
                </ul>
              </div>
            </div>
          ),
        },
        {
          id: "convertToAssertion",
          label: t ? t('assertion') : "Assertion",
          icon: <IconCheck size={14} />,
          color: "var(--shiplight-badge-assert-bg)",
          shortcut: "t",
          tooltip:
            t
              ? t('assertionTooltip')
              : 'An Assertion verifies that something on the page matches your expectations. Examples: "The page title should contain Welcome", "The error message should be visible", "The cart total should be $99.99". Tests will fail if assertions are not met. (Ctrl+Alt+T)',
          onClick: () => onStatementTypeChange(StatementType.ACTION, TestStepActionType.Assertion),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('assertionInstruction1') : 'An Assertion verifies that something on the page matches your expectations.'}</li>
                  <li>{t ? t('assertionInstruction2') : 'Tests will fail if assertions are not met.'}</li>
                  <li>
                    {t ? t('assertionInstruction3') : 'Examples: "The page title should contain Welcome", "The error message should be visible", "The cart total should be $99.99"'}
                  </li>
                </ul>
              </div>
            </div>
          ),
        },
        {
          id: "convertToCode",
          label: t ? t('code') : "Code",
          icon: <IconCode size={14} />,
          color: "var(--shiplight-badge-code-bg)",
          shortcut: "c",
          tooltip:
            t
              ? t('codeTooltip')
              : "Code blocks execute custom JavaScript directly in the browser context. Use for complex logic, data manipulation, or operations not easily expressed in natural language. Examples: calculating values, parsing JSON, setting cookies, or interacting with browser APIs. Code has access to the page object and all Playwright APIs. (Ctrl+Alt+C)",
          onClick: () => onStatementTypeChange(StatementType.ACTION, TestStepActionType.Code),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('codeInstruction1') : 'Code blocks execute custom JavaScript directly in the browser context'}</li>
                  <li>{t ? t('codeInstruction2') : 'Use for complex logic, data manipulation, or operations not easily expressed in natural language'}</li>
                  <li>{t ? t('codeInstruction3') : 'The code has access to the page object and can use await for async operations'}</li>
                  <li>{t ? t('codeInstruction4') : 'Examples: Calculate values, parse JSON, set cookies, or interact with browser APIs'}</li>
                </ul>
              </div>
            </div>
          ),
        },
        {
          id: "convertToFunction",
          label: t ? t('function') : "Function",
          icon: <IconFunction size={14} />,
          color: "var(--shiplight-badge-function-bg, #5c6ac4)",
          shortcut: "f",
          tooltip:
            t
              ? t('functionTooltip')
              : 'Functions are reusable test components that accept parameters. Use them to avoid duplicating common sequences like login flows, form submissions, or navigation patterns. Example: A "Login" function with username and password parameters can be reused across multiple tests. (Ctrl+Alt+F)',
          onClick: () => onStatementTypeChange(StatementType.ACTION, TestStepActionType.Function),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('functionInstruction1') : 'Functions are reusable test components that accept parameters'}</li>
                  <li>{t ? t('functionInstruction2') : 'Use them to avoid duplicating common sequences like login flows, form submissions, or navigation patterns'}</li>
                  <li>{t ? t('functionInstruction3') : 'Examples: A "Login" function with username and password parameters can be reused across multiple tests'}</li>
                </ul>
              </div>
            </div>
          ),
        },
        {
          id: "convertToUploadFile",
          label: t ? t('uploadFile') : "Upload file",
          icon: <IconUpload size={14} />,
          color: "var(--shiplight-badge-upload-bg, #9333ea)",
          shortcut: "u",
          tooltip:
            t
              ? t('uploadFileTooltip')
              : "Upload File actions attach files from your Test Data library to file input elements on the page. First upload files in the Test Data section, then select them here. Useful for testing file uploads, document processing, or image submissions. The action automatically handles file input elements and drag-and-drop zones. (Ctrl+Alt+U)",
          onClick: () => onStatementTypeChange(StatementType.ACTION, TestStepActionType.UploadFile),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('uploadFileInstruction1') : 'Upload File actions attach files from your Test Data library to file input elements on the page'}</li>
                  <li>{t ? t('uploadFileInstruction2') : 'First upload files in the Test Data section, then select them here'}</li>
                  <li>{t ? t('uploadFileInstruction3') : 'Useful for testing file uploads, document processing, or image submissions'}</li>
                  <li>{t ? t('uploadFileInstruction4') : 'The action automatically handles file input elements and drag-and-drop zones'}</li>
                </ul>
              </div>
            </div>
          ),
        },
        {
          id: "convertToExtractContent",
          label: t ? t('extract') : "Extract",
          icon: <IconDeviceFloppy size={14} />,
          color: "var(--shiplight-badge-extract-bg, #10b981)",
          shortcut: "e",
          tooltip:
            t
              ? t('extractTooltip')
              : 'Extract actions capture content from the page and save it to variables for later use. Examples: "Extract the order confirmation number and save to orderNumber", "Extract the user ID from the profile page and save to userId". These variables can be referenced in subsequent actions using $variableName syntax. (Ctrl+Alt+E)',
          onClick: () => onStatementTypeChange(StatementType.ACTION, TestStepActionType.ExtractContent),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('extractInstruction1') : 'Extract actions capture content from the page and save it to variables for later use'}</li>
                  <li>{t ? t('extractInstruction2') : 'These variables can be referenced in subsequent actions using $variableName syntax'}</li>
                  <li>{t ? t('extractInstruction3') : 'Examples: "Extract the order confirmation number and save to orderNumber", "Extract the user ID from the profile page and save to userId"'}</li>
                </ul>
              </div>
            </div>
          ),
        },
        // TODO: Re-enable Login action when supported
        // {
        //   id: "convertToLogin",
        //   label: "Login",
        //   icon: <IconLogin size={14} />,
        //   color: "var(--shiplight-badge-login-bg,rgb(0, 253, 169))",
        //   shortcut: "l",
        //   tooltip:
        //     "Login actions use saved test accounts to authenticate before running tests. Configure test accounts in the Test Accounts section with credentials, cookies, or session storage. The login step ensures your test starts in an authenticated state. (Ctrl+Alt+L)",
        //   onClick: () => onStatementTypeChange(StatementType.ACTION, TestStepActionType.Login),
        //   instructionComponent: (
        //     <div className="space-y-2">
        //       <div className="text-sm">
        //         <ul className="mt-1 ml-3 list-disc space-y-1">
        //           <li>Login actions use saved test accounts to authenticate before running tests</li>
        //           <li>Configure test accounts in the Test Accounts section with credentials, cookies, or session storage</li>
        //           <li>The login step ensures your test starts in an authenticated state</li>
        //         </ul>
        //       </div>
        //     </div>
        //   ),
        // },
        {
          id: "convertToWaitUntil",
          label: t ? t('waitUntil') : "Wait Until",
          icon: <IconClock size={14} />,
          color: "var(--mantine-color-violet-6)",
          shortcut: "w",
          tooltip:
            t
              ? t('waitUntilTooltip')
              : "Wait for a specific condition to be met before continuing. Use natural language to describe what to wait for, like 'The loading spinner disappears' or 'The success message appears'. Set a maximum timeout to prevent tests from hanging. (Ctrl+Alt+W)",
          onClick: () => onStatementTypeChange(StatementType.ACTION, TestStepActionType.WaitUntil),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('waitUntilInstruction1') : 'Wait for a specific condition to be met before continuing'}</li>
                  <li>{t ? t('waitUntilInstruction2') : 'Use natural language to describe what to wait for'}</li>
                  <li>{t ? t('waitUntilInstruction3') : 'Examples: "The loading spinner disappears", "The success message appears"'}</li>
                  <li>{t ? t('waitUntilInstruction4') : 'Set a maximum timeout to prevent tests from hanging'}</li>
                </ul>
              </div>
            </div>
          ),
        },
        {
          id: "convertToStep",
          label: t ? t('group') : "Group",
          icon: <IconFolders size={14} />,
          color: "#06b6d4",
          shortcut: "g",
          tooltip:
            t
              ? t('groupTooltip')
              : 'Groups are logical containers that organize related actions together. Use them to structure your test into meaningful sections like "User Registration", "Checkout Process", or "Search and Filter". Groups can be collapsed/expanded and help with test readability and maintenance. (Ctrl+Alt+G)',
          onClick: () => onStatementTypeChange(StatementType.STEP),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('groupInstruction1') : 'Groups are logical containers that organize related actions together'}</li>
                  <li>{t ? t('groupInstruction2') : 'Use them to structure your test into meaningful sections like "User Registration", "Checkout Process", or "Search and Filter"'}</li>
                  <li>{t ? t('groupInstruction3') : 'Groups can be collapsed/expanded and help with test readability and maintenance'}</li>
                </ul>
              </div>
            </div>
          ),
        },
        ...(isReusableGroupsEnabled && !disableReusableConversion ? [{
          id: "convertToReusableStep",
          label: t ? t('template') : "Template",
          icon: <IconFolders size={14} />,
          color: "#0284c7",
          shortcut: "r",
          tooltip:
            t
              ? t('templateTooltip')
              : 'Templates are pre-defined step groups. Convert this statement to a template reference, then select a template to auto-populate common test patterns like login, navigation, or form submission. (Ctrl+Alt+R)',
          onClick: () => onStatementTypeChange(StatementType.STEP, TestStepActionType.Reusable),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('templateInstruction1') : 'Templates reference pre-defined step groups for common test patterns'}</li>
                  <li>{t ? t('templateInstruction2') : 'After conversion, select a template to auto-populate actions'}</li>
                  <li>{t ? t('templateInstruction3') : 'Examples: login flow, navigation, form submission, data verification'}</li>
                  <li>{t ? t('templateInstruction4') : 'Helps maintain consistency across tests and reduces duplication'}</li>
                </ul>
              </div>
            </div>
          ),
        }] : []),
        {
          id: "convertToExtractEmailContent",
          label: t ? t('extractEmailContent') : "Extract Email Content",
          icon: <IconMail size={14} />,
          color: "var(--mantine-color-green-6)",
          tooltip:
            t
              ? t('extractEmailContentTooltip')
              : "Extract specific content from emails like verification codes, activation links, or custom data. Configure filters to target emails from specific senders, with specific subjects, or containing certain text. The extracted content is automatically saved as a variable for use in subsequent test steps.",
          onClick: () => onStatementTypeChange(StatementType.ACTION, TestStepActionType.ExtractEmailContent),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('extractEmailContentInstruction1') : 'Extract specific content from emails like verification codes or activation links'}</li>
                  <li>{t ? t('extractEmailContentInstruction2') : 'Configure filters to target emails from specific senders or with specific subjects'}</li>
                  <li>{t ? t('extractEmailContentInstruction3') : 'Set custom prompts to guide the extraction process'}</li>
                  <li>{t ? t('extractEmailContentInstruction4') : 'Extracted content is automatically saved as a variable for use in subsequent steps'}</li>
                </ul>
              </div>
            </div>
          ),
        },
      ]
    : [],
});

export const createControlFlowsMenuGroup = (
  onStatementTypeChange?: (statementType: StatementType, actionType?: TestStepActionType) => void,
  t?: (key: string) => string,
): MenuGroup => ({
  id: "convertToStatement",
  label: t ? t('controlFlows') : "Control Flows",
  actions: onStatementTypeChange
    ? [
        {
          id: "convertToIfElse",
          label: t ? t('ifElse') : "If/Else",
          icon: <IconGitBranch size={14} />,
          shortcut: "i",
          tooltip:
            t
              ? t('ifElseTooltip')
              : 'If/Else statements execute different actions based on conditions. The condition can be JavaScript code or natural language. Example: "If the user is logged in" then perform checkout actions, else show login form. Useful for handling different states, A/B tests, or dynamic content. (Ctrl+Alt+I)',
          onClick: () => onStatementTypeChange(StatementType.IF_ELSE),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('ifElseInstruction1') : 'If/Else statements execute different actions based on conditions'}</li>
                  <li>{t ? t('ifElseInstruction2') : 'The condition can be JavaScript code or natural language'}</li>
                  <li>{t ? t('ifElseInstruction3') : 'Examples: "If the user is logged in" then perform checkout actions, else show login form'}</li>
                </ul>
              </div>
            </div>
          ),
        },
        {
          id: "convertToWhileLoop",
          label: t ? t('loop') : "Loop",
          icon: <IconRepeat size={14} />,
          shortcut: "l",
          tooltip:
            t
              ? t('loopTooltip')
              : 'While loops repeat a set of actions as long as a condition is true. Examples: "While there are more pages" click next and extract data, "While the loading spinner is visible" wait. Use for pagination, polling for changes, or processing lists of unknown length. Include a maximum iteration limit to prevent infinite loops. (Ctrl+Alt+L)',
          onClick: () => onStatementTypeChange(StatementType.WHILE_LOOP),
          instructionComponent: (
            <div className="space-y-2">
              <div className="text-sm">
                <ul className="mt-1 ml-3 list-disc space-y-1">
                  <li>{t ? t('loopInstruction1') : 'While loops repeat a set of actions as long as a condition is true'}</li>
                  <li>{t ? t('loopInstruction2') : 'The condition is checked before each iteration'}</li>
                  <li>{t ? t('loopInstruction3') : 'Examples: "While there are more pages" click next and extract data, "While the loading spinner is visible" wait'}</li>
                </ul>
              </div>
            </div>
          ),
        },
      ]
    : [],
});

// Context for tracking which component should show hover effects
const HoverContext = createContext<{
  hoverStack: string[];
  pushHover: (id: string) => void;
  popHover: (id: string) => void;
  getTopHover: () => string | null;
} | null>(null);

export const HoverProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [hoverStack, setHoverStack] = useState<string[]>([]);

  const pushHover = (id: string) => {
    setHoverStack((stack) => {
      // Remove if already in stack (prevent duplicates), then add to top
      const filtered = stack.filter((item) => item !== id);
      return [...filtered, id];
    });
  };

  const popHover = (id: string) => {
    setHoverStack((stack) => stack.filter((item) => item !== id));
  };

  const getTopHover = () => {
    return hoverStack.length > 0 ? hoverStack[hoverStack.length - 1] : null;
  };

  return (
    <HoverContext.Provider value={{ hoverStack, pushHover, popHover, getTopHover }}>{children}</HoverContext.Provider>
  );
};

const useHover = () => {
  const context = useContext(HoverContext);
  if (!context) {
    // Fallback if no context provider
    return {
      hoverStack: [],
      pushHover: () => {},
      popHover: () => {},
      getTopHover: () => null,
    };
  }
  return context;
};

interface StatementWrapperProps {
  id: string;
  index: number;
  statement: Statement;
  children: ReactNode;

  // Badge props
  badgeLabel: string;
  badgeIcon: React.ReactNode;
  badgeColor: string;
  modified?: boolean;

  // Statement type change callback
  onStatementTypeChange?: (statementType: StatementType, actionType?: TestStepActionType) => void;

  // AI toggle component
  aiToggleComponent?: React.ReactNode;

  extraActions?: React.ReactNode;

  // Action button handlers
  onEdit?: () => void;
  onDelete?: () => void;
  onPlay?: () => void;
  onSkipToNext?: () => void;
  onSkipToStatement?: (stableId: string) => void;
  onRollBackToStatement?: (stableId: string) => void;
  onPlayUntil?: () => void;
  onDuplicate?: () => void;

  // Move up/down handlers (v2 floating action bar)
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;

  // Additional menu groups (for extensibility)
  additionalMenuGroups?: MenuGroup[];

  // Debug status (for statement highlighting during debugging)
  debugStatus?: ExecutionStatus;
  isCurrentStatement?: boolean;
  debugDetails?: string; // Execution details for tooltip

  // Statement-level disabling
  disabled?: boolean;

  // Layout customization
  rightPadding?: string;
  className?: string;
}

export function StatementWrapper({
  id,
  index,
  statement,
  children,
  badgeLabel,
  badgeIcon,
  badgeColor,
  modified = false,
  onStatementTypeChange,
  aiToggleComponent,
  extraActions,
  onEdit,
  onDelete,
  onPlay,
  onSkipToNext,
  onSkipToStatement,
  onRollBackToStatement,
  onPlayUntil,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  isFirst = false,
  isLast = false,
  additionalMenuGroups = [],
  debugStatus,
  isCurrentStatement = false,
  debugDetails,
  disabled = false,
  className = "",
}: StatementWrapperProps) {
  const t = useTranslations('TestCases.statementWrapper');
  const { pushHover, popHover, getTopHover } = useHover();
  const isHovered = getTopHover() === id;

  const {
    selectedStatementIds,
    handleStatementSelection,
    selectStatement,
    clearSelection,
    navigateToNextStatement,
    navigateToPreviousStatement,
    enabled,
    executionStatusByStatementUid,
    statementDisplayModeByUid,
    setStatementDisplayMode,
    displayOnly,
    v2,
  } = useEditor();
  const isSelected = selectedStatementIds.has(id);
  const runResultStatus: ExecutionStatusEntry | undefined =
    executionStatusByStatementUid?.[id];
  const statementRef = useRef<HTMLDivElement>(null);
  const descriptionMode = statementDisplayModeByUid[id] ?? (runResultStatus?.autoHealed ? "healed" : "default");

  const debuggerContext = useOptionalDebugger();
  const isDebugging = debuggerContext?.isDebugging ?? false;
  const isAiConverted = debuggerContext?.getStatementAiConverted(id) ?? false;
  // Disable drag when display-only or during debugging
  const isDragDisabled = displayOnly || false;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: id,
    data: {
      type: "statement",
      statementType: statement.type,
      index,
    },
    disabled: disabled || isDragDisabled,
  });

  // Combined ref callback to handle both draggable and statement refs
  const refCallback = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      if (statementRef.current !== node) {
        (statementRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [setNodeRef],
  );

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: undefined, // Disable all transitions for smoother experience
  };

  // Build menu groups (omit conversion and editor groups when display-only)
  const menuGroups: MenuGroup[] = useMemo(
    () => [
      // Conversion groups (only when editable)
      ...(!displayOnly && onStatementTypeChange
        ? [createActionsMenuGroup(onStatementTypeChange, true, false, t), createControlFlowsMenuGroup(onStatementTypeChange, t)]
        : []),

      createDebuggerMenuGroup(
        { onPlay, onPlayUntil },
        {
          showPlay: isCurrentStatement,
          showPlayUntil: debugStatus === "pending" || debugStatus === "running",
        },
        t,
      ),

      // Editor group (edit, duplicate, delete) - hidden in display-only
      ...(!displayOnly
        ? [createEditorMenuGroup({ onEdit, onDuplicate, onDelete }, t)]
        : []),

      // Additional groups from props
      ...additionalMenuGroups,
    ],
    [
      displayOnly,
      onStatementTypeChange,
      onPlay,
      onPlayUntil,
      isCurrentStatement,
      debugStatus,
      onEdit,
      onDuplicate,
      onDelete,
      additionalMenuGroups,
      t,
    ],
  );

  // Debug status style configurations
  const debugStatusConfig: Record<
    ExecutionStatus | "current",
    { border: string; bg: string; shadow: string }
  > = {
    current: {
      border: "border-violet-300",
      bg: "bg-violet-50/30",
      shadow: "shadow-sm",
    },
    skipped: {
      border: "border-gray-400",
      bg: "bg-gray-50/30",
      shadow: "",
    },
    streaming: {
      border: "border-blue-400",
      bg: "bg-blue-50/40",
      shadow: "shadow-md",
    },
    running: {
      border: "border-blue-400",
      bg: "bg-blue-50/30",
      shadow: "shadow-md",
    },
    success: {
      border: "border-green-400",
      bg: "bg-green-50/30",
      shadow: "",
    },
    failed: {
      border: "border-red-400",
      bg: "bg-red-50/30",
      shadow: "",
    },
    pending: {
      border: "",
      bg: "",
      shadow: "",
    },
  };

  const getDebugStyleConfig = () => {
    if (isCurrentStatement) {
      return debugStatusConfig.current;
    }
    if (debugStatus) {
      return debugStatusConfig[debugStatus];
    }
    // Run result status (read-only overview): success/failed styling
    if (runResultStatus?.executed !== false) {
      if (runResultStatus?.failed) return debugStatusConfig.failed;
      if (runResultStatus?.success) return debugStatusConfig.success;
    }
    return { border: "", bg: "", shadow: "" };
  };

  const getBorderColor = () => {
    // Selected takes priority for border only
    if (isSelected) {
      return "border-cyan-500";
    }

    // Use debug border color if available
    const debugConfig = getDebugStyleConfig();
    if (debugConfig.border) {
      return debugConfig.border;
    }

    // Use badge color for border if it's a reusable group (emerald)
    if (badgeColor === "bg-emerald-600") {
      return "border-emerald-300";
    }

    return "border-secondary";
  };

  const getBackgroundColor = () => {
    // Background uses debug status or badge color (selected doesn't affect bg)
    const debugConfig = getDebugStyleConfig();
    if (debugConfig.bg) {
      return debugConfig.bg;
    }

    // Use badge color for background if it's a reusable group (emerald)
    if (badgeColor === "bg-emerald-600") {
      return "bg-emerald-50/20";
    }

    return "";
  };

  const getFinalBorderColor = () => {
    const border = getBorderColor();
    const bg = getBackgroundColor();
    const debugConfig = getDebugStyleConfig();
    const shadow = debugConfig.shadow;
    return [border, bg, shadow].filter(Boolean).join(" ");
  };

  // Handle keyboard shortcuts when this statement is selected
  useEffect(() => {
    if (!isSelected) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle arrow keys for navigation (without modifier)
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        switch (event.key) {
          case "ArrowUp":
            event.preventDefault();
            event.stopPropagation();
            const previousStatement = navigateToPreviousStatement();
            if (previousStatement && handleStatementSelection) {
              handleStatementSelection(previousStatement, isDebugging);
            }
            break;
          case "ArrowDown":
            event.preventDefault();
            event.stopPropagation();
            const nextStatement = navigateToNextStatement();
            if (nextStatement && handleStatementSelection) {
              handleStatementSelection(nextStatement, isDebugging);
            }
            break;
        }
        return;
      }
      // Handle keyboard shortcuts for menu actions
      // Use Ctrl+Alt+shortcut to avoid conflicts with system shortcuts (Ctrl+C, Ctrl+V, etc.)
      // On macOS, use Cmd+Alt+shortcut
      
      // Debug logging for all key events with modifiers
      if (process.env.NODE_ENV === 'development' && (event.ctrlKey || event.metaKey || event.altKey)) {
        console.log('🔍 Key event with modifiers:', {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          code: event.code
        });
      }
      
      const isModifierPressed = (event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey;

      if (isModifierPressed) {
        // Get the key from event, handling special cases
        const keyFromEvent = getKeyFromEvent(event);
        const normalizedKey = normalizeKeyForShortcut(keyFromEvent);
        
        // Find matching action by shortcut
        for (const group of menuGroups) {
          for (const action of group.actions) {
            if (action.shortcut && normalizeKeyForShortcut(action.shortcut) === normalizedKey) {
              event.preventDefault();
              event.stopPropagation();
              action.onClick();
              return;
            }
          }
        }
        
        // Log unmatched shortcuts for debugging (only in development)
        if (process.env.NODE_ENV === 'development') {
          console.log(`⚠️ Unmatched shortcut: ${event.ctrlKey ? 'Ctrl' : 'Cmd'}+Alt+${event.key.toUpperCase()}`);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelected, menuGroups, navigateToNextStatement, navigateToPreviousStatement]);

  // Handle click outside to clear selection
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (statementRef.current && !statementRef.current.contains(event.target as Node)) {
        // Check if click is outside all statements by checking if target has statement-related classes
        const target = event.target as HTMLElement;
        const isOutsideStatements = !target.closest("[data-statement-wrapper]");

        // Only clear selection if clicking outside and no modifier keys are pressed
        if (isOutsideStatements && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          if (selectedStatementIds.size > 0) {
            clearSelection();
          }
        }
      }
    };

    if (selectedStatementIds.size > 0) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [selectedStatementIds.size, clearSelection]);

  if (isDragging) {
    // Show minimal placeholder to maintain layout
    return (
      <div
        ref={setNodeRef}
        style={{
          ...style,
          height: "60px", // Fixed height to maintain layout
        }}
        className={`
          relative border border-dashed border-primary rounded-md bg-surface
          transition-all duration-200
          ${className}
        `}
      >
        {/* Empty placeholder - the drag overlay shows the content */}
      </div>
    );
  }
  // Handle mouse down to prevent text selection when using modifier keys
  const onStatementMouseDown = (event: React.MouseEvent) => {
    // Prevent text selection when using modifier keys for multi-select
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      // Prevent text selection
      if (window.getSelection) {
        window.getSelection()?.removeAllRanges();
      }
    }
  };

  // Handle action click for image preview using EditorContext
  const onStatementClick = async (event: React.MouseEvent) => {
    // Prevent default behavior for modifier keys to avoid text selection
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
    }

    if (handleStatementSelection) {
      try {
        await handleStatementSelection(statement, isDebugging);
      } catch (error) {
        console.error("Failed to handle statement click:", error);
      }
    }

    // Pass the event to selectStatement for multi-select support
    selectStatement(id, event);
  };

  // Handle blur event to clear selection, requires tabIndex on the div
  const onStatementBlur = () => {
    // Only clear selection on blur if no modifier keys are pressed
    // (multi-select should persist through blur)
    if (selectedStatementIds.size === 1 && selectedStatementIds.has(id)) {
      // Single selection - clear on blur for backward compatibility
      // Multi-select - keep selection on blur
    }
  };

  return (
    <div
      ref={refCallback}
      style={style}
      data-statement-wrapper
      data-statement-id={id}
      className={`
        group/item relative border rounded-md px-1 py-2 bg-surface shadow-sm
        ${getFinalBorderColor()}
        hover:shadow-md transition-all duration-200 cursor-pointer
        ${debugStatus === "running" || debugStatus === "streaming" ? "animate-pulse" : ""}
        ${disabled ? "opacity-50 pointer-events-none" : ""}
        select-none
        ${className}
      `}
      onMouseDown={onStatementMouseDown}
      onClick={onStatementClick}
      onBlur={onStatementBlur}
      onMouseEnter={(e) => {
        if (disabled) return;
        // Set this component as the hovered one
        e.stopPropagation();
        pushHover(id);
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        // Only clear hover if we're actually leaving this component
        // Check if we're moving to a child element
        if (e.relatedTarget instanceof Node) {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            popHover(id);
          }
        } else {
          popHover(id);
        }
      }}
    >
      {/* Drag Handle - hidden in display-only mode */}
      {!displayOnly && (
        <Tooltip
          label={isDragDisabled ? t('draggingDisabled') : t('dragToReorder')}
          position="top"
          disabled={!isHovered}
        >
          <div
            {...(isDragDisabled ? {} : { ...attributes, ...listeners })}
            className={`
              absolute -left-4 top-0.5 z-10
              ${isDragDisabled ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}
              transition-opacity duration-200
              ${isHovered ? "opacity-100" : "opacity-0"}
            `}
          >
            <div
              className={`
              ${isDragDisabled ? "bg-gray-200 border-gray-300" : "bg-white border-gray-300 hover:border-gray-400"}
              rounded p-0 shadow-md border transition-colors
            `}
            >
              <IconGripVertical size={14} className={isDragDisabled ? "text-gray-400" : "text-gray-500"} />
            </div>
          </div>
        </Tooltip>
      )}

      {/* Badge Header - common across all statement types */}
      <div className="px-1 py-0.5">
        <div className="flex items-center gap-2 mb-1">
          {/* Index Number */}
          <div className="text-[11px] text-placeholder w-2 flex-shrink-0 ml-2">{index}</div>

          {/* Statement Badge */}
          <StatementBadge label={badgeLabel} icon={badgeIcon} color={badgeColor} modified={modified} />

          <DebugStatusIcon
            debugStatus={debugStatus}
            isCurrentStatement={isCurrentStatement}
            debugDetails={debugDetails}
            isAiConverted={isAiConverted}
          />
          {/* Run result execution status (when not debugging) */}
          {!debugStatus && executionStatusByStatementUid && (
            <RunResultStatusBadge
              status={runResultStatus}
              onToggleOriginal={runResultStatus?.originalDescription ? () => setStatementDisplayMode(id, descriptionMode === "original" ? "default" : "original") : undefined}
              showingOriginal={descriptionMode === "original"}
              onToggleHealed={runResultStatus?.healedAction ? () => setStatementDisplayMode(id, descriptionMode === "healed" ? "original" : "healed") : undefined}
              showingHealed={descriptionMode === "healed"}
            />
          )}
        </div>

        {/* Statement-specific content */}
        <div className="statement-content">
          {descriptionMode === "original" && runResultStatus?.originalDescription ? (
            <div className="px-2 py-1 text-sm text-secondary italic">
              {runResultStatus.originalDescription}
            </div>
          ) : (
            children
          )}
        </div>
      </div>

      {/* V2: Floating action bar centered above the step */}
      {v2 && (
        <FloatingActionBar
          onPlay={onPlay && isCurrentStatement && !disabled ? onPlay : undefined}
          onPlayUntil={onPlayUntil && !isCurrentStatement && debugStatus !== "skipped" && debugStatus !== "success" && debugStatus !== "failed" && !disabled ? onPlayUntil : undefined}
          onSkipToStatement={onSkipToStatement && !isCurrentStatement && debugStatus !== "skipped" && debugStatus !== "success" && !disabled ? () => onSkipToStatement(statement.uid) : undefined}
          onRollBackToStatement={onRollBackToStatement && !isCurrentStatement && debugStatus !== "pending" && !disabled ? () => onRollBackToStatement(statement.uid) : undefined}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onDuplicate={onDuplicate}
          onEdit={onEdit}
          onDelete={onDelete}
          menuGroups={menuGroups.filter(g => g.id !== 'debugger' && g.id !== 'editor')}
          extraActions={extraActions}
          isFirst={isFirst}
          isLast={isLast}
          visible={isHovered}
        />
      )}

      {/* V1: Action Area - visible on hover or when selected */}
      {!v2 && (
      <div
        className={`
          absolute right-2 top-2 flex items-center gap-1
          transition-opacity duration-200
          ${isHovered || isSelected ? "opacity-100" : "opacity-0"}
        `}
      >
        {extraActions}

        {/* AI Toggle Switch - always visible when enabled, positioned left of play icons */}
        {aiToggleComponent}

        {onRollBackToStatement && !isCurrentStatement && (debugStatus !== "pending" && !disabled) && (
          <Tooltip label={t('rollbackToStatement')}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRollBackToStatement?.(statement.uid);
              }}
              className="p-1 rounded hover:bg-surface-active transition-colors"
            >
              <IconCornerDownLeftDouble size={14} className="text-secondary" />
            </button>
          </Tooltip>
        )}

        {onSkipToStatement && !isCurrentStatement && (debugStatus !== "skipped" && debugStatus !== "success" && !disabled) && (
          <Tooltip label={t('skipToStatement')}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSkipToStatement?.(statement.uid);
              }}
              className="p-1 rounded hover:bg-surface-active transition-colors"
            >
              <IconCornerUpRightDouble size={14} className="text-secondary" />
            </button>
          </Tooltip>
        )}



        {/* Quick Play button - only show if handler is provided AND this is the current statement */}
        {onPlay && isCurrentStatement && !disabled && (
          <Tooltip label={t('executeStatement')}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              className="p-1 rounded hover:bg-surface-active transition-colors"
            >
              <IconPlayerPlay size={14} className="text-secondary" />
            </button>
          </Tooltip>
        )}

        {/* Quick Play Until button - only show if handler is provided AND statement hasn't been executed */}
        {onPlayUntil && !isCurrentStatement && debugStatus !== "skipped" && debugStatus !== "success" && debugStatus !== "failed" && !disabled && (
          <Tooltip label={isCurrentStatement ? t('currentStatement') : t('executeUntilStatement')}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlayUntil();
              }}
              className="p-1 rounded hover:bg-surface-active transition-colors"
              disabled={isCurrentStatement}
            >
              <IconPlayerSkipForward
                size={14}
                className={`text-secondary ${isCurrentStatement ? "text-primary" : ""}`}
              />
            </button>
          </Tooltip>
        )}

        {/* Context Menu - always show when hovered/selected */}
        <StatementContextMenu menuGroups={menuGroups} disabled={disabled} size="sm" />
      </div>
      )}
    </div>
  );
}
