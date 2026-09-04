import { TestCaseResultEntity } from '../entities/testCaseResultEntity';
import { TestCaseResultType } from '../constants';
import type { ActionEntity, ActionStepInfo } from 'shiplight-types';
import { TokenUsage } from '../interfaces/tokenUsage';

// Re-export ActionEntity for convenience
export type { ActionEntity };

/**
 * Step status values that indicate a failure.
 * Used for detecting failed steps across runner and frontend.
 */
export const STEP_FAILURE_STATUSES = ['failure', 'failed', 'error'] as const;

/** Check if a step status indicates failure. */
export function isStepFailureStatus(status: unknown): boolean {
  return typeof status === 'string' && (STEP_FAILURE_STATUSES as readonly string[]).includes(status);
}

export interface TestCaseStepResult {
  description: string;
  status?: string;
  message?: string;
  screenshotS3Uri?: string;
  startTime?: number;
  duration?: number;
  type?: string;
  code?: string;
  autoHealed?: boolean;
  healedAction?: ActionEntity;
  dismissedModalActions?: ActionEntity[];
  artifacts?: Array<{
    response_s3_path?: string;
    screenshot_s3_path?: string;
    system_prompt_s3_path?: string;
    user_prompt_s3_path?: string;
    messages_s3_path?: string;
  }>;
  /** Snapshot of test variables (sensitive values masked) just before this step ran. */
  contextBefore?: Record<string, unknown>;
  /** Snapshot of test variables (sensitive values masked) right after this step finished. */
  contextAfter?: Record<string, unknown>;
}

// common/models/testCaseResult.ts
export interface ConsoleLog {
  type: string;
  message: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
  stack?: string;
  timestamp?: number;
  stepId?: string;
}

export interface FullReport {
  createdAt: string;
  stdout: string;
  stderr: string;
  flaky?: boolean;
  testContextBefore?: Record<string, any>;
  testContextAfter?: Record<string, any>;
  resultJson?: Record<string, TestCaseStepResult>;
  consoleLogs?: ConsoleLog[];
  videoS3Uri?: string; // S3 URI of the video of the test run
  traceS3Uri?: string; // S3 URI of the trace file of the test run
  sourceS3Uri?: string; // S3 URI of the test source archive (test.ts + config.json)
  firstRunReport?: FullReport; // If this is a flaky test, this is the report of the first run
  summary?: string; // Summary of the test result
  actionStepsMap?: Record<string, ActionStepInfo>; // Mapping of step IDs to action entities at execution time
  error?: {
    // Error information if the test failed during setup/export (not during execution)
    message: string;
    stack?: string;
  };
  failureAnalysisId?: number; // Reference to test_failure_analyses.id (populated by runner after analysis)
  stateTransitionsS3Uri?: string; // S3 URI of the state transitions JSON file
}

/**
 * A single execution segment in a test run.
 * Each segment represents one Playwright execution with its results.
 */
export interface RunSegment {
  outcome: 'passed' | 'failed' | 'error';
  createdAt: string;
  fixId?: number; // If present → used AI fix; absent → original flow
  failureAnalysisId?: number; // If analysis was triggered after this segment
  isVerificationRun?: boolean; // Explicitly marks verification segments
  // Execution data
  stdout?: string;
  stderr?: string;
  resultJson?: Record<string, TestCaseStepResult>;
  consoleLogs?: ConsoleLog[];
  videoS3Uri?: string;
  traceS3Uri?: string;
  sourceS3Uri?: string;
  actionStepsMap?: Record<string, ActionStepInfo>;
  testContextBefore?: Record<string, any>;
  testContextAfter?: Record<string, any>;
  error?: { message: string; stack?: string };
  timedOut?: boolean;
  stateTransitionsS3Uri?: string;
  summary?: string;
}

/**
 * Version 2 report format with flat segments array.
 * Each segment is a single test execution in chronological order.
 * Top-level fields carry the runner's final decision — no inference needed by frontend.
 */
