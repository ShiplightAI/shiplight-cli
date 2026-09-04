import React from "react";
import { Button, Stack, Text, Box } from "@mantine/core";
import { IconBook } from "@tabler/icons-react";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string | React.ReactNode;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
}

export function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <div className="max-w-[500px] w-full flex flex-col items-start">
        {/* Icon in a bordered box */}
        {icon && (
          <Box
            mb="xl"
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              border: "1px solid var(--mantine-color-default-border)",
              backgroundColor: "var(--mantine-color-body)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "var(--mantine-shadow-sm)",
            }}
          >
            {icon}
          </Box>
        )}

        {/* Title */}
        <Text
          size="xl"
          fw={600}
          mb="lg"
          style={{
            fontSize: 22,
            lineHeight: 1.3,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </Text>

        {/* Description */}
        {description && (
          <Box mb="xl" style={{ width: "100%" }}>
            {typeof description === "string" ? (
              <Text
                size="sm"
                c="dimmed"
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              >
                {description}
              </Text>
            ) : (
              description
            )}
          </Box>
        )}

        {/* Actions */}
        {(primaryAction || secondaryAction) && (
          <Stack gap="xs" style={{ flexDirection: "row" }}>
            {primaryAction && (
              <Button
                size="sm"
                onClick={primaryAction.onClick}
                style={{
                  paddingLeft: 16,
                  paddingRight: 16,
                }}
              >
                {primaryAction.label}
              </Button>
            )}
            {secondaryAction && (
              <>
                {secondaryAction.href ? (
                  <Button
                    size="sm"
                    variant="default"
                    component="a"
                    href={secondaryAction.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    leftSection={<IconBook size={16} />}
                    style={{
                      paddingLeft: 16,
                      paddingRight: 16,
                    }}
                  >
                    {secondaryAction.label}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={secondaryAction.onClick}
                    leftSection={<IconBook size={16} />}
                    style={{
                      paddingLeft: 16,
                      paddingRight: 16,
                    }}
                  >
                    {secondaryAction.label}
                  </Button>
                )}
              </>
            )}
          </Stack>
        )}
      </div>
    </div>
  );
}

