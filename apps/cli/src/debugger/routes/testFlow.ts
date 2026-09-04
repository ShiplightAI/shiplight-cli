/**
 * Test Flow Routes
 *
 * YAML file bridge: load YAML from disk as JSON, save JSON back as YAML.
 * Supports both single-test and suite YAML files.
 */

import { Router } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { yamlToTestFlow, testFlowToYaml, testFlowToYamlObject, extractYamlMetadata, suiteToYaml, extractAndAttachComments } from "shiplight-types";
import { parseYamlTestFile } from "../../yaml-transpiler";
import type { Statement, TestFlow, TestGroup, TestGroupEntry } from "shiplight-types";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";

/**
 * Strip runtime-only fields from all statements before saving to YAML.
 * Removes xpath from action_entity and element_index from action kwargs —
 * these are navigation artifacts that don't belong in committed test files.
 */
function stripRuntimeFields(statements: Statement[]): Statement[] {
  return statements.map(stmt => {
    if (stmt.type === "ACTION" && stmt.action_entity) {
      const ae = stmt.action_entity;
      const actionData = ae.action_data ?? ae.action;
      const filteredKwargs = actionData?.kwargs
        ? Object.fromEntries(Object.entries(actionData.kwargs).filter(([k]) => k !== "element_index"))
        : actionData?.kwargs;
      const cleanedAe = { ...ae };
      delete cleanedAe.xpath;
      if (actionData && filteredKwargs !== undefined) {
        const cleanedActionData = { ...actionData, kwargs: filteredKwargs };
        if (ae.action_data) cleanedAe.action_data = cleanedActionData;
        else cleanedAe.action = cleanedActionData;
      }
      return { ...stmt, action_entity: cleanedAe };
    }
    if (stmt.type === "STEP") {
      return { ...stmt, statements: stripRuntimeFields(stmt.statements) };
    }
    if (stmt.type === "IF_ELSE") {
      return {
        ...stmt,
        then: stripRuntimeFields(stmt.then),
        ...(stmt.else ? { else: stripRuntimeFields(stmt.else) } : {}),
      };
    }
    if (stmt.type === "WHILE_LOOP") {
      return { ...stmt, body: stripRuntimeFields(stmt.body) };
    }
    return stmt;
  });
}

/** Parse raw YAML hook arrays into Statement[] via yamlToTestFlow */
function parseHookStatements(hookArray: any[] | undefined): Statement[] {
  if (!hookArray || hookArray.length === 0) return [];
  const miniDoc = { goal: '_hook', statements: hookArray };
  const yamlString = yamlStringify(miniDoc);
  const testFlow = yamlToTestFlow(yamlString);
  return testFlow.statements ?? [];
}

export interface TestFlowRouterOptions {
  initialDir: string;
  initialFile?: string;
  /** Directory containing playwright.config.ts — the default expanded node in the file tree. */
  projectRoot?: string;
  /** Called when the user selects a test file in the UI. */
  onFileSelected?: (filePath: string) => void;
}

/** Recursively check if a directory contains any .test.yaml files. */
async function hasTestYamlFiles(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      if (entry.isFile() && entry.name.endsWith(".test.yaml")) return true;
      if (entry.isDirectory()) {
        if (await hasTestYamlFiles(path.join(dir, entry.name))) return true;
      }
    }
  } catch {
    // Permission denied or other FS error — skip
  }
  return false;
}

/** Stable numeric id derived from a template name (FNV-1a 32-bit). Same name → same id always. */
function templateId(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 2147483647) + 1;
}

async function loadTemplatePathById(templatesDir: string): Promise<Map<number, string>> {
  const templates = new Map<number, string>();
  let fileNames: string[];
  try {
    fileNames = await fs.readdir(templatesDir);
  } catch (err: any) {
    if (err.code === "ENOENT") return templates;
    throw err;
  }

  for (const file of fileNames.filter(f => f.endsWith(".yaml"))) {
    try {
      const filePath = path.join(templatesDir, file);
      const doc = yamlParse(await fs.readFile(filePath, "utf-8"));
      const name: string = doc?.name ?? path.basename(file, ".yaml");
      templates.set(templateId(name), `templates/${file}`);
    } catch {
      // Ignore unparseable template files, matching the list/update routes.
    }
  }

  return templates;
}

