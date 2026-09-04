import React, { useState, useCallback, useMemo, useRef, useEffect, forwardRef } from "react";
import {
  Menu,
  Text,
  Group,
  Stack,
  Checkbox,
  Button,
  Box,
  ScrollArea,
  UnstyledButton,
  InputWrapper,
  TextInput,
  InputBase,
  Input,
} from "@mantine/core";
import { IconChevronRight, IconFolder, IconFolderOpen, IconSelector } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

// Directory item type definition
export interface DirectoryItem {
  id: string | number;
  name: string;
  children?: DirectoryItem[];
  parentId?: string | number | null;
  disabled?: boolean;
  metadata?: Record<string, any>;
}

// Selected item type
export interface SelectedItem {
  id: string | number;
  name: string;
  path: string; // Full path like "Root/Sub/Item"
  level: number; // Level depth
}

// Component props type
export interface MultiLevelSelectProps {
  // Data source
  data: DirectoryItem[];

  // Selection mode
  mode?: "single" | "multiple";

  // Current selected value
  value?: string | number | (string | number)[] | null;

  // Value change callback
  onChange?: (value: string | number | (string | number)[] | null, selectedItems?: SelectedItem[]) => void;

  // Placeholder text
  placeholder?: string;

  // Whether disabled
  disabled?: boolean;

  // Whether searchable
  searchable?: boolean;

  // Whether to show checkboxes (multiple mode)
  showCheckboxes?: boolean;

  // Whether to allow parent selection
  allowParentSelection?: boolean;

  // Maximum display level
  maxLevel?: number;

  // Custom render function
  renderItem?: (item: DirectoryItem, level: number, isSelected: boolean) => React.ReactNode;

  // Style related
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";

  // InputWrapper props
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  withAsterisk?: boolean;

  // Other props
  [key: string]: any;
}

