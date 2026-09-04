import { v4 as uuidv4 } from "uuid";
import { ActionEntity } from "./actionEntity";

type PlaywrightRecorderAction = {
  name?: string;
  selector?: string;
  xpath?: string;
  css_selector?: string;
  frame_path?: string[];
  text?: string;
  value?: string;
  key?: string;
  options?: string[];
  files?: string[];
  url?: string;
  deltaX?: number;
  deltaY?: number;
  timeout?: number;
  ref?: string;
  ariaSnapshot?: string;
  // Playwright recorder payloads have also surfaced this misspelled variant.
  arIAaSnapshot?: string;
};

export const generateUid = (): string => uuidv4();

export function extractElementDescription(locator: string): string {
  const chainedMatch = locator.match(/\.getByRole\(['"]([^'"]+)['"]/);
  if (chainedMatch && chainedMatch[1]) {
    const filterMatchQuoted = locator.match(/\.filter\(\{\s*hasText:\s*['"]([^'"]*(?:\\.[^'"]*)*)['"]\s*\}\)/);
    if (filterMatchQuoted && filterMatchQuoted[1]) {
      const unescapedText = filterMatchQuoted[1].replace(/\\(.)/g, "$1");
      return `${chainedMatch[1]} element with text "${unescapedText}"`;
    }
    const filterMatchRegex = locator.match(/\.filter\(\{\s*hasText:\s*(\/.*?\/[gimuy]*)\s*\}\)/);
    if (filterMatchRegex && filterMatchRegex[1]) {
      const regexContent = filterMatchRegex[1].replace(/^\/|\/$/g, "");
      const readablePart = regexContent.length > 30 ? `${regexContent.substring(0, 27)}...` : regexContent;
      return `${chainedMatch[1]} element with text matching "${readablePart}"`;
    }
    return `${chainedMatch[1]} element`;
  }

  const hasTextMatch = locator.match(/\.filter\(\{\s*hasText:\s*['"]([^'"]*(?:\\.[^'"]*)*)['"]\s*\}\)/);
  if (hasTextMatch && hasTextMatch[1]) {
    const baseLocator = extractBaseLocatorType(locator);
    const unescapedText = hasTextMatch[1].replace(/\\(.)/g, "$1");
    return `${baseLocator} with text "${unescapedText}"`;
  }

  const hasTextRegexMatch = locator.match(/\.filter\(\{\s*hasText:\s*(\/.*?\/[gimuy]*)\s*\}\)/);
  if (hasTextRegexMatch && hasTextRegexMatch[1]) {
    const baseLocator = extractBaseLocatorType(locator);
    return `${baseLocator} with text matching ${hasTextRegexMatch[1]}`;
  }

  const hasMatchSingle = locator.match(/\.filter\(\{\s*has:\s*[^}]+getByText\('((?:[^'\\]|\\.)*)'(?:,\s*\{[^}]*\})?\)/);
  if (hasMatchSingle && hasMatchSingle[1]) {
    const baseLocator = extractBaseLocatorType(locator);
    const unescapedText = hasMatchSingle[1].replace(/\\(.)/g, "$1");
    return `${baseLocator} containing "${unescapedText}"`;
  }

  const hasMatchDouble = locator.match(/\.filter\(\{\s*has:\s*[^}]+getByText\("((?:[^"\\]|\\.)*)"(?:,\s*\{[^}]*\})?\)/);
  if (hasMatchDouble && hasMatchDouble[1]) {
    const baseLocator = extractBaseLocatorType(locator);
    const unescapedText = hasMatchDouble[1].replace(/\\(.)/g, "$1");
    return `${baseLocator} containing "${unescapedText}"`;
  }

  const hasNotMatchSingle = locator.match(/\.filter\(\{\s*hasNot:\s*[^}]+getByText\('((?:[^'\\]|\\.)*)'(?:,\s*\{[^}]*\})?\)/);
  if (hasNotMatchSingle && hasNotMatchSingle[1]) {
    const baseLocator = extractBaseLocatorType(locator);
    const unescapedText = hasNotMatchSingle[1].replace(/\\(.)/g, "$1");
    return `${baseLocator} not containing "${unescapedText}"`;
  }

  const hasNotMatchDouble = locator.match(/\.filter\(\{\s*hasNot:\s*[^}]+getByText\("((?:[^"\\]|\\.)*)"(?:,\s*\{[^}]*\})?\)/);
  if (hasNotMatchDouble && hasNotMatchDouble[1]) {
    const baseLocator = extractBaseLocatorType(locator);
    const unescapedText = hasNotMatchDouble[1].replace(/\\(.)/g, "$1");
    return `${baseLocator} not containing "${unescapedText}"`;
  }

  const nameMatchSingle = locator.match(/name:\s*'((?:[^'\\]|\\.)*)'/);
  if (nameMatchSingle && nameMatchSingle[1]) {
    return `"${nameMatchSingle[1].replace(/\\(.)/g, "$1")}"`;
  }

  const nameMatchDouble = locator.match(/name:\s*"((?:[^"\\]|\\.)*)"/);
  if (nameMatchDouble && nameMatchDouble[1]) {
    return `"${nameMatchDouble[1].replace(/\\(.)/g, "$1")}"`;
  }

  const textMatchSingle = locator.match(/getByText\('((?:[^'\\]|\\.)*)'(?:,\s*\{[^}]*\})?\)/);
  if (textMatchSingle && textMatchSingle[1]) {
    return `"${textMatchSingle[1].replace(/\\(.)/g, "$1")}"`;
  }

  const textMatchDouble = locator.match(/getByText\("((?:[^"\\]|\\.)*)"(?:,\s*\{[^}]*\})?\)/);
  if (textMatchDouble && textMatchDouble[1]) {
    return `"${textMatchDouble[1].replace(/\\(.)/g, "$1")}"`;
  }

  const placeholderMatchSingle = locator.match(/getByPlaceholder\('((?:[^'\\]|\\.)*)'(?:,\s*\{[^}]*\})?\)/);
  if (placeholderMatchSingle && placeholderMatchSingle[1]) {
    return `input with placeholder "${placeholderMatchSingle[1].replace(/\\(.)/g, "$1")}"`;
  }

  const placeholderMatchDouble = locator.match(/getByPlaceholder\("((?:[^"\\]|\\.)*)"(?:,\s*\{[^}]*\})?\)/);
  if (placeholderMatchDouble && placeholderMatchDouble[1]) {
    return `input with placeholder "${placeholderMatchDouble[1].replace(/\\(.)/g, "$1")}"`;
  }

  const labelMatchSingle = locator.match(/getByLabel\('((?:[^'\\]|\\.)*)'(?:,\s*\{[^}]*\})?\)/);
  if (labelMatchSingle && labelMatchSingle[1]) {
    return `"${labelMatchSingle[1].replace(/\\(.)/g, "$1")}"`;
  }

  const labelMatchDouble = locator.match(/getByLabel\("((?:[^"\\]|\\.)*)"(?:,\s*\{[^}]*\})?\)/);
  if (labelMatchDouble && labelMatchDouble[1]) {
    return `"${labelMatchDouble[1].replace(/\\(.)/g, "$1")}"`;
  }

  const roleMatch = locator.match(/getByRole\(['"]([^'"]+)['"]/);
  if (roleMatch && roleMatch[1]) {
    return `${roleMatch[1]} element`;
  }

  return locator.length > 50 ? `${locator.substring(0, 47)}...` : locator;
}

