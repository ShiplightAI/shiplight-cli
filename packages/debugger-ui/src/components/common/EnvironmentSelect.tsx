import React, { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Select, Text, Group, TextInput, Button, Stack, Modal } from "@mantine/core";
import { IconCheck, IconPlus } from "@tabler/icons-react";
import { type Environment } from "@/common/models/environment";
import { useEnvironments } from "@/hooks/useEnvironments";
import { notifications } from "@mantine/notifications";

/**
 * EnvironmentSelect Component - Quick Environment Creation Support
 *
 * Usage Example:
 * ```tsx
 * import { EnvironmentSelect } from "@/components/common/EnvironmentSelect";
 * import { useEnvironments } from "@/hooks/useEnvironments";
 *
 * function MyComponent() {
 *   const { environments } = useEnvironments();
 *   const [selectedEnvId, setSelectedEnvId] = useState<number | null>(null);
 *
 *   const handleEnvironmentCreated = (environment: Environment) => {
 *     // Callback after environment creation
 *     console.log("New environment created:", environment);
 *   };
 *
 *   return (
 *     <EnvironmentSelect
 *       environments={environments}
 *       value={selectedEnvId}
 *       onChange={setSelectedEnvId}
 *       label="Select Environment"
 *       placeholder="Select environment or create new one"
 *       onEnvironmentCreated={handleEnvironmentCreated}
 *     />
 *   );
 * }
 * ```
 */

interface EnvironmentSelectProps {
  environments: Environment[];
  value: number | null;
  onChange: (envId: number | null) => void;
  disabled?: boolean;
  clearable?: boolean;
  placeholder?: string;
  label?: string;
  className?: string;
  styles?: any;
  onEnvironmentCreated?: (environment: Environment) => void;
  showCreateButton?: boolean;
  showFullName?: boolean;
}

interface EnvOption {
  value: string;
  label: string;
  name: string;
  url?: string;
}

export const EnvironmentSelect: React.FC<EnvironmentSelectProps> = ({
  environments,
  value,
  onChange,
  disabled = false,
  clearable = false,
  placeholder = "Select environment",
  label,
  className,
  styles,
  onEnvironmentCreated,
  showCreateButton = false,
  showFullName = true,
}) => {
  const tS = useTranslations("Settings");
  const tCommon = useTranslations("Common");
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [newEnvironment, setNewEnvironment] = useState({ name: "", url: "" });
  const [isCreating, setIsCreating] = useState(false);
  const { createEnvironment } = useEnvironments();

  const handleEnvironmentChange = (selectedValue: string | null) => {
    if (selectedValue === "create-new") {
      setCreateModalOpened(true);
      return;
    }
    onChange(selectedValue ? parseInt(selectedValue) : null);
  };

  const handleUrlChange = (value: string) => {
    setNewEnvironment(prev => ({ ...prev, url: value }));
  };

  const handleCreateEnvironment = async () => {
    if (!newEnvironment.name || !newEnvironment.url) {
      notifications.show({
        color: "red",
        title: tCommon("error"),
        message: tS("environmentSelect.nameAndUrlRequired"),
      });
      return;
    }

    // Validate URL format
    try {
      new URL(newEnvironment.url);
    } catch {
      notifications.show({
        color: "red",
        title: tCommon("error"),
        message: tS("environmentSelect.invalidUrlFormat"),
      });
      return;
    }

    try {
      setIsCreating(true);
      const result = await createEnvironment(newEnvironment.name, newEnvironment.url);

      if (result.success) {
        notifications.show({
          color: "green",
          title: tCommon("success"),
          message: tS("environmentSelect.createdSuccessfully"),
        });


        // Close modal and reset form
        setCreateModalOpened(false);
        setNewEnvironment({ name: "", url: "" });
        console.log(result.data)
        // Call callback if provided
        if (onEnvironmentCreated && result.data) {
          onEnvironmentCreated(result.data);
        }
      } else {
        notifications.show({
          color: "red",
          title: tCommon("error"),
          message: result.error || tS("environmentSelect.errorCreating"),
        });
      }
    } catch (error) {
      notifications.show({
        color: "red",
        title: tCommon("error"),
        message: tS("environmentSelect.errorCreating"),
      });
    } finally {
      setIsCreating(false);
    }
  };

  const defaultStyles = {
    dropdown: {
      minWidth: "18.75rem",
      maxHeight: "300px",
      padding: 0,
      borderRadius: "0.375rem",
      overflow: "auto",
      marginTop: "0.25rem",
    },
  };

  // Merge custom styles with defaults, giving priority to custom styles
  const mergedStyles = styles ? {
    ...defaultStyles,
    ...styles,
    dropdown: {
      ...defaultStyles.dropdown,
      ...(styles.dropdown || {}),
    },
    input: {
      ...(styles.input || {}),
    },
  } : defaultStyles;

  // Prepare select data, including create new environment option
  const selectData = useMemo(() => {

    return [
    ...environments.map((env) => ({
      value: env.id?.toString() || "",
      label: showFullName ? `${env.name} (${env.url})` : env.url || "",
      name: env.name || "",
      url: env.url || "",
    })),
    ...(showCreateButton ? [{
      value: "create-new",
      label: tS("environmentSelect.createNewEnvironment"),
      name: tS("environmentSelect.createNewEnvironment")
    }] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ]} , [environments, showCreateButton]);

  return (
    <>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <Select
        value={value ? value.toString() : null}
        onChange={handleEnvironmentChange}
        data={selectData}
        className={className}
        styles={mergedStyles}
        placeholder={placeholder}
        checkIconPosition="left"
        disabled={disabled}
        clearable={clearable}
        searchable
        nothingFoundMessage={tS("environmentSelect.nothingFound")}
        renderOption={({ option, checked }) => (
          <Group wrap="nowrap" className="p-2">
            {option.value === "create-new" ? (
              <IconPlus size={12} />
            ) : checked ? (
              <IconCheck size={12} />
            ) : null}
            <div>
              <Text size="sm" fw={500}>
                {option.value !== "create-new" && `ENV-${option.value} - `}
                {(option as EnvOption).name}
              </Text>
              {option.value !== "create-new" && (
                <Text size="sm" c="dimmed">
                  {(option as EnvOption).url}
                </Text>
              )}
            </div>
          </Group>
        )}
      />

      {/* Environment creation modal */}
      <Modal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        title={tS("environmentSelect.createNewEnvironment")}
        size="md"
        centered
      >
        <Stack gap="md">
          <TextInput
            label={tS("environmentSelect.environmentNameLabel")}
            placeholder={tS("environmentSelect.environmentNamePlaceholder")}
            value={newEnvironment.name}
            onChange={(e) => setNewEnvironment(prev => ({ ...prev, name: e.target.value }))}
            required
          />

          <TextInput
            label={tS("environmentSelect.environmentUrlLabel")}
            placeholder={tS("environmentSelect.environmentUrlPlaceholder")}
            value={newEnvironment.url}
            onChange={(e) => handleUrlChange(e.target.value)}
            required
          />

          <Group justify="flex-end" mt="md">
            <Button
              variant="subtle"
              onClick={() => setCreateModalOpened(false)}
              disabled={isCreating}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={handleCreateEnvironment}
              loading={isCreating}
            >
              {tS("environmentSelect.createButton")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};