/**
 * Per-action code generation
 *
 * Extracted from sdk-core/actions/impl/*.ts — only the transpile() methods.
 * Pure string generation, no runtime dependencies.
 */

import path from 'node:path';
import type { ActionEntity } from 'shiplight-types';
import { ACTION_TIMEOUT, getPageLocatorExpression } from './utils';

/**
 * Registry of action transpilers
 */
type ActionTranspiler = (actionEntity: ActionEntity, stepId?: string, options?: ActionTranspileContext) => string[];

export interface ActionTranspileContext {
  /** Collected imports — action transpilers can add to this set */
  imports?: Set<string>;
  /** Absolute path to the directory containing the .test.yaml (and output .yaml.spec.ts) */
  yamlDir?: string;
  /** Project root — bare paths in function references are resolved relative to this */
  projectRoot?: string;
}

const transpilers = new Map<string, ActionTranspiler>();

function register(name: string, transpiler: ActionTranspiler): void {
  transpilers.set(name, transpiler);
}

/**
 * Get transpiler for an action, or undefined if not registered
 */
export function getActionTranspiler(actionName: string): ActionTranspiler | undefined {
  return transpilers.get(actionName);
}

export type { ActionTranspiler };

// ============================================================================
// Helper: build execAction call with locator info
// ============================================================================

function buildExecActionCall(
  actionName: string,
  actionEntity: ActionEntity,
  extraParts: string[] = [],
): string[] {
  const parts: string[] = [...extraParts];
  if (actionEntity.locator) {
    parts.push(`locator: ${JSON.stringify(actionEntity.locator)}`);
  } else if (actionEntity.xpath) {
    parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
  }
  if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
    parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
  }

  if (parts.length === 0) {
    return [`await agent.execAction("${actionName}", page, {});`];
  }

  return [
    `await agent.execAction("${actionName}", page, {`,
    ...parts.map((p) => `  ${p},`),
    `});`,
  ];
}

// ============================================================================
// Click actions
// ============================================================================

register('click', (actionEntity) => {
  const locatorExpr = getPageLocatorExpression(actionEntity);
  if (!locatorExpr) {
    return [`await agent.execAction("click", page, {});`];
  }
  const timeout = actionEntity.action_data?.kwargs?.timeout_ms ?? ACTION_TIMEOUT;
  return [`await ${locatorExpr}.click({ timeout: ${timeout} });`];
});

// click_element and click_element_by_index are legacy aliases
register('click_element', transpilers.get('click')!);
register('click_element_by_index', transpilers.get('click')!);

register('double_click', (actionEntity) => {
  return buildExecActionCall('double_click', actionEntity);
});
register('double_click_on_element', transpilers.get('double_click')!);

register('right_click', (actionEntity) => {
  return buildExecActionCall('right_click', actionEntity);
});
register('right_click_on_element', transpilers.get('right_click')!);

register('hover', (actionEntity) => {
  return buildExecActionCall('hover', actionEntity);
});
register('hover_element_by_index', transpilers.get('hover')!);

// ============================================================================
// Input actions
// ============================================================================

register('input_text', (actionEntity) => {
  const text =
    actionEntity.action_data?.kwargs?.text ?? actionEntity.action_data?.kwargs?.value ?? '';
  return buildExecActionCall('input_text', actionEntity, [
    `action_data: { kwargs: { text: ${JSON.stringify(text)} } }`,
  ]);
});
register('fill', transpilers.get('input_text')!);

register('clear_input', (actionEntity) => {
  return buildExecActionCall('clear_input', actionEntity);
});

// ============================================================================
// Keyboard actions
// ============================================================================

register('press', (actionEntity) => {
  const keys = actionEntity.action_data?.kwargs?.keys;
  return [`await page.keyboard.press(${JSON.stringify(keys)});`];
});
register('send_keys', transpilers.get('press')!);

