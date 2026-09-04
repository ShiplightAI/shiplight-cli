import React, { useState } from "react";
import { Button, Menu, Group, Text } from "@mantine/core";
import { IconSortAscending, IconSortDescending, IconChevronDown } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

export interface SortOption {
  value: string;
  label: string;
}

export interface SortState {
  field: string;
  direction: "asc" | "desc";
}

interface SortDropdownProps {
  sortOptions: SortOption[];
  sortState: SortState;
  onSortChange: (field: string, direction: "asc" | "desc") => void;
}

export function SortDropdown({ sortOptions, sortState, onSortChange }: SortDropdownProps) {
  const tCommon = useTranslations("Common");
  const [opened, setOpened] = useState(false);

  const currentOption = sortOptions.find((option) => option.value === sortState.field);
  const currentLabel = currentOption?.label || tCommon("sort");

  const handleSortChange = (field: string) => {
    // If clicking the same field, toggle direction; otherwise set to asc
    const newDirection = field === sortState.field ? (sortState.direction === "asc" ? "desc" : "asc") : "desc";

    onSortChange(field, newDirection);
    setOpened(false);
  };

  const getSortIcon = (field: string) => {
    if (field === sortState.field) {
      return sortState.direction === "asc" ? <IconSortAscending size={14} /> : <IconSortDescending size={14} />;
    }
    return null;
  };

  return (
    <Menu position="bottom-start" withinPortal opened={opened} onChange={setOpened} closeOnItemClick={true}>
      <Menu.Target>
        <Button
          variant="subtle"
          size="xs"
          rightSection={
            <Group gap={4}>
              {getSortIcon(sortState.field)}
              <IconChevronDown
                size={14}
                style={{
                  transform: opened ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              />
            </Group>
          }
          className="bg-surface border border-subtle hover:bg-surface-hover"
        >
          {currentLabel}
        </Button>
      </Menu.Target>

      <Menu.Dropdown style={{ minWidth: "200px" }}>
        {sortOptions.map((option) => (
          <Menu.Item
            key={option.value}
            onClick={() => handleSortChange(option.value)}
            rightSection={getSortIcon(option.value)}
          >
            <Group gap={8}>
              <Text size="sm">{option.label}</Text>
            </Group>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