export function extractElementDescriptionFromAriaSnapshot(
  ariaSnapshot: string,
  ref: string,
): string | null {
  if (!ariaSnapshot || !ref) return null;
  const refId = ref.replace(/^ref=/, "");
  const lines = ariaSnapshot.split("\n");
  for (const line of lines) {
    if (!line.includes(`[ref=${refId}]`)) continue;
    const withoutAttrs = line.replace(/\s+\[[^\]]+\](?:\s*\[[^\]]+\])*.*$/, "").trim();
    const cleaned = withoutAttrs.replace(/^[-–—]\s*/, "").trim();
    const display = cleaned.replace(/\\"/g, '"');
    if (display.length > 0) return display;
    return null;
  }
  return null;
}

export function extractLocatorFromCode(code: string, fallbackSelector = ""): string {
  const codeMatch = code.match(/page\d*\.(.+?)\.(click|fill|press|check|uncheck|hover|selectOption|dragTo|dblclick|screenshot|setInputFiles|locator|frameLocator)/);
  if (codeMatch && codeMatch[1]) {
    return codeMatch[1].trim();
  }

  const locatorMatch = code.match(/page\d*\.locator\(([^)]+)\)/);
  if (locatorMatch && locatorMatch[1]) {
    return `locator(${locatorMatch[1]})`;
  }

  const frameLocatorMatch = code.match(/page\d*\.frameLocator\(([^)]+)\)/);
  if (frameLocatorMatch && frameLocatorMatch[1]) {
    return `frameLocator(${frameLocatorMatch[1]})`;
  }

  return fallbackSelector;
}