register('send_keys_on_element', (actionEntity) => {
  const locatorExpr = getPageLocatorExpression(actionEntity);
  const keys = actionEntity.action_data?.kwargs?.keys || '';
  if (!locatorExpr) {
    return [
      `await agent.execAction("send_keys_on_element", page, {`,
      `  action_data: { kwargs: { keys: ${JSON.stringify(keys)} } },`,
      `});`,
    ];
  }
  const timeout = actionEntity.action_data?.kwargs?.timeout_ms ?? ACTION_TIMEOUT;
  return [`await ${locatorExpr}.press(${JSON.stringify(keys)}, { timeout: ${timeout} });`];
});

// ============================================================================
// Dropdown actions
// ============================================================================

register('select_dropdown_option', (actionEntity) => {
  const text =
    actionEntity.action_data?.kwargs?.text || actionEntity.action_data?.kwargs?.option || '';
  return buildExecActionCall('select_dropdown_option', actionEntity, [
    `action_data: { kwargs: { text: ${JSON.stringify(text)} } }`,
  ]);
});

// ============================================================================
// Scroll actions
// ============================================================================

register('scroll', (actionEntity) => {
  const down = actionEntity.action_data?.kwargs?.down ?? true;
  const num_pages = actionEntity.action_data?.kwargs?.num_pages ?? 1;
  const direction = down ? 1 : -1;
  return [
    `await page.evaluate('window.scrollBy(0, window.innerHeight * ${num_pages * direction})');`,
  ];
});
register('scroll_down', transpilers.get('scroll')!);
register('scroll_up', transpilers.get('scroll')!);
register('scroll_element', transpilers.get('scroll')!);

register('scroll_to_text', (actionEntity) => {
  const text = actionEntity.action_data?.kwargs?.text || '';
  return [
    `await page.getByText(${JSON.stringify(text)}, { exact: false }).first().scrollIntoViewIfNeeded();`,
  ];
});

register('scroll_on_element', (actionEntity) => {
  return buildExecActionCall('scroll_on_element', actionEntity, [
    `action_data: { kwargs: ${JSON.stringify(actionEntity.action_data?.kwargs || {})} }`,
  ]);
});

// ============================================================================
// Navigation actions
// ============================================================================

register('go_to_url', (actionEntity) => {
  const url = actionEntity.action_data?.kwargs?.url || '';
  const newTab = actionEntity.action_data?.kwargs?.new_tab === true;

  if (newTab) {
    return [
      `await agent.execAction("go_to_url", page, {`,
      `  action_data: { kwargs: { url: ${JSON.stringify(url)}, new_tab: true } },`,
      `});`,
    ];
  }

  return [
    `await agent.execAction("go_to_url", page, {`,
    `  action_data: { kwargs: { url: ${JSON.stringify(url)} } },`,
    `});`,
  ];
});
register('open_tab', transpilers.get('go_to_url')!);

register('go_back', () => {
  return [`await agent.execAction("go_back", page, {});`];
});

register('reload_page', () => {
  return [`await agent.execAction("reload_page", page, {});`];
});

// ============================================================================
// Wait actions
// ============================================================================

register('wait', (actionEntity) => {
  const seconds = actionEntity.action_data?.kwargs?.seconds || 1;
  return [`await page.waitForTimeout(${seconds * 1000});`];
});

register('wait_for_page_ready', () => {
  return [`await page.waitForLoadState('domcontentloaded');`];
});

// ============================================================================
// AI actions
// ============================================================================

