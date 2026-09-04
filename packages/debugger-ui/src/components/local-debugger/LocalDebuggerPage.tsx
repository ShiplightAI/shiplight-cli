/**
 * LocalDebuggerPage — standalone page for `npx shiplight debug`.
 *
 * Fetches the YAML test flow from the local server, renders the step editor
 * and saves changes back to the YAML file.
 * Supports both single-test and suite YAML files.
 *
 * Includes a file tree sidebar for browsing and selecting .test.yaml files.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader, Center, Text, Stack, Button } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import type { TestFlow } from "shiplight-types";
import { TestCase } from "@/common/models/testCase";

import { TestFlowEditorController } from "../testcase/TestFlowEditorController";
import { SuiteSectionDivider } from "../testcase/editor/SuiteSectionDivider";
import {
  flattenTestGroupToTestFlow,
  unflattenTestFlowToTestGroup,
  type SuiteDivider,
} from "../testcase/utils/testGroupUtils";
import { localIntRunnerApi, getLiveviewUrl } from "./localIntRunner";
import type { NetworkResponse } from "../testcase/types/debugger";
import type { TestLiveViewTab } from "../testcase/TestLiveView";
import { PreviewPanel } from "../testcase/ResizableTestEditor";
import type { ConfigChangeSource } from "../testcase/TestInfoView";
import { FileTreeSidebar } from "./FileTreeSidebar";
import { useIsEmbedded } from "./useIsEmbedded";
import { apiUrl } from "../../utils/apiBase";
import type { TestSessionInfo } from "../../services/sandboxService";

interface ApiResponse {
  isSuite: boolean;
  testFlow: TestFlow;
  metadata: {
    goal?: string;
    startingUrl?: string;
    config?: Record<string, unknown>;
    test_case_id?: number;
    name?: string;
    timeout?: number;
    skip?: boolean | string;
  };
  name?: string;
  tags?: string[];
  use?: Record<string, unknown>;
  parameters?: unknown[];
  filePath: string;
  fileName?: string;
}

function useLocalTestFlow(file: string | null) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTestFlow = useCallback(async () => {
    if (!file) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const url = apiUrl(`/api/test-flow?file=${encodeURIComponent(file)}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load test flow: ${res.statusText}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [file]);

  useEffect(() => {
    fetchTestFlow();
  }, [fetchTestFlow]);

  const saveWithData = useCallback(
    async (snapshot: ApiResponse, newTestFlow: TestFlow) => {
      if (!file) return;

      // Strip default values from use before persisting
      let cleanUse = snapshot.use ? { ...snapshot.use } : undefined;
      if (cleanUse) {
        if (cleanUse.autoDismissModal === false) delete cleanUse.autoDismissModal;
        if (Object.keys(cleanUse).length === 0) cleanUse = undefined;
      }

      const metadata = snapshot.isSuite
        ? { name: snapshot.name, tags: snapshot.tags, use: cleanUse, ...snapshot.metadata }
        : { ...snapshot.metadata, tags: snapshot.tags, use: cleanUse };
      const url = apiUrl(`/api/test-flow?file=${encodeURIComponent(file)}`);
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testFlow: newTestFlow, metadata }),
      });
      if (!res.ok) throw new Error(`Failed to save: ${res.statusText}`);
    },
    [file],
  );

  const saveTestFlow = useCallback(
    async (newTestFlow: TestFlow) => {
      if (!data) return;
      await saveWithData(data, newTestFlow);
      if (data.isSuite) {
        await fetchTestFlow();
      } else {
        setData((prev) => prev ? { ...prev, testFlow: newTestFlow } : prev);
      }
    },
    [data, saveWithData, fetchTestFlow],
  );

  return { data, setData, loading, error, saveTestFlow, saveWithData, refetch: fetchTestFlow };
}

interface TestScreenshot {
  url: string;
  label: string;
  stepId?: string;
}

interface TestResultData {
  videoPath: string | null;
  screenshots: TestScreenshot[];
}

function useLocalTestResults(file: string | null) {
  const [data, setData] = useState<TestResultData | null>(null);

  useEffect(() => {
    if (!file) {
      setData(null);
      return;
    }
    const url = apiUrl(`/api/test-results?file=${encodeURIComponent(file)}`);
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setData(json))
      .catch(() => setData(null));
  }, [file]);

  return data;
}

/** Fetch initial config from the server: directory, file, and project root. */
function useInitialConfig() {
  const [config, setConfig] = useState<{
    initialDir: string;
    initialFile: string | null;
    projectRoot: string;
  } | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/files"))
      .then((res) => res.json())
      .then((data) => {
        setConfig({
          initialDir: data.dir,
          initialFile: data.initialFile ?? null,
          projectRoot: data.projectRoot ?? data.dir,
        });
      })
      .catch(() => {});
  }, []);

  return config;
}


class EditorErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Editor render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <Center style={{ flex: 1 }}>
          <Stack align="center" gap="sm">
            <Text size="lg" c="red">Something went wrong</Text>
            <Text size="sm" c="dimmed" style={{ maxWidth: 400, textAlign: "center" }}>
              {this.state.error.message}
            </Text>
            <Button
              variant="light"
              color="blue"
              onClick={() => this.setState({ error: null })}
            >
              Retry
            </Button>
          </Stack>
        </Center>
      );
    }
    return this.props.children;
  }
}

const DEFAULT_SIDEBAR_WIDTH = 300;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 600;

const DEFAULT_EDITOR_WIDTH = 540;
const MIN_EDITOR_WIDTH = 360;
const MAX_EDITOR_WIDTH = 900;
// Below this width the debugger button bar can no longer fit label+icon
// without wrapping/clipping, so we switch it to icon-only mode. Mirrors
// LEFT_PANNEL_MIN_WIDTH_FOR_DEBUGGER_BAR in tabs/NewStepEditor.tsx.
const ICON_ONLY_DEBUGGER_BAR_BELOW = 514;

/** Read the file path stored in the URL hash, resolved against projectRoot. */
function getFileFromHash(projectRoot: string): string | null {
  let raw: string;
  try {
    raw = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return null;
  }
  if (!raw) return null;
  // Already absolute (legacy or same-machine reload)
  if (raw.startsWith("/")) return raw;
  // Relative — resolve against projectRoot
  return `${projectRoot.replace(/\/$/, "")}/${raw}`;
}