// Find item by ID
function findItemById(items: DirectoryItem[], id: string | number): DirectoryItem | null {
  for (const item of items) {
    if (item.id === id) {
      return item;
    }
    if (item.children) {
      const found = findItemById(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Get item path
function getItemPath(items: DirectoryItem[], id: string | number, currentPath: string = ""): string | null {
  for (const item of items) {
    const newPath = currentPath ? `${currentPath}/${item.name}` : item.name;

    if (item.id === id) {
      return newPath;
    }

    if (item.children) {
      const found = getItemPath(item.children, id, newPath);
      if (found) return found;
    }
  }
  return null;
}

// Get all child IDs
function getAllChildIds(item: DirectoryItem): (string | number)[] {
  const ids: (string | number)[] = [item.id];

  if (item.children) {
    for (const child of item.children) {
      ids.push(...getAllChildIds(child));
    }
  }

  return ids;
}

// Menu item component
interface MenuItemProps {
  item: DirectoryItem;
  level: number;
  isSelected: boolean;
  isDisabled: boolean;
  mode: "single" | "multiple";
  showCheckboxes: boolean;
  allowParentSelection: boolean;
  maxLevel?: number;
  onSelect: (itemId: string | number) => void;
  renderItem?: (item: DirectoryItem, level: number, isSelected: boolean) => React.ReactNode;
  selectedValues?: (string | number)[];
  searchValue?: string;
}

function MenuItem({
  item,
  level,
  isSelected,
  isDisabled,
  mode,
  showCheckboxes,
  allowParentSelection,
  maxLevel,
  onSelect,
  renderItem,
  selectedValues = [],
  searchValue = "",
}: MenuItemProps) {
  const tCommon = useTranslations("Common");
  const [localSearchValue, setLocalSearchValue] = useState("");
  const hasChildren = item.children && item.children.length > 0;
  const canShowChildren = hasChildren && (maxLevel === undefined || level < maxLevel);

  // Filter children based on search
  const visibleChildren = useMemo(() => {
    if (!item.children) return [];
    const search = searchValue || localSearchValue;
    if (!search) return item.children;

    return item.children.filter((child) => {
      const matchesSearch = child.name.toLowerCase().includes(search.toLowerCase());
      const hasMatchingDescendants = hasMatchingChildren(child, search);
      return matchesSearch || hasMatchingDescendants;
    });
  }, [item.children, searchValue, localSearchValue]);

  // Check if item has matching descendants
  function hasMatchingChildren(item: DirectoryItem, search: string): boolean {
    if (!item.children) return false;
    return item.children.some((child) => {
      const matches = child.name.toLowerCase().includes(search.toLowerCase());
      return matches || hasMatchingChildren(child, search);
    });
  }

  // Check if item is visible based on search
  const isVisible =
    !searchValue || item.name.toLowerCase().includes(searchValue.toLowerCase()) || visibleChildren.length > 0;

  if (!isVisible && visibleChildren.length === 0) {
    return null;
  }

  // Custom render
  if (renderItem) {
    return (
      <Menu.Item key={item.id} disabled={isDisabled} onClick={() => !isDisabled && onSelect(item.id)}>
        {renderItem(item, level, isSelected)}
      </Menu.Item>
    );
  }

  if (hasChildren && canShowChildren) {
    // Parent node with submenu
    return (
      <Menu.Item key={item.id} disabled={isDisabled} closeMenuOnClick={false}>
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
              className={`flex items-center w-full cursor-pointer ${isDisabled ? "opacity-50" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!isDisabled && mode === "single") {
                  onSelect(item.id);
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Checkbox (multiple mode) */}
              {mode === "multiple" && showCheckboxes && (
                <Checkbox
                  checked={isSelected}
                  onChange={(e) => {
                    e.stopPropagation();
                    if (!isDisabled) {
                      onSelect(item.id);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={isDisabled}
                  size="sm"
                  className="mr-2 flex-shrink-0"
                />
              )}

              {/* Folder icon */}
              <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center mr-2">
                <IconFolder size={14} className="text-tertiary" />
              </div>

              {/* Item name */}
              <Text size="sm" className="flex-1">
                {item.name}
              </Text>

              <IconChevronRight size={14} className="ml-auto" />
            </div>
          </Menu.Target>

          <Menu.Dropdown
            style={{ maxHeight: 300, minWidth: "200px", paddingTop: "0" }}
            className="overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Local search input for submenu */}
            {item.children && item.children.length > 5 && (
              <div className="p-2 sticky top-0 border-b border-subtle bg-overlay z-10">
                <input
                  type="text"
                  placeholder={tCommon("filterSearchPlaceholder")}
                  value={localSearchValue}
                  onChange={(e) => setLocalSearchValue(e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-subtle rounded focus:outline-none focus:border-focus"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onFocus={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  autoComplete="off"
                />
              </div>
            )}

            <div className="py-1">
              {visibleChildren.map((child) => (
                <MenuItem
                  key={child.id}
                  item={child}
                  level={level + 1}
                  isSelected={selectedValues.includes(child.id)}
                  isDisabled={child.disabled || false}
                  mode={mode}
                  showCheckboxes={showCheckboxes}
                  allowParentSelection={allowParentSelection}
                  maxLevel={maxLevel}
                  onSelect={onSelect}
                  renderItem={renderItem}
                  selectedValues={selectedValues}
                  searchValue=""
                />
              ))}
              {visibleChildren.length === 0 && (
                <Menu.Item disabled>
                  <Text size="sm" className="text-tertiary">
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
    // Leaf node or max level reached
    return (
      <Menu.Item
        key={item.id}
        onClick={(e) => {
          e.stopPropagation();
          if (!isDisabled) {
            onSelect(item.id);
          }
        }}
        closeMenuOnClick={mode === "single"}
        leftSection={
          mode === "multiple" && showCheckboxes ? (
            <Checkbox
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                if (!isDisabled) {
                  onSelect(item.id);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={isDisabled}
              size="sm"
            />
          ) : null
        }
        disabled={isDisabled}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center">
          {/* Folder icon */}
          <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center mr-2">
            {hasChildren ? (
              <IconFolder size={14} className="text-tertiary" />
            ) : (
              <div className="w-1 h-1 rounded-full bg-tertiary" />
            )}
          </div>
          <Text size="sm">{item.name}</Text>
        </div>
      </Menu.Item>
    );
  }
}

export const MultiLevelSelect = forwardRef<HTMLDivElement, MultiLevelSelectProps>(
  (
    {
      data,
      mode = "single",
      value,
      onChange,
      placeholder,
      disabled = false,
      searchable = true,
      showCheckboxes = true,
      allowParentSelection = true,
      maxLevel,
      renderItem,
      className,
      size = "md",
      label,
      description,
      error,
      required,
      withAsterisk,
      ...props
    },
    ref,
  ) => {
    const tCommon = useTranslations("Common");
    const resolvedPlaceholder = placeholder ?? tCommon("selectDirectory");
    const [isOpen, setIsOpen] = useState(false);
    const [searchValue, setSearchValue] = useState("");
    const selectRef = useRef<HTMLButtonElement>(null);

    // Current selected values array
    const selectedValues = useMemo(() => {
      if (value === null || value === undefined) return [];
      return Array.isArray(value) ? value : [value];
    }, [value]);

    // Handle selection change
    const handleSelectionChange = useCallback(
      (itemId: string | number) => {
        if (disabled) return;

        const item = findItemById(data, itemId);
        if (!item) return;

        if (mode === "single") {
          const newValue = selectedValues.includes(itemId) ? null : itemId;
          const selectedItem = newValue
            ? {
                id: itemId,
                name: item.name,
                path: getItemPath(data, itemId) || item.name,
                level: 0, // We'll calculate this properly if needed
              }
            : undefined;

          onChange?.(newValue, selectedItem ? [selectedItem] : []);
          setIsOpen(false); // Close menu after single selection
        } else {
          // Multiple selection mode
          let newSelectedValues: (string | number)[];

          if (selectedValues.includes(itemId)) {
            // Deselect
            newSelectedValues = selectedValues.filter((id) => id !== itemId);

            // If deselecting parent, also deselect all children
            if (item.children && item.children.length > 0) {
              const childIds = getAllChildIds(item);
              newSelectedValues = newSelectedValues.filter((id) => !childIds.includes(id));
            }
          } else {
            // Select
            newSelectedValues = [...selectedValues, itemId];

            // If selecting parent, also select all children
            if (item.children && item.children.length > 0) {
              const childIds = getAllChildIds(item);
              newSelectedValues = [...new Set([...newSelectedValues, ...childIds])];
            }
          }

          // Build selected items info
          const selectedItems: SelectedItem[] = newSelectedValues.map((id) => {
            const foundItem = findItemById(data, id);
            return {
              id,
              name: foundItem?.name || "",
              path: getItemPath(data, id) || foundItem?.name || "",
              level: 0, // We'll calculate this properly if needed
            };
          });

          onChange?.(newSelectedValues, selectedItems);
        }
      },
      [data, mode, selectedValues, onChange, disabled],
    );

    // Get display text
    const displayText = useMemo(() => {
      if (selectedValues.length === 0) return undefined;

      if (mode === "single") {
        const selectedItem = findItemById(data, selectedValues[0]);
        return selectedItem?.name || resolvedPlaceholder;
      } else {
        if (selectedValues.length === 1) {
          const selectedItem = findItemById(data, selectedValues[0]);
          return selectedItem?.name || placeholder;
        } else {
          return tCommon("itemsSelected", { count: selectedValues.length });
        }
      }
    }, [selectedValues, data, mode, placeholder]);

    // Filter data based on search
    const filteredData = useMemo(() => {
      if (!searchValue.trim()) return data;

      const searchLower = searchValue.toLowerCase();
      const filterItems = (items: DirectoryItem[]): DirectoryItem[] => {
        return items
          .map((item) => {
            const matchesSearch = item.name.toLowerCase().includes(searchLower);
            const filteredChildren = item.children ? filterItems(item.children) : [];

            if (matchesSearch || filteredChildren.length > 0) {
              return {
                ...item,
                children: filteredChildren.length > 0 ? filteredChildren : item.children,
              } as DirectoryItem;
            }
            return null;
          })
          .filter((item): item is DirectoryItem => item !== null);
      };

      return filterItems(data);
    }, [data, searchValue]);

    // Handle search
    const handleSearchChange = useCallback((searchVal: string) => {
      setSearchValue(searchVal);
    }, []);

    return (
      <Menu opened={isOpen} position="bottom-start" shadow="md" withinPortal>
        <Menu.Target>
          <InputBase
            component="button"
            type="button"
            pointer
            rightSection={<IconSelector size={16} />}
            rightSectionPointerEvents="none"
            onClick={() => setIsOpen(!isOpen)}
          >
            {displayText || <Input.Placeholder>{resolvedPlaceholder}</Input.Placeholder>}
          </InputBase>
          {/* <InputWrapper
            ref={ref}
            label={label}
            description={description}
            error={error}
            required={required}
            withAsterisk={withAsterisk}
            size={size}
            className={className}
          >
            <Input
              onClick={() => setIsOpen(!isOpen)}
              value={displayText}
              placeholder={placeholder}
              rightSection={<IconSelector size={16} />}
            />
          </InputWrapper> */}
        </Menu.Target>

        <Menu.Dropdown>
          {/* Menu items */}
          <ScrollArea.Autosize mah={300}>
            <div className="p-1">
              {filteredData.length === 0 ? (
                <div className="p-4 text-center">
                  <Text size="sm" className="text-tertiary">
                    {tCommon("noMatchingDirectoriesFound")}
                  </Text>
                </div>
              ) : (
                filteredData.map((item: DirectoryItem) => (
                  <MenuItem
                    key={item.id}
                    item={item}
                    level={0}
                    isSelected={selectedValues.includes(item.id)}
                    isDisabled={item.disabled || disabled}
                    mode={mode}
                    showCheckboxes={showCheckboxes}
                    allowParentSelection={allowParentSelection}
                    maxLevel={maxLevel}
                    onSelect={handleSelectionChange}
                    renderItem={renderItem}
                    selectedValues={selectedValues}
                    searchValue={searchValue}
                  />
                ))
              )}
            </div>
          </ScrollArea.Autosize>
        </Menu.Dropdown>
      </Menu>
    );
  },
);

MultiLevelSelect.displayName = "MultiLevelSelect";

export default MultiLevelSelect;
