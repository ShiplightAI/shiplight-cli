import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tabs, Paper, Text, Box, ActionIcon, Button, Group, Badge, Popover, Stack, Divider } from '@mantine/core';
import { useTranslations } from 'next-intl';
import { IconLayoutSidebarRightExpand, IconPointerSearch, IconLayoutSidebarRightCollapse, IconPlayerRecord, IconPlayerStop, IconRefresh, IconGripVertical, IconTarget, IconPlayerStopFilled, IconPlayerRecordFilled } from '@tabler/icons-react';
import { appEventBus, useAppEvent } from '@/utils/appEventBus';
import { startRecorder, stopRecorder } from '@/hooks/useIntRunner';
import { TestSessionInfo } from '@/services/sandboxService';
import { ActionEntity, convertPlaywrightActionToEntity, generateUid } from 'shiplight-types';
import DraggableToolbar, { ToolbarAction } from '@/components/common/DraggableToolbar';

interface PageTarget {
  targetId: string;
  url: string;
  title: string;
  type: string;
}

interface MultiPageViewerProps {
  liveviewUrl: string;
  className?: string;
  session?: TestSessionInfo;
  hideRecorderToolbar?: boolean;
}

const MultiPageViewer: React.FC<MultiPageViewerProps> = ({
  liveviewUrl,
  className,
  session,
  hideRecorderToolbar = false,
}) => {
  const t = useTranslations('TestCases');
  const [pages, setPages] = useState<PageTarget[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const [panelVisible, setPanelVisible] = useState<Record<string, boolean>>({});
  const [hoveredLocator, setHoveredLocator] = useState<string>('');
  const [pickingRequestId, setPickingRequestId] = useState<string>(''); // Track current picking request
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingStatus, setRecordingStatus] = useState<'idle' | 'starting' | 'recording' | 'stopping' | 'error'>('idle');
  const [recordedActions, setRecordedActions] = useState<ActionEntity[]>([]);
  const lastRecordedStatementUidRef = useRef<string | null>(null); // Track the UID of the last recorded statement (use ref to avoid re-renders)
  const [containerBounds, setContainerBounds] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const retryCount = useRef(0);
  const maxRetries = 5;
  const recorderAbortController = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Extract host and protocol from liveviewUrl for devtools URL construction
  const getDevtoolsBaseUrl = useCallback(() => {
    try {
      const url = new URL(liveviewUrl.replace('ws://', 'http://').replace('wss://', 'https://'));
      const protocol = liveviewUrl.startsWith('wss://') ? 'wss' : 'ws';
      return {
        host: url.host,
        protocol,
        path: url.pathname,
        search: url.search  // Preserve query parameters (includes organizationId and endpoint)
      };
    } catch (error) {
      console.error('Invalid liveviewUrl:', error);
      return null;
    }
  }, [liveviewUrl]);

  const constructDevtoolsUrl = useCallback((targetId: string) => {
    const baseUrl = getDevtoolsBaseUrl();
    if (!baseUrl) return null;

    // Construct the devtools inspector URL with the WebSocket endpoint
    // Include query parameters (organizationId, endpoint, etc.) for proper cluster routing
    const wsEndpoint = `${baseUrl.host}${baseUrl.path}/page/${targetId}${baseUrl.search}`;
    return `/devtools/inspector.html?${baseUrl.protocol}=${encodeURIComponent(wsEndpoint)}`;
  }, [getDevtoolsBaseUrl]);

  const togglePanel = useCallback((targetId: string, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation(); // Prevent tab selection when clicking the toggle
    }

    const newVisibility = !panelVisible[targetId]; // Toggle from current state
    setPanelVisible(prev => ({ ...prev, [targetId]: newVisibility }));

    // Send message to iframe to toggle panel
    const iframe = iframeRefs.current[targetId];
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'togglePanel',
        show: newVisibility
      }, '*');
    }
  }, [panelVisible]);

  // Emit recorded action via appEventBus (following picker element pattern)
  const emitRecordedAction = useCallback((actionEntity: ActionEntity) => {
    console.log('🎬 Emitting recorded action via appEventBus:', actionEntity.action_description);
    
    // Generate a new statement UID for this action
    const statementUid = generateUid();
    lastRecordedStatementUidRef.current = statementUid;
    console.log('🆔 Generated statement UID:', statementUid);
    
    // Emit event for the editor to handle
    appEventBus.emit('recorder:action-recorded', {
      actionEntity,
      statementUid
    });
    
    console.log('✅ Recorded action emitted:', actionEntity.action_description);
  }, []);

  // Emit action update via appEventBus
  const emitActionUpdate = useCallback((actionEntity: ActionEntity) => {
    console.log('🔄 Emitting action update via appEventBus:', actionEntity.action_description);
    console.log('🔍 Using statement UID:', lastRecordedStatementUidRef.current);
    
    // Emit update event for the editor to handle, including the statement UID
    appEventBus.emit('recorder:action-updated', {
      actionEntity,
      statementUid: lastRecordedStatementUidRef.current || undefined
    });
    
    console.log('✅ Action update emitted:', actionEntity.action_description);
  }, []);

  // Handle recorder events
  const handleRecorderEvent = useCallback((event: any) => {
    console.log('🎬 Recorder event received:', event);

    try {
    switch (event.type) {
        case 'actionAdded':
          if (event.action && event.code) {
            const actionEntity = convertPlaywrightActionToEntity(event.action, event.code);
            setRecordedActions(prev => [...prev, actionEntity]);
            emitRecordedAction(actionEntity);
            console.log('✅ Action added:', actionEntity.action_description);
          } else {
            console.warn('⚠️ actionAdded event missing action or code:', event);
          }
          break;

        case 'actionUpdated':
          if (event.action && event.code) {
            const actionEntity = convertPlaywrightActionToEntity(event.action, event.code);
            // Update the last recorded action instead of adding a new one
            setRecordedActions(prev => {
              const updated = [...prev];
              if (updated.length > 0) {
                updated[updated.length - 1] = actionEntity;
              }
              return updated;
            });
            
            // Emit update event to notify TestFlowEditor
            // Note: This will update the last added action in the test flow
            emitActionUpdate(actionEntity);
            
            console.log('🔄 Action updated:', actionEntity.action_description);
          } else {
            console.warn('⚠️ actionUpdated event missing action or code:', event);
          }
          break;
      }
    } catch (error) {
      console.error('❌ Error handling recorder event:', error, event);
      setRecordingStatus('error');
      setIsRecording(false);
    }
  }, [emitRecordedAction, emitActionUpdate]);

  // Start recorder
  const handleStartRecorder = useCallback(async () => {
    if (!session) {
      console.error('Cannot start recorder: no session available');
      return;
    }

    try {
      setRecordingStatus('recording');
      setIsRecording(true);
      setRecordedActions([]);

      // Create abort controller for this recording session
      recorderAbortController.current = new AbortController();

      await startRecorder(
        session,
        handleRecorderEvent,
        undefined, // testIdAttributeName - can be configured later
        recorderAbortController.current.signal
      );
    } catch (error) {
      console.error('Failed to start recorder:', error);
      setRecordingStatus('error');
      setIsRecording(false);
      stopRecorder(session);
    }
  }, [session, handleRecorderEvent]);

  // Stop recorder
  const handleStopRecorder = useCallback(async () => {
    if (!session) {
      console.error('Cannot stop recorder: no session available');
      return;
    }

    try {
      setRecordingStatus('stopping');

      // Abort the recorder stream
      if (recorderAbortController.current) {
        recorderAbortController.current.abort();
        recorderAbortController.current = null;
      }

      await stopRecorder(session);
      setRecordingStatus('idle');
      setIsRecording(false);
    } catch (error) {
      console.error('Failed to stop recorder:', error);
      setRecordingStatus('error');
      setIsRecording(false);
    }
  }, [session]);

  // Handle picker element action from toolbar
  // Instead of directly starting the picker, emit an event for components
  // with proper context (like DebuggerContext) to handle
  const handlePickerElement = useCallback(() => {
    if (!session || !activeTab) return;
    
    // Emit event to request picker activation
    // The component with DebuggerContext (e.g., TestFlowEditor) should listen
    // and emit 'locator:request-pick' with the correct statementId
    appEventBus.emit('toolbar:picker-requested', {
      // Just notify that picker was requested from toolbar
    });
    
    console.log('🎯 Picker requested from toolbar');
  }, [session, activeTab]);

  const handleStopPicker = useCallback(() => {
    console.log('🚫 Stopping picker', pickingRequestId);
    if (activeTab && iframeRefs.current[activeTab]) {
      const iframe = iframeRefs.current[activeTab];
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'cancelPickLocator'
        }, '*');
      }
    }
    if (!pickingRequestId) return;
    appEventBus.emit('locator:pick-cancelled', {
      statementId: pickingRequestId
    });
    setPickingRequestId('');
  }, [pickingRequestId, activeTab]);

  // Update container bounds when component mounts or resizes
  useEffect(() => {
    const updateBounds = () => {
      if (containerRef.current) {
        // Use offsetWidth and offsetHeight for container dimensions
        setContainerBounds({ 
          width: containerRef.current.offsetWidth, 
          height: containerRef.current.offsetHeight 
        });
      }
    };

    updateBounds();
    window.addEventListener('resize', updateBounds);
    return () => window.removeEventListener('resize', updateBounds);
  }, []);

  // Initialize WebSocket connection
  useEffect(() => {
    // Clean up function to close WebSocket and clear timeouts
    const cleanup = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      // Clean up recorder if active
      if (recorderAbortController.current) {
        recorderAbortController.current.abort();
        recorderAbortController.current = null;
      }
      setConnectionStatus('disconnected');
    };

    // Skip if the liveviewUrl is empty (similar to ScreencastViewer)
    if (!liveviewUrl) {
      cleanup();
      setPages([]);
      setActiveTab(null);
      retryCount.current = 0;
      setReconnectTrigger(0); // Reset reconnection trigger
      return;
    }

    // Connect to WebSocket
    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(liveviewUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // console.log('✅ Connected to CDP browser endpoint');
        setConnectionStatus('connected');
        retryCount.current = 0;

        // Enable target discovery
        ws.send(JSON.stringify({
          id: 1,
          method: 'Target.setDiscoverTargets',
          params: { discover: true }
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.method === 'Target.targetCreated') {
            const targetInfo = msg.params.targetInfo;
            if (targetInfo.type === 'page') {
              // console.log('🎯 Page target created:', targetInfo);
              const newPage: PageTarget = {
                targetId: targetInfo.targetId,
                url: targetInfo.url,
                title: targetInfo.title || 'Untitled Page',
                type: targetInfo.type
              };

              setPages(prev => {
                const exists = prev.some(p => p.targetId === newPage.targetId);
                if (!exists) {
                  const updated = [...prev, newPage];
                  // Always set newly created tab as active
                  setActiveTab(newPage.targetId);
                  return updated;
                }
                return prev;
              });
            }
          } else if (msg.method === 'Target.targetInfoChanged') {
            const targetInfo = msg.params.targetInfo;
            if (targetInfo.type === 'page') {
              // console.log('📝 Page target info changed:', targetInfo);
              setPages(prev => {
                return prev.map(page =>
                  page.targetId === targetInfo.targetId
                    ? {
                        ...page,
                        url: targetInfo.url,
                        title: targetInfo.title || 'Untitled Page'
                      }
                    : page
                );
              });
            }
          } else if (msg.method === 'Target.targetDestroyed') {
            const targetId = msg.params.targetId;
            console.log('🗑️ Page target destroyed:', targetId);

            // Update pages and handle active tab selection
            setPages(prev => {
              const updated = prev.filter(p => p.targetId !== targetId);

              // Use setActiveTab with updater function to avoid stale closure
              setActiveTab(currentActiveTab => {
                if (currentActiveTab === targetId) {
                  // If the closed tab was active, select the first available tab (front tab)
                  if (updated.length > 0) {
                    return updated[0].targetId;
                  } else {
                    return null;
                  }
                }
                // If a different tab was closed, keep current active tab
                return currentActiveTab;
              });

              return updated;
            });

            // Clean up iframe ref and panel visibility state
            delete iframeRefs.current[targetId];
            setPanelVisible((prevVisible) => {
              const newVisible = { ...prevVisible };
              delete newVisible[targetId];
              return newVisible;
            });
          } else if (msg.method === 'Inspector.detached') {
            console.log('🔌 Inspector detached - browser likely closed');
            setConnectionStatus('disconnected');
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        // console.log('🚪 WebSocket connection closed');
        setConnectionStatus('disconnected');

        // Only attempt to reconnect if we still have a valid liveviewUrl
        // and haven't exceeded max retries
        if (liveviewUrl && retryCount.current < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30000);
          retryCount.current++;

          reconnectTimeoutRef.current = setTimeout(() => {
            // Double-check liveviewUrl is still valid before reconnecting
            if (liveviewUrl) {
              // console.log(`Attempting to reconnect (${retryCount.current}/${maxRetries})...`);
              // Trigger reconnection by updating state
              setReconnectTrigger(prev => prev + 1);
            }
          }, delay);
        }
      };

      ws.onerror = (error) => {
        // console.error('❌ WebSocket error:', error);
        setConnectionStatus('disconnected');
      };

      // Clean up when component unmounts or URL changes
      return cleanup;
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setConnectionStatus('disconnected');
      return cleanup;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveviewUrl, reconnectTrigger]); // Include reconnectTrigger to handle reconnections

  // Listen for locator pick requests from ActionStatement
  useAppEvent('locator:request-pick', (payload) => {
    setPickingRequestId(payload.statementId);

    // Send message to active DevTools iframe to start picking
    if (activeTab && iframeRefs.current[activeTab]) {
      const iframe = iframeRefs.current[activeTab];
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'startPickLocator',
          language: payload.language || 'JavaScript'
        }, '*');
      }
    }
  }, [activeTab]);

  // Listen for messages from DevTools iframes
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Filter out React DevTools and other noise
      if (!event.data || typeof event.data !== 'object') {
        return;
      }

      if (event.data.source && event.data.source.includes('react-devtools')) {
        return;
      }

      // Handle locator-related messages
      switch (event.data.type) {
        case 'locatorHover':
          setHoveredLocator(event.data.locator || '');
          break;
        case 'pickingStopped':
          console.log('[MultiPageViewer] pickingStopped received, pickingRequestId:', pickingRequestId);
          setHoveredLocator(''); // Clear hover when picking stops
          if (pickingRequestId) {
            // Notify that picking was cancelled
            console.log('[MultiPageViewer] Emitting locator:pick-cancelled');
            appEventBus.emit('locator:pick-cancelled', {
              statementId: pickingRequestId
            });
            setPickingRequestId('');
          }
          break;
        case 'locatorGenerated':
          console.log('[MultiPageViewer] locatorGenerated received, pickingRequestId:', pickingRequestId);
          setHoveredLocator(''); // Clear hover when locator is selected
          if (pickingRequestId && event.data.locator) {
            // Forward the picked locator back to the ActionStatement
            console.log('[MultiPageViewer] Emitting locator:picked');
            appEventBus.emit('locator:picked', {
              statementId: pickingRequestId,
              locator: event.data.locator,
              language: event.data.language || 'JavaScript'
            });
            setPickingRequestId('');
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [pickingRequestId]);

  return (
    <Paper
      withBorder
      className={className}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0
      }}
    >
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
      {pages.length === 0 ? (
        <Box p="md" ta="center">
          <Text c="dimmed">
            {connectionStatus === 'connected' ? t('multiPageViewer.noPagesOpen') : t('multiPageViewer.connectingToBrowser')}
          </Text>
        </Box>
      ) : (
        <Tabs
          value={activeTab}
          onChange={setActiveTab}
          styles={{
            root: {
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0 // Allow flex item to shrink
            },
            panel: {
              flex: 1,
              padding: 0,
              margin: 0,
              height: 0, // Use 0 instead of 100% with flex: 1
              overflow: 'hidden',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column'
            },
            list: {
              flexShrink: 0,
            }
          }}
        >
          <Tabs.List justify="center" style={{ position: 'relative' }}>

            {/* Inspector button on the right side */}
            {activeTab && (
              <Button
                size="xs"
                variant="subtle"
                onClick={() => togglePanel(activeTab)}
                leftSection={
                  panelVisible[activeTab] ? (
                    <IconLayoutSidebarRightCollapse size={14} />
                  ) : (
                    <IconLayoutSidebarRightExpand size={14} />
                  )
                }
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 2
                }}
              >
                {panelVisible[activeTab] ? t('multiPageViewer.closeInspector') : t('multiPageViewer.openInspector')}
              </Button>
            )}

            {/* Show hovered locator or picking status on the far left */}
            {(hoveredLocator || pickingRequestId) && (
              <Box
                style={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  zIndex: 1
                }}
              >
                {pickingRequestId && !hoveredLocator && (
                  <>
                    <Text size="xs" c="dimmed">
                      {t('multiPageViewer.pickingLocator')}
                    </Text>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      onClick={() => {
                        // Cancel picking
                        if (activeTab && iframeRefs.current[activeTab]) {
                          const iframe = iframeRefs.current[activeTab];
                          if (iframe && iframe.contentWindow) {
                            iframe.contentWindow.postMessage({
                              type: 'cancelPickLocator'
                            }, '*');
                          }
                        }
                        // Notify ActionStatement if picking for a statement
                        if (pickingRequestId) {
                          appEventBus.emit('locator:pick-cancelled', {
                            statementId: pickingRequestId
                          });
                          setPickingRequestId('');
                        }
                      }}
                      title={t('multiPageViewer.cancelLocatorPicking')}
                    >
                      ✕
                    </ActionIcon>
                  </>
                )}
                {hoveredLocator && (
                  <Text
                    size="xs"
                    c="dimmed"
                    truncate
                    style={{
                      maxWidth: '300px',
                      fontFamily: 'monospace',
                      fontSize: '11px',
                    }}
                  >
                    {hoveredLocator}
                  </Text>
                )}
              </Box>
            )}

            {pages.map((page) => (
              <Tabs.Tab
                  key={page.targetId}
                  value={page.targetId}
                >
                  <Text size="xs" truncate style={{ maxWidth: 150 }}>
                    {page.title || new URL(page.url).hostname}
                  </Text>
                </Tabs.Tab>
            ))}
          </Tabs.List>

          {pages.map((page) => {
            const devtoolsUrl = constructDevtoolsUrl(page.targetId);

            return (
              <Tabs.Panel
                key={page.targetId}
                value={page.targetId}
              >
                {devtoolsUrl ? (
                  <iframe
                    ref={(el) => { iframeRefs.current[page.targetId] = el; }}
                    src={devtoolsUrl}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      display: 'block'
                    }}
                    title={`DevTools - ${page.title}`}
                  />
                ) : (
                  <Box p="md" ta="center">
                    <Text c="red">Failed to construct DevTools URL</Text>
                  </Box>
                )}
              </Tabs.Panel>
            );
          })}
        </Tabs>
      )}

      {/* Draggable Recorder Toolbar */}
      {session && !hideRecorderToolbar && (
        <DraggableToolbar
          showDragHandle={false}
          actions={[
            {
              id: 'record',
              label: isRecording ? t('multiPageViewer.recording') : t('multiPageViewer.record'),
              description: isRecording ? t('multiPageViewer.clickToStopRecording') : t('multiPageViewer.clickToStartRecording'),
              icon: isRecording ? <IconPlayerStopFilled color="red" size={14} /> : <IconPlayerRecordFilled color="green" size={14} />,
              onClick: isRecording ? handleStopRecorder : handleStartRecorder,
              color: isRecording ? 'red' : 'red',
              variant: 'filled'
            },
            {
              id: 'picker',
              label: pickingRequestId ? t('multiPageViewer.picking') : t('multiPageViewer.pick'),
              description: pickingRequestId ? t('multiPageViewer.clickToStopPicking') : t('multiPageViewer.clickToStartPicking'),
              icon: <IconPointerSearch color={pickingRequestId ? 'orange' : undefined} size={14} />,
              onClick: pickingRequestId ? handleStopPicker : handlePickerElement,
              color: pickingRequestId ? 'orange' : 'blue',
              variant: pickingRequestId ? 'filled' : 'outline'
            }
          ]}
          initialPosition="center"
          containerBounds={containerBounds}
        />
      )}
      </div>
    </Paper>
  );
};

export default MultiPageViewer;
