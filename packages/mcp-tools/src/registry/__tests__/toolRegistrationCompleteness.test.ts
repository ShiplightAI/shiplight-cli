import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../toolRegistry.js';
import type { ToolDefinition } from '../../types/index.js';
import { SessionTools } from '../../tools/sessionTools.js';
import { BrowserTools } from '../../tools/browserTools.js';
import { DebugTools } from '../../tools/debugTools.js';
import { LocalTestTools } from '../../tools/localTestTools.js';
import { RelayTools } from '../../tools/relayTools.js';

/**
 * Guards the registerAll/registerTools "silent skip" footgun against the REAL
 * tool classes the server registers. registerAll resolves each ToolDefinition's
 * `name` to an instance method via a hardcoded methodMappings table in
 * ToolRegistry; a definition whose name is missing from that table (or whose
 * method is absent on the instance) is dropped with NO error. A tool added to a
 * class but not to the mapping would silently vanish from the published server.
 *
 * Construction note: every tool-class constructor only stores its backend/api
 * refs — it does no work — so stub args are sufficient to exercise registration
 * (we never invoke a handler here).
 */
const stub = {} as never;

function expectedNames(toolDefinitions: ToolDefinition[]): string[] {
  return toolDefinitions.map((d) => d.name).sort();
}

function registeredVia(
  ToolClass: { toolDefinitions: ToolDefinition[] },
  instance: object
): string[] {
  return new ToolRegistry().registerAll(ToolClass, instance).getRegisteredToolNames().sort();
}

describe('tool registration completeness (real tool classes)', () => {
  it('SessionTools: every toolDefinition registers', () => {
    assert.deepEqual(
      registeredVia(SessionTools, new SessionTools(stub)),
      expectedNames(SessionTools.toolDefinitions)
    );
  });

  it('BrowserTools: every toolDefinition registers', () => {
    assert.deepEqual(
      registeredVia(BrowserTools, new BrowserTools(stub)),
      expectedNames(BrowserTools.toolDefinitions)
    );
  });

  it('DebugTools: every toolDefinition registers', () => {
    assert.deepEqual(
      registeredVia(DebugTools, new DebugTools(stub)),
      expectedNames(DebugTools.toolDefinitions)
    );
  });

  it('LocalTestTools: every toolDefinition registers', () => {
    assert.deepEqual(
      registeredVia(LocalTestTools, new LocalTestTools()),
      expectedNames(LocalTestTools.toolDefinitions)
    );
  });


  it('RelayTools: every toolDefinition registers', () => {
    assert.deepEqual(
      registeredVia(RelayTools, new RelayTools(stub)),
      expectedNames(RelayTools.toolDefinitions)
    );
  });


  it('SessionTools: the methods the server selectively registers all resolve', () => {
    // server.ts registers SessionTools via registerTools (NOT registerAll) to
    // drop close_all + get_session_state. registerTools silently skips a method
    // it can't resolve, so a rename would vanish the tool with no error.
    const serverSelected = ['newSession', 'saveStorageState', 'closeSession'] as const;
    const registry = new ToolRegistry();
    registry.registerTools(SessionTools, new SessionTools(stub), [...serverSelected]);
    assert.deepEqual(
      registry.getRegisteredToolNames().sort(),
      ['close_session', 'new_session', 'save_storage_state'],
      'some server-selected SessionTools methods did not resolve to a tool definition'
    );
  });

  it('DebugTools: the methods the server selectively registers all resolve', () => {
    // server.ts registers DebugTools via registerTools to drop clear_logs.
    const serverSelected = ['getConsoleLogs', 'getNetworkLogs'] as const;
    const registry = new ToolRegistry();
    registry.registerTools(DebugTools, new DebugTools(stub), [...serverSelected]);
    assert.deepEqual(
      registry.getRegisteredToolNames().sort(),
      ['get_browser_console_logs', 'get_browser_network_logs'],
      'some server-selected DebugTools methods did not resolve to a tool definition'
    );
  });
});
