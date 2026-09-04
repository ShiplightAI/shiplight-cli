import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, ActionIcon, Text, Tooltip, Group, Button } from '@mantine/core';
import { IconGripVertical } from '@tabler/icons-react';

export interface ToolbarAction {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  color?: string;
  variant?: 'filled' | 'outline' | 'light' | 'subtle' | 'default';
}

export interface DraggableToolbarProps {
  /** Toolbar actions */
  actions: ToolbarAction[];
  /** Initial position, default to container center */
  initialPosition?: { x: number; y: number } | 'center';
  /** Container boundaries */
  containerBounds?: { width: number; height: number };
  /** Whether to show action count */
  showActionCount?: boolean;
  /** Whether to show drag handle */
  showDragHandle?: boolean;
  /** Toolbar title */
  title?: string;
  /** Custom styles */
  style?: React.CSSProperties;
  /** Custom class name */
  className?: string;
}

export const DraggableToolbar: React.FC<DraggableToolbarProps> = ({
  actions,
  initialPosition = 'center',
  containerBounds,
  showActionCount = true,
  showDragHandle = true,
  title,
  style,
  className,
}) => {
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 4, y: 4 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!toolbarRef.current) return;
    
    // Get the toolbar's current position relative to the container
    const rect = toolbarRef.current.getBoundingClientRect();
    const containerRect = toolbarRef.current.parentElement?.getBoundingClientRect();
    
    if (containerRect) {
      // Calculate offset from mouse to toolbar's top-left corner
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      
      setDragOffset({ x: offsetX, y: offsetY });
      setIsDragging(true);
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !toolbarRef.current) return;
    
    // Get container bounds
    const containerRect = toolbarRef.current.parentElement?.getBoundingClientRect();
    if (!containerRect) return;
    
    // Calculate new position relative to the container
    const newX = e.clientX - containerRect.left - dragOffset.x;
    const newY = e.clientY - containerRect.top - dragOffset.y;
    
    // Apply container bounds constraint
    const toolbarWidth = toolbarRef.current.offsetWidth;
    const toolbarHeight = toolbarRef.current.offsetHeight;
    const constrainedX = Math.max(0, Math.min(newX, containerRect.width - toolbarWidth));
    const constrainedY = Math.max(0, Math.min(newY, containerRect.height - toolbarHeight));
    
    setPosition({ x: constrainedX, y: constrainedY });
  }, [isDragging, dragOffset]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global mouse event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);


  // Adjust position to true center after toolbar renders


  return (
    <Box
      ref={toolbarRef}
      className={className}
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        zIndex: 100,
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        background: 'var(--mantine-color-body)',
        gap: '8px',
        transition: isDragging ? 'none' : 'all 0.2s ease',
        ...style,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Drag Handle */}
      {showDragHandle && (
          <IconGripVertical 
            size={16} 
            style={{ 
              cursor: isDragging ? 'grabbing' : 'grab',
              color: 'var(--mantine-color-gray-6)',
              flexShrink: 0
            }} 
          />
      )}
      
      {/* Action Buttons with Tooltips */}
      {actions.map((action) => (
        <Tooltip key={action.id} label={action.description || action.label} position="top">
          <Button size='xs' variant='subtle' color={action.color || 'blue'} onClick={action.onClick} leftSection={action.icon}>
            <Text size="xs">{action.label}</Text>
          </Button>
        </Tooltip>
      ))}
    </Box>
  );
};

export default DraggableToolbar;
