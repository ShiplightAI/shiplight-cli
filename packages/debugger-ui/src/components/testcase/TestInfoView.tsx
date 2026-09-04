import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Text, Tabs, Table, Badge, Switch, TagsInput, Tooltip } from "@mantine/core";
import { IconInfoCircle, IconTerminal, IconSettings } from "@tabler/icons-react";

interface TestContextInfo {
  testContext?: any;
  stdout?: string[];
}

export interface TestConfigInfo {
  name?: string;
  goal?: string;
  baseURL?: string;
  tags?: string[];
  use?: Record<string, unknown>;
  parameters?: unknown[];
  timeout?: number;
  skip?: boolean | string;
  fileName?: string;
}

export type ConfigChangeSource = "use" | "top";

interface EditableConfigField {
  key: string;
  label: string;
  description?: string;
  type: "boolean" | "tags";
  source: ConfigChangeSource;
  defaultValue: unknown;
}

const EDITABLE_FIELDS: EditableConfigField[] = [
  { key: "autoDismissModal", label: "autoDismissModal", description: "Auto-dismiss cookie banners and popups before self-healing", type: "boolean", source: "use", defaultValue: false },
  { key: "tags", label: "tags", description: "Filter and organize tests (e.g. smoke, regression)", type: "tags", source: "top", defaultValue: [] },
];

interface TestInfoViewProps {
  className?: string;
  testContextInfo?: TestContextInfo | null;
  testConfigInfo?: TestConfigInfo | null;
  onConfigChange?: (key: string, value: unknown, source: ConfigChangeSource) => void;
}

