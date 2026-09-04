/**
 * Fields the report recovers from the `.test.yaml` a spec was transpiled from.
 *
 * Everything here is information Playwright does not have: the YAML step
 * descriptions behind each generated action, the suite name as the author wrote
 * it, the base URL, and the execution-control keys. Tags are deliberately NOT
 * in this list — see ./reportTags.ts for why they come off `TestCase.tags`.
 *
 * Kept pure and separate from the reporter class so the mapping can be tested
 * without standing up a Playwright run. The bug that motivated the split lived
 * in exactly this wiring: a field was resolved correctly here and then dropped
 * on the way out, with no test able to see it.
 */

import { extractActionStepsFromTestFlow } from 'shiplight-types';
import type { ActionStepInfo } from 'shiplight-types';
import type { ParameterSet, ParsedYamlTestFile } from '../yaml-transpiler';

/**
 * Read a parsed `.test.yaml` through a cache, parsing at most once per path.
 *
 * The reporter builds a report for every attempt of every test, so without this
 * a 20-test suite file was read and re-expanded 20+ times — parsing also pulls
 * in every referenced template — while the run appeared to hang after the last
 * test finished.
 *
 * A file that is missing or fails to parse caches as `null` so the failure is
 * not retried either. `Map.get` returns `undefined` only on a miss, which is
 * what separates "not looked up yet" from "looked up, nothing there".
 *
 * `parse` is injected rather than called directly so the caching rule can be
 * tested without touching the filesystem.
 *
 * @param yamlPath - Absolute path used as the cache key.
 * @param cache - Per-run store; the caller owns its lifetime.
 * @param parse - Reads and parses the file, or returns `null` if it cannot.
 */
export function loadCachedYaml(
  yamlPath: string,
  cache: Map<string, ParsedYamlTestFile | null>,
  parse: (yamlPath: string) => ParsedYamlTestFile | null,
): ParsedYamlTestFile | null {
  const cached = cache.get(yamlPath);
  if (cached !== undefined) return cached;

  const parsed = parse(yamlPath);
  cache.set(yamlPath, parsed);
  return parsed;
}

/** A test title split into the YAML test name and its parameter-set suffix. */
export interface TestTitleParts {
  baseTitle: string;
  /**
   * Candidate parameter-set name from the title. Only a candidate: a YAML test
   * whose own name ends in `[...]` matches this shape without being
   * parameterized, so it must be confirmed against the parsed file before use.
   */
  titleParameterSetName?: string;
}

/**
 * Split `Base name [paramSetName]`, the title shape the transpiler emits for a
 * parameter set, back into its parts.
 */
export function splitParameterizedTitle(title: string): TestTitleParts {
  const match = title.match(/^(.*)\s+\[([^\]]+)\]$/);
  if (!match) return { baseTitle: title };
  return { baseTitle: match[1], titleParameterSetName: match[2] };
}

/**
 * Confirm a title-derived parameter-set name against the sets the YAML declares.
 *
 * Without this, a YAML test literally named `checkout [beta]` reports as an
 * instance of a parameter set named `beta` that does not exist, and the cloud
 * groups it under that phantom set.
 */
export function confirmParameterSetName(
  titleParameterSetName: string | undefined,
  parameters: ParameterSet[] | undefined,
): string | undefined {
  if (!titleParameterSetName) return undefined;
  if (!parameters?.some((p) => p.name === titleParameterSetName)) return undefined;
  return titleParameterSetName;
}

/** Report fields recovered from the YAML. Absent keys mean "leave unset". */
export interface YamlEnrichment {
  actionStepsMap: Record<string, ActionStepInfo>;
  baseTitle?: string;
  suiteName?: string;
  baseUrl?: string;
  skip?: boolean | string;
  slow?: boolean;
  timeout?: number;
  parameterSetName?: string;
}

/**
 * Map a parsed YAML test file onto the report fields for one test.
 *
 * @param parsed - The parsed `.test.yaml`.
 * @param title - The Playwright test title, parameter-set suffix included.
 */
export function resolveYamlEnrichment(
  parsed: ParsedYamlTestFile,
  title: string,
): YamlEnrichment {
  const { baseTitle, titleParameterSetName } = splitParameterizedTitle(title);
  const enrichment: YamlEnrichment = { actionStepsMap: {} };

  if (parsed.suite) {
    // Match by base name so every parameter set of one YAML test finds it.
    const suiteTest = parsed.suite.tests.find((t) => t.name === baseTitle);
    if (suiteTest) {
      enrichment.actionStepsMap = extractActionStepsFromTestFlow(suiteTest.testFlow);
      if (suiteTest.skip !== undefined) enrichment.skip = suiteTest.skip;
      if (suiteTest.slow) enrichment.slow = suiteTest.slow;
      if (suiteTest.timeout !== undefined) enrichment.timeout = suiteTest.timeout;
      enrichment.baseTitle = suiteTest.name || suiteTest.testFlow?.goal;
    }
    enrichment.suiteName = parsed.name;
    enrichment.parameterSetName = confirmParameterSetName(
      titleParameterSetName,
      suiteTest?.parameters,
    );
    if (typeof parsed.use?.baseURL === 'string') enrichment.baseUrl = parsed.use.baseURL;
    return enrichment;
  }

  if (parsed.testFlow) {
    enrichment.actionStepsMap = extractActionStepsFromTestFlow(parsed.testFlow);
    enrichment.baseTitle = parsed.name || parsed.testFlow.goal;
    enrichment.parameterSetName = confirmParameterSetName(
      titleParameterSetName,
      parsed.parameters,
    );
    if (typeof parsed.use?.baseURL === 'string') enrichment.baseUrl = parsed.use.baseURL;
  }

  return enrichment;
}
