import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { TestCaseDetails } from "@/common/view-models/testCaseDetails";
import TestLiveView, { type TestLiveViewTab } from "./TestLiveView";
import TestInfoView, { type TestConfigInfo, type ConfigChangeSource } from "./TestInfoView";
import { SegmentedControl } from "@mantine/core";
import { TestSessionInfo } from "@/services/sandboxService";
import { useTranslations } from "next-intl";

const LEFT_PANNEL_MIN_WIDTH = 323;

interface TestContextInfo {
  testContext?: any;
  stdout: string[];
}

// Extract EditorPanel as a separate component to maintain React component identity
const EditorPanel: React.FC<{ content: React.ReactNode; isCollapsed: boolean }> = React.memo(
  ({ content, isCollapsed }) => {
    return (
      <div className={`h-full flex flex-col ${isCollapsed ? "invisible" : ""}`}>
        <div className="flex-1 min-h-0">{content}</div>
      </div>
    );
  }
);
EditorPanel.displayName = "EditorPanel";

export interface PreviewPanelProps {
  isDebugging: boolean;
  testCase?: any;
  liveviewUrl?: string;
  liveviewUrlType?: string;
  liveviewImageData?: Blob;
  videoUrl?: string;
  previewImages?: Array<{ url: string; label: string }>;
  activeTab?: TestLiveViewTab;
  onTabChange?: (tab: TestLiveViewTab | null) => void;
  session?: TestSessionInfo;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  testContextInfo?: TestContextInfo | null;
  testConfigInfo?: TestConfigInfo | null;
  onConfigChange?: (key: string, value: unknown, source: ConfigChangeSource) => void;
}

// Extract PreviewPanel as a separate component to maintain React component identity
export const PreviewPanel: React.FC<PreviewPanelProps> = React.memo(
  ({
    isDebugging,
    testCase,
    liveviewUrl,
    liveviewUrlType,
    liveviewImageData,
    videoUrl,
    previewImages,
    activeTab,
    onTabChange,
    session,
    isFullScreen = false,
    onToggleFullScreen,
    testContextInfo,
    testConfigInfo,
    onConfigChange,
  }) => {
    return (
      <div className="h-full overflow-y-auto flex flex-col">
        {/* Live View */}
        <div className="flex-1 overflow-y-auto">
          <TestLiveView
            isDebugging={isDebugging}
            testCase={testCase}
            liveviewUrl={liveviewUrl}
            liveviewUrlType={liveviewUrlType}
            liveviewImageData={liveviewImageData}
            videoUrl={videoUrl}
            previewImages={previewImages}
            activeTab={activeTab}
            onTabChange={onTabChange}
            session={session}
            onToggleFullScreen={onToggleFullScreen}
            isFullScreen={isFullScreen}
          />
        </div>

        {/* Info View - hide in full screen mode */}
        {!isFullScreen && (
          <div className="pb-0">
            <TestInfoView testContextInfo={testContextInfo} testConfigInfo={testConfigInfo} onConfigChange={onConfigChange} />
          </div>
        )}
      </div>
    );
  }
);
PreviewPanel.displayName = "PreviewPanel";

interface ResizableTestEditorProps {
  isDebugging?: boolean;
  testCaseDetails: TestCaseDetails | null;
  leftPanelContent: React.ReactNode | (() => React.ReactNode);
  className?: string;
  liveviewImageData?: Blob;
  liveviewUrl?: string;
  liveviewUrlType?: string;
  videoUrl?: string;
  previewImages?: Array<{ url: string; label: string }>;
  activeTab?: TestLiveViewTab;
  onTabChange?: (tab: TestLiveViewTab | null) => void;
  testContextInfo?: TestContextInfo | null;
  testConfigInfo?: TestConfigInfo | null;
  onConfigChange?: (key: string, value: unknown, source: ConfigChangeSource) => void;
  onLeftPanelWidthChange?: (width: number) => void;
  session?: TestSessionInfo; // Session for recorder functionality
}

