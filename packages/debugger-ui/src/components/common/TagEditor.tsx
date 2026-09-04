import React, { useState } from "react";
import { Badge, Group, ActionIcon, TextInput, Text, Box } from "@mantine/core";
import { IconX, IconPlus, IconCheck } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

interface TagEditorProps {
  tags: string[];
  onTagAdd?: (tag: string) => void;
  onTagRemove?: (tag: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  label?: string;
  size?: "xs" | "sm" | "md" | "lg";
}

export function TagEditor({
  tags,
  onTagAdd,
  onTagRemove,
  readOnly = false,
  placeholder,
  label,
  size = "sm",
}: TagEditorProps) {
  const tCommon = useTranslations("Common");
  const resolvedPlaceholder = placeholder ?? tCommon("enterTag");
  const [showTagInput, setShowTagInput] = useState(false);
  const [newTagValue, setNewTagValue] = useState("");

  const addTag = () => {
    if (!newTagValue.trim()) return;

    const trimmedTag = newTagValue.trim();

    // Check if tag already exists
    if (tags.includes(trimmedTag)) {
      return;
    }

    onTagAdd?.(trimmedTag);
    setNewTagValue("");
    setShowTagInput(false);
  };

  const removeTag = (tagToRemove: string) => {
    onTagRemove?.(tagToRemove);
  };

  const handleTagKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      addTag();
    } else if (event.key === "Escape") {
      setNewTagValue("");
      setShowTagInput(false);
    }
  };

  return (
    <Box>
      {label && (
        <Text size="sm" mb="xs">
          {label}
        </Text>
      )}
      <Group gap="xs" align="center">
        {tags.map((tag) => (
          <Badge
            key={tag}
            size={size}
            variant="light"
            style={{
              cursor: readOnly ? "default" : "pointer",
              paddingRight: readOnly ? undefined : "4px",
            }}
            rightSection={
              !readOnly ? (
                <ActionIcon
                  size="xs"
                  color="gray"
                  variant="transparent"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTag(tag);
                  }}
                >
                  <IconX size={10} />
                </ActionIcon>
              ) : undefined
            }
          >
            {tag}
          </Badge>
        ))}
        {!readOnly && (
          <>
            {showTagInput ? (
              <Group gap="xs">
                <TextInput
                  value={newTagValue}
                  onChange={(e) => setNewTagValue(e.target.value)}
                  onKeyDown={handleTagKeyPress}
                  placeholder={resolvedPlaceholder}
                  size="xs"
                  style={{ width: "120px" }}
                  autoFocus
                />
                <ActionIcon size="xs" color="green" onClick={addTag}>
                  <IconCheck size={12} />
                </ActionIcon>
                <ActionIcon
                  size="xs"
                  color="red"
                  onClick={() => {
                    setShowTagInput(false);
                    setNewTagValue("");
                  }}
                >
                  <IconX size={12} />
                </ActionIcon>
              </Group>
            ) : (
              <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setShowTagInput(true)}>
                <IconPlus size={14} />
              </ActionIcon>
            )}
          </>
        )}
      </Group>
    </Box>
  );
}
