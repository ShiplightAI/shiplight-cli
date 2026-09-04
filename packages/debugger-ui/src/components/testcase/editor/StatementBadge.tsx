import React from "react";
import { Badge, Tooltip } from "@mantine/core";
import { useTranslations } from "next-intl";

interface StatementBadgeProps {
  label: string;
  icon: React.ReactNode;
  color: string; // e.g. 'bg-green-500', 'bg-blue-600', etc.
  modified?: boolean;
  className?: string;
}

// Helper to convert Tailwind color classes to Mantine colors
const tailwindToMantineColor = (tailwindClass: string): string => {
  if (tailwindClass.includes('cyan')) return 'cyan';
  if (tailwindClass.includes('sky')) return 'blue';
  if (tailwindClass.includes('teal')) return 'teal';
  if (tailwindClass.includes('indigo')) return 'indigo';
  if (tailwindClass.includes('emerald')) return 'green';
  if (tailwindClass.includes('fuchsia')) return 'fuchsia';
  if (tailwindClass.includes('violet')) return 'violet';
  if (tailwindClass.includes('purple')) return 'violet';
  if (tailwindClass.includes('green')) return 'green';
  if (tailwindClass.includes('blue')) return 'blue';
  if (tailwindClass.includes('orange')) return 'orange';
  if (tailwindClass.includes('red')) return 'red';
  if (tailwindClass.includes('yellow')) return 'yellow';
  if (tailwindClass.includes('gray')) return 'dark';
  return 'gray'; // fallback
};

export const StatementBadge: React.FC<StatementBadgeProps> = ({
  label,
  icon,
  color,
  modified = false,
  className = "",
}) => {
  const t = useTranslations('TestCases');
  const mantineColor = tailwindToMantineColor(color);

  const badge = (
    <Badge
      size="sm"
      variant="filled"
      color={mantineColor}
      leftSection={icon}
      className={className}
    >
      {label}
    </Badge>
  );

  return (
    <div className="relative inline-block">
      {modified ? (
        <Tooltip label={t('statementBadge.unsavedChanges')}>
          {badge}
        </Tooltip>
      ) : (
        badge
      )}

      {modified && (
        <div
          className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-white"
          style={{
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)"
          }}
        />
      )}
    </div>
  );
};