export const ResizableTestEditor: React.FC<ResizableTestEditorProps> = ({
  isDebugging = false,
  testCaseDetails,
  leftPanelContent,
  className = "",
  liveviewImageData,
  liveviewUrl,
  liveviewUrlType,
  videoUrl = "",
  previewImages = [],
  activeTab = "live",
  onTabChange,
  testContextInfo,
  testConfigInfo,
  onConfigChange,
  onLeftPanelWidthChange,
  session,
}) => {
  const t = useTranslations('TestCases.resizableEditor');
  const [showEditor, setShowEditor] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  // Track screen size to determine if we're on desktop
  useEffect(() => {
    const checkIsDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };

    // Check on mount
    checkIsDesktop();

    // Listen for resize events
    window.addEventListener("resize", checkIsDesktop);
    return () => window.removeEventListener("resize", checkIsDesktop);
  }, []);

  // Render leftPanelContent - call as function if it's a function, otherwise render as-is
  const enhancedLeftPanelContent = useMemo(() => {
    if (typeof leftPanelContent === 'function') {
      return leftPanelContent();
    }
    return leftPanelContent;
  }, [leftPanelContent]);

  // Add state for the resizable panel width
  const [leftPanelWidth, setLeftPanelWidth] = useState(35); // 35% default width
  const [previousWidth, setPreviousWidth] = useState(35); // Store previous width for collapse/expand
  const [isDragging, setIsDragging] = useState(false);

  // Store the width before entering full screen so we can restore it
  const normalModeWidthRef = useRef(35);
  const dragStartXRef = useRef(0);
  const currentWidthRef = useRef(35);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const hasDragged = useRef(false);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate minimum width percentage dynamically
  const getMinWidthPercent = useCallback(() => {
    if (!containerRef.current) return 0;
    return (LEFT_PANNEL_MIN_WIDTH / containerRef.current.offsetWidth) * 100;
  }, []);

  // Auto-adjust panel width when entering/exiting full screen
  useEffect(() => {
    if (isFullScreen) {
      // Entering full screen - save current width and set to minimum width
      normalModeWidthRef.current = currentWidthRef.current;
      const minWidthPercent = getMinWidthPercent();
      setLeftPanelWidth(minWidthPercent);
      currentWidthRef.current = minWidthPercent;
    } else {
      // Exiting full screen - restore previous width
      const restoredWidth = normalModeWidthRef.current;
      setLeftPanelWidth(restoredWidth);
      currentWidthRef.current = restoredWidth;
    }
  }, [isFullScreen, getMinWidthPercent]);


  // use ResizeObserver to listen to the size change of the left panel
  useEffect(() => {
    const leftPanel = leftPanelRef.current;
    if (!leftPanel) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        // Call the parent callback when width changes
        onLeftPanelWidthChange?.(width);
      }
    });

    resizeObserver.observe(leftPanel);

    // set the width when initialized
    const initialWidth = leftPanel.clientWidth;
    onLeftPanelWidthChange?.(initialWidth);

    return () => {
      resizeObserver.unobserve(leftPanel);
      resizeObserver.disconnect();
    };
  }, [onLeftPanelWidthChange]);

  // Update collapse detection to only consider truly collapsed (0% width)
  const isCollapsed = useMemo(() => {
    return leftPanelWidth < 1; // Only collapsed when essentially 0%
  }, [leftPanelWidth]);

  // Update the ref when state changes to avoid stale closures
  useEffect(() => {
    currentWidthRef.current = leftPanelWidth;
  }, [leftPanelWidth]);


  // Memoize the update function to prevent recreating on every render
  const updateWidth = useCallback((newWidth: number) => {
    if (leftPanelRef.current && containerRef.current) {
      // Update the DOM directly for smoother performance
      leftPanelRef.current.style.width = `${newWidth}%`;

      // Update state only once per frame for React's benefit
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        setLeftPanelWidth(newWidth);
        if (newWidth > 5) {
          setPreviousWidth(newWidth);
        }
        animationFrameRef.current = null;
      });
    }
  }, []);

  // Add handlers for resize functionality
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    hasDragged.current = false;

    // Clear any existing timeout
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
  };

  const handleClick = () => {
    // Only process the click if no dragging occurred
    if (!hasDragged.current) {
      if (isCollapsed) {
        // Expand to previous width, but ensure it meets minimum
        const minWidthPercent = getMinWidthPercent();
        const targetWidth = Math.max(previousWidth, minWidthPercent);
        updateWidth(targetWidth);
      } else {
        // Collapse to 0 (will be handled by CSS visibility)
        setPreviousWidth(currentWidthRef.current);
        updateWidth(0);
      }
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const containerWidth = containerRef.current.offsetWidth;
      const deltaX = e.clientX - dragStartXRef.current;

      // If the mouse has moved more than 3px, consider it a drag
      if (Math.abs(deltaX) > 3) {
        hasDragged.current = true;
      }

      const newLeftPanelWidth = currentWidthRef.current + (deltaX / containerWidth) * 100;

      // Calculate minimum width percentage based on pixel minimum
      const minWidthPercent = (LEFT_PANNEL_MIN_WIDTH / containerWidth) * 100;

      // Set constraints (minimum based on icon-only button width, maximum 80%)
      const clampedWidth = Math.min(Math.max(newLeftPanelWidth, minWidthPercent), 80);

      // Update the width with direct DOM manipulation
      updateWidth(clampedWidth);

      // Update the reference point
      dragStartXRef.current = e.clientX;
      currentWidthRef.current = clampedWidth;
    };

    const handleMouseUp = () => {
      setIsDragging(false);

      // If we've dragged, prevent click for a short period
      if (hasDragged.current) {
        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current);
        }

        clickTimeoutRef.current = setTimeout(() => {
          hasDragged.current = false;
          clickTimeoutRef.current = null;
        }, 300);
      }
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      // Add a cursor style to the body during dragging
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      // Disable pointer events on iframes during drag to prevent mouse capture issues
      const iframes = document.querySelectorAll("iframe");
      iframes.forEach((iframe) => {
        iframe.style.pointerEvents = "none";
      });
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      // Reset cursor
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      // Re-enable pointer events on iframes
      const iframes = document.querySelectorAll("iframe");
      iframes.forEach((iframe) => {
        iframe.style.pointerEvents = "";
      });

      // Cancel any pending animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isDragging, updateWidth]);


  // Memoize toggle function to prevent unnecessary re-renders
  const handleToggleFullScreen = useCallback(() => {
    setIsFullScreen(!isFullScreen);
  }, [isFullScreen]);

  if (!testCaseDetails) {
    return <div>Loading test case details...</div>;
  }

  const { testCase } = testCaseDetails;

  

  return (
    <div
      ref={containerRef}
      className={`flex flex-col lg:flex-row h-full w-full gap-6 lg:gap-0 overflow-hidden ${className} ${
        isFullScreen ? "fixed inset-0 z-50 bg-surface" : ""
      }`}
    >
      {/* Mobile header with toggle - only visible on mobile */}
      <div className="flex items-center justify-end px-4 pt-2 pb-1 lg:hidden">
        <SegmentedControl
          value={showEditor ? "editor" : "preview"}
          onChange={(value) => setShowEditor(value === "editor")}
          data={[
            { label: t('editor'), value: "editor" },
            { label: t('preview'), value: "preview" },
          ]}
          size="sm"
          styles={{
            label: {
              width: 80,
            },
          }}
        />
      </div>

      {/* Left section (Editor Panel) - unified for both mobile and desktop */}
      {/* Use stable key to help React maintain component identity across different DOM positions */}
      <div
        key="editor-panel-container"
        ref={leftPanelRef}
        className={`w-full lg:w-auto flex flex-col h-full overflow-hidden ${
          isCollapsed ? "lg:w-0" : ""
        } ${
          isDragging ? "" : "transition-all duration-300 ease-in-out"
        } ${
          // On mobile, show/hide based on showEditor state
          // On desktop, always show (controlled by width)
          showEditor ? "flex" : "hidden lg:flex"
        }`}
        style={{
          // Only apply width and minWidth on desktop (lg and above)
          // On mobile, w-full class will handle the width
          ...(isDesktop
            ? {
                width: `${leftPanelWidth}%`,
                minWidth: leftPanelWidth > 0 ? `${LEFT_PANNEL_MIN_WIDTH}px` : "0px",
              }
            : {}),
        }}
      >
        <EditorPanel key="editor-panel" content={enhancedLeftPanelContent} isCollapsed={isCollapsed} />
      </div>

      {/* Resizer handle - only visible on desktop */}
      <div
        className="hidden lg:block cursor-col-resize select-none z-10 relative group"
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        data-testid="resizer-handle"
      >
        <div className="absolute inset-0 w-3 -ml-1.5" />
        <div className="h-full w-px border-l border-secondary group-hover:border-blue-400 transition-colors duration-200" />
        <div className="absolute top-1/4 -translate-y-1/2 ml-4 text-xs text-secondary bg-surface px-2 py-1 rounded-md shadow-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="whitespace-nowrap font-medium">{t('dragToResize')}</div>
          <div className="whitespace-nowrap text-tertiary">
            {isCollapsed ? t('clickToExpand') : t('clickToCollapse')}
          </div>
        </div>
      </div>

      {/* Right section (Preview Panel) - unified for both mobile and desktop */}
      {/* Use stable key to help React maintain component identity across different DOM positions */}
      <div
        key="preview-panel-container"
        className={`flex-1 flex flex-col bg-surface h-full overflow-hidden ${
          // On mobile, show/hide based on showEditor state
          // On desktop, always show
          showEditor ? "hidden lg:flex" : "flex"
        }`}
      >
        <PreviewPanel
          key="preview-panel"
          isDebugging={isDebugging}
          testCase={testCase}
          liveviewUrl={liveviewUrl}
          liveviewUrlType={liveviewUrlType}
          liveviewImageData={liveviewImageData}
          videoUrl={videoUrl}
          previewImages={previewImages}
          activeTab={activeTab}
          onTabChange={onTabChange}
          session={session}
          isFullScreen={isFullScreen}
          onToggleFullScreen={handleToggleFullScreen}
          testContextInfo={testContextInfo}
          testConfigInfo={testConfigInfo}
          onConfigChange={onConfigChange}
        />
      </div>
    </div>
  );
};
