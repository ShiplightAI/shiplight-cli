import React, { useState, useRef, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button, Menu, TextInput, Group, Text, Checkbox, Badge, Tooltip } from "@mantine/core";
import { IconFilter, IconSearch, IconChevronDown, IconChevronRight, IconX, IconCircleCheck, IconInfoCircle } from "@tabler/icons-react";

export interface FilterOptionValue {
  value: string;
  label: string;
  count?: number;
  children?: FilterOptionValue[];
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface FilterOption {
  id: string;
  label: string;
  icon?: React.ReactNode;
  type: string;
  options?: FilterOptionValue[];
  // Optional hint shown at the top of the filter dropdown
  description?: string;
  // Optional custom renderer applied to each option in this filter
  render?: (option: FilterOptionValue) => React.ReactNode;
}

export interface FilterState {
  [key: string]: string[];
}

interface FilterDropdownProps {
  filters: FilterOption[];
  filterState: FilterState;
  onFilterChange: (filterType: string, values: string[]) => void;
  onClearAll: () => void;
  onSaveView?: () => void;
  onUpdateView?: () => void;
  canUpdateView?: boolean;
  /** Whether there are unsaved temporary filters (different from saved view) */
  hasUnsavedChanges?: boolean;
  /** Filters locked by the current view — fields present here are disabled in the dropdown */
  baseFilters?: FilterState;
}

interface FilterSubMenuProps {
  filter: FilterOption;
  activeValues?: string[];
  onFilterToggle: (filterType: string, value: string) => void;
}

interface FilterOptionItemProps {
  option: FilterOptionValue;
  activeValues?: string[];
  onFilterToggle: (filterType: string, value: string) => void;
  filterType: string;
  depth?: number;
  render?: (option: FilterOptionValue) => React.ReactNode;
}

interface FilterSubMenuWithSearchProps {
  children: FilterOptionValue[];
  activeValues?: string[];
  onFilterToggle: (filterType: string, value: string) => void;
  filterType: string;
  depth: number;
  render?: (option: FilterOptionValue) => React.ReactNode;
}

const FilterSubMenuWithSearch: React.FC<FilterSubMenuWithSearchProps> = ({
  children,
  activeValues,
  onFilterToggle,
  filterType,
  depth,
  render,
}) => {
  const tCommon = useTranslations("Common");
  const [localSearchValue, setLocalSearchValue] = useState("");

  // Helper function to check if a node or its descendants match search
  const hasMatchingDescendants = (option: FilterOptionValue, search: string): boolean => {
    if (option.label.toLowerCase().includes(search.toLowerCase())) {
      return true;
    }
    if (option.children) {
      return option.children.some((child) => hasMatchingDescendants(child, search));
    }
    return false;
  };

  // Filter children based on local search
  const filteredChildren = useMemo(() => {
    if (!localSearchValue) return children;
    return children.filter((child) => hasMatchingDescendants(child, localSearchValue));
  }, [children, localSearchValue]);

  const showSearch = children.length > 5;

  return (
    <Menu.Dropdown
      style={{ minWidth: "200px", paddingTop: "0" }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Local search input for submenu */}
      {showSearch && (
        <div className="p-2 bg-overlay border-b border-subtle">
          <TextInput
            placeholder={tCommon("filterSearchPlaceholder")}
            value={localSearchValue}
            onChange={(e) => setLocalSearchValue(e.target.value)}
            leftSection={<IconSearch size={16} />}
            rightSection={
              localSearchValue && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocalSearchValue("");
                  }}
                  className="flex items-center justify-center w-4 h-4 hover:bg-gray-200 rounded transition-colors"
                  type="button"
                >
                  <IconX size={12} />
                </button>
              )
            }
            size="xs"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            autoComplete="off"
          />
        </div>
      )}

      <div style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto', scrollbarWidth: 'none' }} className="[&::-webkit-scrollbar]:hidden">
        <div className="py-1">
          {filteredChildren.length > 0 ? (
            filteredChildren.map((child) => (
              <FilterOptionItem
                key={child.value}
                option={child}
                activeValues={activeValues}
                onFilterToggle={onFilterToggle}
                filterType={filterType}
                depth={depth + 1}
                render={render}
              />
            ))
          ) : (
            <Menu.Item disabled>
              <Text size="sm" c="dimmed">
                {localSearchValue ? tCommon("noResults") : tCommon("noOptions")}
              </Text>
            </Menu.Item>
          )}
        </div>
      </div>
    </Menu.Dropdown>
  );
};

