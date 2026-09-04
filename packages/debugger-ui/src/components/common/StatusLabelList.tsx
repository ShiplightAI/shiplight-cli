import { Badge, Box, Tooltip, useMantineTheme, Popover, Checkbox, ActionIcon, Flex, TextInput, Divider, Button, Group, Text, ColorInput } from "@mantine/core";
import { useResizeObserver } from "@mantine/hooks";
import { useLayoutEffect, useState, useRef, useMemo, useEffect } from "react";
import { IconPlus, IconSearch, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

interface Label {
  id: string | number;
  name: string;
  color: string;
}

// Color options for quick selection
const colorOptions = [
  { value: "#9DA3B4", name: "Gray" },
  { value: "#8692B7", name: "Slate" },
  { value: "#5461B0", name: "Blue" },
  { value: "#5298D0", name: "Light Blue" },
  { value: "#4CB782", name: "Green" },
  { value: "#20c997", name: "Teal" },
  { value: "#E5B454", name: "Yellow" },
  { value: "#DF8F6A", name: "Orange" },
  { value: "#C1937D", name: "Tan" },
  { value: "#DD6868", name: "Red" },
  { value: "#e64980", name: "Pink" },
  { value: "#9c36b5", name: "Purple" },
];

interface StatusLabelListProps {
  allLabels: Label[];
  value?: (string | number)[];
  onChange?: (newValue: (string | number)[]) => void;
  onLabelToggle?: (labelId: string | number) => void;
  onCreateLabel?: (name: string, color: string) => Promise<void>;
  readOnly?: boolean;
  iconOnly?: boolean; // Only show plus icon, don't display labels

  gap?: number;
  maxLabelWidth?: number;
  minWidth?: number;
}

export function StatusLabelList({
  allLabels,
  value = [],
  onChange,
  onLabelToggle,
  onCreateLabel,
  readOnly = false,
  iconOnly = false,
  gap = 4,
  maxLabelWidth = 150,
  minWidth = 100,
}: StatusLabelListProps) {
  const tCommon = useTranslations("Common");
  const theme = useMantineTheme();
  const [containerRef, containerRect] = useResizeObserver();
  const [popoverOpened, setPopoverOpened] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [isPickerColorOpen, setIsPickerColorOpen] = useState(false);
  const [searchColorQuery, setSearchColorQuery] = useState("");
  const [filteredColorOptions, setFilteredColorOptions] = useState(colorOptions);
  useEffect(() => {
    if (!searchColorQuery.trim()) {
      setFilteredColorOptions(colorOptions);
      return;
    }
    const query = searchColorQuery.toLowerCase().trim();
    setFilteredColorOptions(colorOptions.filter((color) => color.name.toLowerCase().includes(query)));
  }, [searchColorQuery]);

  const allLabelsMap = useMemo(() => new Map(allLabels.map((l) => [l.id, l])), [allLabels]);
  const displayedLabels = useMemo(
    () => value.map((id) => allLabelsMap.get(id)).filter((l): l is Label => !!l),
    [value, allLabelsMap],
  );

  const filteredLabels = useMemo(() => {
    if (!searchQuery.trim()) {
      return allLabels;
    }
    const query = searchQuery.toLowerCase().trim();
    return allLabels.filter((label) => label.name.toLowerCase().includes(query));
  }, [allLabels, searchQuery]);

  const [renderState, setRenderState] = useState<{
    mode: "all" | "compact";
    visibleCount: number;
  }>({
    mode: "all",
    visibleCount: displayedLabels.length,
  });

  const { mode, visibleCount } = renderState;

  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const plusBadgeRef = useRef<HTMLDivElement>(null);

  const handleCheckboxChange = (checked: boolean, labelId: string | number) => {
    if (onLabelToggle) {
      onLabelToggle(labelId);
    }
    if (!onChange) return;
    const newValue = checked ? [...value, labelId] : value.filter((id) => id !== labelId);
    onChange(newValue);
  };

  const handleCreateLabel = async () => {
    const nameToCreate = searchQuery.trim();
    if (!nameToCreate || !onCreateLabel) return;

    setIsPickerColorOpen(true);
    return;

    // setIsCreating(true);
    // try {
    //   await onCreateLabel(nameToCreate, createColor);
    //   setCreateColor(colorOptions[0].value);
    //   setSearchQuery("");
    //   setPopoverOpened(false); // Close popover after successful creation
    // } catch (error) {
    //   console.error("Error creating label:", error);
    // } finally {
    //   setIsCreating(false);
    // }
  };

  const handleSelectColor = async (color: string) => {
    const nameToCreate = searchQuery.trim();
    if (!nameToCreate || !onCreateLabel) return;
    setIsCreating(true);
    try {
      await onCreateLabel(nameToCreate, color);
      setSearchQuery("");
      setSearchColorQuery("");
      setPopoverOpened(false); // Close popover after successful creation
      setIsPickerColorOpen(false);
    } catch (error) {
      console.error("Error creating label:", error);
    } finally {
      setIsCreating(false);
    }
  };

  useLayoutEffect(() => {
    const containerWidth = Math.max(minWidth, containerRect.width);
    if (containerWidth === 0) return;

    const n = displayedLabels.length;
    if (n <= 1) {
      setRenderState({ mode: "all", visibleCount: n });
      return;
    }

    const labelWidths = labelRefs.current.slice(0, n).map((el) => el?.offsetWidth ?? 0);
    const sumOfWidths = labelWidths.reduce((acc, w) => acc + w, 0);

    const totalWidthWithGap = sumOfWidths + (n - 1) * gap;
    if (totalWidthWithGap <= containerWidth - gap) {
      setRenderState({ mode: "all", visibleCount: displayedLabels.length });
      return;
    }

    const plusBadgeWidth = plusBadgeRef.current?.offsetWidth ?? 0;
    let currentWidth = plusBadgeWidth;
    let newVisibleCount = 0;
    for (const width of labelWidths) {
      if (currentWidth + width + gap > containerWidth) {
        break;
      }
      currentWidth += width + gap;
      newVisibleCount++;
    }

    if (newVisibleCount === 0 && displayedLabels.length > 0) {
      if (labelWidths[0] + gap + plusBadgeWidth > containerWidth) {
        setRenderState({ mode: "compact", visibleCount: 0 });
        return;
      }
      setRenderState({ mode: "compact", visibleCount: 1 });
      return;
    }

    setRenderState({ mode: "compact", visibleCount: newVisibleCount });
  }, [containerRect.width, displayedLabels, gap, minWidth]);

  const labelStyle = {
    display: "inline-flex",
    alignItems: "center",
    border: `1px solid var(--shiplight-border-subtle)`,
    borderRadius: "16px",
    padding: "2px 8px",
    gap: "6px",
    backgroundColor: "var(--shiplight-surface)",
    maxWidth: maxLabelWidth,
    fontSize: "12px",
  };

  const textStyle = {
    textOverflow: "ellipsis",
    overflow: "hidden",
    whiteSpace: "nowrap" as const,
  };

  const popoverDropdownContent = (
    <Popover.Dropdown>
       {!isPickerColorOpen && <Box style={{ padding: "4px" }}>
        {/* Search and Add Label Header */}
        <Box style={{ padding: "4px", marginBottom: "4px" }}>
          <TextInput
            placeholder={tCommon("searchOrCreateLabels")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
            leftSection={<IconSearch size={16} />}
            rightSection={
              searchQuery && (
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                >
                  <IconX size={12} />
                </ActionIcon>
              )
            }
            size="xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isCreating && searchQuery.trim() && filteredLabels.length === 0 && onCreateLabel) {
                e.preventDefault();
                handleCreateLabel();
              }
            }}
          />
        </Box>
        <Divider style={{ marginBottom: "4px" }} />
        {/* Labels List or Create Form */}
        <Box style={{ maxHeight: 300, overflowY: "auto", padding: "4px" }}>
          {filteredLabels.length === 0 && searchQuery && onCreateLabel ? (
            <Box>
              <Button
                variant="subtle"
                size="xs"
                fullWidth
                leftSection={<IconPlus size={14} />}
                onClick={handleCreateLabel}
                loading={isCreating}
                disabled={!searchQuery.trim()}
              >
                {tCommon("createNamed", { name: searchQuery })}
              </Button>
            </Box>
          ) : filteredLabels.length === 0 ? (
            <Box style={{ padding: "8px", textAlign: "center", color: theme.colors.gray[6] }}>
              {searchQuery ? tCommon("noLabelsFound") : tCommon("noLabelsAvailable")}
            </Box>
          ) : (
            filteredLabels.map((label) => (
              <Flex key={label.id} align="center" gap="4px" className="cursor-pointer">
                <Checkbox
                  key={label.id}
                  size="xs"
                  checked={value.includes(label.id)}
                  onChange={(event) => {
                    event.stopPropagation();
                    handleCheckboxChange(event.currentTarget.checked, label.id);
                  }}
                  styles={{
                    label: {
                      width: "100%",
                    },
                    root: {
                      padding: "4px 8px",
                      borderRadius: "4px",
                      cursor: "pointer",
                    },
                  }}
                />
                <Box
                  style={{ display: "flex", alignItems: "center", gap: "4px" }}
                  onClick={() => {
                    handleCheckboxChange(!value.includes(label.id), label.id);
                    setPopoverOpened(false);
                  }}
                >
                  <Box
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: label.color,
                      flexShrink: 0,
                      marginRight: "4px",
                    }}
                  />
                  <span className="text-sm" style={textStyle}>{label.name}</span>
                </Box>
              </Flex>
            ))
          )}
        </Box>
      </Box>}
       {isPickerColorOpen && <Box px='sm'>
        <Box style={{ padding: "4px", marginBottom: "4px" }}>
          <TextInput
            placeholder={tCommon("pickerLabelColor")}
            value={searchColorQuery}
            onChange={(e) => setSearchColorQuery(e.currentTarget.value)}
            leftSection={<IconSearch size={16} />}
            rightSection={
              searchColorQuery && (
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={() => setSearchColorQuery("")}
                  aria-label="Clear search"
                >
                  <IconX size={12} />
                </ActionIcon>
              )
            }
            size="xs"
          />
        </Box>
        <Divider style={{ marginBottom: "4px" }} />
        {/* use color options to render the colors */}
        <Box style={{ maxHeight: 300, overflowY: "auto"}}>
          {filteredColorOptions.map((color) => (
            <Flex key={color.value} align="center" gap="8px" className="cursor-pointer hover:bg-surface-active py-1 px-2 rounded-md" onClick={() => handleSelectColor(color.value)}>
              <Box style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: color.value, flexShrink: 0 }} />
              <span style={textStyle}>{color.name}</span>
            </Flex>
          ))}
        </Box>
      </Box>}
    </Popover.Dropdown>
  );

  const renderStyledLabel = (label: Label, extraStyles?: React.CSSProperties) => (
    <Box key={label.id} style={{ ...labelStyle, ...extraStyles }} title={label.name}>
      <Box style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: label.color, flexShrink: 0 }} />
      <span style={textStyle}>{label.name}</span>
    </Box>
  );

  const renderSummaryBadge = (hiddenLabels: Label[]) => (
    <Tooltip
      styles={{
        tooltip: {
          borderRadius: "4px",
          padding: "4px",
        },
      }}
      bg="white"
      label={
        <Box className="gap-2" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {hiddenLabels.map((l) => {
            return (
              <Box title={l.name} key={l.id} style={{ display: "flex", alignItems: "center" }}>
                <Box
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: l.color,
                    flexShrink: 0,
                    marginRight: "4px",
                  }}
                />
                <span style={textStyle} className="text-sm text-gray-500">
                  {l.name}
                </span>
              </Box>
            );
          })}
        </Box>
      }
    >
      <Box style={labelStyle}>
        <Box style={{ display: "flex", alignItems: "center" }}>
          {hiddenLabels.slice(0, 3).map((l, i) => (
            <Box
              key={l.id}
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: l.color,
                marginLeft: i > 0 ? -5 : 0,
              }}
            />
          ))}
        </Box>
        <span style={textStyle}>{tCommon("moreLabels", { count: hiddenLabels.length })}</span>
      </Box>
    </Tooltip>
  );

  const renderContent = () => {
    // Icon-only mode: always show just the plus icon
    if (iconOnly) {
      return (
        <Popover
          styles={{ dropdown: { padding: 0, paddingTop: "8px", paddingBottom: "8px", minWidth: 240 } }}
          opened={popoverOpened}
          onChange={(opened) => {
            setPopoverOpened(opened);
            if (!opened) {
              setSearchQuery("");
              setSearchColorQuery("");
              setIsPickerColorOpen(false);
            }
          }}
          withArrow
          shadow="md"
        >
          <Popover.Target>
            <Tooltip label={tCommon("addLabels")} position="top">
              <ActionIcon
                variant="subtle"
                size="sm"
                c="gray"
                onClick={(e) => {
                  e.stopPropagation();
                  setPopoverOpened((o) => !o);
                }}
              >
                <IconPlus size={16} />
              </ActionIcon>
            </Tooltip>
          </Popover.Target>
          {popoverDropdownContent}
        </Popover>
      );
    }

    if (readOnly) {
      const ReadonlyLabel = (label: Label, extraStyles?: React.CSSProperties) => (
        <Box title={label.name} key={label.id} style={{ ...labelStyle, ...extraStyles, cursor: "default" }}>
          <Box style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: label.color, flexShrink: 0 }} />
          <span style={textStyle}>{label.name}</span>
        </Box>
      );
      const ReadonlySummaryBadge = (hiddenLabels: Label[]) => (
        <Tooltip
          styles={{
            tooltip: {
              borderRadius: "4px",
              padding: "4px",
            },
          }}
          label={
            <Box className="gap-2" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {hiddenLabels.map((l) => {
                return (
                  <Box key={l.id} style={{ display: "flex", alignItems: "center" }}>
                    <Box
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: l.color,
                        flexShrink: 0,
                        marginRight: "4px",
                      }}
                    />
                    <span style={textStyle} className="text-sm text-gray-500">
                      {l.name}
                    </span>
                  </Box>
                );
              })}
            </Box>
          }
        >
          <Box style={labelStyle}>
            <Box style={{ display: "flex", alignItems: "center" }}>
              {hiddenLabels.slice(0, 3).map((l, i) => (
                <Box
                  key={l.id}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: l.color,
                    marginLeft: i > 0 ? -5 : 0,
                  }}
                />
              ))}
            </Box>
            <span style={textStyle}>{tCommon("moreLabels", { count: hiddenLabels.length })}</span>
          </Box>
        </Tooltip>
      );

      switch (mode) {
        case "all":
          return displayedLabels.map((label) => ReadonlyLabel(label));
        case "compact": {
          const visibleLabels = displayedLabels.slice(0, visibleCount);
          const hiddenLabels = displayedLabels.slice(visibleCount);
          if (visibleCount === 0) {
            return ReadonlySummaryBadge(hiddenLabels);
          }
          return (
            <>
              {visibleLabels.map((label) => ReadonlyLabel(label))}
              {hiddenLabels.length > 0 && ReadonlySummaryBadge(hiddenLabels)}
            </>
          );
        }
        default:
          return null;
      }
    }

    if (displayedLabels.length === 0) {
      return (
        <Popover
          styles={{ dropdown: { padding: 0, paddingTop: "8px", paddingBottom: "8px", minWidth: 240 } }}
          opened={popoverOpened}
          onChange={(opened) => {
            setPopoverOpened(opened);
            if (!opened) {
              setSearchQuery("");
              setSearchColorQuery("");
              setIsPickerColorOpen(false);
            }
          }}
          withArrow
          shadow="md"
        >
          <Popover.Target>
            <Tooltip label={tCommon("addLabels")} position="top">
              <ActionIcon
                variant="subtle"
                size="sm"
                c="gray"
                onClick={(e) => {
                  e.stopPropagation();
                  setPopoverOpened((o) => !o);
                }}
              >
                <IconPlus size={16} />
              </ActionIcon>
            </Tooltip>
          </Popover.Target>
          {popoverDropdownContent}
        </Popover>
      );
    }

    const interactiveContent = (() => {
      switch (mode) {
        case "all":
          return displayedLabels.map((label) => renderStyledLabel(label));
        case "compact": {
          const visibleLabels = displayedLabels.slice(0, visibleCount);
          const hiddenLabels = displayedLabels.slice(visibleCount);
          if (visibleCount === 0) {
            return renderSummaryBadge(hiddenLabels);
          }
          return (
            <>
              {visibleLabels.map((label) => renderStyledLabel(label))}
              {hiddenLabels.length > 0 && renderSummaryBadge(hiddenLabels)}
            </>
          );
        }
        default:
          return null;
      }
    })();

    return (
      <Popover
        styles={{ dropdown: { padding: 0, paddingTop: "8px", paddingBottom: "8px", minWidth: 240 } }}
        opened={popoverOpened}
        onChange={(opened) => {
          setPopoverOpened(opened);
          if (!opened) {
            setSearchQuery("");
            setIsPickerColorOpen(false);
          }
        }}
        withArrow
        shadow="md"
      >
        <Popover.Target>
          <Box
            onClick={(e) => {
              e.stopPropagation();
              setPopoverOpened((o) => !o);
            }}
            style={{ display: "flex", alignItems: "center", cursor: "pointer", gap: `${gap}px` }}
          >
            {interactiveContent}
          </Box>
        </Popover.Target>
        {popoverDropdownContent}
      </Popover>
    );
  };

  return (
    <>
      <Box
        ref={containerRef}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          overflow: "hidden",
          gap: `${gap}px`,
        }}
      >
        {renderContent()}
      </Box>

      {/* Measurement Layer */}
      <Box
        style={{
          position: "absolute",
          top: -9999,
          left: -9999,
          opacity: 0,
          zIndex: -1,
          display: "flex",
          gap: `${gap}px`,
        }}
      >
        {displayedLabels.map((label, index) => (
          <Box
            key={label.id}
            style={labelStyle}
            ref={(el) => {
              labelRefs.current[index] = el;
            }}
          >
            <Box style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: label.color, flexShrink: 0 }} />
            <span style={textStyle}>{label.name}</span>
          </Box>
        ))}
        <Box ref={plusBadgeRef} style={labelStyle}>
          <Box style={{ display: "flex", alignItems: "center" }}>
            {displayedLabels.slice(0, 3).map((l, i) => (
              <Box
                key={l.id}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: l.color,
                  marginLeft: i > 0 ? -5 : 0,
                  border: "1.5px solid white",
                }}
              />
            ))}
          </Box>
          <span style={textStyle}>{tCommon("moreLabels", { count: displayedLabels.length })}</span>
        </Box>
      </Box>
    </>
  );
}
