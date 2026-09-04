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
  Tooltip,
  Alert,
  Loader,
} from "@mantine/core";
import { IconMail, IconSettings, IconFilter, IconCopy, IconCheck, IconAlertCircle, IconExternalLink } from "@tabler/icons-react";
import type { ExtractEmailContentConfig } from "@/components/testcase/editor/actions/ExtractEmailContentModal";
import { useTranslations } from "next-intl";
import { apiUrl } from "../../utils/apiBase";

interface ForwardingAddress {
  id: string;
  address: string;
  label: string | null;
  createdAt: string;
}

const EXTRACTION_TYPES = [
  { value: "verification_code", label: "Verification Code" },
  { value: "activation_link", label: "Activation Link" },
  { value: "custom", label: "Custom" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (config: ExtractEmailContentConfig) => void;
  initialConfig?: ExtractEmailContentConfig;
}

export const LocalExtractEmailContentModal: React.FC<Props> = ({
  open,
  onClose,
  onSave,
  initialConfig,
}) => {
  const t = useTranslations("TestCases");
  const tCommon = useTranslations("Common");

  const [addresses, setAddresses] = useState<ForwardingAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [tokenConfigured, setTokenConfigured] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [forwardEmail, setForwardEmail] = useState(initialConfig?.forwardEmail ?? "");
  const [extractionType, setExtractionType] = useState(initialConfig?.extractionType ?? "");
  const [prompt, setPrompt] = useState(initialConfig?.prompt ?? "");
  const [filterFromEmail, setFilterFromEmail] = useState(initialConfig?.filterFromEmail ?? "");
  const [filterToEmail, setFilterToEmail] = useState(initialConfig?.filterToEmail ?? "");
  const [filterSubject, setFilterSubject] = useState(initialConfig?.filterSubject ?? "");
  const [filterBodyContains, setFilterBodyContains] = useState(initialConfig?.filterBodyContains ?? "");
  const [errors, setErrors] = useState<{ extractionType?: string; filterFromEmail?: string }>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForwardEmail(initialConfig?.forwardEmail ?? "");
    setExtractionType(initialConfig?.extractionType ?? "");
    setPrompt(initialConfig?.prompt ?? "");
    setFilterFromEmail(initialConfig?.filterFromEmail ?? "");
    setFilterToEmail(initialConfig?.filterToEmail ?? "");
    setFilterSubject(initialConfig?.filterSubject ?? "");
    setFilterBodyContains(initialConfig?.filterBodyContains ?? "");
    setErrors({});
    setFetchError(null);
    setAddresses([]);

    const controller = new AbortController();
    setLoading(true);
    fetch(apiUrl("/api/email-forwarding/addresses"), { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json() as { addresses?: ForwardingAddress[]; configured?: boolean; error?: string };
        if (!res.ok) {
          setFetchError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        setAddresses(data.addresses ?? []);
        setTokenConfigured(data.configured !== false);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setFetchError(err.message || "Network error");
      })
      .finally(() => {
        setLoading(false);
      });
    return () => controller.abort();
  }, [open, initialConfig]);

  const handleCopy = async () => {
    if (!forwardEmail) return;
    try {
      await navigator.clipboard.writeText(forwardEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!extractionType.trim()) newErrors.extractionType = t("extractEmailContentModal.extractionTypeRequired");
    if (!filterFromEmail.trim()) newErrors.filterFromEmail = t("extractEmailContentModal.filterFromEmailRequired");
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave({
      forwardEmail,
      extractionType,
      prompt: prompt || undefined,
      filterFromEmail: filterFromEmail || undefined,
      filterToEmail: filterToEmail || undefined,
      filterSubject: filterSubject || undefined,
      filterBodyContains: filterBodyContains || undefined,
    });
    onClose();
  };

  const addressOptions = addresses.map((a) => ({
    value: a.address,
    label: a.label ? `${a.label} (${a.address})` : a.address,
  }));

  const hasExistingConfig = !!initialConfig?.forwardEmail;
  const showForm = forwardEmail && (hasExistingConfig || (tokenConfigured && !fetchError));

  return (
    <Modal
      opened={open}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconMail size={20} />
          <Text fw={500}>{t("extractEmailContentModal.title")}</Text>
        </Group>
      }
      size="md"
    >
      <Stack gap="md">
        {/* Loading */}
        {loading && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">{t("extractEmailContentModal.loadingAddresses")}</Text>
          </Group>
        )}

        {/* Token not configured */}
        {!loading && !tokenConfigured && (
          <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light">
            {t("extractEmailContentModal.tokenNotConfigured")}
          </Alert>
        )}

        {/* Fetch error */}
        {!loading && fetchError && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {fetchError}
          </Alert>
        )}

        {/* No addresses */}
        {!loading && tokenConfigured && !fetchError && addresses.length === 0 && (
          <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
            <Stack gap="xs">
              <Text size="sm" fw={500}>{t("extractEmailContentModal.noAddressesTitle")}</Text>
              <Text size="sm">{t("extractEmailContentModal.noAddressesDescription")}</Text>
              <Group>
                <Button
                  component="a"
                  href="https://app.shiplight.ai/settings/email-forwarding"
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="light"
                  size="xs"
                  rightSection={<IconExternalLink size={14} />}
                >
                  {t("extractEmailContentModal.goToPlatform")}
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {/* Address selector */}
        {!loading && addresses.length > 0 && (
          <div className="flex flex-col gap-1">
            <Text size="sm" fw={500} className="text-secondary mb-1">
              {t("extractEmailContentModal.selectAddress")} <span className="text-red-500">*</span>
            </Text>
            <Select
              placeholder={t("extractEmailContentModal.selectAddressPlaceholder")}
              data={addressOptions}
              value={forwardEmail || null}
              onChange={(value) => setForwardEmail(value ?? "")}
              leftSection={<IconMail size={16} />}
              rightSection={
                forwardEmail ? (
                  <Tooltip label="Copy">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy();
                      }}
                    >
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  </Tooltip>
                ) : undefined
              }
            />
          </div>
        )}

        {/* Existing address (API failed but editing a saved step) */}
        {!loading && addresses.length === 0 && hasExistingConfig && forwardEmail && (
          <TextInput
            label={t("extractEmailContentModal.selectAddress")}
            value={forwardEmail}
            readOnly
            leftSection={<IconMail size={16} />}
            rightSection={
              <Tooltip label="Copy">
                <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleCopy}>
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              </Tooltip>
            }
          />
        )}

        {showForm && (
          <>
            {/* Extraction Type */}
            <div className="flex flex-col gap-1">
              <Text size="sm" fw={500} className="text-secondary mb-1">
                {t("extractEmailContentModal.extractionType")} <span className="text-red-500">*</span>
              </Text>
              <Select
                placeholder={t("extractEmailContentModal.extractionTypePlaceholder")}
                data={EXTRACTION_TYPES}
                value={extractionType}
                onChange={(value) => {
                  setExtractionType(value ?? "");
                  if (errors.extractionType) setErrors({ ...errors, extractionType: undefined });
                }}
                error={errors.extractionType}
                leftSection={<IconSettings size={16} />}
              />
              <Text size="xs" c="dimmed">
                {t("extractEmailContentModal.extractionTypeDescription")}
              </Text>
            </div>

            {/* Prompt (custom only) */}
            {extractionType === "custom" && (
              <div className="flex flex-col gap-1">
                <Text size="sm" fw={500} className="text-secondary mb-1">
                  {t("extractEmailContentModal.prompt")}
                </Text>
                <Textarea
                  placeholder={t("extractEmailContentModal.promptPlaceholder")}
                  value={prompt}
                  onChange={(e) => setPrompt(e.currentTarget.value)}
                  minRows={3}
                  maxRows={6}
                />
                <Text size="xs" c="dimmed">
                  {t("extractEmailContentModal.promptDescription")}
                </Text>
              </div>
            )}

            {/* Filter From Email */}
            <div className="flex flex-col gap-1">
              <Text size="sm" fw={500} className="text-secondary mb-1">
                {t("extractEmailContentModal.filterFromEmail")} <span className="text-red-500">*</span>
              </Text>
              <TextInput
                placeholder={t("extractEmailContentModal.filterFromEmail")}
                value={filterFromEmail}
                onChange={(e) => {
                  setFilterFromEmail(e.currentTarget.value);
                  if (errors.filterFromEmail) setErrors({ ...errors, filterFromEmail: undefined });
                }}
                error={errors.filterFromEmail}
                leftSection={<IconFilter size={16} />}
              />
              <Text size="xs" c="dimmed">
                {t("extractEmailContentModal.filterFromDescription")}
              </Text>
            </div>

            {/* Filter To Email */}
            <div className="flex flex-col gap-1">
              <Text size="sm" fw={500} className="text-secondary mb-1">
                {t("extractEmailContentModal.filterToEmail")}
              </Text>
              <TextInput
                placeholder={t("extractEmailContentModal.filterToEmail")}
                value={filterToEmail}
                onChange={(e) => setFilterToEmail(e.currentTarget.value)}
                leftSection={<IconFilter size={16} />}
              />
              <Text size="xs" c="dimmed">
                {t("extractEmailContentModal.filterToDescription")}
              </Text>
            </div>

            {/* Filter Subject */}
            <div className="flex flex-col gap-1">
              <Text size="sm" fw={500} className="text-secondary mb-1">
                {t("extractEmailContentModal.filterSubject")}
              </Text>
              <TextInput
                placeholder={t("extractEmailContentModal.filterSubjectPlaceholder")}
                value={filterSubject}
                onChange={(e) => setFilterSubject(e.currentTarget.value)}
                leftSection={<IconFilter size={16} />}
              />
              <Text size="xs" c="dimmed">
                {t("extractEmailContentModal.filterSubjectDescription")}
              </Text>
            </div>

            {/* Filter Body Contains */}
            <div className="flex flex-col gap-1">
              <Text size="sm" fw={500} className="text-secondary mb-1">
                {t("extractEmailContentModal.filterBodyContains")}
              </Text>
              <TextInput
                placeholder={t("extractEmailContentModal.filterBodyContains")}
                value={filterBodyContains}
                onChange={(e) => setFilterBodyContains(e.currentTarget.value)}
                leftSection={<IconFilter size={16} />}
              />
              <Text size="xs" c="dimmed">
                {t("extractEmailContentModal.filterBodyDescription")}
              </Text>
            </div>
          </>
        )}

        <Group justify="flex-end" gap="sm">
          <Button variant="outline" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!showForm}>
            {tCommon("confirm")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
