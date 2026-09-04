import React, { useState, useEffect, useRef } from "react";
import { Paper, Text, ThemeIcon, Tabs, Button, ActionIcon, Tooltip, Badge } from "@mantine/core";
import { useTranslations } from "next-intl";
import { IconLiveView, IconVideo, IconBrowserCheck, IconRefresh, IconPhoto, IconMaximize, IconMinimize } from "@tabler/icons-react";
import { TestCase } from "@/common/models/testCase";
import ScreencastViewer from "./ScreencastViewer";
import { ImageViewer, type ImageItem } from "./ImageViewer";
import { ImageDataViewer } from "../common/ImageDataViewer";
import MultiPageViewer from "./MultiPageViewer";
import { TestSessionInfo } from "@/services/sandboxService";
import { TestFlow } from "shiplight-types";
import { getDeviceByName } from "shiplight-types";

// Define the valid tab names
export type TestLiveViewTab = "live" | "video" | "previews";

interface TestLiveViewProps {
  isDebugging?: boolean;
  testCase?: TestCase;
  liveviewUrl?: string;
  liveviewUrlType?: string;
  liveviewImageData?: Blob; // New prop for generation image data
  videoUrl?: string | null;
  previewImages?: ImageItem[];
  activeTab?: TestLiveViewTab | null;
  onTabChange?: (tab: TestLiveViewTab | null) => void;
  showVideoTab?: boolean; // Controls whether to show the Video tab
  showPreviewsTab?: boolean; // Controls whether to show the Previews tab
  session?: TestSessionInfo; // Session for recorder functionality
  onToggleFullScreen?: () => void; // Callback to toggle full screen mode
  minimalMode?: boolean; // Hide Paper border and tabs header for full screen
  isFullScreen?: boolean; // Whether currently in full screen mode
}