register('verify', (actionEntity, stepId) => {
  const kwargs = actionEntity.action_data?.kwargs;
  const hasCode = typeof kwargs?.code === 'string';
  const escapedStepId = JSON.stringify(stepId || '');
  const statement = hasCode
    ? (kwargs?.statement || actionEntity.action_description)
    : (actionEntity.action_description || kwargs?.statement);

  // Both code and statement: try/catch with AI fallback
  if (hasCode && statement) {
    const codeLines = kwargs.code.split('\n');
    const escapedStatement = JSON.stringify(statement);
    return [
      `{ const _t = Date.now(); try {`,
      `  try {`,
      ...codeLines.map((line: string) => `    ${line}`),
      `  } finally {`,
      `    await agent.replaceStepScreenshot(page, ${escapedStepId});`,
      `  }`,
      `  console.log(\`[VERIFY:JS] ✓ \${((Date.now()-_t)/1000).toFixed(1)}s: ${escapedStatement}\`);`,
      `} catch (_e) {`,
      `  console.log(\`[VERIFY:JS→AI] JS failed \${((Date.now()-_t)/1000).toFixed(1)}s: (\${_e instanceof Error ? _e.message : String(_e)}), falling back to AI: ${escapedStatement}\`);`,
      `  await agent.assert(page, ${escapedStatement}, ${JSON.stringify(stepId || '')});`,
      `} }`,
    ];
  }

  // JS-only mode
  if (hasCode) {
    return [
      `try {`,
      ...kwargs.code.split('\n').map((line: string) => `  ${line}`),
      `} finally {`,
      `  await agent.replaceStepScreenshot(page, ${escapedStepId});`,
      `}`,
    ];
  }

  // AI mode
  if (!statement) {
    return [`// Skipping verify: missing statement or code`];
  }
  const escapedStatement = JSON.stringify(statement);
  return [`await agent.assert(page, ${escapedStatement}, ${JSON.stringify(stepId || '')});`];
});
register('ai_assert', transpilers.get('verify')!);
register('assert', transpilers.get('verify')!);

// Note: stepId uses single quotes to match sdk-core's ai_action.transpile() output.
// The conformance tests enforce exact parity between CLI and sdk-core transpilers.
register('ai_action', (actionEntity, stepId) => {
  const statement = actionEntity.action_data?.kwargs?.statement;
  if (!statement) {
    return [`// Skipping ai_action: missing statement`];
  }
  const escapedStatement = JSON.stringify(statement);
  const usePureVision = actionEntity.action_data?.kwargs?.use_pure_vision;
  return [`await agent.execute(page, ${escapedStatement}, '${stepId || ''}', ${usePureVision});`];
});

register('ai_step', (actionEntity, stepId) => {
  const statement = actionEntity.action_data?.kwargs?.statement;
  if (!statement) {
    return [`// Skipping ai_step: missing statement`];
  }
  const escapedStatement = JSON.stringify(statement);
  return [`await agent.run(page, ${escapedStatement}, '${stepId || ''}');`];
});

register('ai_extract', (actionEntity, stepId) => {
  const elementDescription = actionEntity.action_data?.kwargs?.element_description;
  const variableName = actionEntity.action_data?.kwargs?.variable_name;
  if (!elementDescription || !variableName) {
    return [`// Skipping ai_extract: missing element_description or variable_name`];
  }
  const escapedElementDesc = JSON.stringify(elementDescription);
  const escapedVarName = JSON.stringify(variableName);
  return [`await agent.extract(page, ${escapedElementDesc}, ${escapedVarName}, '${stepId || ''}');`];
});

register('ai_wait_until', (actionEntity, stepId) => {
  const condition = actionEntity.action_data?.kwargs?.condition;
  const timeoutSeconds = actionEntity.action_data?.kwargs?.timeout_seconds || 60;
  if (!condition) {
    return [`// Skipping ai_wait_until: missing condition`];
  }
  // JS_CODE condition: inline the expression as a predicate polled in-process (no model calls).
  // In the intent + sibling `js:` form, the expression lives in `js` and `condition`
  // holds the intent, which is passed through as the step description.
  if (actionEntity.action_data?.kwargs?.condition_type === 'JS_CODE') {
    const js = actionEntity.action_data?.kwargs?.js;
    const expression = typeof js === 'string' ? js : condition;
    const intentArg = typeof js === 'string' ? `, ${JSON.stringify(condition)}` : '';
    return [`await agent.waitForJs(page, async () => (${expression}), ${timeoutSeconds}, '${stepId || ''}'${intentArg});`];
  }
  const escapedCondition = JSON.stringify(condition);
  return [`await agent.waitUntilCondition(page, ${escapedCondition}, ${timeoutSeconds}, '${stepId || ''}');`];
});