// Recursive function to render nested object fields
const renderNestedFields = (
  obj: any,
  parentKey: string = "",
  isNested: boolean = false
): JSX.Element[] => {
  if (!obj || typeof obj !== "object") return [];

  return Object.entries(obj).map(([key, value], index) => {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;

    // Use the original key name without formatting
    const displayKey = key;

    // Special handling for test field - highlight it
    const isTestField = key === "test";
    const keyClassName = `font-semibold ${isNested ? 'pl-4' : ''} ${isTestField ? 'text-blue-600' : ''}`;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // For nested objects, render the parent key first, then the children indented
      return (
        <React.Fragment key={fullKey}>
          <tr>
            <td className={keyClassName}>{displayKey}</td>
            <td>{"{"}</td>
          </tr>
          {renderNestedFields(value, fullKey, true).map((element, i) => (
            <tr key={`${fullKey}-${i}`}>
              <td className="pl-6">{element.props.children[0].props.children}</td>
              <td>{element.props.children[1].props.children}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2}>{"}"}</td>
          </tr>
        </React.Fragment>
      );
    } else {
      // For simple values or arrays, display directly
      let displayValue = value;
      let valueClassName = "font-mono text-xs";

      // Format different types appropriately
      if (Array.isArray(value)) {
        displayValue = JSON.stringify(value);
      } else if (typeof value === "object" && value !== null) {
        displayValue = JSON.stringify(value);
      } else if (typeof value === "number") {
        valueClassName += " text-blue-600 font-bold";
      } else if (typeof value === "boolean") {
        valueClassName += " text-purple-600";
        displayValue = value ? "true" : "false";
      } else if (value === null) {
        valueClassName += " text-gray-500";
        displayValue = "null";
      } else if (typeof value === "string") {
        // Check if the string looks like a number
        if (/^\d+$/.test(value)) {
          // Numeric strings should have the same color as numbers
          valueClassName += " text-blue-600 font-bold";
          displayValue = `"${value}"`;
        }
        // Highlight strings that look like tokens or IDs
        else if (value.length > 20 && /^[a-zA-Z0-9-_]+$/.test(value)) {
          valueClassName += " text-orange-600";
          displayValue = `"${value}"`;
        } else {
          valueClassName += " text-blue-600";
          displayValue = `"${value}"`;
        }
      }

      // Special color for test field values
      if (isTestField) {
        valueClassName = "font-mono text-xs text-blue-600 font-bold";
      }

      return (
        <tr key={fullKey} className="test-context-row">
          <td className={keyClassName}>{displayKey}</td>
          <td className={valueClassName}>{String(displayValue)}</td>
        </tr>
      );
    }
  });
};

// Function to detect console line types and return appropriate styling
const getConsoleLineStyle = (line: string): { className: string; prefix?: string | React.ReactNode } => {
  const normalizedLine = line.toLowerCase();
  
  // Error patterns (highest priority)
  if (normalizedLine.includes('error') || 
      normalizedLine.includes('failed') || 
      normalizedLine.includes('failure') ||
      normalizedLine.includes('exception') ||
      normalizedLine.includes('fatal') ||
      normalizedLine.includes('critical')) {
    return {
      className: "text-red-600 dark:text-red-400 font-medium rounded",
      prefix: '',  
    };
  }
  
  // Warning patterns
  // if (normalizedLine.includes('warning') ||
  //     normalizedLine.includes('warn') ||
  //     normalizedLine.includes('deprecated') ||
  //     normalizedLine.includes('caution')) {
  //   return {
  //     className: "text-console-warning bg-warning px-2 py-1 rounded",
  //     prefix: "⚠️"
  //   };
  // }
  
  // Info patterns
  // if (normalizedLine.includes('info') ||
  //     normalizedLine.includes('debug') ||
  //     normalizedLine.includes('log') ||
  //     normalizedLine.includes('trace')) {
  //   return {
  //     className: "text-console-info",
  //     prefix: "ℹ️"
  //   };
  // }
  
  // Success patterns
  // if (normalizedLine.includes('success') ||
  //     normalizedLine.includes('passed') ||
  //     normalizedLine.includes('complete') ||
  //     normalizedLine.includes('done')) {
  //   return {
  //     className: "text-success-600",
  //     prefix: "✅"
  //   };
  // }
  
  // Default styling - use default text color
  return {
    className: ""
  };
};

const renderConfigRow = (key: string, value: React.ReactNode, valueClassName = "font-mono text-xs text-blue-600"): JSX.Element => (
  <tr key={key} className="test-context-row">
    <td className="font-semibold">{key}</td>
    <td className={valueClassName}>{value}</td>
  </tr>
);

const renderConfigFields = (config: TestConfigInfo): JSX.Element[] => {
  const rows: JSX.Element[] = [];

  if (config.name) {
    rows.push(renderConfigRow("name", `"${config.name}"`));
  }
  if (config.baseURL) {
    rows.push(renderConfigRow("base_url", `"${config.baseURL}"`));
  }

  // Extract read-only fields from use (editable ones are rendered separately)
  if (config.use) {
    const editableKeys = new Set(EDITABLE_FIELDS.filter(f => f.source === "use").map(f => f.key));
    const knownKeys = new Set(["baseURL", "account", "auth", "args", ...editableKeys]);
    const { account, auth, args } = config.use as Record<string, unknown>;

    if (account !== undefined) {
      const accountVal = typeof account === "object" && account !== null
        ? JSON.stringify(account, null, 2)
        : String(account);
      rows.push(renderConfigRow("account", accountVal, "font-mono text-xs text-orange-600 font-bold"));
    }
    if (auth !== undefined) {
      rows.push(renderConfigRow("auth", String(auth), "font-mono text-xs text-orange-600 font-bold"));
      if (args !== undefined) {
        rows.push(renderConfigRow("args", JSON.stringify(args), "font-mono text-xs"));
      }
    }

    // Remaining use fields (excluding editable and known)
    for (const [k, v] of Object.entries(config.use)) {
      if (v === undefined || knownKeys.has(k)) continue;
      const display = typeof v === "object" ? JSON.stringify(v) : String(v);
      rows.push(renderConfigRow(`use.${k}`, display));
    }
  }

  if (config.parameters && config.parameters.length > 0) {
    rows.push(renderConfigRow(
      "parameters",
      `${config.parameters.length} set${config.parameters.length > 1 ? "s" : ""}`,
      "font-mono text-xs text-purple-600",
    ));
    for (const [i, paramSet] of config.parameters.entries()) {
      if (!paramSet || typeof paramSet !== "object") continue;
      const ps = paramSet as { name?: string; values?: Record<string, string> };
      const label = ps.name || `Set ${i + 1}`;
      const values = ps.values;
      if (values && Object.keys(values).length > 0) {
        rows.push(
          <tr key={`param-${i}`} className="test-context-row">
            <td className="font-semibold pl-4">{label}</td>
            <td>
              <div className="flex flex-col gap-0.5 font-mono text-xs">
                {Object.entries(values).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-purple-600">{k}</span>
                    <span className="text-tertiary">: </span>
                    <span className="text-blue-600">{`"${v}"`}</span>
                  </div>
                ))}
              </div>
            </td>
          </tr>
        );
      } else {
        rows.push(renderConfigRow(`  ${label}`, "(empty)", "font-mono text-xs text-gray-500"));
      }
    }
  }

  if (config.timeout) {
    rows.push(renderConfigRow("timeout", `${config.timeout}ms`, "font-mono text-xs text-blue-600 font-bold"));
  }
  if (config.skip !== undefined) {
    const skipVal = typeof config.skip === "string" ? `"${config.skip}"` : String(config.skip);
    rows.push(renderConfigRow("skip", skipVal, "font-mono text-xs text-yellow-600"));
  }

  return rows;
};