const FilterOptionItem: React.FC<FilterOptionItemProps> = ({
  option,
  activeValues,
  onFilterToggle,
  filterType,
  depth = 0,
  render,
}) => {
  const hasChildren = option.children && option.children.length > 0;
  const isSelected = activeValues ? activeValues.includes(option.value) : false;

  if (hasChildren) {
    // Parent option with submenu
    return (
      <Menu.Item key={option.value} disabled={option.disabled} closeMenuOnClick={false}>
        <Menu
          trigger="hover"
          position="right-start"
          offset={20}
          withinPortal={true}
          closeOnItemClick={false}
          closeOnClickOutside={false}
          keepMounted={true}
        >
          <Menu.Target>
            <div
              className={`flex items-center w-full cursor-pointer ${option.disabled ? "opacity-50" : ""}`}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  if (!option.disabled) {
                    onFilterToggle(filterType, option.value);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                disabled={option.disabled}
                size="sm"
                className="mr-2"
              />
              {option.icon && <div className="mr-2">{option.icon}</div>}
              {render ? render(option) : <Text size="sm">{option.label}</Text>}
              {option.count !== undefined && (
                <Text size="xs" c="dimmed" className="mr-2">
                  {option.count}
                </Text>
              )}
              <IconChevronRight size={14} className="ml-auto" />
            </div>
          </Menu.Target>
          <FilterSubMenuWithSearch
            activeValues={activeValues}
            onFilterToggle={onFilterToggle}
            filterType={filterType}
            depth={depth}
            render={render}
          >
            {option.children!}
          </FilterSubMenuWithSearch>
        </Menu>
      </Menu.Item>
    );
  } else {
    // Leaf option
    return (
      <Menu.Item
        key={option.value}
        onClick={(e) => {
          e.stopPropagation();
          if (!option.disabled) {
            onFilterToggle(filterType, option.value);
          }
        }}
        closeMenuOnClick={false}
        onMouseDown={(e) => e.stopPropagation()}
        leftSection={
          <Checkbox
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation();
              if (!option.disabled) {
                onFilterToggle(filterType, option.value);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={option.disabled}
            size="sm"
          />
        }
        disabled={option.disabled}
      >
        <div className="flex items-center">
          {option.icon && <div className="mr-2">{option.icon}</div>}
          {render ? render(option) : <Text size="sm">{option.label}</Text>}
          {option.count !== undefined && (
            <Text size="xs" c="dimmed" className="ml-auto">
              {option.count}
            </Text>
          )}
        </div>
      </Menu.Item>
    );
  }
};

const FilterSubMenu: React.FC<FilterSubMenuProps> = ({ filter, activeValues, onFilterToggle }) => {
  const tCommon = useTranslations("Common");
  const [localSearchValue, setLocalSearchValue] = useState("");

  // Helper function to check if a node or its descendants match search
  const hasMatchingDescendants = (option: FilterOptionValue, search: string): boolean => {
    if (option.label.toLowerCase().includes(search.toLowerCase())) {
      return true;
    }
    if (option.children) {
      return option.children.some((child) => hasMatchingDescendants(child, search));
    }
    return false;
  };

  // Filter options based on local search (supports tree structure)
  const filteredOptions = useMemo(() => {
    if (!filter.options || !localSearchValue) return filter.options || [];
    return filter.options.filter((option) => hasMatchingDescendants(option, localSearchValue));
  }, [filter.options, localSearchValue]);

  const showSearch = (filter.options?.length || 0) > 5;

  return (
    <Menu.Dropdown style={{ minWidth: "200px", paddingTop: "0" }}>
      {/* Local search input for submenu */}
      {showSearch && (
        <div className="p-2 bg-overlay border-b border-subtle">
          <TextInput
            placeholder={tCommon("filterSearchPlaceholder")}
            value={localSearchValue}
            onChange={(e) => setLocalSearchValue(e.target.value)}
            leftSection={<IconSearch size={16} />}
            rightSection={
              localSearchValue && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocalSearchValue("");
                  }}
                  className="flex items-center justify-center w-4 h-4 hover:bg-gray-200 rounded transition-colors"
                  type="button"
                >
                  <IconX size={12} />
                </button>
              )
            }
            size="xs"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            autoComplete="off"
          />
        </div>
      )}

      {/* Filter Options */}
      <div style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto', scrollbarWidth: 'none' }} className="[&::-webkit-scrollbar]:hidden">
        {filteredOptions && filteredOptions.length > 0 ? (
          <div className="py-1">
            {filteredOptions.map((option) => (
              <FilterOptionItem
                key={option.value}
                option={option}
                activeValues={activeValues}
                onFilterToggle={onFilterToggle}
                filterType={filter.type}
                render={filter.render}
              />
            ))}
          </div>
        ) : (
          <Menu.Item disabled>
            <Text size="sm" c="dimmed">
              {localSearchValue ? tCommon("noResults") : tCommon("noOptions")}
            </Text>
          </Menu.Item>
        )}
      </div>
    </Menu.Dropdown>
  );
};