/** Write a file path into the URL hash, relative to projectRoot when possible. */
function setFileHash(filePath: string | null, projectRoot: string) {
  try {
    const url = new URL(window.location.href);

    if (!filePath) {
      url.hash = "";
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      return;
    }

    const prefix = projectRoot.endsWith("/") ? projectRoot : `${projectRoot}/`;
    const relative = filePath.startsWith(prefix)
      ? filePath.slice(prefix.length)
      : filePath;
    url.hash = encodeURIComponent(relative);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (error) {
    // VS Code webviews can reject history mutations if they consider the URL
    // cross-origin. Hash sync is optional, so fail open instead of breaking the UI.
    console.warn("Failed to sync local debugger file path to URL hash:", error);
  }
}

export function LocalDebuggerPage() {
  const config = useInitialConfig();
  // Embedded mode: the testbox's `/debugger/:sessionId/` iframe sets
  // `?embedded=1` — when true, we hide the file-tree sidebar and any other
  // file-navigation chrome (FR-013). OmniTerm's file explorer is the single
  // source of file navigation in that context.
  const isEmbedded = useIsEmbedded();
  const [treeRoot, setTreeRoot] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [session, setSession] = useState<TestSessionInfo | null>(null);
  const [liveviewUrl, setLiveviewUrl] = useState<string>("");
  const [liveviewUrlType, setLiveviewUrlType] = useState<string | undefined>(undefined);
  const [previewImages, setPreviewImages] = useState<Array<{ url: string; label: string }>>([]);
  const [activeTab, setActiveTab] = useState<TestLiveViewTab>("live");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [testContextInfo, setTestContextInfo] = useState<{ testContext?: Record<string, unknown>; stdout: string[] } | null>(null);
  const [editorWidth, setEditorWidth] = useState(DEFAULT_EDITOR_WIDTH);
  const hasActiveSession = !!session;
  const draggingRef = useRef(false);
  const liveviewDraggingRef = useRef(false);
  // Mirrors liveviewDraggingRef into render state so we can disable pointer
  // events on the right-pane iframe during drag — without it the iframe
  // swallows mousemove events and the drag stalls.
  const [isLiveviewDragging, setIsLiveviewDragging] = useState(false);
  const restoredRef = useRef(false);

  // Initialize tree root from project root (or initialDir as fallback)
  useEffect(() => {
    if (config && treeRoot === null) {
      setTreeRoot(config.projectRoot);
    }
  }, [config, treeRoot]);

  // Restore selected file on initial load: prefer URL hash, then yamlPath query param
  // (set by the shell's iframe), then server's initialFile.
  useEffect(() => {
    if (config && !restoredRef.current) {
      restoredRef.current = true;
      const fromHash = getFileFromHash(config.projectRoot);
      const fromQuery = isEmbedded
        ? new URLSearchParams(window.location.search).get("yamlPath")
        : null;
      const file = fromHash || fromQuery || config.initialFile;
      if (file) {
        setSelectedFile(file);
        if (!fromHash) setFileHash(file, config.projectRoot);
      }
    }
  }, [config, isEmbedded]);

  // Sync selected file to URL hash
  const selectFile = useCallback(
    (file: string | null) => {
      setSelectedFile(file);
      if (config) setFileHash(file, config.projectRoot);
    },
    [config],
  );

  const { data, setData, loading, error, saveTestFlow, saveWithData } = useLocalTestFlow(selectedFile);
  const testResults = useLocalTestResults(selectedFile);

  // Populate video from last run results when available
  useEffect(() => {
    if (!testResults) return;
    if (testResults.videoPath) {
      setVideoUrl(apiUrl(testResults.videoPath));
    }
    // Show all screenshots initially (before any step is clicked)
    if (testResults.screenshots.length > 0) {
      setPreviewImages(testResults.screenshots.map((s) => ({
        url: apiUrl(s.url),
        label: s.label,
      })));
    }
  }, [testResults]);

  // When a step is clicked, show its before/after screenshots
  const handleStatementClick = useCallback((statementUid: string) => {
    if (!testResults?.screenshots?.length) return;
    const matching = testResults.screenshots.filter((s) => s.stepId === statementUid);
    if (matching.length === 0) {
      setPreviewImages([]);
      return;
    }
    // Sort so "before" comes first, "after" second
    matching.sort((a, b) => b.label.localeCompare(a.label));
    const images = matching.map((s) => ({
      url: apiUrl(s.url),
      label: s.label === "before" ? "Before" : s.label === "after" ? "After" : s.label,
    }));
    setPreviewImages(images);
    setActiveTab("previews");
  }, [testResults]);

  const handleLiveviewUrl = useCallback((url: string | undefined, type: string | undefined) => {
    setLiveviewUrl(url ?? "");
    setLiveviewUrlType(type);
  }, []);
  const handleNetworkResponse = useCallback((data: NetworkResponse) => {
    if (!data) return;
    const testContext = data.testContext;
    let newStdoutLines: string[] = [];
    if (data.stdout) {
      newStdoutLines = Array.isArray(data.stdout) ? data.stdout : [data.stdout];
    }
    if (data.details && typeof data.details === "string" && !newStdoutLines.includes(data.details)) {
      newStdoutLines.push(data.details);
    }
    if (testContext || newStdoutLines.length > 0) {
      setTestContextInfo((prev) => {
        const currentStdout = prev?.stdout || [];
        const updatedStdout = [...currentStdout];
        newStdoutLines.forEach((line) => {
          if (!updatedStdout.includes(line)) {
            updatedStdout.push(line);
          }
        });
        return {
          testContext: testContext ? JSON.parse(JSON.stringify(testContext)) : prev?.testContext,
          stdout: updatedStdout,
        };
      });
    }
  }, []);
  const handlePreviewImages = useCallback((images: Array<{ url: string; label: string }>) => {
    if (images.length > 0) {
      setPreviewImages(images);
      setActiveTab("previews");
    }
  }, []);
  const handleSetActiveTab = useCallback((tab: TestLiveViewTab | null) => {
    if (tab) setActiveTab(tab);
  }, []);
  const handleSessionChange = useCallback(async (newSession: TestSessionInfo | null) => {
    setSession(newSession);
    if (newSession) {
      try {
        const { liveviewUrl: url } = await getLiveviewUrl(newSession);
        setLiveviewUrl(url);
        setLiveviewUrlType("browser");
        setActiveTab("live");
      } catch {
        setLiveviewUrl("");
      }
    } else {
      setLiveviewUrl("");
      setLiveviewUrlType(undefined);
      setTestContextInfo(null);
    }
  }, []);

  // Build TestCase, divider map, and clone UID map — works for both single-test and suite
  const { testCase, dividerMap, cloneUidMap } = useMemo<{
    testCase: TestCase | null;
    dividerMap: Map<string, SuiteDivider> | null;
    cloneUidMap: Map<string, string> | null;
  }>(() => {
    if (!data) return { testCase: null, dividerMap: null, cloneUidMap: null };

    let testFlow: TestFlow;
    let dividers: Map<string, SuiteDivider> | null = null;
    let cloneMap: Map<string, string> | null = null;

    if (data.testFlow.testGroup) {
      const result = flattenTestGroupToTestFlow(data.testFlow.testGroup);
      testFlow = result.testFlow;
      dividers = result.dividerMap;
      cloneMap = result.cloneUidMap;
    } else {
      testFlow = data.testFlow;
    }

    const goal = data.testFlow.testGroup
      ? (data.name || 'Suite')
      : (data.metadata.goal || data.testFlow.goal || 'Local Test');

    const tc = new TestCase(
      "local", 1, goal,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, [], undefined, undefined,
      testFlow,
    );

    return { testCase: tc, dividerMap: dividers, cloneUidMap: cloneMap };
  }, [data]);

  const testConfigInfo = useMemo(() => {
    if (!data) return null;
    return {
      name: data.name,
      goal: data.metadata?.goal || data.testFlow?.goal,
      baseURL: data.testFlow?.baseURL || (data.use?.baseURL as string | undefined),
      tags: data.tags,
      use: data.use,
      parameters: data.parameters,
      timeout: data.metadata?.timeout,
      skip: data.metadata?.skip,
      fileName: data.fileName,
    };
  }, [data]);

  const handleConfigChange = useCallback((key: string, value: unknown, source: ConfigChangeSource) => {
    configDirtyRef.current = true;
    setData((prev) => {
      if (!prev) return prev;
      if (source === "use") {
        return { ...prev, use: { ...prev.use, [key]: value } };
      }
      if (source === "top") {
        return { ...prev, [key]: value } as ApiResponse;
      }
      return prev;
    });
  }, [setData]);

  // Auto-save config changes to YAML whenever data.use or data.tags change.
  // configDirtyRef tracks whether a change came from handleConfigChange (user edit)
  // vs. initial data load or file switch, to avoid saving on load.
  const configDirtyRef = useRef(false);
  useEffect(() => {
    if (!data || !configDirtyRef.current) return;
    configDirtyRef.current = false;
    saveWithData(data, data.testFlow).catch((e: unknown) => console.error("[debugger] Config save error:", e));
  }, [data, saveWithData]);

  // Render section dividers between statements for suites
  const renderBetweenStatements = useCallback(
    (_beforeUid: string | undefined, afterUid: string | undefined): React.ReactNode => {
      if (!afterUid || !dividerMap) return null;
      const divider = dividerMap.get(`before:${afterUid}`);
      if (!divider) return null;
      return <SuiteSectionDivider type={divider.type} label={divider.label} skip={divider.skip} />;
    },
    [dividerMap],
  );

  // Suite save: unflatten the modified TestFlow back to test group structure
  const handleSave = useCallback(
    async (newTestFlow: TestFlow) => {
      if (!data) return;
      const originalGroup = data.testFlow.testGroup;
      if (originalGroup && cloneUidMap) {
        const updatedGroup = unflattenTestFlowToTestGroup(newTestFlow, originalGroup, cloneUidMap);
        await saveTestFlow({ ...data.testFlow, testGroup: updatedGroup });
      } else {
        await saveTestFlow(newTestFlow);
      }
    },
    [data, cloneUidMap, saveTestFlow],
  );

  // Draggable divider between editor and live view panel
  const handleLiveviewDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    liveviewDraggingRef.current = true;
    setIsLiveviewDragging(true);
    const startX = e.clientX;
    const startWidth = editorWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!liveviewDraggingRef.current) return;
      const newWidth = Math.min(MAX_EDITOR_WIDTH, Math.max(MIN_EDITOR_WIDTH, startWidth + (ev.clientX - startX)));
      setEditorWidth(newWidth);
    };

    const onMouseUp = () => {
      liveviewDraggingRef.current = false;
      setIsLiveviewDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [editorWidth]);

  // Draggable divider between sidebar and editor
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + ev.clientX - startX));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarWidth]);

  // Editor content
  const renderEditor = () => {
    if (!selectedFile) {
      return (
        <Center style={{ flex: 1 }}>
          <Text size="lg" c="dimmed">Select a test file to start debugging</Text>
        </Center>
      );
    }

    if (loading) {
      return (
        <Center style={{ flex: 1 }}>
          <Loader size="lg" />
        </Center>
      );
    }

    if (error || !data || !testCase) {
      return (
        <Center style={{ flex: 1 }}>
          <Stack align="center" gap="sm">
            <Text size="lg" c="red">Failed to load test flow</Text>
            <Text size="sm" c="dimmed">{error || "No test flow data"}</Text>
          </Stack>
        </Center>
      );
    }

    return (
      <EditorErrorBoundary>
        <TestFlowEditorController
          key={selectedFile}
          intRunner={localIntRunnerApi}
          testCase={testCase}
          onSave={handleSave}
          onReceivedLiveviewUrl={handleLiveviewUrl}
          onNetworkResponse={handleNetworkResponse}
          onReceivePreviewImages={handlePreviewImages}
          onStatementClick={handleStatementClick}
          setActiveTab={handleSetActiveTab}
          onSessionChange={handleSessionChange}
          editingEnabled={true}
          renderBetweenStatements={renderBetweenStatements}
          debuggerButtonIconOnly={editorWidth < ICON_ONLY_DEBUGGER_BAR_BELOW}
          v2
        />
      </EditorErrorBoundary>
    );
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Notifications position="top-right" />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {!isEmbedded && config && !config.initialFile && treeRoot && !hasActiveSession && (
          <>
            <FileTreeSidebar
              treeRoot={treeRoot}
              expandToDir={selectedFile?.includes("/") ? selectedFile.substring(0, selectedFile.lastIndexOf("/")) : config.initialDir}
              selectedFile={selectedFile}
              onSelectFile={selectFile}
              onChangeTreeRoot={setTreeRoot}
              width={sidebarWidth}
              disabled={hasActiveSession}
            />
            {/* Draggable divider */}
            <div
              onMouseDown={handleMouseDown}
              style={{
                width: 4,
                cursor: "col-resize",
                background: "transparent",
                flexShrink: 0,
                borderRight: "1px solid var(--mantine-color-default-border)",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--mantine-color-blue-light)"; }}
              onMouseLeave={(e) => { if (!draggingRef.current) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            />
          </>
        )}
        <div style={{ width: editorWidth, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {renderEditor()}
        </div>
        <div
          onMouseDown={handleLiveviewDividerMouseDown}
          style={{
            width: 4,
            cursor: "col-resize",
            background: "transparent",
            flexShrink: 0,
            borderLeft: "1px solid var(--mantine-color-default-border)",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--mantine-color-blue-light)"; }}
          onMouseLeave={(e) => { if (!liveviewDraggingRef.current) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
        />
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", pointerEvents: isLiveviewDragging ? "none" : "auto" }}>
          <PreviewPanel
            isDebugging={hasActiveSession}
            liveviewUrl={liveviewUrl || undefined}
            liveviewUrlType={liveviewUrlType}
            videoUrl={videoUrl || undefined}
            previewImages={previewImages}
            activeTab={activeTab}
            onTabChange={handleSetActiveTab}
            session={session ?? undefined}
            testContextInfo={testContextInfo}
            testConfigInfo={testConfigInfo}
            onConfigChange={handleConfigChange}
          />
        </div>
      </div>
    </div>
  );
}
