import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Button, Menu, Checkbox, TextInput, Group, Text, ScrollArea, ActionIcon } from "@mantine/core";
import { IconChevronDown, IconChevronRight, IconSearch, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

export interface TreeNode {
  id: string;
  label: string;
  value: string;
  children?: TreeNode[];
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface TreeSelectProps {
  /** Tree data */
  data: TreeNode[];
  /** Selected value */
  value?: string | string[];
  /** Value change callback */
  onChange?: (value: string | string[] | null) => void;
  /** Enable multiple selection */
  multiple?: boolean;
  /** Enable cascade selection (parent node selection automatically selects child nodes) */
  cascade?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Is disabled */
  disabled?: boolean;
  /** Selection strategy: all-return all selected nodes, parent-return only parent nodes, child-return only leaf nodes */
  checkStrategy?: "all" | "parent" | "child";
  /** Show search box */
  searchable?: boolean;
  /** Button size */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Button variant */
  variant?: "filled" | "light" | "outline" | "subtle" | "default";
  /** Custom class name */
  className?: string;
  /** Left section icon */
  leftSection?: React.ReactNode;
  /** Menu maximum height (pixels) */
  maxHeight?: number;
}

interface TreeNodeItemProps {
  node: TreeNode;
  searchValue: string;
  selectedValues: string[];
  onNodeSelect: (nodeId: string, checked: boolean) => void;
  getNodeCheckState: (nodeId: string) => { checked: boolean; indeterminate: boolean };
  multiple: boolean;
  maxHeight: number;
  depth?: number;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({
  node,
  searchValue,
  selectedValues,
  onNodeSelect,
  getNodeCheckState,
  multiple,
  maxHeight,
  depth = 0,
}) => {
  const tCommon = useTranslations("Common");
  const [localSearchValue, setLocalSearchValue] = useState("");
  const hasChildren = node.children && node.children.length > 0;
  const checkState = getNodeCheckState(node.id);
  const isVisible = !searchValue || node.label.toLowerCase().includes(searchValue.toLowerCase());

  // Filter children based on local search for submenus, global search for root level
  const visibleChildren = useMemo(() => {
    if (!node.children) return [];
    return node.children.filter(
      (child) =>
        child.label.toLowerCase().includes(localSearchValue.toLowerCase()) ||
        hasVisibleDescendants(child, localSearchValue),
    );
  }, [node.children, localSearchValue]);

  // Check if node has visible descendants matching search
  function hasVisibleDescendants(node: TreeNode, search: string): boolean {
    if (!node.children) return false;
    return node.children.some(
      (child) => child.label.toLowerCase().includes(search.toLowerCase()) || hasVisibleDescendants(child, search),
    );
  }

  if (!isVisible && visibleChildren.length === 0) {
    return null;
  }

  if (hasChildren) {
    // Parent node with submenu
    return (
      <Menu.Item key={node.id} disabled={node.disabled} closeMenuOnClick={!multiple}>
        <Menu
          trigger="hover"
          position="right-start"
          offset={16}
          withinPortal={true}
          closeOnItemClick={false}
          closeOnClickOutside={false}
          keepMounted={true}
        >
          <Menu.Target>
            <div
              className={`flex items-center w-full cursor-pointer ${node.disabled ? "opacity-50" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!node.disabled && !multiple) {
                  onNodeSelect(node.id, !checkState.checked);
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {multiple && (
                <Checkbox
                  checked={checkState.checked}
                  indeterminate={checkState.indeterminate}
                  onChange={(e) => {
                    e.stopPropagation();
                    if (!node.disabled) {
                      onNodeSelect(node.id, e.currentTarget.checked);
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={node.disabled}
                  size="sm"
                  className="mr-2"
                />
              )}
              {node.icon && <div className="mr-2">{node.icon}</div>}
              <Text size="sm" className="flex-1">
                {node.label}
              </Text>
              <IconChevronRight size={14} className="ml-auto" />
            </div>
          </Menu.Target>
          <Menu.Dropdown
            style={{ maxHeight: maxHeight, minWidth: "200px", paddingTop: "0" }}
            className="overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Local search input for submenu */}
            {node.children && node.children.length > 5 && (
              <div className="p-2 sticky top-0 border-b border-subtle bg-overlay z-10">
                <TextInput
                  placeholder={tCommon("filterSearchPlaceholder")}
                  value={localSearchValue}
                  onChange={(e) => {
                    setLocalSearchValue(e.target.value);
                  }}
                  leftSection={<IconSearch size={16} />}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onFocus={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  autoComplete="off"
                  rightSection={
                    localSearchValue && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocalSearchValue("");
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="flex items-center justify-center w-4 h-4 hover:bg-gray-200 rounded transition-colors"
                        type="button"
                      >
                        <IconX size={12} />
                      </button>
                    )
                  }
                  size="xs"
                />
              </div>
            )}

            <div className="py-1">
              {visibleChildren.map((child) => (
                <TreeNodeItem
                  key={child.id}
                  node={child}
                  searchValue=""
                  selectedValues={selectedValues}
                  onNodeSelect={onNodeSelect}
                  getNodeCheckState={getNodeCheckState}
                  multiple={multiple}
                  maxHeight={maxHeight}
                  depth={depth + 1}
                />
              ))}
              {visibleChildren.length === 0 && (
                <Menu.Item disabled>
                  <Text size="sm" c="dimmed">
                    {tCommon("noResults")}
                  </Text>
                </Menu.Item>
              )}
            </div>
          </Menu.Dropdown>
        </Menu>
      </Menu.Item>
    );
  } else {
    // Leaf node
    return (
      <Menu.Item
        key={node.id}
        onClick={(e) => {
          e.stopPropagation();
          if (!node.disabled && !multiple) {
            onNodeSelect(node.id, !checkState.checked);
          }
        }}
        closeMenuOnClick={!multiple}
        leftSection={
          multiple ? (
            <Checkbox
              checked={checkState.checked}
              indeterminate={checkState.indeterminate}
              onChange={(e) => {
                e.stopPropagation();
                if (!node.disabled) {
                  onNodeSelect(node.id, e.currentTarget.checked);
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={node.disabled}
              size="sm"
            />
          ) : null
        }
        disabled={node.disabled}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center">
          {node.icon && <div className="mr-2">{node.icon}</div>}
          <Text size="sm">{node.label}</Text>
        </div>
      </Menu.Item>
    );
  }
};

const TreeSelect: React.FC<TreeSelectProps> = ({
  data,
  value,
  onChange,
  multiple = false,
  cascade = true,
  placeholder,
  disabled = false,
  checkStrategy = "all",
  searchable = true,
  size = "sm",
  variant = "subtle",
  className = "",
  leftSection,
  maxHeight = 320,
}) => {
  const tCommon = useTranslations("Common");
  const resolvedPlaceholder = placeholder ?? tCommon("selectPlaceholder");
  const [opened, setOpened] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Normalize value to array format for easier processing
  const selectedValues = useMemo(() => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }, [value]);

  // Flatten all nodes for easy search and processing
  const flattenNodes = useMemo(() => {
    const nodes: TreeNode[] = [];
    const nodeMap = new Map<string, TreeNode>();
    const parentMap = new Map<string, string>();
    const childrenMap = new Map<string, string[]>();

    const flatten = (nodeList: TreeNode[], parent?: TreeNode) => {
      nodeList.forEach((node) => {
        nodes.push(node);
        nodeMap.set(node.id, node);

        if (parent) {
          parentMap.set(node.id, parent.id);
        }

        if (node.children) {
          childrenMap.set(
            node.id,
            node.children.map((child) => child.id),
          );
          flatten(node.children, node);
        }
      });
    };

    flatten(data);
    return { nodes, nodeMap, parentMap, childrenMap };
  }, [data]);

  // Get all descendant nodes
  const getAllDescendants = useCallback(
    (nodeId: string): string[] => {
      const descendants: string[] = [];
      const children = flattenNodes.childrenMap.get(nodeId) || [];

      for (const childId of children) {
        descendants.push(childId);
        descendants.push(...getAllDescendants(childId));
      }

      return descendants;
    },
    [flattenNodes.childrenMap],
  );

  // Get all ancestor nodes
  const getAllAncestors = useCallback(
    (nodeId: string): string[] => {
      const ancestors: string[] = [];
      let currentId: string | undefined = flattenNodes.parentMap.get(nodeId);

      while (currentId) {
        ancestors.push(currentId);
        currentId = flattenNodes.parentMap.get(currentId);
      }

      return ancestors;
    },
    [flattenNodes.parentMap],
  );

  // Check node selection state with proper cascade logic
  const getNodeCheckState = useCallback(
    (nodeId: string): { checked: boolean; indeterminate: boolean } => {
      if (!multiple || !cascade) {
        return { checked: selectedValues.includes(nodeId), indeterminate: false };
      }

      const children = flattenNodes.childrenMap.get(nodeId) || [];
      if (children.length === 0) {
        // Leaf node: check if it's selected directly or if its parent is selected (for parent strategy)
        if (checkStrategy === "parent") {
          const ancestors = getAllAncestors(nodeId);
          const isSelectedViaParent = ancestors.some((ancestorId) => selectedValues.includes(ancestorId));
          return { checked: selectedValues.includes(nodeId) || isSelectedViaParent, indeterminate: false };
        }
        return { checked: selectedValues.includes(nodeId), indeterminate: false };
      }

      // Parent node: check selection state based on strategy
      if (checkStrategy === "parent") {
        // For parent strategy: node is checked if it's directly selected
        return { checked: selectedValues.includes(nodeId), indeterminate: false };
      }

      // For other strategies: check based on descendants
      const allDescendants = getAllDescendants(nodeId);
      const selectedDescendantsCount = allDescendants.filter((descendantId) =>
        selectedValues.includes(descendantId),
      ).length;

      if (selectedDescendantsCount === 0) {
        return { checked: false, indeterminate: false };
      } else if (selectedDescendantsCount === allDescendants.length) {
        return { checked: true, indeterminate: false };
      } else {
        return { checked: false, indeterminate: true };
      }
    },
    [selectedValues, multiple, cascade, checkStrategy, flattenNodes.childrenMap, getAllDescendants, getAllAncestors],
  );

  // Handle node selection
  const handleNodeSelect = useCallback(
    (nodeId: string, checked: boolean) => {
      if (!onChange) return;
      console.log("handleNodeSelect", nodeId, checked);
      let newSelection = [...selectedValues];

      if (multiple) {
        if (checked) {
          if (!newSelection.includes(nodeId)) {
            newSelection.push(nodeId);
          }

          if (cascade) {
            const descendants = getAllDescendants(nodeId);
            descendants.forEach((descendantId) => {
              if (!newSelection.includes(descendantId)) {
                newSelection.push(descendantId);
              }
            });
          }
        } else {
          newSelection = newSelection.filter((id) => id !== nodeId);

          if (cascade) {
            const descendants = getAllDescendants(nodeId);
            newSelection = newSelection.filter((id) => !descendants.includes(id));

            // When a child is unselected, handle parent-to-children conversion
            const parentId = flattenNodes.parentMap.get(nodeId);
            if (parentId && selectedValues.includes(parentId)) {
              // Parent is currently selected, so we need to:
              // 1. Remove the parent from selection
              newSelection = newSelection.filter((id) => id !== parentId);

              // 2. Add all siblings (except the unselected one) to selection
              const siblings = flattenNodes.childrenMap.get(parentId) || [];
              siblings.forEach((siblingId) => {
                if (siblingId !== nodeId && !newSelection.includes(siblingId)) {
                  newSelection.push(siblingId);
                  // Also add all descendants of this sibling
                  const siblingDescendants = getAllDescendants(siblingId);
                  siblingDescendants.forEach((descendant) => {
                    if (!newSelection.includes(descendant)) {
                      newSelection.push(descendant);
                    }
                  });
                }
              });
            }
          }
        }

        // Apply selection strategy
        if (checkStrategy === "parent") {
          // For parent strategy: only keep parent nodes, remove children if parent is selected
          newSelection = newSelection.filter((id) => {
            const ancestors = getAllAncestors(id);
            return !ancestors.some((ancestorId) => newSelection.includes(ancestorId));
          });
        } else if (checkStrategy === "child") {
          // For child strategy: only keep leaf nodes
          newSelection = newSelection.filter((id) => {
            const node = flattenNodes.nodeMap.get(id);
            return !node?.children || node.children.length === 0;
          });
        }
        console.log("new selection", newSelection);
        onChange(newSelection.length > 0 ? newSelection : null);
      } else {
        onChange(checked ? nodeId : null);
        setOpened(false);
      }
    },
    [
      selectedValues,
      multiple,
      cascade,
      checkStrategy,
      onChange,
      getAllDescendants,
      getAllAncestors,
      flattenNodes.nodeMap,
    ],
  );

  // Generate display text
  const displayText = useMemo(() => {
    if (selectedValues.length === 0) return undefined;

    if (!multiple) {
      const node = flattenNodes.nodeMap.get(selectedValues[0]);
      return node?.label || selectedValues[0];
    }

    if (selectedValues.length === 1) {
      const node = flattenNodes.nodeMap.get(selectedValues[0]);
      return node?.label || selectedValues[0];
    }

    const firstNode = flattenNodes.nodeMap.get(selectedValues[0]);
    return `${firstNode?.label || selectedValues[0]} + ${selectedValues.length - 1} more`;
  }, [selectedValues, placeholder, multiple, flattenNodes.nodeMap]);

  // Clear selection
  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onChange) {
        onChange(null);
      }
    },
    [onChange],
  );

  // Handle menu state changes
  const handleMenuChange = useCallback(
    (isOpened: boolean) => {
      setOpened(isOpened);
      if (isOpened && searchable) {
        setTimeout(() => searchInputRef.current?.focus(), 10);
      } else {
        setSearchValue("");
      }
    },
    [searchable],
  );

  return (
    <Menu
      position="bottom-start"
      withinPortal
      opened={opened}
      onChange={handleMenuChange}
      disabled={disabled}
      closeOnItemClick={false}
      closeOnClickOutside={true}
    >
      <Menu.Target>
        <Button
          variant={selectedValues.length > 0 ? "light" : variant}
          size={size}
          disabled={disabled}
          className={`font-medium ${className}`}
          leftSection={leftSection}
          rightSection={
            <Group gap={4}>
              {selectedValues.length > 0 && !disabled && (
                <ActionIcon variant="subtle" size="sm" onClick={handleClear}>
                  <IconX size={12} />
                </ActionIcon>
              )}
              <IconChevronDown
                size={14}
                style={{
                  transform: opened ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              />
            </Group>
          }
          styles={{
            label: {
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "100%",
            },
          }}
        >
          {displayText ? displayText : <Text size="sm" c="dimmed">{resolvedPlaceholder}</Text>}
        </Button>
      </Menu.Target>

      <Menu.Dropdown style={{ maxHeight: maxHeight, minWidth: "200px" }} p={0}>
        {searchable && (
          <div className="p-2 sticky top-0 z-10 bg-overlay">
            <TextInput
              ref={searchInputRef}
              placeholder={tCommon("filterSearchPlaceholder")}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              leftSection={<IconSearch size={16} />}
              rightSection={
                searchValue && (
                  <button
                    onClick={() => setSearchValue("")}
                    className="flex items-center justify-center w-4 h-4 hover:bg-gray-200 rounded transition-colors"
                    type="button"
                  >
                    <IconX size={12} />
                  </button>
                )
              }
              size="xs"
            />
          </div>
        )}

        <ScrollArea.Autosize style={{ maxHeight: maxHeight - (searchable ? 60 : 0) }}>
          <div className="py-1">
            {data.length === 0 ? (
              <Menu.Item disabled>
                <Text size="sm" c="dimmed">
                  {tCommon("noOptions")}
                </Text>
              </Menu.Item>
            ) : (
              data.map((node) => (
                <TreeNodeItem
                  key={node.id}
                  node={node}
                  searchValue={searchValue}
                  selectedValues={selectedValues}
                  onNodeSelect={handleNodeSelect}
                  getNodeCheckState={getNodeCheckState}
                  multiple={multiple}
                  maxHeight={maxHeight}
                  depth={0}
                />
              ))
            )}

            {multiple && selectedValues.length > 0 && (
              <>
                <Menu.Divider />
                <Menu.Item color="gray" onClick={handleClear}>
                  {tCommon("clearAllSelections")}
                </Menu.Item>
              </>
            )}
          </div>
        </ScrollArea.Autosize>
      </Menu.Dropdown>
    </Menu>
  );
};

export default TreeSelect;