const TestLiveView: React.FC<TestLiveViewProps> = ({
  isDebugging = false,
  testCase,
  liveviewUrl,
  liveviewUrlType,
  liveviewImageData,
  videoUrl,
  previewImages,
  activeTab: activeTabProp,
  onTabChange,
  showVideoTab = true,
  showPreviewsTab = true,
  session,
  onToggleFullScreen,
  minimalMode = false,
  isFullScreen = false,
}) => {
  const t = useTranslations('TestCases');
  const [activeTab, setActiveTab] = useState<TestLiveViewTab | null>(activeTabProp || "live");

  // handleScreencastDisconnected is used to handle the screencast viewer disconnection
  const [screencastDisconnected, setScreencastDisconnected] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentIntervalRef = useRef<number>(1000); // Start with 1 second
  const hasVideo = !!videoUrl;
  const hasPreviewImages = previewImages && previewImages.length > 0;
  const hasLiveviewImage = !!liveviewImageData;
  const isCodeMode = false; // Code mode removed - all tests are Agent-based
  const isGenerating = testCase?.status === "Generating";

  // Use external activeTab if provided, otherwise use internal state
  const currentActiveTab = activeTabProp !== undefined ? activeTabProp : activeTab;

  // Handle tab change - use external handler if provided, otherwise use internal state
  const handleTabChange = (tab: TestLiveViewTab | null) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setActiveTab(tab);
    }
  };

  // Type guard to ensure the tab value is valid
  const isValidTab = (tab: string | null): tab is TestLiveViewTab | null => {
    return tab === null || tab === "live" || tab === "video" || tab === "previews";
  };

  // Handler for Mantine Tabs onChange (which expects string | null)
  const handleManteTabChange = (value: string | null) => {
    if (isValidTab(value)) {
      handleTabChange(value);
    }
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  // handleScreencastDisconnected is used to handle the screencast viewer disconnection
  const handleScreencastDisconnected = () => {
    setScreencastDisconnected(true);

    // Clear any existing timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    // Schedule the next retry
    const scheduleNextRetry = () => {
      reconnectToLiveViewServer();
      // Double the interval up to 30 seconds
      currentIntervalRef.current = Math.min(currentIntervalRef.current * 2, 30000);
      retryTimeoutRef.current = setTimeout(scheduleNextRetry, currentIntervalRef.current);
    };

    // Start the retry sequence
    scheduleNextRetry();

    // Try immediate reconnection after setting up the timeout
    reconnectToLiveViewServer();
  };

  // reconnectToLiveView is used to force a reconnect of the screencast viewer
  const reconnectToLiveViewServer = () => {
    setReconnectKey(prev => prev + 1);
  };

  // Clear retry timeout when connection is successful
  const handleScreencastConnected = () => {
    setScreencastDisconnected(false);
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    // Reset the interval when connection is successful
    currentIntervalRef.current = 1000;
  };

  // Render live view content (extracted for reuse in minimal mode)
  const renderLiveViewContent = () => (
    <div className="w-full h-full flex-1 relative min-h-0" style={{ margin: 0, padding: 0 }}>
      {isCodeMode ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 h-full p-6">
          <ThemeIcon size={48} radius={24} className="mb-4 bg-gray-200 text-gray-500">
            <IconLiveView size={24} />
          </ThemeIcon>
          <Text size="lg" fw={600} c="dark" className="mb-2 text-center">
            {t('liveView.liveViewNotAvailable')}
          </Text>
          <Text c="dimmed" size="sm" className="max-w-md text-center">
            {t('liveView.liveViewNotAvailableDesc')}
          </Text>
        </div>
      ) : isGenerating && hasLiveviewImage ? (
        // Show generation image viewer during generation
        <ImageDataViewer
          imageData={liveviewImageData}
          className="absolute inset-0 w-full h-full"
          alt={t('liveView.generationScreenshot')}
          placeholder={t('liveView.waitingForScreenshot')}
        />
      ) : liveviewUrl ? (
        <div key={reconnectKey}>
          {liveviewUrlType === "screencast" ? (
            <ScreencastViewer
              websocketUrl={liveviewUrl}
              className="absolute inset-0 w-full h-full"
              onOpen={handleScreencastConnected}
              onClose={handleScreencastDisconnected}
            />
          ) : liveviewUrlType === "devtools" ? (
            <iframe
              src={liveviewUrl}
              className="absolute inset-0 w-full h-full"
              style={{ border: "none" }}
              title={t('liveView.livePreviewTitle')}
            />
          ) : liveviewUrlType === "browser" ? (
            <MultiPageViewer
              liveviewUrl={liveviewUrl}
              className="absolute inset-0 w-full h-full"
              session={session}
              hideRecorderToolbar={minimalMode}
            />
          ) : <div>Unsupported liveview URL type: {liveviewUrlType}</div>}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center h-full p-6">
          <ThemeIcon size={48} radius={24} className="mb-4 bg-blue-500/10 text-blue-500">
            <IconBrowserCheck size={24} />
          </ThemeIcon>
          <Text size="lg" fw={600} className="mb-2 text-center text-secondary">
            {t('liveView.testLiveView')}
          </Text>
          <Text c="dimmed" size="sm" className="max-w-md text-center">
            {isGenerating
              ? t('liveView.waitingForGeneration')
              : isDebugging ? t('liveView.initializingDebug') : t('liveView.clickToStart')
            }
          </Text>
        </div>
      )}
    </div>
  );

  // Minimal mode: render only the content without Paper wrapper and tabs
  if (minimalMode) {
    return (
      <div className="w-full h-full flex flex-col">
        {renderLiveViewContent()}
      </div>
    );
  }

  // Normal mode: render with Paper wrapper and tabs
  return (
    <Paper
      shadow="sm"
      className="w-full h-full flex flex-col"
      style={{
        border: "1px solid var(--shiplight-border-secondary)",
        borderRadius: "var(--mantine-radius-md)",
      }}
    >
      <Tabs value={currentActiveTab} onChange={handleManteTabChange}
        className="flex flex-col h-full"
        style={{ margin: 0, padding: 0 }}
        styles={{
          root: { height: '100%', display: 'flex', flexDirection: 'column' },
          panel: { flex: 1, padding: 0, margin: 0, height: '100%' }
        }}>
        <Tabs.List className="px-4 pt-2">
          <Tabs.Tab value="live" leftSection={<IconLiveView size={16} />}>
            {t('liveView.liveViewTab')}
          </Tabs.Tab>
          {showVideoTab && (
            <Tabs.Tab value="video" leftSection={<IconVideo size={16} />} disabled={!hasVideo}>
              {t('liveView.videoTab')}
            </Tabs.Tab>
          )}
          {showPreviewsTab && (
            <Tabs.Tab value="previews" leftSection={<IconPhoto size={16} />} disabled={!hasPreviewImages}>
              {hasPreviewImages
                ? t('liveView.previewsWithCount', { count: previewImages.length })
                : t('liveView.previewsTab')}
            </Tabs.Tab>
          )}
          {/* Browser indicator badge - only show during live debugging */}
          {isDebugging && testCase?.deviceName && (() => {
            const device = getDeviceByName(testCase.deviceName);
            const browserName = device?.displayName || testCase.deviceName;
            return (
              <div className="flex items-center ml-2">
                <Tooltip label={t('liveView.deviceTooltip', { name: testCase.deviceName })} position="bottom">
                  <Badge
                    variant="light"
                    color="gray"
                    size="sm"
                    className="cursor-default"
                  >
                    {browserName}
                  </Badge>
                </Tooltip>
              </div>
            );
          })()}
          {/* Show Reconnect button only for iframe, show Reconnecting... for WebSocket when disconnected */}
          {liveviewUrl && (
            <>
              {liveviewUrlType !== "screencast" && (
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconRefresh size={14} />}
                  onClick={reconnectToLiveViewServer}
                  className="ml-auto"
                >
                  {t('liveView.reload')}
                </Button>
              )}
              {liveviewUrlType === "screencast" && screencastDisconnected && (
                <div className="ml-auto flex items-center text-sm text-gray-500">
                  <IconRefresh size={14} className="mr-1 animate-spin" />
                  {t('liveView.reloading')}
                </div>
              )}
            </>
          )}

          {/* Full screen toggle button */}
          {onToggleFullScreen && (
            <Tooltip label={isFullScreen ? t('liveView.exitFullScreen') : t('liveView.fullScreen')} position="bottom">
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={onToggleFullScreen}
                className={liveviewUrl && liveviewUrlType !== "screencast" ? "" : "ml-auto"}
                aria-label={isFullScreen ? t('liveView.exitFullScreen') : t('liveView.fullScreen')}
              >
                {isFullScreen ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
        </Tabs.List>

        <Tabs.Panel value="live" className="flex-1 min-h-0" style={{ padding: 0, margin: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
          {renderLiveViewContent()}
        </Tabs.Panel>

        {showVideoTab && (
          <Tabs.Panel value="video" className="flex-1 min-h-0" style={{ padding: 0, margin: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="w-full h-full flex-1 relative" style={{ margin: 0, padding: 0 }}>
              {videoUrl ? (
                <video controls className="absolute inset-0 w-full h-full object-contain bg-gray-50" src={videoUrl}>
                  {t('viewRecordingModal.browserNotSupported')}
                </video>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center h-full bg-gray-50">
                  <Text c="dimmed">{t('liveView.noVideoRecording')}</Text>
                </div>
              )}
            </div>
          </Tabs.Panel>
        )}

        {showPreviewsTab && (
          <Tabs.Panel value="previews" className="flex-1 min-h-0" style={{ padding: 0, margin: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="w-full h-full flex-1 relative" style={{ margin: 0, padding: 0 }}>
              <div className="absolute inset-0 w-full h-full">
                <ImageViewer
                  images={previewImages || []}
                  enableKeyboardNavigation={currentActiveTab === "previews"}
                />
              </div>
            </div>
          </Tabs.Panel>
        )}
      </Tabs>
    </Paper>
  );
};

export default TestLiveView;
