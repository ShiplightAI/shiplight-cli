import React, { useState, useEffect, useMemo } from "react";
import { Text, Badge, Group, TextInput, Select, Textarea, Tooltip } from "@mantine/core";
import { IconMail, IconFilter, IconSettings, IconVariable } from "@tabler/icons-react";
import { ExtractEmailContentModal, ExtractEmailContentConfig } from "./ExtractEmailContentModal";
import { useTranslations } from "next-intl";

/**
 * Generate predicted variable name based on extraction type
 */
const generateVariableName = (extractionType: string): string => {
  switch (extractionType) {
    case "verification_code":
      return "email_otp_code";
    case "activation_link":
      return "email_magic_link";
    case "custom":
      return "email_extracted_content";
    default:
      return "email_extracted_content";
  }
};

interface ExtractEmailContentEditorProps {
  description: string;
  config?: ExtractEmailContentConfig;
  onExtractEmailContentConfirm?: (config: ExtractEmailContentConfig) => void;
  onExtractEmailContentCancel?: () => void;
  /** When true, same UI but non-editable (no click to open modal) */
  readOnly?: boolean;
}

export const ExtractEmailContentEditor: React.FC<ExtractEmailContentEditorProps> = ({
  description,
  config,
  onExtractEmailContentConfirm,
  onExtractEmailContentCancel,
  readOnly = false,
}) => {
  const t = useTranslations('TestCases');
  const [modalOpen, setModalOpen] = useState(false);

  const handleSave = (config: ExtractEmailContentConfig) => {
    if (onExtractEmailContentConfirm) {
      onExtractEmailContentConfirm(config);
    }
    setModalOpen(false);
  };

  const handleModalClose = () => {
    setModalOpen(false);

    // If no configuration exists and modal is closed, this is a cancellation
    if (!config?.extractionType && onExtractEmailContentCancel) {
      onExtractEmailContentCancel();
    }
  };

  const handleEdit = () => {
    setModalOpen(true);
  };

  // Show configured view if we have an extraction type
  if (config?.extractionType) {
    return (
      <>
        <div className="flex items-center gap-2 px-2 py-1">
          <div
            className={`flex items-center gap-2 flex-1 ${
              readOnly ? "cursor-default" : "cursor-pointer hover:opacity-80 transition-opacity"
            }`}
            onClick={readOnly ? undefined : handleEdit}
            title={readOnly ? undefined : t('extractEmailContentEditor.clickToEdit')}
            role={readOnly ? undefined : "button"}
          >
            <IconMail size={16} />
            <div className="flex-1">
              <div className="space-y-1">
                <Group gap="xs">
                  <Badge
                    style={{ textTransform: "none" }}
                    leftSection={<IconSettings size={12} />}
                    variant="light"
                    color="green"
                    size="sm"
                  >
                    {config.extractionType}
                  </Badge>
                  {config.filterFromEmail && (
                    <Badge
                      style={{ textTransform: "none" }}
                      leftSection={<IconFilter size={12} />}
                      variant="light"
                      color="blue"
                      size="sm"
                    >
                      From: {config.filterFromEmail}
                    </Badge>
                  )}
                </Group>
                <Tooltip label={t('extractEmailContentEditor.variableTooltip')}>
                  <div className="flex items-center gap-1 text-sm">
                    <IconVariable size={14} />
                    <span>{t('extractEmailContentEditor.variableLabel', { name: generateVariableName(config.extractionType) })}</span>
                  </div>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>

        {!readOnly && (
          <ExtractEmailContentModal
            open={modalOpen}
            onClose={handleModalClose}
            onSave={handleSave}
            initialConfig={config}
          />
        )}
      </>
    );
  }

  // No config: placeholder or read-only empty state
  if (readOnly) {
    return (
      <div className="flex items-center gap-2 px-2 py-1">
        <IconMail size={16} />
        <Text size="sm" c="dimmed">
          {t('extractEmailContentEditor.noConfig')}
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
          title={t('extractEmailContentEditor.clickToConfigure')}
        >
          <IconMail size={16} />
          <Text size="sm" className="flex-1 text-gray-500">
            {t('extractEmailContentEditor.clickToConfigure')}
          </Text>
        </div>
      </div>

      <ExtractEmailContentModal
        open={modalOpen}
        onClose={handleModalClose}
        onSave={handleSave}
        initialConfig={config}
      />
    </>
  );
};

interface ExtractEmailContentWithActionEditorProps {
  description: string;
  actionEntity?: any;
  onExtractEmailContentConfirm?: (config: ExtractEmailContentConfig) => void;
  onExtractEmailContentCancel?: () => void;
  readOnly?: boolean;
}

export const ExtractEmailContentWithActionEditor: React.FC<ExtractEmailContentWithActionEditorProps> = ({
  description,
  actionEntity,
  onExtractEmailContentConfirm,
  onExtractEmailContentCancel,
  readOnly,
}) => {
  const config = useMemo(() => {
    return {
      configId: actionEntity?.action_data?.kwargs?.config_id,
      forwardEmail: actionEntity?.action_data?.kwargs?.forward_email,
      extractionType: actionEntity?.action_data?.kwargs?.extraction_type,
      prompt: actionEntity?.action_data?.kwargs?.prompt,
      filterFromEmail: actionEntity?.action_data?.kwargs?.filter_from_email,
      filterToEmail: actionEntity?.action_data?.kwargs?.filter_to_email,
      filterSubject: actionEntity?.action_data?.kwargs?.filter_subject,
      filterBodyContains: actionEntity?.action_data?.kwargs?.filter_body_contains,
    };
  }, [actionEntity]);
  return (
    <ExtractEmailContentEditor description={description} config={config} onExtractEmailContentConfirm={onExtractEmailContentConfirm} onExtractEmailContentCancel={onExtractEmailContentCancel} readOnly={readOnly} />
  );
};