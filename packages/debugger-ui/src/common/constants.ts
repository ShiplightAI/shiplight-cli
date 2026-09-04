export enum TestRunStatus {
  NotStarted = "Not Started",
  Running = "Running",
  WaitingRerun = "Waiting Rerun",
  Finished = "Finished",
  Skipped = "Skipped",
}

export enum TestCaseCreationMode {
  SINGLE = "SINGLE",
  BATCH = "BATCH",
  CSV_UPLOAD = "CSV_UPLOAD",
  NATURAL_LANGUAGE_FLOW = "NATURAL_LANGUAGE_FLOW",
}

export enum TestBatchGenTaskStatus {
  NotStarted = "Not Started",
  Running = "Running",
  Completed = "Completed",
  Failed = "Failed",
  Finished = "Finished", // all test cases are generated
  Closed = "Closed", // all test cases are generated and updated from now over 10 minutes
}

export enum TestRunResult {
  Queued = "Queued",
  Pending = "Pending",
  Analyzing = "Analyzing",
  Passed = "Passed",
  Failed = "Failed",
  Skipped = "Skipped",
}

export enum AgentTaskStatus {
  Pending = "Pending",
  Queued = "Queued",
  Running = "Running",
  Completed = "Completed",
  Failed = "Failed",
}

export enum TestStepActionType {
  Action = "Action",
  Assertion = "Assertion",
  Code = "Code",
  Function = "Function",
  UploadFile = "UploadFile",
  ExtractContent = "ExtractContent",
  AiAction = "AiAction",
  AiStep = "AiStep",
  Login = "Login",
  WaitUntil = "WaitUntil",
  Reusable = "reusable",
  ExtractEmailContent = "ExtractEmailContent",
}

export enum TestStepActionMode {
  Default = "Default",
  Dynamic = "Dynamic",
}

export enum TestCaseStatus {
  Active = "Active",
  // Disabled = "Disabled", // TODO: remove this
  Generating = "Generating",
  Queued = "Queued",
  Draft = "Draft",
}

export enum TestCaseType {
  Main = "Main",
  Setup = "Setup",
  Teardown = "Teardown",
}

// Values are stored verbatim in the `test_runs.trigger` text column and matched
// exactly by the run-results filter, so they must stay in sync with the CI
// detection in apps/cli/src/reporter/cloudUpload.ts (`CI_PROVIDERS`). A run
// uploaded with `shiplight report --trigger <name>` may carry a value outside
// this enum — that is supported, it just cannot be selected in the filter.
export enum TestRunTrigger {
  API = "API",
  Manual = "Manual",
  Scheduled = "Scheduled",
  GithubAction = "GITHUB_ACTION",
  GitlabCi = "GITLAB_CI",
  CircleCi = "CIRCLECI",
  Webhook = "Webhook",
  Automation = "Automation",
  LocalCli = "Local",
}

export enum TestPlanStatus {
  Disabled = "Disabled",
  Active = "Active",
}

export enum TestRunTriggerType {
  TestCase = "TestCase",
  TestSuite = "TestSuite",
  TestPlan = "TestPlan",
}

export enum TestRunType {
  Main = "Main",
  Setup = "Setup",
  Teardown = "Teardown",
  Dependency = "Dependency",
}

export enum TestCaseResultType {
  Main = "Main",
  Preflight = "Preflight",
  Setup = "Setup",
  Teardown = "Teardown",
  Dependency = "Dependency",
}

export enum TestAccountType {
  None = "None",
  SharedAccount = "Shared Account",
  DedicatedAccount = "Dedicated Account",
}

export enum TestAccountGroupType {
  None = "None",
  Any = "Any",
  Specific = "Specific",
  Dynamic = "Dynamic",
}

export enum LoginType {
  Regular = "Regular",
  OAuth = "OAuth",
  None = "None",
}

export enum TestCaseSourceMode {
  Agent = "Agent",
  Code = "Code",
}

export enum TestFunctionStatus {
  Draft = "Draft",
  Active = "Active",
  // Disabled = "Disabled", // TODO: remove this
}

export enum OrganizationMemberStatus {
  Pending = "pending",
  Active = "active",
  Inactive = "inactive",
  Revoked = "revoked",
}

export enum OrganizationMemberRole {
  Admin = "admin",
  Member = "member",
}

export enum OrganizationMemberJoinedVia {
  Invitation = "invitation",
  DomainAutoJoin = "domain_auto_join",
}

// Different triggers for the Slack channel notifications
export enum TestPlanSubSlackTrigger {
  All = "All",
  Failed = "Failed",
  Passed = "Passed",
  PassToFail = "PassToFail",
  FailToPass = "FailToPass",
}

