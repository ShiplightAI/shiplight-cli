import React, { useState, useRef, useEffect } from "react";
import { Menu, ActionIcon, Popover, Box, Group, Text, Divider, ScrollArea } from "@mantine/core";
import { IconDots, IconCommand } from "@tabler/icons-react";

export interface MenuAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  color?: string;
  onClick: () => void;
  disabled?: boolean;
  visible?: boolean;
  shortcut?: string; // Key to be combined with Cmd/Ctrl
  tooltip?: string; // Tooltip text to show on hover
  instructionComponent?: React.ReactNode; // Detailed usage instructions as a React component
  // New: support for custom component instead of standard menu item
  customComponent?: React.ReactNode;
}

export interface MenuGroup {
  id: string;
  label?: string;
  actions: MenuAction[];
  visible?: boolean;
  divider?: boolean;
  showLabel?: boolean;
}

interface StatementContextMenuProps {
  menuGroups: MenuGroup[];
  disabled?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  trigger?: React.ReactNode;
}

export const StatementContextMenu: React.FC<StatementContextMenuProps> = ({
  menuGroups,
  disabled = false,
  size = "sm",
  trigger,
}) => {
  const [opened, setOpened] = useState(false);
  const [hoveredActionId, setHoveredActionId] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout>();

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // Format shortcut display
  const formatShortcut = (shortcut: string) => {
    if (!shortcut) return null;
    // Detect if running on macOS and use Cmd instead of Ctrl
    return `Ctrl + Alt + ${shortcut.toUpperCase()}`;
  };

  // Filter visible groups and actions
  const visibleGroups = menuGroups
    .filter((group) => group.visible !== false)
    .map((group) => ({
      ...group,
      actions: group.actions.filter((action) => action.visible !== false),
    }))
    .filter((group) => group.actions.length > 0);

  if (visibleGroups.length === 0 || disabled) {
    return null;
  }

  return (
    <Menu shadow="md" position="right-start" width={250} closeOnItemClick={true} withinPortal={true} opened={opened} onChange={setOpened}>
      <Menu.Target>
        {trigger ?? (
          <ActionIcon size={size} variant="subtle">
            <IconDots size={14} className="text-secondary" />
          </ActionIcon>
        )}
      </Menu.Target>

      <Menu.Dropdown>
        <ScrollArea.Autosize style={{ maxHeight: 800 }}>
          {visibleGroups.map((group, groupIndex) => (
            <React.Fragment key={group.id}>
              {group.showLabel && <Menu.Label>{group.label}</Menu.Label>}

              {/* Group Actions */}
              {group.label && <Menu.Label>{group.label}</Menu.Label>}
              {group.actions.map((action) =>
                action.customComponent ? (
                  // Render custom component directly
                  <React.Fragment key={action.id}>
                    {React.cloneElement(action.customComponent as React.ReactElement, {
                      onMenuClose: () => setOpened(false),
                    })}
                  </React.Fragment>
                ) : // Render standard menu item
                action.instructionComponent ? (
                  <Popover
                    key={action.id}
                    position="right-start"
                    shadow="md"
                    withinPortal
                    opened={hoveredActionId === action.id}
                    onChange={() => {}} // Required prop but we control it manually
                  >
                    <Popover.Target>
                      <Menu.Item
                        leftSection={action.icon}
                        rightSection={
                          action.shortcut ? (
                            <span className="text-xs text-gray-400 ml-auto">{formatShortcut(action.shortcut)}</span>
                          ) : undefined
                        }
                        style={action.color ? { color: action.color } : undefined}
                        disabled={action.disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          action.onClick();
                        }}
                        onMouseEnter={() => {
                          if (hoverTimeoutRef.current) {
                            clearTimeout(hoverTimeoutRef.current);
                          }
                          hoverTimeoutRef.current = setTimeout(() => {
                            setHoveredActionId(action.id);
                          }, 500);
                        }}
                        onMouseLeave={() => {
                          if (hoverTimeoutRef.current) {
                            clearTimeout(hoverTimeoutRef.current);
                          }
                          setHoveredActionId(null);
                        }}
                      >
                        {action.label}
                      </Menu.Item>
                    </Popover.Target>
                    <Popover.Dropdown
                      style={{
                        maxWidth: "400px",
                      }}
                      onMouseEnter={() => {
                        if (hoverTimeoutRef.current) {
                          clearTimeout(hoverTimeoutRef.current);
                        }
                        setHoveredActionId(action.id);
                      }}
                      onMouseLeave={() => {
                        if (hoverTimeoutRef.current) {
                          clearTimeout(hoverTimeoutRef.current);
                        }
                        setHoveredActionId(null);
                      }}
                    >
                      <Box>
                        <Group gap="xs">
                          {action.icon}
                          <Text>{action.label}</Text>
                        </Group>
                        <Divider my="xs" />
                        <Box className="text-sm">{action.instructionComponent}</Box>
                      </Box>
                    </Popover.Dropdown>
                  </Popover>
                ) : (
                  <Menu.Item
                    key={action.id}
                    leftSection={action.icon}
                    rightSection={
                      action.shortcut ? (
                        <span className="text-xs text-gray-400 ml-auto">{formatShortcut(action.shortcut)}</span>
                      ) : undefined
                    }
                    style={action.color ? { color: action.color } : undefined}
                    disabled={action.disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      action.onClick();
                    }}
                  >
                    {action.label}
                  </Menu.Item>
                ),
              )}

              {/* Divider between groups (except for last group) */}
              {groupIndex < visibleGroups.length - 1 && <Menu.Divider />}
            </React.Fragment>
          ))}
        </ScrollArea.Autosize>
      </Menu.Dropdown>
    </Menu>
  );
};