// ============================================================================
// Utility actions
// ============================================================================

register('save_variable', (actionEntity) => {
  const name = actionEntity.action_data?.kwargs?.name || '';
  const value = actionEntity.action_data?.kwargs?.value;
  return [
    `await agent.execAction("save_variable", page, {`,
    `  action_data: { kwargs: { name: ${JSON.stringify(name)}, value: ${JSON.stringify(value)} } },`,
    `});`,
  ];
});

register('js_code', (actionEntity) => {
  const code = actionEntity.action_data?.kwargs?.code;
  if (!code) {
    return [`// Skipping js_code: missing code`];
  }
  const lines: string[] = ['{'];
  const codeLines = code.split('\n');
  for (const codeLine of codeLines) {
    lines.push(`  ${codeLine}`);
  }
  lines.push('}');
  return lines;
});

register('function', (actionEntity, _stepId, options) => {
  const kwargs = actionEntity.action_data?.kwargs || {};
  const functionName = kwargs.functionName;

  // Handle file#export pattern: helpers/auth.ts#loginUser
  if (functionName && functionName.includes('#')) {
    const [filePath, exportName] = functionName.split('#');
    if (filePath && exportName) {
      // Strip .ts/.js extension for the import path
      let importPath = filePath.replace(/\.(ts|js|mjs)$/, '');

      if (path.isAbsolute(filePath)) {
        return [`throw new Error(${JSON.stringify(`Absolute paths are not supported in call: references. Use a path relative to the project root (got: "${filePath}")`)})`];
      } else if (!importPath.startsWith('.') && options?.projectRoot && options?.yamlDir) {
        // Bare paths (e.g. "helpers/auth.ts") are resolved relative to the
        // project root, then converted to a path relative to the spec file's
        // directory. Explicitly-relative paths ("./x", "../x") are left as-is:
        // the generated spec is co-located with the YAML file, so a path the
        // author wrote relative to the YAML already points at the right module.
        // This matches normal ESM import semantics and keeps YAML written before
        // bare paths were project-root-resolved working unchanged.
        const abs = path.resolve(options.projectRoot, importPath);
        const rel = path.relative(options.yamlDir, abs).replace(/\\/g, '/');
        importPath = rel.startsWith('..') ? rel : './' + rel;
      }
      // else: neither projectRoot nor yamlDir was provided, so importPath is left
      // as the raw bare specifier (e.g. "helpers/auth"). That produces an invalid
      // bare-specifier import with no error — pre-existing behavior, callers are
      // expected to always supply both options when transpiling `call:` references.

      const importStatement = `import { ${exportName} } from '${importPath}';`;
      options?.imports?.add(importStatement);

      // Generate the function call with the export name instead of the full path#name
      const modifiedKwargs = { ...kwargs, functionName: exportName };
      const code = generateFunctionCallCode(modifiedKwargs);
      if (!code) return [`// Skipping function: invalid export pattern`];
      return [code.endsWith(';') ? code : `${code};`];
    }
  }

  const code = generateFunctionCallCode(kwargs);
  if (!code) {
    return [`// Skipping function: missing functionName`];
  }
  return [code.endsWith(';') ? code : `${code};`];
});

register('generate_2fa_code', (actionEntity) => {
  const secretKey = actionEntity.action_data?.kwargs?.otp_secret_key || '';
  return [
    `await agent.execAction("generate_2fa_code", page, {`,
    `  action_data: { kwargs: { otp_secret_key: ${JSON.stringify(secretKey)} } },`,
    `});`,
  ];
});

