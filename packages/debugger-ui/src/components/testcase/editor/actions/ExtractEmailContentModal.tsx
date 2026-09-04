import React, { useState, useEffect } from "react";
import {
  Modal,
  Button,
  Text,
  Group,
  Stack,
  TextInput,
  Select,
  Textarea,
  ActionIcon,
} from "@mantine/core";
import { IconMail, IconSettings, IconFilter, IconCopy, IconCheck } from "@tabler/icons-react";
import { useForwardEmailConfigs } from "@/hooks/useForwardEmailConfigs";
import { useTranslations } from "next-intl";

export interface ExtractEmailContentConfig {
  configId?: string;
  forwardEmail?: string;
  extractionType?: string;
  prompt?: string;
  filterFromEmail?: string;
  filterToEmail?: string;
  filterSubject?: string;
  filterBodyContains?: string;
}

interface ExtractEmailContentModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (config: ExtractEmailContentConfig) => void;
  initialConfig?: ExtractEmailContentConfig;
}

const EXTRACTION_TYPES = [
  { value: "verification_code", label: "Verification Code" },
  { value: "activation_link", label: "Activation Link" },
  { value: "custom", label: "Custom" },
];

export const ExtractEmailContentModal: React.FC<ExtractEmailContentModalProps> = ({
  open,
  onClose,
  onSave,
  initialConfig,
}) => {
  const t = useTranslations('TestCases');
  const tCommon = useTranslations('Common');
  const { configs } = useForwardEmailConfigs();

  const [selectedConfigId, setSelectedConfigId] = useState<string>("");

  const [forwardEmail, setForwardEmail] = useState<string>(initialConfig?.forwardEmail || "");
  const [extractionType, setExtractionType] = useState<string>(initialConfig?.extractionType || "");
  const [prompt, setPrompt] = useState<string>(initialConfig?.prompt || "");
  const [filterFromEmail, setFilterFromEmail] = useState<string>(initialConfig?.filterFromEmail || "");
  const [filterToEmail, setFilterToEmail] = useState<string>(initialConfig?.filterToEmail || "");
  const [filterSubject, setFilterSubject] = useState<string>(initialConfig?.filterSubject || "");
  const [filterBodyContains, setFilterBodyContains] = useState<string>(initialConfig?.filterBodyContains || "");
  const [errors, setErrors] = useState<{ extractionType?: string; filterFromEmail?: string }>({});
  const [copied, setCopied] = useState<boolean>(false);

  // Reset values when modal opens
  useEffect(() => {
    if (open) {
      setSelectedConfigId(initialConfig?.configId || "");
      setForwardEmail(initialConfig?.forwardEmail || "");
      setExtractionType(initialConfig?.extractionType || "");
      setPrompt(initialConfig?.prompt || "");
      setFilterFromEmail(initialConfig?.filterFromEmail || "");
      setFilterToEmail(initialConfig?.filterToEmail || "");
      setFilterSubject(initialConfig?.filterSubject || "");
      setFilterBodyContains(initialConfig?.filterBodyContains || "");
      setErrors({});
    }
  }, [open, initialConfig]);

  const loadConfig = (configId: string) => {
    const config = configs.find((c) => c.id.toString() === configId);
    if (config) {
      setForwardEmail(config.forward_email);
      setExtractionType(config.extraction_type);
      setPrompt(config.prompt || "");
      setFilterFromEmail(config.filter_from_email || "");
      setFilterToEmail(config.filter_to_email || "");
      setFilterSubject(config.filter_subject || "");
      setFilterBodyContains(config.filter_body_contains || "");
    }
  };

  const validateForm = () => {
    const newErrors: { extractionType?: string; filterFromEmail?: string } = {};

    if (!extractionType || extractionType.trim() === "") {
      newErrors.extractionType = t('extractEmailContentModal.extractionTypeRequired');
    }

    if (!filterFromEmail || filterFromEmail.trim() === "") {
      newErrors.filterFromEmail = t('extractEmailContentModal.filterFromEmailRequired');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validateForm()) {
      onSave({
        configId: selectedConfigId,
        forwardEmail: forwardEmail || undefined,
        extractionType,
        prompt: prompt || undefined,
        filterFromEmail: filterFromEmail || undefined,
        filterToEmail: filterToEmail || undefined,
        filterSubject: filterSubject || undefined,
        filterBodyContains: filterBodyContains || undefined,
      });
      onClose();
    }
  };

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(forwardEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy email:", err);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Modal
      opened={open}
      onClose={handleCancel}
      title={
        <Group gap="xs">
          <IconMail size={20} />
          <Text fw={500}>{t('extractEmailContentModal.title')}</Text>
        </Group>
      }
      size="md"
    >
      <Stack gap="md">
        {/* Select Existing Config */}
        <div className="flex flex-col gap-1">
          <Text size="sm" fw={500} className="text-secondary mb-1">
            {t('extractEmailContentModal.selectConfig')} <span className="text-red-500">*</span>
          </Text>
          <Select
            placeholder={t('extractEmailContentModal.selectConfigPlaceholder')}
            data={configs.map((config) => ({
              value: config.id.toString(),
              label: config.name,
            }))}
            value={selectedConfigId}
            onChange={(value) => {
              const id = value || "";
              setSelectedConfigId(id);
              if (id) loadConfig(id);
            }}
          />
        </div>

        {selectedConfigId && (
          <>
          {/* Forward Email */}
          <div className="flex flex-col gap-1">
            <Text size="sm" fw={500} className="text-secondary mb-1">
              {t('extractEmailContentModal.forwardEmail')}
            </Text>
            <TextInput
              value={forwardEmail}
              readOnly
              variant="unstyled"
              onChange={(event) => setForwardEmail(event.currentTarget.value)}
              leftSection={<IconMail size={16} />}
              onClick={handleCopyEmail}
              styles={{
                input: {
                  cursor: "pointer",
                },
              }}
              rightSection={
                <ActionIcon variant="subtle" color="gray" onClick={handleCopyEmail} size="sm">
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              }
            />
          </div>

          {/* Extraction Type */}
          <div className="flex flex-col gap-1">
            <Text size="sm" fw={500} className="text-secondary mb-1">
              {t('extractEmailContentModal.extractionType')} <span className="text-red-500">*</span>
            </Text>
            <Select
              placeholder={t('extractEmailContentModal.extractionTypePlaceholder')}
              data={EXTRACTION_TYPES}
              value={extractionType}
              onChange={(value) => {
                setExtractionType(value || "");
                if (errors.extractionType) {
                  setErrors({ ...errors, extractionType: undefined });
                }
              }}
              error={errors.extractionType}
              leftSection={<IconSettings size={16} />}
            />
            <Text size="xs" c="dimmed">
              {t('extractEmailContentModal.extractionTypeDescription')}
            </Text>
          </div>

          {/* Prompt */}
          {extractionType === "custom" && (
            <div className="flex flex-col gap-1">
              <Text size="sm" fw={500} className="text-secondary mb-1">
                {t('extractEmailContentModal.prompt')}
              </Text>
              <Textarea
                placeholder={t('extractEmailContentModal.promptPlaceholder')}
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                minRows={3}
                maxRows={6}
              />
              <Text size="xs" c="dimmed">
                {t('extractEmailContentModal.promptDescription')}
              </Text>
            </div>
          )}

          {/* Filter From Email */}
          <div className="flex flex-col gap-1">
            <Text size="sm" fw={500} className="text-secondary mb-1">
              {t('extractEmailContentModal.filterFromEmail')} <span className="text-red-500">*</span>
            </Text>
            <TextInput
              placeholder={t('extractEmailContentModal.filterFromEmail')}
              value={filterFromEmail}
              onChange={(event) => {
                setFilterFromEmail(event.currentTarget.value);
                if (errors.filterFromEmail) {
                  setErrors({ ...errors, filterFromEmail: undefined });
                }
              }}
              error={errors.filterFromEmail}
              leftSection={<IconFilter size={16} />}
            />
            <Text size="xs" c="dimmed">
              {t('extractEmailContentModal.filterFromDescription')}
            </Text>
          </div>

          {/* Filter To Email */}
          <div className="flex flex-col gap-1">
            <Text size="sm" fw={500} className="text-secondary mb-1">
              {t('extractEmailContentModal.filterToEmail')}
            </Text>
            <TextInput
              placeholder={t('extractEmailContentModal.filterToEmail')}
              value={filterToEmail}
              onChange={(event) => setFilterToEmail(event.currentTarget.value)}
              leftSection={<IconFilter size={16} />}
            />
            <Text size="xs" c="dimmed">
              {t('extractEmailContentModal.filterToDescription')}
            </Text>
          </div>

          {/* Filter Subject */}
          <div className="flex flex-col gap-1">
            <Text size="sm" fw={500} className="text-secondary mb-1">
              {t('extractEmailContentModal.filterSubject')}
            </Text>
            <TextInput
              placeholder={t('extractEmailContentModal.filterSubjectPlaceholder')}
              value={filterSubject}
              onChange={(event) => setFilterSubject(event.currentTarget.value)}
              leftSection={<IconFilter size={16} />}
            />
            <Text size="xs" c="dimmed">
              {t('extractEmailContentModal.filterSubjectDescription')}
            </Text>
          </div>

          {/* Filter Body Contains */}
          <div className="flex flex-col gap-1">
            <Text size="sm" fw={500} className="text-secondary mb-1">
              {t('extractEmailContentModal.filterBodyContains')}
            </Text>
            <TextInput
              placeholder={t('extractEmailContentModal.filterBodyContains')}
              value={filterBodyContains}
              onChange={(event) => setFilterBodyContains(event.currentTarget.value)}
              leftSection={<IconFilter size={16} />}
            />
            <Text size="xs" c="dimmed">
              {t('extractEmailContentModal.filterBodyDescription')}
            </Text>
          </div>
        </>)}

        <Group justify="flex-end" gap="sm">
          <Button variant="outline" onClick={handleCancel}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!selectedConfigId}>
            {tCommon('confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