function extractBaseLocatorType(locator: string): string {
  const locatorMatch = locator.match(/^locator\(['"]([^'"]+)['"]\)/);
  if (locatorMatch && locatorMatch[1]) {
    const selector = locatorMatch[1];
    const elementMatch = selector.match(/^([a-zA-Z][\w-]*)/);
    if (elementMatch) {
      return elementMatch[1];
    }
    return selector.length > 20 ? `${selector.substring(0, 17)}...` : selector;
  }

  const roleMatch = locator.match(/getByRole\(['"]([^'"]+)['"]/);
  if (roleMatch && roleMatch[1]) {
    return roleMatch[1];
  }

  const testIdMatch = locator.match(/getByTestId\(['"]([^'"]+)['"]/);
  if (testIdMatch && testIdMatch[1]) {
    return `element with testId "${testIdMatch[1]}"`;
  }

  return "element";
}

function extractValueFromCode(code: string): string {
  const fillMatch = code.match(/\.fill\(['"]([^'"]*)['"]\)/);
  if (fillMatch && fillMatch[1] !== undefined) return fillMatch[1];

  const pressMatch = code.match(/\.press\(['"]([^'"]+)['"]\)/);
  if (pressMatch && pressMatch[1]) return pressMatch[1];

  const selectMatch = code.match(/\.selectOption\(['"]([^'"]+)['"]\)/);
  if (selectMatch && selectMatch[1]) return selectMatch[1];

  return "";
}

function extractClickButton(code: string): string | undefined {
  const buttonMatch = code.match(/button:\s*['"]([^'"]+)['"]/);
  return buttonMatch ? buttonMatch[1] : undefined;
}

function extractModifiers(code: string): string[] | undefined {
  const modifiersMatch = code.match(/modifiers:\s*\[([^\]]+)\]/);
  if (modifiersMatch && modifiersMatch[1]) {
    return modifiersMatch[1].split(",").map((m) => m.trim().replace(/['"]/g, ""));
  }
  return undefined;
}

export function convertPlaywrightActionToEntity(
  action: PlaywrightRecorderAction,
  code: string,
): ActionEntity {
  const playwrightActionName = action.name || "unknown";
  const locator = extractLocatorFromCode(code, action.selector || "");
  const snapshot = action.ariaSnapshot ?? action.arIAaSnapshot ?? "";
  const ref = action.ref;
  const isGetByTestId = /getByTestId\s*\(/.test(locator);
  const fromSnapshot =
    ref && snapshot && isGetByTestId
      ? extractElementDescriptionFromAriaSnapshot(snapshot, ref)
      : null;
  const elementDescription = fromSnapshot ?? extractElementDescription(locator);

  let internalActionName: string;
  let actionDescription: string;
  let kwargs: Record<string, string | number | boolean | string[]> = {};

  switch (playwrightActionName) {
    case "click": {
      const button = extractClickButton(code);
      const modifiers = extractModifiers(code);
      if (button === "right") {
        internalActionName = "right_click_on_element";
        actionDescription = `Right click on ${elementDescription}`;
      } else {
        internalActionName = "click_element";
        actionDescription = `Click on ${elementDescription}`;
      }
      kwargs = { index: 0 };
      if (button && button !== "left") kwargs.button = button;
      if (modifiers) kwargs.modifiers = modifiers;
      break;
    }
    case "fill": {
      const inputText = action.text || action.value || extractValueFromCode(code) || "";
      internalActionName = "fill";
      actionDescription = inputText
        ? `Fill ${elementDescription} with '${inputText}'`
        : `Fill ${elementDescription}`;
      kwargs = { value: inputText, index: 0 };
      break;
    }
    case "press": {
      const key = action.key || extractValueFromCode(code) || "";
      internalActionName = "press";
      actionDescription = `Press '${key}' on ${elementDescription}`;
      kwargs = { keyComb: key, index: 0 };
      break;
    }
    case "selectOption": {
      const optionValue = action.options?.[0] || extractValueFromCode(code) || "";
      internalActionName = "select_dropdown_option";
      actionDescription = `Select '${optionValue}' from ${elementDescription}`;
      kwargs = { text: optionValue, index: 0 };
      break;
    }
    case "check":
      internalActionName = "click_element";
      actionDescription = `Check ${elementDescription}`;
      kwargs = { index: 0 };
      break;
    case "uncheck":
      internalActionName = "click_element";
      actionDescription = `Uncheck ${elementDescription}`;
      kwargs = { index: 0 };
      break;
    case "setInputFiles": {
      const files = action.files || [];
      internalActionName = "upload_file";
      actionDescription = files.length > 0
        ? `Upload file(s) to ${elementDescription}`
        : `Upload file to ${elementDescription}`;
      kwargs = { paths: files, index: 0 };
      break;
    }
    case "navigate":
    case "goto":
      internalActionName = "go_to_url";
      actionDescription = `Navigate to ${action.url || "URL"}`;
      kwargs = { url: action.url || "", new_tab: false };
      break;
    case "dblclick":
      internalActionName = "double_click_on_element";
      actionDescription = `Double click on ${elementDescription}`;
      kwargs = { index: 0 };
      break;
    case "hover":
      internalActionName = "hover";
      actionDescription = `Hover over ${elementDescription}`;
      kwargs = { index: 0 };
      break;
    case "wheel":
    case "scroll":
      internalActionName = "scroll";
      actionDescription = `Scroll on ${elementDescription}`;
      kwargs = { x: action.deltaX || 0, y: action.deltaY || 0, index: action.selector ? 0 : -1 };
      break;
    case "dragTo":
      internalActionName = "drag_drop";
      actionDescription = `Drag ${elementDescription} to target`;
      kwargs = { index: 0 };
      break;
    case "screenshot":
      // Recorder screenshots are tooling artifacts, not user actions to replay.
      // Preserve the event in the timeline as a short wait instead of emitting
      // a synthetic screenshot action that the runtime cannot execute directly.
      internalActionName = "wait";
      actionDescription = "Take screenshot";
      kwargs = { seconds: 0.5 };
      break;
    case "wait":
      internalActionName = "wait";
      actionDescription = `Wait for ${action.timeout || 1000}ms`;
      kwargs = { seconds: (action.timeout || 1000) / 1000 };
      break;
    default:
      internalActionName = "click_element";
      actionDescription = `${playwrightActionName} on ${elementDescription}`;
      kwargs = { index: 0 };
      break;
  }

  return {
    locator,
    xpath: action.xpath || "",
    css_selector: action.css_selector || "",
    unique_selector: action.selector || action.css_selector || "",
    frame_path: action.frame_path || [],
    action_data: {
      action_name: internalActionName,
      args: [],
      kwargs,
    },
    action_description: actionDescription,
    url: "",
    feedback: "",
  };
}