register('upload_file', (actionEntity) => {
  const kwargs = actionEntity.action_data?.kwargs || {};
  const parts: string[] = [];

  // Build kwargs with paths and use_file_input
  const kwargsObj: Record<string, any> = {};
  if (kwargs.paths) kwargsObj.paths = kwargs.paths;
  else if (kwargs.path) kwargsObj.path = kwargs.path;
  if (kwargs.use_file_input) kwargsObj.use_file_input = true;

  parts.push(`action_data: { kwargs: ${JSON.stringify(kwargsObj)} }`);

  if (actionEntity.locator) {
    parts.push(`locator: ${JSON.stringify(actionEntity.locator)}`);
  } else if (actionEntity.xpath) {
    parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
  }
  if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
    parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
  }

  return [
    `await agent.execAction("upload_file", page, {`,
    ...parts.map((p) => `  ${p},`),
    `});`,
  ];
});

register('wait_for_download_complete', (actionEntity) => {
  const timeoutSeconds = actionEntity.action_data?.kwargs?.timeout_seconds || 10;
  return [
    `await agent.execAction("wait_for_download_complete", page, {`,
    `  action_data: { kwargs: { timeout_seconds: ${timeoutSeconds} } },`,
    `});`,
  ];
});

register('switch_tab', (actionEntity) => {
  const pageId = actionEntity.action_data?.kwargs?.page_id ?? actionEntity.action_data?.kwargs?.tab_index ?? 0;
  return [
    `await agent.execAction("switch_tab", page, {`,
    `  action_data: { kwargs: { page_id: ${pageId} } },`,
    `});`,
  ];
});

register('close_tab', (actionEntity) => {
  let pageId = actionEntity.action_data?.kwargs?.page_id;
  pageId = pageId ?? actionEntity.action_data?.kwargs?.index;
  return [
    `await agent.execAction("close_tab", page, {`,
    `  action_data: { kwargs: { page_id: ${pageId} } },`,
    `});`,
  ];
});

register('set_date_for_native_date_picker', (actionEntity) => {
  const date = actionEntity.action_data?.kwargs?.date ?? '';
  const parts: string[] = [];
  parts.push(`action_data: { kwargs: { date: ${JSON.stringify(date)} } }`);
  if (actionEntity.locator) {
    parts.push(`locator: ${JSON.stringify(actionEntity.locator)}`);
  } else if (actionEntity.xpath) {
    parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
  }
  if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
    parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
  }

  return [
    `await agent.execAction("set_date_for_native_date_picker", page, {`,
    ...parts.map((p) => `  ${p},`),
    `});`,
  ];
});

register('done', () => {
  return [`// Done - no action needed`];
});

// ============================================================================
// Coordinate-based click actions
// ============================================================================

function buildCoordinateClickCall(actionName: string, actionEntity: ActionEntity): string[] {
  const kwargs = actionEntity.action_data?.kwargs || {};
  const parts: string[] = [];

  if (typeof kwargs.relative_x === 'number' && typeof kwargs.relative_y === 'number') {
    parts.push(`action_data: { kwargs: { relative_x: ${kwargs.relative_x}, relative_y: ${kwargs.relative_y} } }`);
    if (actionEntity.locator) {
      parts.push(`locator: ${JSON.stringify(actionEntity.locator)}`);
    } else if (actionEntity.xpath) {
      parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
    }
    if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
      parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
    }
  } else if (typeof kwargs.x === 'number' && typeof kwargs.y === 'number') {
    parts.push(`action_data: { kwargs: { x: ${kwargs.x}, y: ${kwargs.y} } }`);
  }

  return [
    `await agent.execAction("${actionName}", page, {`,
    ...parts.map((p) => `  ${p},`),
    `});`,
  ];
}

register('click_by_coordinates', (actionEntity) => buildCoordinateClickCall('click_by_coordinates', actionEntity));
register('right_click_by_coordinates', (actionEntity) => buildCoordinateClickCall('right_click_by_coordinates', actionEntity));
register('double_click_by_coordinates', (actionEntity) => buildCoordinateClickCall('double_click_by_coordinates', actionEntity));

