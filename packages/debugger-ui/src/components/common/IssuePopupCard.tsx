import React, { useState, useRef, useEffect, useMemo } from "react";
import { Popover, Box, Text, Badge, Group, ActionIcon, Stack, Divider } from "@mantine/core";
import { IconBug, IconExternalLink, IconChevronRight, IconCalendar, IconUser } from "@tabler/icons-react";
import { Issue, ISSUE_STATUS_OPTIONS } from "@/types/issue";
import Link from "next/link";
import { UserAvatarByUserId } from "./UserAvater";
import { useLabels } from "@/hooks/useLabels";
import { Label } from "@/common/models/label";
import { formatDate } from "@/utils/formatUtils";

interface IssuePopupCardProps {
  issue: Issue;
  children: React.ReactNode;
  opened?: boolean;
  onClose?: () => void;
  position?: "top" | "bottom" | "left" | "right";
  withArrow?: boolean;
  withinPortal?: boolean;
  trigger?: "click" | "hover";
  openDelay?: number;
  closeDelay?: number;
}

export function IssuePopupCard({
  issue,
  children,
  opened,
  onClose,
  position = "top",
  withArrow = true,
  withinPortal = true,
  trigger = "hover",
  openDelay = 300,
  closeDelay = 200,
}: IssuePopupCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { labels } = useLabels();

  const tagItems = useMemo(() => {
    return issue.tags?.map((tag) => {
      const label = labels.find((label: Label) => label.id?.toString() === tag);
      if (!label) return null;
      return label;
    }).filter((tag: Label | null) => tag !== null) || [];
  }, [labels, issue.tags]);

  // Get status color
  const getStatusColor = (status: string) => {
    const option = ISSUE_STATUS_OPTIONS.find((opt) => opt.value === status);
    return option?.color || "gray";
  };

  // Handle mouse enter
  const handleMouseEnter = () => {
    if (trigger === "hover") {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setIsOpen(true);
      }, openDelay);
    }
  };

  // Handle mouse leave
  const handleMouseLeave = () => {
    if (trigger === "hover") {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setIsOpen(false);
      }, closeDelay);
    }
  };

  // Handle click
  const handleClick = () => {
    if (trigger === "click") {
      setIsOpen(!isOpen);
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Use controlled state if opened prop is provided
  const isPopupOpen = opened !== undefined ? opened : isOpen;
  const handleClose = () => {
    if (opened === undefined) {
      setIsOpen(false);
    }
    onClose?.();
  };

  return (
    <Popover
      opened={isPopupOpen}
      onClose={handleClose}
      position={position}
      withArrow={withArrow}
      withinPortal={withinPortal}
      shadow="lg"
      radius="md"
      width={320}
    >
      <Popover.Target>
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          className="min-w-0"
        >
          {children}
        </div>
      </Popover.Target>
      <Popover.Dropdown 
        p="md"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Stack gap="sm">
          {/* Header */}
          <Group justify="space-between" align="flex-start">
            <Box style={{ flex: 1 }} className="min-w-0">
              <Group gap="xs" mb={4}>
                <IconBug size={16} className="text-primary-600" />
                <Text size="sm" fw={600} c="primary">
                  ISSUE-{issue.id}
                </Text>
                <Badge
                  size="xs"
                  color={getStatusColor(issue.status)}
                  variant="light"
                >
                  {issue.status}
                </Badge>
              </Group>
              <Text size="sm" fw={500} lineClamp={2} className="text-primary">
                {issue.title}
              </Text>
            </Box>
          </Group>

          {/* Description */}
          {issue.description && (
            <>
              <Divider />
              <Text size="xs" c="secondary" lineClamp={3}>
                {issue.description}
              </Text>
            </>
          )}

          {/* Tags */}
          {tagItems.length > 0 && (
            <>
              <Group gap="xs" wrap="wrap">
                {tagItems.slice(0, 3).map((tag) => {
                  return (
                    <Badge key={tag.id} size="xs" variant="outline" color={tag.color || "primary"}>
                      {tag.name}
                    </Badge>
                  );
                })}
                {tagItems.length > 3 && (
                  <Text size="xs" c="tertiary">
                    +{tagItems.length - 3} more
                  </Text>
                )}
              </Group>
            </>
          )}

          {/* Metadata */}
          <Divider />
          <Stack gap="xs">
            <Group gap="xs">
              <IconCalendar size={12} className="text-tertiary" />
              <Text size="xs" c="tertiary">
                 {formatDate(issue.createdAt)}
              </Text>
            </Group>
            {issue.createdBy && (
              <Group gap="xs">
                <IconUser size={12} className="text-tertiary" />
                <UserAvatarByUserId userId={issue.createdBy} size="xs" action="Created by" />
              </Group>
            )}
          </Stack>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