function convertLocalTemplateReferences(value: unknown, templatePathById: Map<number, string>): unknown {
  if (Array.isArray(value)) {
    return value.map(item => convertLocalTemplateReferences(item, templatePathById));
  }

  if (!value || typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  const converted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(obj)) {
    converted[key] = convertLocalTemplateReferences(child, templatePathById);
  }

  const referenceId = typeof obj.reference_id === "number" ? obj.reference_id : undefined;
  if (referenceId !== undefined && typeof converted.template_path !== "string") {
    const templatePath = templatePathById.get(referenceId);
    if (templatePath) {
      converted.template_path = templatePath;
      delete converted.reference_id;
    }
  }

  return converted;
}

function serializeTemplateStatements(statements: Statement[]): unknown[] {
  return testFlowToYamlObject({ statements } as TestFlow).statements;
}

/**
 * Walk the statement tree and write modified template steps back to their source files.
 * When a STEP references a local template_path and its child statements have been edited,
 * update the template file so the changes aren't silently discarded on the next load.
 */
async function writeBackTemplateChanges(statements: Statement[], projectRoot: string): Promise<void> {
  for (const stmt of statements) {
    if (stmt.type === "STEP") {
      if (stmt.template_path && stmt.statements.length > 0) {
        const filePath = path.join(projectRoot, stmt.template_path);
        try {
          const doc = (yamlParse(await fs.readFile(filePath, "utf-8")) ?? {}) as Record<string, unknown>;
          doc.statements = serializeTemplateStatements(stmt.statements);
          await fs.writeFile(filePath, yamlStringify(doc), "utf-8");
        } catch {
          // Best-effort — skip if the template file doesn't exist or isn't writable
        }
      }
      await writeBackTemplateChanges(stmt.statements, projectRoot);
    } else if (stmt.type === "IF_ELSE") {
      await writeBackTemplateChanges(stmt.then, projectRoot);
      if (stmt.else) await writeBackTemplateChanges(stmt.else, projectRoot);
    } else if (stmt.type === "WHILE_LOOP") {
      await writeBackTemplateChanges(stmt.body, projectRoot);
    }
  }
}

