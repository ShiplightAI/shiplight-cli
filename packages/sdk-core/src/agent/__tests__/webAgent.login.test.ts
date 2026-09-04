/**
 * Unit tests for the WebAgent.login() and WebAgent.generate2faCode() helpers.
 *
 * login() is a thin façade over loginPage() — we stub loginPage on the
 * instance to capture the LoginConfig it builds and to control the result,
 * so these tests assert the mapping (options -> LoginConfig) and the boolean
 * return contract without exercising real browser/LLM login internals.
 *
 * generate2faCode() delegates to agentServices.generate2faCode — we stub that
 * to assert the delegation contract (TOTP generation itself is exercised
 * elsewhere / by the otp library).
 *
 * Uses the same module mocks as webAgent.maxSteps.test.ts — WebAgent's import
 * chain pulls in ?raw dom assets and browser modules that fail outside bundlers.
 */

import assert from 'node:assert';
import { describe, it, mock } from 'node:test';

// --- Module-level mocks (must be set up before dynamic imports) ---

mock.module('../agentHelpers', {
  namedExports: {
    executeStep: mock.fn(),
    runTask: mock.fn(),
    evaluateStatement: mock.fn(),
    generateActionStep: mock.fn(),
  },
});

mock.module('../../dom', {
  namedExports: {
    DomService: class MockDomService {},
    HistoryTreeProcessor: class {},
  },
});

mock.module('../agentWait', {
  namedExports: {
    waitUntilStable: async () => {},
    waitUntilCondition: async () => true,
    waitForDownloadComplete: async () => {},
  },
});

mock.module('../../browser/browserUtils', {
  namedExports: {
    waitForPageAndFramesLoad: async () => {},
    getBrowserCdpUrl: async () => '',
    getPageInfo: async () => ({}),
    getPageWsUrl: () => '',
    newBrowserContext: async () => ({}),
    setWindowBounds: async () => {},
  },
});

mock.module('../../browser/tabManager', {
  namedExports: {
    TabManager: class MockTabManager {
      getCurrentPage() { return null; }
    },
  },
});

// --- Dynamic imports (after mocks are set up) ---

const { WebAgent } = await import('../webAgent');
const { VariableStore, LoginType, TwoFactorAuthType } = await import('shiplight-types');

// --- Helpers ---

function createPageStub() {
  const page = {
    url: () => 'https://example.com',
    isClosed: () => false,
    context: () => ({ storageState: async () => ({}), pages: () => [page] }),
    on: () => {},
  } as any;
  return page;
}

function createAgent() {
  const variableStore = new VariableStore();
  const context = {
    model: 'test-model',
    variableStore,
    executionHistory: [],
    tokenUsages: [],
    aiActionDetails: [],
  };
  return new WebAgent(context as any);
}

// --- Tests ---

describe('WebAgent.login()', () => {
  it('maps options to a PASSWORD LoginConfig and delegates to loginPage', async () => {
    const agent = createAgent();
    const page = createPageStub();
    const loginPageMock = mock.fn(async () => ({ success: true, page }));
    (agent as any).loginPage = loginPageMock;

    const result = await agent.login(page, {
      url: 'https://app.example.com/login',
      username: 'user@example.com',
      password: 'secret123',
    });

    assert.strictEqual(result, true);
    assert.strictEqual(loginPageMock.mock.callCount(), 1);

    const [passedPage, config] = loginPageMock.mock.calls[0].arguments as [unknown, any];
    assert.strictEqual(passedPage, page);
    assert.strictEqual(config.site_url, 'https://app.example.com/login');
    // num_verification_exprs: 0 skips validation-expr generation for simple login.
    assert.strictEqual(config.num_verification_exprs, 0);
    assert.strictEqual(config.account.type, LoginType.PASSWORD);
    assert.strictEqual(config.account.username, 'user@example.com');
    assert.strictEqual(config.account.password, 'secret123');
    // No TOTP secret -> no 2FA config.
    assert.strictEqual(config.account.two_factor_auth_config, undefined);
  });

  it('adds a TOTP two_factor_auth_config when totpSecret is provided', async () => {
    const agent = createAgent();
    const page = createPageStub();
    const loginPageMock = mock.fn(async () => ({ success: true, page }));
    (agent as any).loginPage = loginPageMock;

    await agent.login(page, {
      url: '/login',
      username: 'user@example.com',
      password: 'secret123',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });

    const [, config] = loginPageMock.mock.calls[0].arguments as [unknown, any];
    assert.deepStrictEqual(config.account.two_factor_auth_config, {
      type: TwoFactorAuthType.TOTP,
      data: 'JBSWY3DPEHPK3PXP',
    });
  });

  it('returns false when loginPage reports failure', async () => {
    const agent = createAgent();
    const page = createPageStub();
    (agent as any).loginPage = mock.fn(async () => ({ success: false, page }));

    const result = await agent.login(page, {
      url: '/login',
      username: 'user@example.com',
      password: 'secret123',
    });

    assert.strictEqual(result, false);
  });
});

describe('WebAgent.generate2faCode()', () => {
  it('delegates to agentServices.generate2faCode and returns its result', async () => {
    const agent = createAgent();
    const genMock = mock.fn(async () => '123456');
    (agent.agentServices as any).generate2faCode = genMock;

    const code = await agent.generate2faCode('JBSWY3DPEHPK3PXP');

    assert.strictEqual(code, '123456');
    assert.strictEqual(genMock.mock.callCount(), 1);
    assert.deepStrictEqual(genMock.mock.calls[0].arguments, ['JBSWY3DPEHPK3PXP']);
  });
});