export enum TestPlanRuntime {
  Production = "Production",
  Staging = "Staging",
  Development = "Development",
}

// Platform for Device
export enum DevicePlatform {
  Desktop = "desktop",
  Mobile = "mobile",
  All = "all"
}

// Platform for TestLoginConfig
export enum TestLoginConfigPlatform {
  Desktop = "desktop",
  Mobile = "mobile",
}

// Knowledge usage scenario
export enum KnowledgeUsageScenario {
  General = "general",
  Login = "login",
}

// Admin organization ID constant
export const ROOT_ADMIN_ORG_ID = "shiplight-root-admin";

// Header name for organization ID in admin requests
export const ORG_ID_HEADER = "organization-id";

// S3 bucket suffix for environment isolation (e.g., "-staging")
// Set S3_BUCKET_SUFFIX env var to separate staging from production buckets
export const S3_BUCKET_SUFFIX = process.env.S3_BUCKET_SUFFIX || '';

// Bucket name for storing test run artifacts
export const TEST_RUN_ARTIFACTS_BUCKET = `shiplight-test-runs${S3_BUCKET_SUFFIX}`;

// Bucket name for storing interactive run artifacts
export const INT_RUN_ARTIFACTS_BUCKET = `shiplight-int-runs${S3_BUCKET_SUFFIX}`;

// Bucket name for storing storage states
export const STORAGE_STATE_BUCKET = `shiplight-storage-states${S3_BUCKET_SUFFIX}`;

// Bucket name for storing agent task artifacts
export const AGENT_TASKS_BUCKET = `shiplight-agent-tasks${S3_BUCKET_SUFFIX}`;

// Bucket name for storing agent API step artifacts
export const AGENT_API_ARTIFACTS_BUCKET = `shiplight-agent-api${S3_BUCKET_SUFFIX}`;

// Bucket name for storing MCP session video recordings
export const MCP_VIDEOS_BUCKET = `shiplight-mcp-videos${S3_BUCKET_SUFFIX}`;

// Slack OAuth callback URL
export const SLACK_OAUTH_CALLBACK_PATH = "/oauth/callbacks/slack";

// Browser constants - re-exported from shiplight-types
export {
  USER_AGENT,
  ADDRESS_BAR_HEIGHT,
  WINDOW_WIDTH,
  WINDOW_HEIGHT,
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  RECORD_VIDEO_WIDTH,
  RECORD_VIDEO_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  DEFAULT_DEVICE_NAME,
} from 'shiplight-types';

export const INIT_SCRIPT = `
// check to make sure we're not inside the PDF viewer
window.isPdfViewer = !!document?.body?.querySelector('body > embed[type="application/pdf"][width="100%"]')
if (!window.isPdfViewer) {

  // Permissions
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );
  (() => {
    if (window._eventListenerTrackerInitialized) return;
    window._eventListenerTrackerInitialized = true;

    const originalAddEventListener = EventTarget.prototype.addEventListener;
    const eventListenersMap = new WeakMap();

    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (typeof listener === "function") {
        let listeners = eventListenersMap.get(this);
        if (!listeners) {
          listeners = [];
          eventListenersMap.set(this, listeners);
        }

        listeners.push({
          type,
          listener,
          listenerPreview: listener.toString().slice(0, 100),
          options
        });
      }

      return originalAddEventListener.call(this, type, listener, options);
    };

    window.getEventListenersForNode = (node) => {
      const listeners = eventListenersMap.get(node) || [];
      return listeners.map(({ type, listenerPreview, options }) => ({
        type,
        listenerPreview,
        options
      }));
    };
  })();

  // Inject CSS to hide recorder toolbar
  console.log('Injecting CSS to hide recorder toolbar');
          
  // Function to inject CSS when DOM is ready
  function injectCSS() {
    if (!document.head) {
      // If head is not ready, wait for DOMContentLoaded
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectCSS);
        return;
      }
      // If still no head, create it
      if (!document.head) {
        const head = document.createElement('head');
        document.documentElement.insertBefore(head, document.documentElement.firstChild);
      }
    }
    
    const style = document.createElement('style');
    style.textContent = \`
      x-pw-glass,
      x-pw-toolbar,
      x-pw-tool-item,
      [class*="pw-tool"],
      [class*="playwright-recorder"],
      .recorder-toolbar,
      .pw-toolbar,
      .pw-glass {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        position: absolute !important;
        left: -9999px !important;
        top: -9999px !important;
      }
    \`;
    document.head.appendChild(style);
    console.log('CSS injected successfully');
  }
  
  // Try to inject immediately, or wait for DOM
  injectCSS();
}
`
