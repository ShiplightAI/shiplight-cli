import React, { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Menu,
  Checkbox,
  Avatar,
  Group,
  Text,
  UnstyledButton,
  TextInput,
} from "@mantine/core";
import { IconChevronDown, IconUsers, IconSearch } from "@tabler/icons-react";
import { TestAccountGroupType } from "@/common/constants";

export interface TestAccountInfo {
  id: number;
  username: string;
  createdAt?: Date;
  environmentId?: number;
  name?: string;
}

export interface TestUserSelectionProps {
  accounts: TestAccountInfo[];
  selectedIds: number[];
  selectedType: TestAccountGroupType;
  onTestUserSelectionChange: (
    type: TestAccountGroupType,
    ids?: number[]
  ) => void;
  organizationId: string;
  disabled?: boolean;
}

export const TestUserSelection: React.FC<TestUserSelectionProps> = ({
  accounts,
  selectedIds,
  selectedType,
  onTestUserSelectionChange,
  organizationId,
  disabled = false,
}) => {
  const t = useTranslations('TestCases.userSelection');
  const [searchQuery, setSearchQuery] = useState("");
  const [displayText, setDisplayText] = useState("");

  useEffect(() => {
    let text = t('noneOption');
    switch (selectedType) {
      case TestAccountGroupType.None:
        text = t('noneOption');
        break;
      case TestAccountGroupType.Any:
        text = t('anyOption');
        break;
      case TestAccountGroupType.Specific:
        if (selectedIds.length === 1) {
          const account = accounts.find((a) => a.id === selectedIds[0]);
          if (account) {
            text = account.name ? `${account.username} (${account.name})` : account.username;
          } else {
            text = t('unknownAccount');
          }
        } else if (selectedIds.length > 1) {
          text = t('selectedAccounts', { count: selectedIds.length });
        }
        break;
    }
    setDisplayText(text);
  }, [selectedType, selectedIds, accounts, t]);

  const handleSelectionChange = (ids: number[]) => {
    if (ids.length === 0) {
      onTestUserSelectionChange(TestAccountGroupType.None, []);
      return;
    }
    onTestUserSelectionChange(TestAccountGroupType.Specific, ids);
  };

  const handleAnyUserSelection = () => {
    onTestUserSelectionChange(TestAccountGroupType.Any, []);
    setDisplayText(t('anyOption'));
  };

  const handleNoneSelection = () => {
    onTestUserSelectionChange(TestAccountGroupType.None, []);
    setDisplayText(t('noneOption'));
  };

  const handleUserToggle = (id: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const currentIds = selectedType === TestAccountGroupType.Specific ? selectedIds : [];
    
    const newSelection = currentIds.includes(id)
      ? currentIds.filter((selectedId) => selectedId !== id)
      : [...currentIds, id];
    
    handleSelectionChange(newSelection);
  };

  const filteredAccounts = useMemo(() => 
    accounts.filter((account) => {
      const searchTerm = searchQuery.toLowerCase();
      const displayName = account.name ? `${account.username} (${account.name})` : account.username;
      return displayName.toLowerCase().includes(searchTerm);
    }),
    [accounts, searchQuery]
  );

  return (
    <Menu 
      position="bottom-start" 
      withinPortal 
      closeOnItemClick={false}
      shadow="xl"
      offset={4}
      styles={{
        dropdown: {
          padding: 0,
          // border: '1px solid #e5e7eb',
          borderRadius: '6px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
          overflow: 'hidden',
          marginTop: '4px'
        }
      }}
    >
      <Menu.Target>
        <UnstyledButton
          className={`flex items-center gap-2 overflow-hidden px-3 h-[36px] w-full text-sm rounded border border-[color:var(--shiplight-border-subtle)] ${
            disabled
              ? "opacity-50 bg-surface cursor-not-allowed"
              : "hover:bg-surface-hover"
          }`}
          disabled={disabled}
        >
          <IconUsers
            size={16}
            className={`${disabled ? "opacity-50" : ""} text-secondary`}
          />
          <span className={disabled ? "opacity-50 truncate" : "truncate"}>{displayText}</span>
          <IconChevronDown
            size={16}
            className={`${disabled ? "opacity-50" : ""} text-secondary`}
          />
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown>
        <div className="p-2">
          <TextInput
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            leftSection={<IconSearch size={16} />}
            size="xs"
          />
        </div>

        <Menu.Item onClick={handleNoneSelection} closeMenuOnClick>
          <Text
            size="sm"
            className={
              selectedType === TestAccountGroupType.None ? "font-medium" : ""
            }
          >
            {t('noneOption')}
          </Text>
        </Menu.Item>

        <Menu.Item onClick={handleAnyUserSelection} closeMenuOnClick>
          <Text
            size="sm"
            className={
              selectedType === TestAccountGroupType.Any ? "font-medium" : ""
            }
          >
            {t('anyOption')}
          </Text>
        </Menu.Item>

        <Menu.Divider />

        <div style={{ maxHeight: "300px", overflow: "auto" }}>
          {filteredAccounts.map((account) => {
            const displayName = account.name ? `${account.username} (${account.name})` : account.username;
            return (
              <Menu.Item
                key={account.id}
                onClick={(event) =>
                  handleUserToggle(account.id, event as React.MouseEvent)
                }
              >
                <Group>
                  <Checkbox
                    checked={selectedType === TestAccountGroupType.Specific && selectedIds.includes(account.id)}
                    onChange={(event) => {
                      event.stopPropagation();
                      handleUserToggle(
                        account.id,
                        event as unknown as React.MouseEvent
                      );
                    }}
                  />
                  <Avatar size="sm" radius="xl">
                    {account.username.charAt(0)}
                  </Avatar>
                  <div>
                    <Text size="sm">{displayName}</Text>
                    <Text size="xs" c="dimmed">
                      {t('createdLabel', { date: account.createdAt?.toLocaleDateString() ?? '' })}
                    </Text>
                  </div>
                </Group>
              </Menu.Item>
            );
          })}
        </div>
      </Menu.Dropdown>
    </Menu>
  );
};