export interface ReportV2 {
  schemaVersion: 2;
  // Top-level runner decisions (authoritative)
  result: 'passed' | 'failed' | 'flaky' | 'error';
  usedFixId?: number; // The fix ID used for the final/winning result
  failureAnalysisId?: number; // If analysis was triggered during this run
  flaky?: boolean; // Explicit flaky flag
  // All execution segments in chronological order
  segments: RunSegment[];
}

/**
 * Migrate a v1 FullReport (possibly with nested firstRunReport) to ReportV2.
 */
export function migrateV1ToV2(legacy: FullReport): ReportV2 {
  const segments: RunSegment[] = [];

  // If there's a firstRunReport, it was the first (failed) run
  if (legacy.firstRunReport) {
    const firstRun = legacy.firstRunReport;
    segments.push({
      outcome: 'failed',
      createdAt: firstRun.createdAt,
      stdout: firstRun.stdout,
      stderr: firstRun.stderr,
      resultJson: firstRun.resultJson,
      consoleLogs: firstRun.consoleLogs,
      videoS3Uri: firstRun.videoS3Uri,
      traceS3Uri: firstRun.traceS3Uri,
      sourceS3Uri: firstRun.sourceS3Uri,
      actionStepsMap: firstRun.actionStepsMap,
      error: firstRun.error,
      timedOut: firstRun.error?.message === 'Test execution timed out' || undefined,
    });
  }

  // The main report is always the last segment
  const hasFailures = legacy.resultJson
    ? Object.values(legacy.resultJson).some((step) => isStepFailureStatus(step.status))
    : false;
  segments.push({
    outcome: legacy.error ? 'error' : hasFailures ? 'failed' : 'passed',
    createdAt: legacy.createdAt,
    failureAnalysisId: legacy.failureAnalysisId,
    stdout: legacy.stdout,
    stderr: legacy.stderr,
    resultJson: legacy.resultJson,
    consoleLogs: legacy.consoleLogs,
    videoS3Uri: legacy.videoS3Uri,
    traceS3Uri: legacy.traceS3Uri,
    sourceS3Uri: legacy.sourceS3Uri,
    actionStepsMap: legacy.actionStepsMap,
    testContextBefore: legacy.testContextBefore,
    testContextAfter: legacy.testContextAfter,
    error: legacy.error,
    timedOut: legacy.error?.message === 'Test execution timed out' || undefined,
    stateTransitionsS3Uri: legacy.stateTransitionsS3Uri,
    summary: legacy.summary,
  });

  const lastSegment = segments[segments.length - 1];
  return {
    schemaVersion: 2,
    result: legacy.error ? 'error' : legacy.flaky ? 'flaky' : lastSegment.outcome === 'failed' ? 'failed' : 'passed',
    usedFixId: undefined, // V1 didn't track fix usage in the report
    failureAnalysisId: legacy.failureAnalysisId,
    flaky: legacy.flaky,
    segments,
  };
}

export interface ShortReport {
  createdAt: string;
  flaky?: boolean;
  resultJson?: Record<string, TestCaseStepResult>;
  videoS3Uri?: string;
  traceS3Uri?: string;
  sourceS3Uri?: string; // S3 URI of the test source archive (test.ts + config.json)
  hasLogs?: boolean;
  hasFirstRunReport?: boolean;
  summary?: string; // Summary of the test result
}

export interface ParameterSetSnapshot {
  id: string;
  label: string;
  variables: Array<{ name: string; value: string; isSensitive: boolean }>;
  enabled?: boolean;
}

export interface TestCaseResultMetadata {
  /** Full snapshot of the parameter set at execution time */
  parameterSet?: ParameterSetSnapshot;
  /** Test case name for LOCAL_CLI runs that have no testCaseId */
  testCaseName?: string;
  /** File path of the test case */
  file?: string;
}

