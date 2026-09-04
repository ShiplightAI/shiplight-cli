// common/view-models/testCaseDetails.ts

import { TestCase } from "../models/testCase";
import { TestCaseResult } from "../models/testCaseResult";
import { Environment } from "../models/environment";
import type { TestAccountGroupConfig } from "../entities/testEnvironmentConfigEntity";

export interface TestCaseDetails {
  testCase: TestCase;
  latestRunResult: TestCaseResult | null;
  environment: Environment | null;
  testAccountGroup: TestAccountGroupConfig | null;
}