export function createTestFlowRouter(options: TestFlowRouterOptions): Router {
  const { initialDir, initialFile, projectRoot, onFileSelected } = options;
  const router = Router();

  function getFixturesDir(): string {
    return path.join(projectRoot ?? initialDir, "fixtures");
  }

  /**
   * GET /api/files — list directory contents (subdirectories + *.test.yaml files)
   */
  router.get("/api/files", async (req, res) => {
    try {
      const dir = typeof req.query.dir === "string" ? req.query.dir : initialDir;
      const resolvedDir = path.resolve(dir);

      const dirEntries = await fs.readdir(resolvedDir, { withFileTypes: true });
      const entries: Array<{ name: string; type: "file" | "directory"; path: string }> = [];

      for (const entry of dirEntries) {
        if (entry.name === "node_modules") continue;
        if (entry.name.startsWith(".")) continue;

        if (entry.isDirectory()) {
          const dirPath = path.join(resolvedDir, entry.name);
          if (await hasTestYamlFiles(dirPath)) {
            entries.push({ name: entry.name, type: "directory", path: dirPath });
          }
        } else if (entry.isFile() && entry.name.endsWith(".test.yaml")) {
          entries.push({ name: entry.name, type: "file", path: path.join(resolvedDir, entry.name) });
        }
      }

      // Sort: directories first, then files, alphabetical within each group
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const parent = path.dirname(resolvedDir);
      res.json({
        dir: resolvedDir,
        parent: parent !== resolvedDir ? parent : null,
        entries,
        initialFile: initialFile ?? null,
        projectRoot: projectRoot ?? initialDir,
      });
    } catch (error: any) {
      console.error("[debugger] Error listing files:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Resolve which YAML file to use from the request query or initialFile fallback.
   */
  function resolveYamlFile(fileParam: unknown): { filePath: string } | { error: string } {
    if (typeof fileParam === "string" && fileParam) {
      const resolved = path.resolve(fileParam);
      if (!resolved.endsWith(".test.yaml")) {
        return { error: "File must be a .test.yaml file" };
      }
      return { filePath: resolved };
    }
    if (initialFile) {
      return { filePath: initialFile };
    }
    return { error: "No file specified. Pass ?file= parameter." };
  }

  /**
   * GET /api/test-flow — read YAML file, return TestFlow or Suite JSON
   */
  router.get("/api/test-flow", async (req, res) => {
    const resolved = resolveYamlFile(req.query.file);
    if ("error" in resolved) {
      return res.status(400).json({ error: resolved.error });
    }
    const yamlFilePath = resolved.filePath;
    try {
      onFileSelected?.(yamlFilePath);

      const yamlString = await fs.readFile(yamlFilePath, "utf-8");
      const stat = await fs.stat(yamlFilePath);
      const metadata = extractYamlMetadata(yamlString);
      const parsed = parseYamlTestFile(yamlString, yamlFilePath, projectRoot);

      if (parsed.suite) {
        // Suite file — build TestFlow with testGroup
        const suite = parsed.suite;
        const testGroup: TestGroup = {
          tests: suite.tests.map((t): TestGroupEntry => ({
            name: t.name,
            statements: t.testFlow.statements ?? [],
            tags: t.tags,
            teardown: t.testFlow.teardown,
            skip: t.skip,
            timeout: t.timeout,
            fail: t.fail,
            only: t.only,
            slow: t.slow,
          })),
          beforeAll: parseHookStatements(suite.beforeAll),
          afterAll: parseHookStatements(suite.afterAll),
          beforeEach: parseHookStatements(suite.beforeEach),
          afterEach: parseHookStatements(suite.afterEach),
        };
        const suiteTestFlow: TestFlow = {
          version: '1.3.0',
          baseURL: parsed.use?.baseURL as string | undefined,
          testGroup,
        };
        res.json({
          isSuite: true,
          testFlow: suiteTestFlow,
          metadata,
          name: parsed.name,
          tags: parsed.tags,
          use: parsed.use,
          filePath: yamlFilePath,
          fileName: path.basename(yamlFilePath),
          lastModified: stat.mtimeMs,
        });
      } else {
        // Single-test file — existing behavior
        const testFlow = parsed.testFlow!;
        // Re-attach comments from original YAML source.
        // parseYamlTestFile → yamlToTestFlow internally calls extractAndAttachComments,
        // but on re-serialized YAML (after template expansion), which loses comments.
        // This second call uses the original file content to restore them.
        extractAndAttachComments(yamlString, testFlow);
        res.json({
          isSuite: false,
          testFlow,
          metadata,
          name: parsed.name,
          tags: parsed.tags,
          use: parsed.use,
          parameters: parsed.parameters,
          filePath: yamlFilePath,
          fileName: path.basename(yamlFilePath),
          lastModified: stat.mtimeMs,
        });
      }
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return res.status(404).json({
          error: `File not found: ${yamlFilePath}`,
        });
      }
      console.error("[debugger] Error loading test flow:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/test-flow — receive TestFlow or Suite JSON, write as YAML
   */
  router.put("/api/test-flow", async (req, res) => {
    try {
      const resolved = resolveYamlFile(req.query.file);
      if ("error" in resolved) {
        return res.status(400).json({ error: resolved.error });
      }
      const yamlFilePath = resolved.filePath;

      const { testFlow, metadata } = req.body;

      if (!testFlow) {
        return res.status(400).json({ error: "testFlow is required" });
      }

      const templatesDir = path.join(projectRoot ?? initialDir, "templates");
      const templatePathById = await loadTemplatePathById(templatesDir);
      const yamlTestFlow = convertLocalTemplateReferences(testFlow, templatePathById) as TestFlow;

      // Strip runtime-only fields (xpath, element_index) before persisting
      const strippedStatements = stripRuntimeFields(yamlTestFlow.statements ?? []);
      const cleanTestFlow: TestFlow = { ...yamlTestFlow, statements: strippedStatements };

      // Write modified template steps back to their source files before serializing.
      // testFlowToYaml discards STEP children when template_path is set, so we must
      // persist any edits to the template files here or they'll be silently lost.
      const root = projectRoot ?? initialDir;
      const allStatementArrays: Statement[][] = [
        cleanTestFlow.statements ?? [],
        cleanTestFlow.teardown ?? [],
        ...(cleanTestFlow.testGroup?.tests?.flatMap(t => [t.statements, ...(t.teardown ? [t.teardown] : [])]) ?? []),
        ...(cleanTestFlow.testGroup?.beforeEach ? [cleanTestFlow.testGroup.beforeEach] : []),
        ...(cleanTestFlow.testGroup?.afterEach ? [cleanTestFlow.testGroup.afterEach] : []),
      ];
      for (const arr of allStatementArrays) {
        await writeBackTemplateChanges(arr, root);
      }

      // testFlowToYaml handles both single-test and suite (testGroup) TestFlows
      // Comments are preserved natively via the comment field on statements
      const yamlString = testFlowToYaml(cleanTestFlow, metadata);

      // Atomic write: write to temp file then rename
      const tmpPath = yamlFilePath + ".tmp";
      await fs.writeFile(tmpPath, yamlString, "utf-8");
      await fs.rename(tmpPath, yamlFilePath);

      const stat = await fs.stat(yamlFilePath);
      res.json({ success: true, lastModified: stat.mtimeMs });
    } catch (error: any) {
      console.error("[debugger] Error saving test flow:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/fixtures — list files in the fixtures dir (<yamlDir>/files/).
   */
  router.get("/api/fixtures", async (req, res) => {
    try {
      const fixturesDir = getFixturesDir();
      try {
        const entries = await fs.readdir(fixturesDir, { withFileTypes: true });
        const files = entries
          .filter(e => e.isFile())
          .map(e => e.name)
          .sort();
        res.json({ files, dir: fixturesDir });
      } catch (err: any) {
        if (err.code === "ENOENT") {
          res.json({ files: [], dir: fixturesDir });
        } else {
          throw err;
        }
      }
    } catch (error: any) {
      console.error("[debugger] Error listing fixtures:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/fixtures — receive a base64-encoded file, copy it into <yamlDir>/files/.
   * Returns the saved filename (bare name, no path) for use in upload_file action kwargs.
   */
  router.post("/api/fixtures", async (req, res) => {
    try {
      const fixturesDir = getFixturesDir();
      await fs.mkdir(fixturesDir, { recursive: true });

      const { name, content }: { name: string; content: string } = req.body;
      if (!name || !content) {
        return res.status(400).json({ error: "name and content are required" });
      }
      const safeName = path.basename(name);
      if (!safeName) {
        return res.status(400).json({ error: "Invalid file name" });
      }

      const dest = path.join(fixturesDir, safeName);
      await fs.writeFile(dest, Buffer.from(content, "base64"));
      res.json({ fileName: safeName });
    } catch (error: any) {
      console.error("[debugger] Error saving fixture:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/functions — list exported async functions from <projectRoot>/helpers/.
   * Returns TestFunction-shaped objects so the function picker modal works locally.
   * Function names use the "helpers/file.ts#funcName" reference format that the
   * sandbox resolves via dynamic import when executing a function action.
   */
  router.get("/api/functions", async (_req, res) => {
    const helpersDir = path.join(projectRoot ?? initialDir, "helpers");
    let fileNames: string[];
    try {
      fileNames = await fs.readdir(helpersDir);
    } catch (err: any) {
      if (err.code === "ENOENT") return res.json([]);
      console.error("[debugger] Error reading helpers dir:", err);
      return res.status(500).json({ error: err.message });
    }

    const helperFiles = fileNames.filter(f => /\.(ts|js|mjs)$/.test(f));
    const functions: object[] = [];
    let idCounter = 1;

    for (const file of helperFiles) {
      const content = await fs.readFile(path.join(helpersDir, file), "utf-8");
      const funcRegex = /export\s+async\s+function\s+(\w+)\s*(\([^)]*\))/g;
      let match: RegExpExecArray | null;
      while ((match = funcRegex.exec(content)) !== null) {
        const [, funcName, params] = match;
        // Strip TypeScript type annotations (": Type") so parseFunctionParameters()
        // returns bare names like "page" that isSystemParameter() can recognise.
        const strippedParams = params.replace(/\s*:\s*[^,)]+/g, "");
        functions.push({
          id: idCounter++,
          name: `helpers/${file}#${funcName}`,
          description: "",
          status: "Active",
          // Synthetic stub so parseFunctionParameters() can extract the param list
          code: `async function ${funcName}${strippedParams} {}`,
        });
      }
    }

    res.json(functions);
  });

  /**
   * GET /api/reusable-steps — list templates from <projectRoot>/templates/*.yaml.
   * Returns ReusableStep-shaped objects so the template picker modal works locally.
   */
  router.get("/api/reusable-steps", async (_req, res) => {
    const templatesDir = path.join(projectRoot ?? initialDir, "templates");
    let fileNames: string[];
    try {
      fileNames = await fs.readdir(templatesDir);
    } catch (err: any) {
      if (err.code === "ENOENT") return res.json([]);
      console.error("[debugger] Error reading templates dir:", err);
      return res.status(500).json({ error: err.message });
    }

    const yamlFiles = fileNames.filter(f => f.endsWith(".yaml")).sort();
    const templates: object[] = [];

    for (const file of yamlFiles) {
      try {
        const content = await fs.readFile(path.join(templatesDir, file), "utf-8");
        const doc = yamlParse(content);
        if (!doc || typeof doc !== "object") continue;

        const name: string = doc.name ?? path.basename(file, ".yaml");
        const description: string = doc.description ?? "";
        const statements = parseHookStatements(doc.statements);

        templates.push({ id: templateId(name), organizationId: "local", name, description, statements });
      } catch (err) {
        console.error(`[debugger] Error parsing template ${file}:`, err);
      }
    }

    res.json(templates);
  });

  /**
   * POST /api/reusable-steps/exists/:name — check if a template with that name already exists.
   * Called by SaveReusableStepModal for uniqueness validation.
   */
  router.post("/api/reusable-steps/exists/:name", async (req, res) => {
    const templatesDir = path.join(projectRoot ?? initialDir, "templates");
    const targetName = decodeURIComponent(req.params.name).toLowerCase();
    let fileNames: string[];
    try {
      fileNames = await fs.readdir(templatesDir);
    } catch (err: any) {
      if (err.code === "ENOENT") return res.json(false);
      return res.status(500).json({ error: err.message });
    }

    for (const file of fileNames.filter(f => f.endsWith(".yaml"))) {
      try {
        const content = await fs.readFile(path.join(templatesDir, file), "utf-8");
        const doc = yamlParse(content);
        const name: string = doc?.name ?? path.basename(file, ".yaml");
        if (name.toLowerCase() === targetName) return res.json(true);
      } catch {
        // skip unparseable files
      }
    }
    res.json(false);
  });

  /**
   * POST /api/reusable-steps — save a new template to <projectRoot>/templates/.
   * Body: { reusableStep: { name, description, statements } }
   */
  router.post("/api/reusable-steps", async (req, res) => {
    const templatesDir = path.join(projectRoot ?? initialDir, "templates");
    const { reusableStep } = req.body ?? {};
    if (!reusableStep?.name || !Array.isArray(reusableStep.statements)) {
      return res.status(400).json({ error: "reusableStep.name and reusableStep.statements are required" });
    }

    await fs.mkdir(templatesDir, { recursive: true });

    const safeName = reusableStep.name.replace(/[/\\:*?"<>|]/g, "-").trim();
    const filePath = path.join(templatesDir, `${safeName}.yaml`);

    const doc: Record<string, unknown> = {
      name: reusableStep.name,
      statements: serializeTemplateStatements(reusableStep.statements),
    };
    if (reusableStep.description) doc.description = reusableStep.description;

    await fs.writeFile(filePath, yamlStringify(doc), "utf-8");

    res.json({
      id: templateId(reusableStep.name),
      organizationId: "local",
      name: reusableStep.name,
      description: reusableStep.description ?? "",
      statements: reusableStep.statements,
    });
  });

  /**
   * PUT /api/reusable-steps/:id/update — update a template file identified by its stable hash id.
   */
  router.put("/api/reusable-steps/:id/update", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const templatesDir = path.join(projectRoot ?? initialDir, "templates");

    let fileNames: string[];
    try {
      fileNames = await fs.readdir(templatesDir);
    } catch (err: any) {
      if (err.code === "ENOENT") return res.status(404).json({ error: "Templates directory not found" });
      return res.status(500).json({ error: err.message });
    }

    for (const file of fileNames.filter(f => f.endsWith(".yaml"))) {
      try {
        const filePath = path.join(templatesDir, file);
        const doc: Record<string, unknown> = yamlParse(await fs.readFile(filePath, "utf-8")) ?? {};
        const name: string = (doc.name as string) ?? path.basename(file, ".yaml");
        if (templateId(name) !== id) continue;

        const updates = req.body ?? {};
        if (updates.description !== undefined) doc.description = updates.description;
        if (updates.statements !== undefined) doc.statements = serializeTemplateStatements(updates.statements);

        await fs.writeFile(filePath, yamlStringify(doc), "utf-8");
        return res.json({
          id,
          organizationId: "local",
          ...doc,
          statements: updates.statements !== undefined ? updates.statements : parseHookStatements(doc.statements as any[]),
        });
      } catch {
        // skip unparseable files
      }
    }

    res.status(404).json({ error: `Template with id ${id} not found` });
  });

  /**
   * PUT /api/templates/:name — update a template file by its name field.
   * Used by the local debugger's useReusableSteps stub instead of the id-based update endpoint.
   */
  router.put("/api/templates/:name", async (req, res) => {
    const templatesDir = path.join(projectRoot ?? initialDir, "templates");
    const targetName = decodeURIComponent(req.params.name);

    let fileNames: string[];
    try {
      fileNames = await fs.readdir(templatesDir);
    } catch (err: any) {
      if (err.code === "ENOENT") return res.status(404).json({ error: "Templates directory not found" });
      return res.status(500).json({ error: err.message });
    }

    for (const file of fileNames.filter(f => f.endsWith(".yaml"))) {
      try {
        const filePath = path.join(templatesDir, file);
        const doc: Record<string, unknown> = yamlParse(await fs.readFile(filePath, "utf-8")) ?? {};
        const name: string = (doc.name as string) ?? path.basename(file, ".yaml");
        if (name !== targetName) continue;

        const updates = req.body ?? {};
        if (updates.name !== undefined) doc.name = updates.name;
        if (updates.description !== undefined) doc.description = updates.description;
        if (updates.statements !== undefined) doc.statements = serializeTemplateStatements(updates.statements);

        await fs.writeFile(filePath, yamlStringify(doc), "utf-8");
        return res.json({
          organizationId: "local",
          ...doc,
          statements: updates.statements !== undefined ? updates.statements : parseHookStatements(doc.statements as any[]),
        });
      } catch {
        // skip unparseable files
      }
    }

    res.status(404).json({ error: `Template "${targetName}" not found` });
  });

  /**
   * GET /api/test-results — return screenshots/video from past debug executions.
   * Scans .shiplight/artifacts/<yaml-basename>/ (persisted from test-results/).
   */
  router.get("/api/test-results", async (req, res) => {
    const resolved = resolveYamlFile(req.query.file);
    if ("error" in resolved) {
      return res.status(400).json({ error: resolved.error });
    }

    const root = projectRoot ?? initialDir;
    const yamlBaseName = path.basename(resolved.filePath, ".test.yaml");
    const testArtifactsDir = path.join(root, ".shiplight", "artifacts", yamlBaseName);

    // Scan for per-step screenshot directories.
    // Directory names are "<uid>_before" or "<uid>_after" (from takeScreenshot).
    // stepId = the statement UID (without _before/_after suffix).
    // Also supports legacy "artifacts/main-0/" structure from stepTracking.
    const screenshots: Array<{ url: string; label: string; stepId?: string }> = [];
    let videoPath: string | null = null;
    try {
      const rootEntries = await fs.readdir(testArtifactsDir, { withFileTypes: true });
      for (const entry of rootEntries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(testArtifactsDir, entry.name);
          const files = await fs.readdir(dirPath);
          for (const file of files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f))) {
            const rel = path.relative(testArtifactsDir, path.join(dirPath, file));
            // Extract statement UID: strip _before/_after suffix
            const match = entry.name.match(/^(.+?)_(before|after)$/);
            const stepId = match ? match[1] : entry.name;
            const suffix = match ? match[2] : "screenshot";
            screenshots.push({
              url: `/api/report-assets/${yamlBaseName}/${rel}`,
              label: suffix,
              stepId,
            });
          }
        } else if (/\.(webm|mp4)$/i.test(entry.name)) {
          if (!videoPath) {
            videoPath = `/api/report-assets/${yamlBaseName}/${entry.name}`;
          }
        }
      }
      // Sort: group by stepId, then before < after
      screenshots.sort((a, b) => {
        if (a.stepId !== b.stepId) return (a.stepId ?? "").localeCompare(b.stepId ?? "");
        return a.label.localeCompare(b.label);
      });
    } catch {
      // No artifacts directory
    }

    if (screenshots.length === 0 && !videoPath) {
      return res.status(404).json({ error: "No test results found" });
    }

    res.json({ videoPath, screenshots });
  });

  return router;
}