export class TestCaseResult {
  constructor(
    public organizationId: string, // Required field
    public id?: number, // Optional fields with `?`
    public testRunId?: number,
    public testSuiteResultId?: number,
    public device?: string,
    public result?: string,
    public startTime?: Date,
    public endTime?: Date,
    public duration?: number,
    public testCaseId?: number,
    public video?: string,
    public trace?: string,
    public status?: string,
    public environmentName?: string,
    public environmentId?: number,
    public environmentUrl?: string,
    public type?: TestCaseResultType,
    public mainResultId?: number,
    public report?: ShortReport[],
    public testAccountGroup?: Record<string, any>,
    public resolvedTestAccount?: Record<string, any>,
    public reportS3Uri?: string,
    public summary?: string, // Summary of the test result
    public tokenUsages?: TokenUsage[],
    public hardCaseSteps?: string[], // Step IDs marked as hard cases for evaluation
    public usedFixId?: number, // Reference to test_case_fixes.id if this test was run using an AI-generated fix
    public metadata?: TestCaseResultMetadata,
  ) {}

  // Static factory method to create a TestCaseResult from an entity
  static fromEntity(entity: TestCaseResultEntity): TestCaseResult {
    return new TestCaseResult(
      entity.organization_id,
      entity.id,
      entity.test_run_id,
      entity.test_suite_result_id,
      entity.device,
      entity.result,
      entity.start_time ? new Date(entity.start_time) : undefined,
      entity.end_time ? new Date(entity.end_time) : undefined,
      entity.duration,
      entity.test_case_id,
      entity.video,
      entity.trace,
      entity.status,
      entity.environment_name,
      entity.environment_id,
      entity.environment_url,
      entity.type as TestCaseResultType,
      entity.main_result_id,
      entity.report as ShortReport[],
      entity.test_account_group,
      entity.resolved_test_account,
      entity.report_s3_uri,
      entity.summary,
      entity.token_usages,
      entity.hard_case_steps,
      entity.used_fix_id,
      entity.metadata as TestCaseResultMetadata | undefined,
    );
  }

  // Builder pattern for constructing the object
  static builder(organizationId: string) {
    return new TestCaseResultBuilder(organizationId);
  }

  // Method to convert this TestCaseResult object back to a TestCaseResultEntity
  toEntity(): TestCaseResultEntity {
    return {
      organization_id: this.organizationId,
      id: this.id,
      test_run_id: this.testRunId,
      test_suite_result_id: this.testSuiteResultId ?? undefined,
      device: this.device ?? undefined,
      result: this.result ?? undefined,
      start_time: this.startTime?.toISOString() ?? undefined,
      end_time: this.endTime?.toISOString() ?? undefined,
      duration: this.duration ?? undefined,

      test_case_id: this.testCaseId ?? undefined,
      video: this.video ?? undefined,
      trace: this.trace ?? undefined,
      status: this.status ?? undefined,
      environment_name: this.environmentName ?? undefined,
      environment_id: this.environmentId ?? undefined,
      environment_url: this.environmentUrl ?? undefined,
      type: this.type ?? undefined,
      main_result_id: this.mainResultId ?? undefined,
      report: this.report ?? undefined,
      test_account_group: this.testAccountGroup ?? undefined,
      resolved_test_account: this.resolvedTestAccount ?? undefined,
      report_s3_uri: this.reportS3Uri ?? undefined,
      summary: this.summary ?? undefined,
      token_usages: this.tokenUsages ?? undefined,
      hard_case_steps: this.hardCaseSteps ?? undefined,
      used_fix_id: this.usedFixId ?? undefined,
      metadata: this.metadata ?? undefined,
    };
  }
}

