// common/entities/testCaseResultEntity.ts
import { TokenUsage } from "../interfaces/tokenUsage";

export interface TestCaseResultEntity {
  organization_id: string;
  id?: number;
  test_run_id?: number;
  test_suite_result_id?: number;
  device?: string;
  result?: string;
  start_time?: string;
  end_time?: string;
  duration?: number;
  test_case_id?: number;
  video?: string;
  trace?: string;
  status?: string;
  environment_name?: string;
  environment_id?: number;
  environment_url?: string;
  type?: string;
  main_result_id?: number;
  report?: Record<string, any>;
  test_account_group?: Record<string, any>;
  resolved_test_account?: Record<string, any>;
  report_s3_uri?: string;
  token_usages?: TokenUsage[];
  hard_case_steps?: string[];
  used_fix_id?: number;

  /** Arbitrary result metadata (e.g. parameter set snapshot at execution time) */
  metadata?: Record<string, any>;

  /**
   * @deprecated Use TestResultAiSummaryEntity instead for type safety
   * Manual summary of the test result (will be replaced by AI summary)
   */
  summary?: string;

  /**
   * @deprecated Use TestResultAiSummaryEntity for proper typing
   * AI-generated summary metadata stored as JSONB
   * See: TestResultAiSummaryEntity in entities/testResultAiSummaryEntity.ts
   */
  ai_summary_metadata?: Record<string, any>;
}