const EditableConfigFields: React.FC<{
  config: TestConfigInfo;
  onConfigChange?: (key: string, value: unknown, source: ConfigChangeSource) => void;
}> = ({ config, onConfigChange }) => {
  const getFieldValue = (field: EditableConfigField): unknown => {
    if (field.source === "use") {
      return config.use?.[field.key] ?? field.defaultValue;
    }
    return (config as Record<string, unknown>)[field.key] ?? field.defaultValue;
  };

  return (
    <>
      {EDITABLE_FIELDS.map((field) => {
        const value = getFieldValue(field);

        const labelCell = (
          <td className="font-semibold align-top pt-1">
            <div className="flex items-center gap-1">
              {field.label}
              {field.description && (
                <Tooltip label={field.description} multiline w={220} withArrow>
                  <IconInfoCircle size={14} className="text-tertiary cursor-help flex-shrink-0" />
                </Tooltip>
              )}
            </div>
          </td>
        );

        if (field.type === "boolean") {
          return (
            <tr key={field.key} className="test-context-row">
              {labelCell}
              <td className="align-top pt-1">
                <Switch
                  size="xs"
                  color={value ? "green" : "gray"}
                  checked={!!value}
                  onChange={(e) => onConfigChange?.(field.key, e.currentTarget.checked, field.source)}
                />
              </td>
            </tr>
          );
        }

        if (field.type === "tags") {
          const tags = Array.isArray(value) ? (value as string[]) : [];
          return (
            <tr key={field.key} className="test-context-row">
              {labelCell}
              <td>
                <TagsInput
                  size="xs"
                  value={tags}
                  onChange={(newTags) => onConfigChange?.(field.key, newTags, field.source)}
                  placeholder="Add tag..."
                  styles={{ input: { minHeight: 28 } }}
                />
              </td>
            </tr>
          );
        }

        return null;
      })}
    </>
  );
};

