import React, { useState, useEffect, useMemo } from "react";
import { Text, Badge, Group } from "@mantine/core";
import { IconLogin, IconUser, IconWorld } from "@tabler/icons-react";
import { LoginModal } from "./LoginModal";
import { useTestAccounts } from "@/hooks/useTestAccounts";
import { useEnvironments } from "@/hooks/useEnvironments";
import { useTranslations } from "next-intl";

interface LoginEditorProps {
  description: string;
  testAccountId?: number;
  environmentId?: number;
  defaultEnvironmentId?: number; // Default environment from test case editor
  onLoginConfirm?: (testAccountId: number, environmentId?: number) => void;
  onLoginCancel?: () => void;
  /** When true, same UI but non-editable (no click to open modal) */
  readOnly?: boolean;
}

export const LoginEditor: React.FC<LoginEditorProps> = ({
  description,
  testAccountId: initialTestAccountId,
  environmentId: initialEnvironmentId,
  defaultEnvironmentId,
  onLoginConfirm,
  onLoginCancel,
  readOnly = false,
}) => {
  const t = useTranslations('TestCases');
  const [modalOpen, setModalOpen] = useState(false);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  // Get environment and test account data
  const { environments } = useEnvironments();
  const { testAccounts } = useTestAccounts();

  // Get display names for selected items
  const selectedEnvironment = useMemo(() => {
    return environments.find((env: any) => env.id === initialEnvironmentId);
  }, [environments, initialEnvironmentId]);

  const selectedTestAccount = useMemo(() => {
    return testAccounts.find((account) => account.id === initialTestAccountId);
  }, [testAccounts, initialTestAccountId]);

  // Auto-open modal when component is first rendered without configuration (and not readOnly)
  useEffect(() => {
    if (readOnly) return;
    if (!initialTestAccountId && !hasAutoOpened) {
      setModalOpen(true);
      setHasAutoOpened(true);
    }
  }, [readOnly, initialTestAccountId, hasAutoOpened]);

  const handleSave = (testAccountId: number, environmentId?: number) => {
    if (onLoginConfirm) {
      onLoginConfirm(testAccountId, environmentId);
    }
    setModalOpen(false);
  };

  const handleModalClose = () => {
    setModalOpen(false);

    // If no configuration exists and modal is closed, this is a cancellation
    if (!initialTestAccountId && onLoginCancel) {
      onLoginCancel();
    }
  };

  const handleEdit = () => {
    setModalOpen(true);
  };

  // Show configured view if we have a test account ID (same UI; readOnly disables click)
  if (initialTestAccountId) {
    return (
      <>
        <div className="flex items-center gap-2 px-2 py-1">
          <div
            className={`flex items-center gap-2 flex-1 ${
              readOnly ? "cursor-default" : "cursor-pointer hover:opacity-80 transition-opacity"
            }`}
            onClick={readOnly ? undefined : handleEdit}
            title={readOnly ? undefined : t('loginEditor.clickToEdit')}
            role={readOnly ? undefined : "button"}
          >
            <IconLogin size={16} />
            <div className="flex-1">
              <Group gap="xs">
                <Badge
                  style={{ textTransform: "none" }}
                  leftSection={<IconUser size={12} />}
                  variant="light"
                  color="blue"
                  size="sm"
                >
                  {selectedTestAccount
                    ? selectedTestAccount.name
                      ? `${selectedTestAccount.username} (${selectedTestAccount.name})`
                      : selectedTestAccount.username
                    : `Account ID: ${initialTestAccountId}`}
                </Badge>
              </Group>
            </div>
          </div>
        </div>

        {!readOnly && (
          <LoginModal
            open={modalOpen}
            onClose={handleModalClose}
            onSave={handleSave}
            initialTestAccountId={initialTestAccountId}
            initialEnvironmentId={initialEnvironmentId || defaultEnvironmentId}
          />
        )}
      </>
    );
  }

  // No account selected: placeholder or read-only empty state
  if (readOnly) {
    return (
      <div className="flex items-center gap-2 px-2 py-1">
        <IconLogin size={16} />
        <Text size="sm" c="dimmed">
          {t('loginEditor.clickToConfigure')}
        </Text>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 px-2 py-1">
        <div
          className="flex items-center gap-2 flex-1 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => setModalOpen(true)}
          title={t('loginEditor.clickToConfigure')}
        >
          <IconLogin size={16} />
          <Text size="sm" className="flex-1 text-gray-500">
            {t('loginEditor.configurePlaceholder')}
          </Text>
        </div>
      </div>

      <LoginModal
        open={modalOpen}
        onClose={handleModalClose}
        onSave={handleSave}
        initialTestAccountId={initialTestAccountId}
        initialEnvironmentId={initialEnvironmentId || defaultEnvironmentId}
      />
    </>
  );
};