export function FilterDropdown({ filters, filterState, onFilterChange, onClearAll, onSaveView, onUpdateView, canUpdateView = false, hasUnsavedChanges = false, baseFilters = {} }: FilterDropdownProps) {
  const tCommon = useTranslations("Common");
  const [opened, setOpened] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [chipMenuOpened, setChipMenuOpened] = useState<Record<string, boolean>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter types locked by the current view — user cannot select these
  const lockedFilterTypes = useMemo(() => {
    return new Set(
      Object.entries(baseFilters)
        .filter(([_, values]) => values && values.length > 0)
        .map(([key]) => key),
    );
  }, [baseFilters]);

  const getActiveFilterCount = () => {
    return Object.values(filterState).reduce((total, values) => total + values.length, 0);
  };

  const hasActiveFilters = getActiveFilterCount() > 0;

  // Helper function to get all descendant values from an option
  const getAllDescendantValues = (option: FilterOptionValue): string[] => {
    const values: string[] = [];
    if (option.children) {
      option.children.forEach((child) => {
        values.push(child.value);
        values.push(...getAllDescendantValues(child));
      });
    }
    return values;
  };

  // Helper function to find an option by value in the filter options
  const findOptionByValue = (filterType: string, value: string): FilterOptionValue | null => {
    const filter = filters.find((f) => f.type === filterType);
    if (!filter?.options) return null;

    const findInOptions = (options: FilterOptionValue[]): FilterOptionValue | null => {
      for (const option of options) {
        if (option.value === value) return option;
        if (option.children) {
          const found = findInOptions(option.children);
          if (found) return found;
        }
      }
      return null;
    };

    return findInOptions(filter.options);
  };

  // Helper function to find all parent options of a given option
  const getAllParentValues = (filterType: string, value: string): string[] => {
    const filter = filters.find((f) => f.type === filterType);
    if (!filter?.options) return [];

    const parents: string[] = [];

    const findParents = (options: FilterOptionValue[], currentPath: string[] = []): void => {
      for (const option of options) {
        const newPath = [...currentPath, option.value];

        if (option.value === value) {
          // Found the target, add all parents from current path
          parents.push(...currentPath);
          return;
        }

        if (option.children) {
          findParents(option.children, newPath);
        }
      }
    };

    findParents(filter.options);
    return parents;
  };

  // Helper function to check if all children of a parent are selected
  const areAllChildrenSelected = (filterType: string, parentValue: string, selectedValues: string[]): boolean => {
    const parentOption = findOptionByValue(filterType, parentValue);
    if (!parentOption?.children) return true; // No children means all are "selected"

    const allChildren = getAllDescendantValues(parentOption);
    return allChildren.every((childValue) => selectedValues.includes(childValue));
  };

  const handleFilterToggle = (filterType: string, value: string) => {
    if (lockedFilterTypes.has(filterType)) return;
    const currentValues = filterState[filterType] || [];
    const isCurrentlySelected = currentValues.includes(value);

    let newValues: string[];

    if (isCurrentlySelected) {
      // Remove the option and all its descendants
      const option = findOptionByValue(filterType, value);
      const descendants = option ? getAllDescendantValues(option) : [];
      const valuesToRemove = [value, ...descendants];
      newValues = currentValues.filter((v) => !valuesToRemove.includes(v));
    } else {
      // Add the option and all its descendants
      const option = findOptionByValue(filterType, value);
      const descendants = option ? getAllDescendantValues(option) : [];
      const valuesToAdd = [value, ...descendants];
      newValues = [...currentValues];
      valuesToAdd.forEach((v) => {
        if (!newValues.includes(v)) {
          newValues.push(v);
        }
      });
    }

    // Handle reverse cascade: check if any parent should be deselected
    const parentValues = getAllParentValues(filterType, value);
    for (const parentValue of parentValues) {
      if (newValues.includes(parentValue) && !areAllChildrenSelected(filterType, parentValue, newValues)) {
        // Remove parent if not all children are selected
        newValues = newValues.filter((v) => v !== parentValue);
      }
    }

    // Handle forward cascade: check if any parent should be auto-selected
    for (const parentValue of parentValues) {
      if (!newValues.includes(parentValue) && areAllChildrenSelected(filterType, parentValue, newValues)) {
        // Add parent if all children are selected
        newValues.push(parentValue);
      }
    }

    onFilterChange(filterType, newValues);
  };

  const handleClearFilter = (filterType: string) => {
    onFilterChange(filterType, []);
  };

  const handleRemoveFilter = (filterType: string) => {
    onFilterChange(filterType, []);
  };

  // Get active filter chips data - one chip per filter type
  const getActiveFilterChips = () => {
    const chips: Array<{
      filterType: string;
      filterLabel: string;
      filterIcon?: React.ReactNode;
      valueCount: number;
      singleValue?: {
        value: string;
        valueLabel: string;
        valueIcon?: React.ReactNode;
      };
      allValues?: Array<{
        value: string;
        valueLabel: string;
        valueIcon?: React.ReactNode;
      }>;
    }> = [];

    Object.entries(filterState).forEach(([filterType, values]) => {
      if (values.length === 0) return;
      
      const filter = filters.find((f) => f.type === filterType);
      if (!filter) return;

      // Get only leaf nodes (values without selected children) to count actual selected values
      const leafValues = values.filter((value) => {
        const option = findOptionByValue(filterType, value);
        if (!option) return false;
        
        const hasSelectedChildren = option.children?.some((child) => {
          const childDescendants = getAllDescendantValues(child);
          return childDescendants.some((descValue) => values.includes(descValue));
        });
        
        return !hasSelectedChildren;
      });

      if (leafValues.length === 0) return;

      // If only one value, get its details
      let singleValue: { value: string; valueLabel: string; valueIcon?: React.ReactNode } | undefined;
      if (leafValues.length === 1) {
        const option = findOptionByValue(filterType, leafValues[0]);
        if (option) {
          singleValue = {
            value: leafValues[0],
            valueLabel: option.label,
            valueIcon: option.icon,
          };
        }
      }

      // Get all selected values for tooltip when count > 1
      let allValues: Array<{ value: string; valueLabel: string; valueIcon?: React.ReactNode }> | undefined;
      if (leafValues.length > 1) {
        allValues = [];
        for (const value of leafValues) {
          const option = findOptionByValue(filterType, value);
          if (option) {
            allValues.push({
              value,
              valueLabel: option.label,
              valueIcon: option.icon,
            });
          }
        }
      }

      chips.push({
        filterType,
        filterLabel: filter.label,
        filterIcon: filter.icon,
        valueCount: leafValues.length,
        singleValue,
        allValues,
      });
    });

    return chips;
  };

  const filteredFilters = filters.filter((filter) => filter.label.toLowerCase().includes(searchValue.toLowerCase()));

  // Handle menu state changes
  const handleMenuChange = (isOpened: boolean) => {
    setOpened(isOpened);
    if (isOpened) {
      setTimeout(() => searchInputRef.current?.focus(), 10);
    } else {
      setSearchValue("");
    }
  };

  const activeFilterChips = getActiveFilterChips();

  return (
    <Group gap={8}>
      {/* Filter Chips */}
      {activeFilterChips.map((chip) => {
        const filter = filters.find((f) => f.type === chip.filterType);
        const activeValues = filterState[chip.filterType];
        const chipMenuOpen = chipMenuOpened[chip.filterType] || false;

        return (
          <div
            key={chip.filterType}
            className="flex items-center gap-2 px-2 py-1 rounded border border-subtle bg-surface text-sm"
          >
            {chip.filterIcon && <div className="flex items-center">{chip.filterIcon}</div>}
            <span className="text-primary">{chip.filterLabel}</span>
            {filter && (
              <Menu
                position="bottom-start"
                withinPortal
                opened={chipMenuOpen}
                onChange={(isOpened) => {
                  setChipMenuOpened((prev) => ({
                    ...prev,
                    [chip.filterType]: isOpened,
                  }));
                }}
                closeOnItemClick={false}
                closeOnClickOutside={true}
              >
                <Menu.Target>
                  {chip.valueCount === 1 && chip.singleValue ? (
                    <div className="flex items-center gap-2 cursor-pointer hover:opacity-80">
                      <span className="text-muted">{tCommon("filterIs")}</span>
                      {chip.singleValue.valueIcon && <div className="flex items-center">{chip.singleValue.valueIcon}</div>}
                      <span className="text-primary">{chip.singleValue.valueLabel}</span>
                    </div>
                  ) : (
                    <Tooltip
                      label={
                        <div className="flex flex-col gap-1">
                          {chip.allValues?.map((val, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              {val.valueIcon && <div className="flex items-center">{val.valueIcon}</div>}
                              <span>{val.valueLabel}</span>
                            </div>
                          ))}
                        </div>
                      }
                      position="top-end"
                      withinPortal
                    >
                      <div className="flex items-center gap-2 cursor-pointer hover:opacity-80">
                        <span className="text-muted">{tCommon("filterIsAnyOf")}</span>
                        <span className="text-primary">{chip.valueCount} {chip.filterLabel.toLowerCase()}</span>
                      </div>
                    </Tooltip>
                  )}
                </Menu.Target>
                <FilterSubMenu filter={filter} activeValues={activeValues} onFilterToggle={handleFilterToggle} />
              </Menu>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveFilter(chip.filterType);
              }}
              className="flex items-center justify-center w-4 h-4 hover:bg-surface-hover rounded transition-colors ml-1"
              type="button"
              aria-label={`Remove ${chip.filterLabel} filter`}
            >
              <IconX size={12} className="text-muted" />
            </button>
          </div>
        );
      })}

      {/* Filter Button */}
      <Menu
        position="bottom-start"
        withinPortal
        opened={opened}
        onChange={handleMenuChange}
        closeOnItemClick={false}
        closeOnClickOutside={true}
        middlewares={{ shift: false}}
      >
        <Menu.Target>
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconFilter size={14} />}
            className="bg-surface border border-subtle hover:bg-surface-hover"
          >
            {tCommon("filter")}
          </Button>
        </Menu.Target>

      <Menu.Dropdown style={{ maxHeight: 400, minWidth: "240px" }} p={0}>
        {/* Search Input */}
        <div className="p-2 sticky top-0 z-10 bg-overlay border-b border-subtle">
          <TextInput
            ref={searchInputRef}
            placeholder={tCommon("filterPlaceholder")}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            leftSection={<IconSearch size={16} />}
            rightSection={
              searchValue && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchValue("");
                  }}
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

        <div style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto', scrollbarWidth: 'none' }} className="[&::-webkit-scrollbar]:hidden">
          <div className="py-1">
            {filteredFilters.length === 0 ? (
              <Menu.Item disabled>
                <Text size="sm" c="dimmed">
                  {tCommon("noFiltersFound")}
                </Text>
              </Menu.Item>
            ) : (
              filteredFilters.map((filter) => {
                const isLocked = lockedFilterTypes.has(filter.type);
                const activeValues = filterState[filter.type];
                const hasActiveValues = activeValues ? activeValues.length > 0 : false;

                if (isLocked) {
                  const lockedValues = baseFilters[filter.type] || [];
                  const lockedLabels = lockedValues
                    .map((value) => findOptionByValue(filter.type, value)?.label || value)
                    .join(", ");

                  return (
                    <Tooltip
                      key={filter.id}
                      label={
                        <div>
                          <Text size="xs" c="dimmed">{tCommon("setByCurrentView")}</Text>
                          <Text size="xs">{lockedLabels}</Text>
                        </div>
                      }
                      position="right-start"
                      withinPortal
                    >
                      <div>
                        <Menu.Item disabled>
                          <div className="flex items-center w-full opacity-50">
                            <Group gap={8} className="flex-1">
                              {filter.icon}
                              <Text size="sm" fw={500}>
                                {filter.label}
                              </Text>
                            </Group>
                          </div>
                        </Menu.Item>
                      </div>
                    </Tooltip>
                  );
                }

                return (
                  <Menu.Item key={filter.id} closeMenuOnClick={false}>
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
                        <div className="flex items-center w-full cursor-pointer">
                          <Group gap={8} className="flex-1">
                            {filter.icon}
                            <Text size="sm" fw={500}>
                              {filter.label}
                            </Text>
                            {filter.description && (
                              <Tooltip
                                label={filter.description}
                                position="right"
                                withinPortal
                                multiline
                                w={220}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <IconInfoCircle size={14} className="text-dimmed opacity-50 hover:opacity-100 flex-shrink-0" />
                              </Tooltip>
                            )}
                          </Group>
                          <Group gap={4}>
                            {hasActiveValues && (
                              <Badge size="xs" variant="light">
                                {activeValues.length}
                              </Badge>
                            )}
                            <IconChevronRight size={14} />
                          </Group>
                        </div>
                      </Menu.Target>
                      <FilterSubMenu filter={filter} activeValues={activeValues} onFilterToggle={handleFilterToggle} />
                    </Menu>
                  </Menu.Item>
                );
              })
            )}

            {/* Clear All Button */}
            {hasActiveFilters && (
              <>
                <Menu.Divider />
                <Menu.Item color="gray" onClick={onClearAll}>
                  {tCommon("clearAllFilters")}
                </Menu.Item>
              </>
            )}
          </div>
        </div>
      </Menu.Dropdown>
      </Menu>

      {/* Clear button - show when there are active filters */}
      {hasActiveFilters && (
        <Button variant="subtle" size="xs" onClick={onClearAll}>
          {tCommon("clear")}
        </Button>
      )}

      {/* Save/Update buttons - only show when there are unsaved changes */}
      {hasUnsavedChanges && (
        <>
          {canUpdateView && onUpdateView && (
            <Button variant="subtle" size="xs" onClick={onUpdateView}>
              Update
            </Button>
          )}
          {onSaveView && (
            <Button variant="subtle" size="xs" onClick={onSaveView}>
              {canUpdateView ? tCommon("saveAsNew") : tCommon("save")}
            </Button>
          )}
        </>
      )}
    </Group>
  );
}