const TestInfoView: React.FC<TestInfoViewProps> = ({ className = "", testContextInfo = null, testConfigInfo = null, onConfigChange }) => {
  const t = useTranslations('TestCases.infoView');
  const [activeTab, setActiveTab] = useState<string | null>(() =>
    testConfigInfo ? "config" : "context"
  );

  useEffect(() => {
    if (!testConfigInfo && activeTab === "config") {
      setActiveTab("context");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to data availability changes, not manual tab switches
  }, [testConfigInfo]);

  const [panelHeight, setPanelHeight] = useState(200); // Default height
  const [isDragging, setIsDragging] = useState(false);
  const [previousHeight, setPreviousHeight] = useState(200);
  const [isCollapsed, setIsCollapsed] = useState(false);
  // Add a counter to force re-renders when context data changes
  const [contextUpdateCounter, setContextUpdateCounter] = useState(0);
  // Add state for console outputs
  const [consoleLines, setConsoleLines] = useState<string[]>([]);

  const dragStartYRef = useRef(0);
  const currentHeightRef = useRef(200);
  const containerRef = useRef<HTMLDivElement>(null);
  const consoleContainerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const hasDragged = useRef(false);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousContextRef = useRef<any>(null);
  const previousStdoutRef = useRef<string[]>([]);

  // Auto-scroll to bottom when console lines change or tab changes
  useEffect(() => {
    if (consoleContainerRef.current && activeTab === "console") {
      consoleContainerRef.current.scrollTop = consoleContainerRef.current.scrollHeight;
    }
  }, [consoleLines, activeTab]);

  // Update the ref when state changes to avoid stale closures
  useEffect(() => {
    currentHeightRef.current = panelHeight;
  }, [panelHeight]);

  // Memoize the update function to prevent recreating on every render
  const updateHeight = useCallback((newHeight: number) => {
    if (containerRef.current) {
      // Update the DOM directly for smoother performance
      containerRef.current.style.height = `${newHeight}px`;

      // Update state only once per frame for React's benefit
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        setPanelHeight(newHeight);
        if (newHeight > 30) {
          setPreviousHeight(newHeight);
          setIsCollapsed(false);
        } else if (newHeight < 30) {
          setIsCollapsed(true);
        }
        animationFrameRef.current = null;
      });
    }
  }, []);

  // Update the context counter when testContextInfo changes
  useEffect(() => {
    // Handle testContext updates
    if (testContextInfo?.testContext) {
      // Create a special string that highlights the test field if present
      let currentContextStr = JSON.stringify(testContextInfo.testContext);
      let previousContextStr = previousContextRef.current
        ? JSON.stringify(previousContextRef.current)
        : "";

      // Special handling for test field to ensure we detect changes to it
      const testValue = testContextInfo.testContext.test;
      if (testValue !== undefined) {
        // Add a special flag to force update when test field changes
        currentContextStr = `testField:${testValue}|${currentContextStr}`;
      }

      const prevTestValue = previousContextRef.current?.test;
      if (prevTestValue !== undefined) {
        // Add the same flag to previous context for comparison
        previousContextStr = `testField:${prevTestValue}|${previousContextStr}`;
      }

      if (currentContextStr !== previousContextStr) {
        setContextUpdateCounter(prev => prev + 1);
        previousContextRef.current = JSON.parse(JSON.stringify(testContextInfo.testContext));

        // Auto-expand the panel if it's collapsed
        if (isCollapsed || panelHeight < 200) {
          updateHeight(300); // A reasonable height to show new context
        }
      }
    }

    // Handle stdout updates
    if (testContextInfo?.stdout) {
      const currentStdout = testContextInfo.stdout;
      const hasNewLines = currentStdout.length !== previousStdoutRef.current.length;

      if (hasNewLines || JSON.stringify(currentStdout) !== JSON.stringify(previousStdoutRef.current)) {
        setConsoleLines(currentStdout);
        previousStdoutRef.current = currentStdout;

        // Auto-expand the panel if it's collapsed, but don't switch tabs
        if (hasNewLines && currentStdout.length > 0 && (isCollapsed || panelHeight < 200)) {
          updateHeight(300); // A reasonable height to show new console output
        }
      }
    } else if (testContextInfo === null) {
      // Clear console when testContextInfo is null (during reset)
      setConsoleLines([]);
      previousStdoutRef.current = [];
    }
  }, [testContextInfo, isCollapsed, panelHeight, updateHeight]);

  // Add handlers for resize functionality
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartYRef.current = e.clientY;
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
        // Expand to previous height
        updateHeight(previousHeight);
      } else {
        // Collapse and save current height
        setPreviousHeight(currentHeightRef.current);
        updateHeight(30); // Collapsed height
      }
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaY = dragStartYRef.current - e.clientY;

      // If the mouse has moved more than 3px, consider it a drag
      if (Math.abs(deltaY) > 3) {
        hasDragged.current = true;
      }

      const newHeight = currentHeightRef.current + deltaY;

      // Set constraints (minimum 30px, maximum 600px)
      const clampedHeight = Math.min(Math.max(newHeight, 30), 600);

      // Update the height with direct DOM manipulation
      updateHeight(clampedHeight);

      // Update the reference point
      dragStartYRef.current = e.clientY;
      currentHeightRef.current = clampedHeight;
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
      document.body.style.cursor = "row-resize";
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
  }, [isDragging, updateHeight]);

  const renderContextTab = () => {
    // Force update with a key based on the counter
    const renderKey = `context-${contextUpdateCounter}`;

    if (!testContextInfo || !testContextInfo.testContext) {
      return (
        <div className="flex items-center justify-center h-full" key={renderKey}>
          <Text size="sm" c="dimmed">
            {t('noVariables')}
          </Text>
        </div>
      );
    }

    return (
      <div className="overflow-auto h-full w-full scrollbar-thin" key={renderKey}>
        <Table className="test-context-table">
          <Table.Tbody>
            {renderNestedFields(testContextInfo.testContext)}
          </Table.Tbody>
        </Table>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`flex flex-col w-full ${className}`}
      style={{ height: `${panelHeight}px` }}
    >
      {/* Resizer handle */}
      <div
        className="info-view-resizer group border-t border-subtle"
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        data-testid="resizer-handle"
      >
        <div className="absolute left-1/2 -translate-x-1/2 -mt-0.5 text-xs text-secondary bg-surface px-2 py-1 rounded-md shadow-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="whitespace-nowrap font-medium">
            {isCollapsed ? t('clickToExpand') : t('dragToResize')}
          </div>
        </div>
      </div>

      {/* DevTools-like panel */}
      <div className="flex-1 flex flex-col bg-surface border-t border-subtle overflow-hidden">
        <Tabs value={activeTab} onChange={setActiveTab} style={{ height: "100%" }}>
          <Tabs.List>
            {testConfigInfo && (
              <Tabs.Tab value="config" leftSection={<IconSettings size={16} />}>
                {t('configTab')}
              </Tabs.Tab>
            )}
            <Tabs.Tab value="context" leftSection={<IconInfoCircle size={16} />}>
              {t('variablesTab')}
            </Tabs.Tab>
            <Tabs.Tab value="console" leftSection={<IconTerminal size={16} />}>
              {t('consoleTab')} {consoleLines.length > 0 && `(${consoleLines.length})`}
            </Tabs.Tab>
          </Tabs.List>

          {testConfigInfo && (
            <Tabs.Panel value="config" style={{ height: "calc(100% - 40px)", overflow: "hidden" }}>
              <div className="h-full overflow-hidden">
                <div className="overflow-y-auto h-full">
                  <Table className="test-context-table">
                    <Table.Tbody>
                      {renderConfigFields(testConfigInfo)}
                      <EditableConfigFields config={testConfigInfo} onConfigChange={onConfigChange} />
                    </Table.Tbody>
                  </Table>
                  <div className="h-4" />
                </div>
              </div>
            </Tabs.Panel>
          )}

          <Tabs.Panel value="context" style={{ height: "calc(100% - 40px)", overflow: "hidden" }}>
            {!testContextInfo || !testContextInfo.testContext ? (
              <div className="flex items-center justify-center h-full">
                <Text size="sm" c="dimmed">
                  {t('noVariables')}
                </Text>
              </div>
            ) : (
              <div className="h-full overflow-hidden">
                <div className="test-context-wrapper overflow-y-auto h-full">
                  <Table className="test-context-table">
                    <Table.Tbody>
                      {renderNestedFields(testContextInfo.testContext)}
                    </Table.Tbody>
                  </Table>
                  <div className="h-4"></div> {/* Bottom padding to prevent content from being cut off */}
                </div>
              </div>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="console" style={{ height: "calc(100% - 40px)", overflow: "hidden" }}>
            {consoleLines.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Text size="sm" c="dimmed">
                  {t('noConsoleOutput')}
                </Text>
              </div>
            ) : (
              <div className="h-full overflow-hidden">
                <div
                  ref={consoleContainerRef}
                  className="console-wrapper overflow-y-auto h-full p-2 font-mono text-sm"
                >
                  {consoleLines.map((line, index) => {
                    const { className, prefix } = getConsoleLineStyle(line);
                    return (
                      <div key={index} className="py-1 flex items-start gap-1">
                        {prefix && (
                          <span className="flex-shrink-0 text-xs leading-5">
                            {prefix}
                          </span>
                        )}
                        <span className={className}>
                          {line}
                        </span>
                      </div>
                    );
                  })}
                  <div className="h-4"></div> {/* Bottom padding to prevent content from being cut off */}
                </div>
              </div>
            )}
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
};

export default TestInfoView;