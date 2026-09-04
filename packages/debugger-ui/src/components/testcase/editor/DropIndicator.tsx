import React from 'react';
import { useDroppable } from '@dnd-kit/core';

interface DropIndicatorProps {
  id: string;
  isActive: boolean;
  position: 'before' | 'after' | 'inside';
}

export const DropIndicator: React.FC<DropIndicatorProps> = ({
  id,
  isActive,
  position
}) => {
  const { setNodeRef } = useDroppable({
    id: id,
    data: {
      type: 'drop-indicator',
      position,
    },
  });

  // Simple, consistent message for all positions
  const getDropText = () => 'Drop here';

  // Show drop indicator - active ones are prominent, inactive ones are subtle
  return (
    <div
      ref={setNodeRef}
      className={`
        min-h-[40px] rounded-md border-2 border-dashed transition-all duration-200 my-1
        flex items-center justify-center relative
        ${isActive
          ? 'border-blue-500 bg-blue-50/70 scale-105 shadow-lg'
          : 'border-transparent bg-transparent hover:border-gray-200'
        }
      `}
    >
      {isActive && (
        <>
          <div className="text-sm text-blue-600 font-semibold">
            {getDropText()}
          </div>
          {/* Visual feedback indicator */}
          <div className="absolute right-3 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
        </>
      )}
    </div>
  );
};