register('drag_drop', (actionEntity) => {
  const kwargs = actionEntity.action_data?.kwargs || {};
  const kwargsObj: Record<string, number> = {};
  if (typeof kwargs.relative_x === 'number') kwargsObj.relative_x = kwargs.relative_x;
  if (typeof kwargs.relative_y === 'number') kwargsObj.relative_y = kwargs.relative_y;
  if (typeof kwargs.delta_x === 'number') kwargsObj.delta_x = kwargs.delta_x;
  if (typeof kwargs.delta_y === 'number') kwargsObj.delta_y = kwargs.delta_y;
  if (typeof kwargs.coord_source_x === 'number') kwargsObj.coord_source_x = kwargs.coord_source_x;
  if (typeof kwargs.coord_source_y === 'number') kwargsObj.coord_source_y = kwargs.coord_source_y;
  if (typeof kwargs.coord_target_x === 'number') kwargsObj.coord_target_x = kwargs.coord_target_x;
  if (typeof kwargs.coord_target_y === 'number') kwargsObj.coord_target_y = kwargs.coord_target_y;

  const parts: string[] = [`action_data: { kwargs: ${JSON.stringify(kwargsObj)} }`];
  if (actionEntity.locator) {
    parts.push(`locator: ${JSON.stringify(actionEntity.locator)}`);
  } else if (actionEntity.xpath) {
    parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
  }
  if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
    parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
  }

  return [
    `await agent.execAction("drag_drop", page, {`,
    ...parts.map((p) => `  ${p},`),
    `});`,
  ];
});

register('get_dropdown_options', (actionEntity) => {
  const parts: string[] = [];
  if (actionEntity.xpath) {
    parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
  }
  if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
    parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
  }

  if (parts.length === 0) {
    return [`await agent.execAction("get_dropdown_options", page, {});`];
  }

  return [
    `await agent.execAction("get_dropdown_options", page, {`,
    ...parts.map((p) => `  ${p},`),
    `});`,
  ];
});

register('extract_email_content', (actionEntity) => {
  const kwargs = actionEntity.action_data?.kwargs || {};
  return [
    `await agent.execAction("extract_email_content", page, {`,
    `  action_data: { kwargs: ${JSON.stringify(kwargs)} },`,
    `});`,
  ];
});

// ============================================================================
// JS shorthand action (raw Playwright code wrapped in agent.step)
// ============================================================================

register('js_action', (actionEntity) => {
  const code = actionEntity.action_data?.kwargs?.code;
  if (!code) {
    return [`// Skipping js_action: missing code`];
  }
  // Emit raw JS lines — the statement transpiler wraps this in agent.step()
  return code.split('\n');
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate function call code from action kwargs.
 * Expects `args` array format (YAML `call:` syntax).
 */
function generateFunctionCallCode(kwargs: Record<string, any>): string | null {
  const functionName = kwargs.functionName;
  if (!functionName) return null;

  // Support both `args` (array) and `parameterValues` (paired with parameterNames) formats
  const args: string[] = Array.isArray(kwargs.args)
    ? kwargs.args.map(String)
    : Array.isArray(kwargs.parameterValues)
      ? kwargs.parameterValues.map(String)
      : [];
  if (args.length === 0) return `await ${functionName}()`;

  const systemParams = ['page', 'testContext', 'request', 'agent', 'extensionActionPopup'];
  const jsLiterals = ['undefined', 'null', 'true', 'false'];

  const valueStrings = args.map((value) => {
    if (systemParams.includes(value)) return value;
    if (jsLiterals.includes(value) || /^-?\d+(\.\d+)?$/.test(value)) return value;
    if (value.startsWith('$')) return `agent.agentServices.readVariable('${value.substring(1)}')`;
    return `"${value}"`;
  });

  return `await ${functionName}(${valueStrings.join(', ')})`;
}
