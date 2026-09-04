import React, { useState, useEffect, useMemo } from "react";
import { Modal, Button, Text, Group, Stack, Alert, Menu, UnstyledButton, Avatar } from "@mantine/core";
import { IconLogin, IconInfoCircle, IconUsers, IconChevronDown } from "@tabler/icons-react";
import { EnvironmentSelect } from "@/components/common/EnvironmentSelect";
import { useEnvironments } from "@/hooks/useEnvironments";
import { useTestAccounts } from "@/hooks/useTestAccounts";
import type { TestAccountInfo } from "@/components/testcase/TestUserSelection";
import { useTranslations } from "next-intl";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (testAccountId: number, environmentId?: number) => void;
  initialTestAccountId?: number;
  initialEnvironmentId?: number;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  open,
  onClose,
  onSave,
  initialTestAccountId,
  initialEnvironmentId,
}) => {
  const t = useTranslations('TestCases');
  const tCommon = useTranslations('Common');
  const [testAccountId, setTestAccountId] = useState<number | undefined>(initialTestAccountId);
  const [environmentId, setEnvironmentId] = useState<number | undefined>(initialEnvironmentId);
  const [errors, setErrors] = useState<{ testAccountId?: string }>({});

  // Get environment data and test accounts from hooks
  const { environments } = useEnvironments();
  const { testAccounts } = useTestAccounts();

  // Reset values when modal opens
  useEffect(() => {
    if (open) {
      setTestAccountId(initialTestAccountId);
      setEnvironmentId(initialEnvironmentId);
      setErrors({});
    }
  }, [open, initialTestAccountId, initialEnvironmentId]);

  const validateForm = () => {
    const newErrors: { testAccountId?: string } = {};

    if (!testAccountId || testAccountId <= 0) {
      newErrors.testAccountId = t('loginModal.testAccountRequired');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validateForm() && testAccountId) {
      onSave(testAccountId, environmentId || undefined);
      onClose();
    }
  };

  const handleCancel = () => {
    setTestAccountId(initialTestAccountId);
    setEnvironmentId(initialEnvironmentId);
    setErrors({});
    onClose();
  };

  // Filter test accounts based on selected environment
  const availableTestAccounts = useMemo(() => {
    return testAccounts.filter((account: TestAccountInfo) => {
      if (!environmentId) {
        // When no environment is selected, only show global accounts
        return !account.environmentId;
      }
      // Include global accounts (no environmentId) and accounts specific to the selected environment
      return !account.environmentId || account.environmentId === environmentId;
    });
  }, [testAccounts, environmentId]);

  // Get display name for selected test account
  const selectedTestAccount = useMemo(() => {
    return availableTestAccounts.find((account) => account.id === testAccountId);
  }, [availableTestAccounts, testAccountId]);

  const selectedTestAccountDisplay = selectedTestAccount
    ? selectedTestAccount.name
      ? `${selectedTestAccount.username} (${selectedTestAccount.name})`
      : selectedTestAccount.username
    : t('loginModal.selectTestAccount');

  return (
    <Modal
      opened={open}
      onClose={handleCancel}
      title={
        <Group gap="xs">
          <IconLogin size={20} />
          <Text fw={500}>{t('loginModal.title')}</Text>
        </Group>
      }
      size="md"
    >
      <Stack gap="md">
        {/* Environment Selection */}
        <div className="flex flex-col gap-1">
          <Text size="sm" fw={500} className="text-secondary mb-1">
            {t('loginModal.environment')}
          </Text>
          <EnvironmentSelect
            environments={environments}
            value={environmentId || null}
            onChange={(envId) => {
              setEnvironmentId(envId || undefined);
              // Reset test account selection when environment changes
              setTestAccountId(undefined);
              if (errors.testAccountId) {
                setErrors({ ...errors, testAccountId: undefined });
              }
            }}
            placeholder={t('loginModal.environmentPlaceholder')}
          />
          <Text size="xs" c="dimmed">
            {t('loginModal.environmentDescription')}
          </Text>
        </div>

        {/* Test Account Selection */}
        <div className="flex flex-col gap-1">
          <Text size="sm" fw={500} className="text-secondary mb-1">
            {t('loginModal.testAccount')} <span className="text-red-500">*</span>
          </Text>
          <Menu position="bottom-start" withinPortal closeOnItemClick shadow="xl" offset={4}>
            <Menu.Target>
              <UnstyledButton
                className={`flex items-center gap-2 px-3 h-[36px] w-full text-sm rounded border border-[color:var(--shiplight-border-subtle)] hover:bg-surface-hover ${
                  errors.testAccountId ? "border-red-500" : ""
                }`}
              >
                <IconUsers size={16} className="text-secondary" />
                <span className="flex-1 text-left">{selectedTestAccountDisplay}</span>
                <IconChevronDown size={16} className="text-secondary" />
              </UnstyledButton>
            </Menu.Target>

            <Menu.Dropdown>
              <div style={{ maxHeight: "300px", overflow: "auto" }}>
                {availableTestAccounts.length === 0 ? (
                  <Menu.Item disabled>
                    <Text size="sm" c="dimmed">
                      {environmentId
                        ? t('loginModal.noAccountsForEnv')
                        : t('loginModal.noGlobalAccounts')}
                    </Text>
                  </Menu.Item>
                ) : (
                  availableTestAccounts.map((account) => {
                    const displayName = account.name ? `${account.username} (${account.name})` : account.username;
                    return (
                      <Menu.Item
                        key={account.id}
                        onClick={() => {
                          setTestAccountId(account.id);
                          if (errors.testAccountId) {
                            setErrors({ ...errors, testAccountId: undefined });
                          }
                        }}
                      >
                        <Group>
                          <Avatar size="sm" radius="xl">
                            {account.username.charAt(0)}
                          </Avatar>
                          <div>
                            <Text size="sm">{displayName}</Text>
                            <Text size="xs" c="dimmed">
                              ID: {account.id} • Created: {account.createdAt?.toLocaleDateString() || "Unknown"}
                            </Text>
                          </div>
                        </Group>
                      </Menu.Item>
                    );
                  })
                )}
              </div>
            </Menu.Dropdown>
          </Menu>
          {errors.testAccountId && (
            <Text size="xs" c="red">
              {errors.testAccountId}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {t('loginModal.selectAccountDescription')}
          </Text>
        </div>

        <Group justify="flex-end" gap="sm">
          <Button variant="outline" onClick={handleCancel}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleSave} leftSection={<IconLogin size={16} />}>
            {t('loginModal.saveConfiguration')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
