import React, { useState } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { StatementType } from "shiplight-types";
import { useTranslations } from "next-intl";

interface FloatingAddButtonProps {
  onAddStatement: (type: StatementType) => void;
  className?: string;
  prominent?: boolean;
}

export const FloatingAddButton: React.FC<FloatingAddButtonProps> = ({
  onAddStatement,
  className = "",
  prominent = false,
}) => {
  const t = useTranslations('TestCases');
  const [isHovered, setIsHovered] = useState(false);

  const handleAddAction = () => {
    // Default to DRAFT - it will convert to ACTION or STEP after execution
    onAddStatement(StatementType.DRAFT);
  };

  // Render prominent version for top-level last button
  if (prominent) {
    return (
      <div className={`flex justify-center ${className}`} style={{ margin: '8px 0px' }}>
        <button
          onClick={handleAddAction}
          className="flex items-center gap-2 px-1 py-1 hover:bg-surface-hover hover:border-border-subtle rounded-lg transition-colors duration-200 text-secondary hover:text-primary"
        >
          <IconPlus size={16} className="text-secondary" />
          <span className="text-sm font-medium">{t('floatingAddButton.addNewStep')}</span>
        </button>
      </div>
    );
  }

  // Render subtle version for all other cases
  return (
    <div className={`flex justify-center ${className}`} style={{ margin: '4px 0px' }}>
      <div
        className="relative group"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Collapsed state - small grey + icon (always present to maintain layout) */}
        <div className="flex items-center justify-center w-6 h-2 cursor-pointer transition-opacity duration-200 opacity-60 hover:opacity-80">
          <IconPlus size={12} className="text-gray-400" />
        </div>

        {/* Expanded state - absolute positioned overlay */}
        <div
          className={`
            absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10
            transition-all duration-300 ease-in-out
            ${isHovered
              ? 'opacity-100 scale-100 pointer-events-auto'
              : 'opacity-0 scale-95 pointer-events-none'
            }
          `}
        >
          <div className="flex items-center justify-center">
            <div className="rounded-[4px]" style={{ backgroundColor: '#3b3b3b' }}>
              {/* Single Add Action button */}
              <button
                onClick={handleAddAction}
                className="w-6 h-6 outline-none flex items-center justify-center transition-colors duration-200"
              >
                <IconPlus size={16} className="text-white" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};