// Builder class for TestCaseResult
export class TestCaseResultBuilder {
  private id?: number;
  private testRunId?: number;
  private testSuiteResultId?: number;
  private device?: string;
  private result?: string;
  private startTime?: Date;
  private endTime?: Date;
  private duration?: number;
  private testCaseId?: number;
  private video?: string;
  private trace?: string;
  private status?: string;
  private environmentName?: string;
  private environmentId?: number;
  private environmentUrl?: string;
  private type?: TestCaseResultType;
  private mainResultId?: number;
  private report?: ShortReport[];
  private testAccountGroup?: Record<string, any>;
  private resolvedTestAccount?: Record<string, any>;
  private reportS3Uri?: string;
  private summary?: string; // Summary of the test result
  private tokenUsages?: TokenUsage[];
  private hardCaseSteps?: string[];
  private usedFixId?: number;
  private metadata?: TestCaseResultMetadata;

  constructor(private organizationId: string) {} // Required field

  withId(id: number) {
    this.id = id;
    return this;
  }

  withTestRunId(testRunId: number) {
    this.testRunId = testRunId;
    return this;
  }

  withTestSuiteResultId(testSuiteResultId: number) {
    this.testSuiteResultId = testSuiteResultId;
    return this;
  }

  withDevice(device: string) {
    this.device = device;
    return this;
  }

  withResult(result: string) {
    this.result = result;
    return this;
  }

  withStartTime(startTime: Date) {
    this.startTime = startTime;
    return this;
  }

  withEndTime(endTime: Date) {
    this.endTime = endTime;
    return this;
  }

  withTestCaseId(testCaseId: number) {
    this.testCaseId = testCaseId;
    return this;
  }

  withVideo(video: string) {
    this.video = video;
    return this;
  }

  withTrace(trace: string) {
    this.trace = trace;
    return this;
  }

  withStatus(status: string) {
    this.status = status;
    return this;
  }

  withType(type: TestCaseResultType) {
    this.type = type;
    return this;
  }

  withMainResultId(mainResultId: number) {
    this.mainResultId = mainResultId;
    return this;
  }

  withEnvironmentName(environmentName: string) {
    this.environmentName = environmentName;
    return this;
  }

  withEnvironmentId(environmentId: number) {
    this.environmentId = environmentId;
    return this;
  }

  withEnvironmentUrl(environmentUrl: string) {
    this.environmentUrl = environmentUrl;
    return this;
  }

  withReport(report: ShortReport[]) {
    this.report = report;
    return this;
  }

  withTestAccountGroup(testAccountGroup: Record<string, any>) {
    this.testAccountGroup = testAccountGroup;
    return this;
  }

  withResolvedTestAccount(resolvedTestAccount: Record<string, any>) {
    this.resolvedTestAccount = resolvedTestAccount;
    return this;
  }

  withReportS3Uri(reportS3Uri: string) {
    this.reportS3Uri = reportS3Uri;
    return this;
  }

  withSummary(summary: string) {
    this.summary = summary;
    return this;
  }

  withTokenUsages(tokenUsages: TokenUsage[]) {
    this.tokenUsages = tokenUsages;
    return this;
  }

  withHardCaseSteps(hardCaseSteps: string[]) {
    this.hardCaseSteps = hardCaseSteps;
    return this;
  }

  withUsedFixId(usedFixId: number) {
    this.usedFixId = usedFixId;
    return this;
  }

  withMetadata(metadata: TestCaseResultMetadata) {
    this.metadata = metadata;
    return this;
  }

  build(): TestCaseResult {
    return new TestCaseResult(
      this.organizationId,
      this.id,
      this.testRunId,
      this.testSuiteResultId,
      this.device,
      this.result,
      this.startTime,
      this.endTime,
      this.duration,
      this.testCaseId,
      this.video,
      this.trace,
      this.status,
      this.environmentName,
      this.environmentId,
      this.environmentUrl,
      this.type,
      this.mainResultId,
      this.report,
      this.testAccountGroup,
      this.resolvedTestAccount,
      this.reportS3Uri,
      this.summary,
      this.tokenUsages,
      this.hardCaseSteps,
      this.usedFixId,
      this.metadata,
    );
  }
}
