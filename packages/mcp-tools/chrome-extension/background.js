import { buildRelayWsUrl, isRetryableReconnectError, reconnectDelayMs } from './background-utils.js'

const BADGE = {
  on: { text: 'ON', color: '#FF5A36' },
  off: { text: '', color: '#000000' },
  connecting: { text: '…', color: '#F59E0B' },
  error: { text: '!', color: '#B91C1C' },
  unconfigured: { text: '?', color: '#9CA3AF' },
}

/** @type {WebSocket|null} */
let relayWs = null
/** @type {Promise<void>|null} */
let relayConnectPromise = null
let nextSession = 1

/** @type {Map<number, {state:'connecting'|'connected', sessionId?:string, targetId?:string}>} */
const tabs = new Map()
/** @type {Map<string, number>} */
const tabBySession = new Map()

/** @type {Map<number, {resolve:(v:any)=>void, reject:(e:Error)=>void}>} */
const pending = new Map()

// Per-tab operation locks prevent double-attach races.
/** @type {Set<number>} */
const tabOperationLocks = new Set()

// Tabs currently in a detach/re-attach cycle after navigation.
/** @type {Set<number>} */
const reattachPending = new Set()

// Reconnect state for exponential backoff.
let reconnectAttempt = 0
let reconnectTimer = null

/** @returns {Promise<number|null>} configured port or null if not set */
async function getRelayPort() {
  const stored = await chrome.storage.local.get(['relayPort'])
  const raw = stored.relayPort
  const n = Number.parseInt(String(raw || ''), 10)
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return null
  return n
}

function setBadge(tabId, kind) {
  const cfg = BADGE[kind]
  void chrome.action.setBadgeText({ tabId, text: cfg.text })
  void chrome.action.setBadgeBackgroundColor({ tabId, color: cfg.color })
  void chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' }).catch(() => {})
}

/** Badge kind reflecting current relay connection state. */
function relayBadgeKind() {
  return relayWs?.readyState === WebSocket.OPEN ? 'on' : 'connecting'
}

// Persist attached tab state to survive MV3 service worker restarts.
async function persistState() {
  try {
    const tabEntries = []
    for (const [tabId, tab] of tabs.entries()) {
      if (tab.state === 'connected' && tab.sessionId && tab.targetId) {
        tabEntries.push({ tabId, sessionId: tab.sessionId, targetId: tab.targetId })
      }
    }
    await chrome.storage.session.set({
      persistedTabs: tabEntries,
      nextSession,
    })
  } catch {
    // chrome.storage.session may not be available in all contexts.
  }
}

// Rehydrate tab state on service worker startup.
async function rehydrateState() {
  try {
    const stored = await chrome.storage.session.get(['persistedTabs', 'nextSession'])
    if (stored.nextSession) {
      nextSession = Math.max(nextSession, stored.nextSession)
    }
    const entries = stored.persistedTabs || []
    // Phase 1: restore state and badges (reflect actual relay connection state).
    for (const entry of entries) {
      tabs.set(entry.tabId, {
        state: 'connected',
        sessionId: entry.sessionId,
        targetId: entry.targetId,
      })
      tabBySession.set(entry.sessionId, entry.tabId)
      setBadge(entry.tabId, relayBadgeKind())
    }
    // Phase 2: validate asynchronously, remove dead tabs.
    for (const entry of entries) {
      try {
        await chrome.tabs.get(entry.tabId)
        await chrome.debugger.sendCommand({ tabId: entry.tabId }, 'Runtime.evaluate', {
          expression: '1',
          returnByValue: true,
        })
      } catch {
        tabs.delete(entry.tabId)
        tabBySession.delete(entry.sessionId)
        setBadge(entry.tabId, 'off')
      }
    }
  } catch {
    // Ignore rehydration errors.
  }
}

async function ensureRelayConnection() {
  if (relayWs && relayWs.readyState === WebSocket.OPEN) return
  if (relayConnectPromise) return await relayConnectPromise

  relayConnectPromise = (async () => {
    const port = await getRelayPort()
    if (!port) throw new Error('No relay port configured')
    const httpBase = `http://127.0.0.1:${port}`
    const wsUrl = buildRelayWsUrl(port)

    // Fast preflight: is the relay server up?
    try {
      await fetch(`${httpBase}/`, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
    } catch (err) {
      throw new Error(`Relay server not reachable at ${httpBase} (${String(err)})`)
    }

    const ws = new WebSocket(wsUrl)
    relayWs = ws
    // Bind message handler before open so an immediate first frame cannot be missed.
    ws.onmessage = (event) => {
      if (ws !== relayWs) return
      void whenReady(() => onRelayMessage(String(event.data || '')))
    }

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000)
      ws.onopen = () => {
        clearTimeout(t)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(t)
        reject(new Error('WebSocket connect failed'))
      }
      ws.onclose = (ev) => {
        clearTimeout(t)
        reject(new Error(`WebSocket closed (${ev.code} ${ev.reason || 'no reason'})`))
      }
    })

    // Bind permanent handlers.
    ws.onclose = () => {
      if (ws !== relayWs) return
      onRelayClosed('closed')
    }
    ws.onerror = () => {
      if (ws !== relayWs) return
      onRelayClosed('error')
    }
  })()

  try {
    await relayConnectPromise
    reconnectAttempt = 0
  } finally {
    relayConnectPromise = null
  }
}

// Relay closed — update badges, reject pending requests, auto-reconnect.
function onRelayClosed(reason) {
  relayWs = null

  for (const [id, p] of pending.entries()) {
    pending.delete(id)
    p.reject(new Error(`Relay disconnected (${reason})`))
  }

  reattachPending.clear()

  for (const [tabId, tab] of tabs.entries()) {
    if (tab.state === 'connected') {
      setBadge(tabId, 'connecting')
      void chrome.action.setTitle({
        tabId,
        title: 'Shiplight AI: relay reconnecting…',
      })
    }
  }

  scheduleReconnect()
}

function scheduleReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const delay = reconnectDelayMs(reconnectAttempt)
  reconnectAttempt++

  console.log(`Scheduling reconnect attempt ${reconnectAttempt} in ${Math.round(delay)}ms`)

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    try {
      await ensureRelayConnection()
      reconnectAttempt = 0
      console.log('Reconnected successfully')
      await reannounceAttachedTabs()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`Reconnect attempt ${reconnectAttempt} failed: ${message}`)
      if (!isRetryableReconnectError(err)) {
        return
      }
      scheduleReconnect()
    }
  }, delay)
}

function cancelReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempt = 0
}

// Re-announce all attached tabs to the relay after reconnect.
async function reannounceAttachedTabs() {
  for (const [tabId, tab] of tabs.entries()) {
    if (tab.state !== 'connected' || !tab.sessionId || !tab.targetId) continue

    // Verify debugger is still attached.
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: '1',
        returnByValue: true,
      })
    } catch {
      tabs.delete(tabId)
      if (tab.sessionId) tabBySession.delete(tab.sessionId)
      setBadge(tabId, 'off')
      void chrome.action.setTitle({
        tabId,
        title: 'Shiplight AI (click to attach/detach)',
      })
      continue
    }

    // Send fresh attach event to relay.
    try {
      const info = /** @type {any} */ (
        await chrome.debugger.sendCommand({ tabId }, 'Target.getTargetInfo')
      )
      const targetInfo = info?.targetInfo

      sendToRelay({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.attachedToTarget',
          params: {
            sessionId: tab.sessionId,
            targetInfo: { ...targetInfo, tabId, attached: true },
            waitingForDebugger: false,
          },
        },
      })

      setBadge(tabId, 'on')
      void chrome.action.setTitle({
        tabId,
        title: 'Shiplight AI: attached (click to detach)',
      })
    } catch {
      setBadge(tabId, 'on')
    }
  }

  await persistState()
}

function sendToRelay(payload) {
  const ws = relayWs
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Relay not connected')
  }
  ws.send(JSON.stringify(payload))
}

function requestFromRelay(command) {
  const id = command.id
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Relay request timeout (30s)'))
    }, 30000)
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v) },
      reject: (e) => { clearTimeout(timer); reject(e) },
    })
    try {
      sendToRelay(command)
    } catch (err) {
      clearTimeout(timer)
      pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

async function onRelayMessage(text) {
  /** @type {any} */
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    return
  }

  // Handle CDP command from relay
  if (msg && typeof msg.id === 'number' && msg.method === 'forwardCDPCommand') {
    const { method, params, sessionId } = msg.params || {}
    const tabId = tabBySession.get(sessionId)
    if (!tabId) {
      // No tab found for this session
      sendToRelay({
        id: msg.id,
        error: { message: `No tab found for session ${sessionId}` },
      })
      return
    }

    try {
      // Add timeout wrapper - chrome.debugger.sendCommand can hang indefinitely
      const result = await Promise.race([
        chrome.debugger.sendCommand({ tabId }, method, params),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`CDP command timeout: ${method}`)), 25000)
        ),
      ])
      sendToRelay({
        id: msg.id,
        result,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)

      // Handle unsupported Browser.* commands with fake responses
      if (method === 'Browser.getVersion') {
        sendToRelay({
          id: msg.id,
          result: {
            protocolVersion: '1.3',
            product: 'Chrome',
            revision: '@000000',
            userAgent: navigator.userAgent,
            jsVersion: '0.0.0',
          },
        })
        return
      }

      if (method === 'Browser.setDownloadBehavior') {
        // Just return success - downloads won't work but we can ignore this
        sendToRelay({
          id: msg.id,
          result: {},
        })
        return
      }

      sendToRelay({
        id: msg.id,
        error: { message: errorMsg },
      })
    }
    return
  }

  // Handle getActiveTab request from relay
  if (msg && typeof msg.id === 'number' && msg.method === 'getActiveTab') {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const tabId = activeTab?.id

      if (!tabId) {
        sendToRelay({
          id: msg.id,
          result: { sessionId: null, tabId: null },
        })
        return
      }

      const attachedTab = tabs.get(tabId)

      if (attachedTab && attachedTab.state === 'connected') {
        // Active tab is already attached
        sendToRelay({
          id: msg.id,
          result: {
            sessionId: attachedTab.sessionId,
            tabId: tabId,
          },
        })
      } else {
        // Active tab is not attached
        sendToRelay({
          id: msg.id,
          result: { sessionId: null, tabId: null },
        })
      }
    } catch (err) {
      sendToRelay({
        id: msg.id,
        error: { message: err instanceof Error ? err.message : String(err) },
      })
    }
    return
  }

  // Handle response to our CDP commands
  if (msg && typeof msg.id === 'number') {
    const p = pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      if (msg.error) {
        p.reject(new Error(msg.error.message || 'Command failed'))
      } else {
        p.resolve(msg.result)
      }
    }
  }
}

// Attach/detach flow
async function toggleAttach(tabId) {
  if (tabOperationLocks.has(tabId)) {
    console.warn(`Tab ${tabId} is locked (concurrent attach/detach)`)
    return
  }
  tabOperationLocks.add(tabId)

  try {
    const tab = tabs.get(tabId)
    if (tab && tab.state === 'connected') {
      await doDetach(tabId)
    } else {
      await doAttach(tabId)
    }
  } catch (err) {
    console.error(`Toggle attach failed for tab ${tabId}:`, err)
    setBadge(tabId, 'error')
    void chrome.action.setTitle({
      tabId,
      title: `Shiplight AI: error (${err instanceof Error ? err.message : String(err)})`,
    })
  } finally {
    tabOperationLocks.delete(tabId)
  }
}

async function doAttach(tabId) {
  // Ensure relay connection
  try {
    await ensureRelayConnection()
  } catch (err) {
    throw new Error(`Cannot connect to relay: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Attach debugger
  try {
    await chrome.debugger.attach({ tabId }, '1.3')
  } catch (err) {
    throw new Error(`Cannot attach debugger: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Get target info
  const info = /** @type {any} */ (
    await chrome.debugger.sendCommand({ tabId }, 'Target.getTargetInfo')
  )
  const targetInfo = info?.targetInfo
  if (!targetInfo) {
    await chrome.debugger.detach({ tabId })
    throw new Error('No target info')
  }

  // Generate session ID
  const sessionId = `sl-tab-${nextSession++}`

  // Store tab state
  tabs.set(tabId, {
    state: 'connected',
    sessionId,
    targetId: targetInfo.targetId,
  })
  tabBySession.set(sessionId, tabId)

  // Notify relay
  sendToRelay({
    method: 'forwardCDPEvent',
    params: {
      method: 'Target.attachedToTarget',
      params: {
        sessionId,
        targetInfo: { ...targetInfo, tabId, attached: true },
        waitingForDebugger: false,
      },
    },
  })

  setBadge(tabId, 'on')
  void chrome.action.setTitle({
    tabId,
    title: 'Shiplight AI: attached (click to detach)',
  })

  await persistState()
}

async function doDetach(tabId) {
  const tab = tabs.get(tabId)
  if (!tab) return

  // Notify relay
  if (tab.sessionId) {
    try {
      sendToRelay({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.detachedFromTarget',
          params: {
            sessionId: tab.sessionId,
          },
        },
      })
    } catch {
      // Ignore relay errors on detach
    }
  }

  // Detach debugger
  try {
    await chrome.debugger.detach({ tabId })
  } catch {
    // Ignore detach errors
  }

  // Clean up state
  if (tab.sessionId) {
    tabBySession.delete(tab.sessionId)
  }
  tabs.delete(tabId)

  setBadge(tabId, 'off')
  void chrome.action.setTitle({
    tabId,
    title: 'Shiplight AI (click to attach/detach)',
  })

  await persistState()
}

// CDP event forwarding
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId
  if (!tabId) return

  const tab = tabs.get(tabId)
  if (!tab || tab.state !== 'connected' || !tab.sessionId) return

  // Forward CDP events to relay
  try {
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        method,
        params,
        sessionId: tab.sessionId,
      },
    })
  } catch {
    // Ignore relay errors
  }
})

// Debugger detach handler
chrome.debugger.onDetach.addListener(async (source, reason) => {
  const tabId = source.tabId
  if (!tabId) return

  const tab = tabs.get(tabId)
  if (!tab) return

  console.log(`Debugger detached from tab ${tabId}: ${reason}`)

  // Clean up
  if (tab.sessionId) {
    tabBySession.delete(tab.sessionId)
  }
  tabs.delete(tabId)

  setBadge(tabId, 'off')
  void chrome.action.setTitle({
    tabId,
    title: 'Shiplight AI (click to attach/detach)',
  })

  await persistState()
})

// Navigation handling: auto-reattach
chrome.webNavigation.onCommitted.addListener((details) => {
  const tabId = details.tabId
  if (!tabId || details.frameId !== 0) return

  const tab = tabs.get(tabId)
  if (!tab || tab.state !== 'connected') return

  // Mark for reattach and preserve badge during navigation
  reattachPending.add(tabId)
  setBadge(tabId, relayBadgeKind())

  // Reattach after navigation completes (self-removing listener to avoid accumulation)
  const onNavCompleted = async (nav) => {
    if (nav.tabId !== tabId || nav.frameId !== 0) return
    chrome.webNavigation.onCompleted.removeListener(onNavCompleted)

    reattachPending.delete(tabId)

    // Re-announce to relay and restore badge
    try {
      const info = /** @type {any} */ (
        await chrome.debugger.sendCommand({ tabId }, 'Target.getTargetInfo')
      )
      const targetInfo = info?.targetInfo

      sendToRelay({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.attachedToTarget',
          params: {
            sessionId: tab.sessionId,
            targetInfo: { ...targetInfo, tabId, attached: true },
            waitingForDebugger: false,
          },
        },
      })

      // Restore badge — Chrome may clear per-tab badge state on navigation
      setBadge(tabId, relayBadgeKind())
    } catch {
      // Ignore reattach errors
    }
  }
  chrome.webNavigation.onCompleted.addListener(onNavCompleted, { url: [{ urlMatches: '.*' }] })
})

// Extension toolbar click
chrome.action.onClicked.addListener(async (tab) => {
  const port = await getRelayPort()
  if (!port) {
    // No port configured — open options page
    chrome.runtime.openOptionsPage()
    return
  }
  if (tab.id) {
    await toggleAttach(tab.id)
  }
})

// Tab activation handler — notify relay when user switches to a registered tab
chrome.tabs.onActivated.addListener((activeInfo) => {
  const tabId = activeInfo.tabId
  const tab = tabs.get(tabId)
  if (!tab || tab.state !== 'connected' || !tab.sessionId) return

  try {
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.activateTarget',
        params: {
          targetId: tab.targetId,
          sessionId: tab.sessionId,
        },
      },
    })
  } catch {
    // Ignore relay errors — tab activation is best-effort
  }
})

// Tab close handler
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tab = tabs.get(tabId)
  if (tab) {
    await doDetach(tabId)
  }
})

// Tab replaced handler (when Chrome replaces a tab with a new ID)
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  const tab = tabs.get(removedTabId)
  if (!tab) return

  // Move tab state to new ID
  tabs.delete(removedTabId)
  tabs.set(addedTabId, tab)
  if (tab.sessionId) {
    tabBySession.set(tab.sessionId, addedTabId)
  }

  // Update badge on new tab
  setBadge(addedTabId, relayBadgeKind())

  void persistState()
})

// Keepalive alarm
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    // Restore badge state for all connected tabs (service worker restart may clear badges)
    console.debug('Keepalive: restoring badges for', tabs.size, 'tab(s)')
    for (const [tabId, tab] of tabs.entries()) {
      if (tab.state === 'connected') {
        setBadge(tabId, relayBadgeKind())
      }
    }
  }
})

// Service worker startup
let whenReadyQueue = []
let serviceReady = false

async function init() {
  await rehydrateState()

  // Show unconfigured state if no port is set
  const port = await getRelayPort()
  if (!port) {
    void chrome.action.setBadgeText({ text: '?' })
    void chrome.action.setBadgeBackgroundColor({ color: '#9CA3AF' })
    void chrome.action.setBadgeTextColor({ color: '#FFFFFF' }).catch(() => {})
    void chrome.action.setTitle({ title: 'Shiplight AI: no relay port configured (click to configure)' })
  } else if (tabs.size > 0) {
    // Attempt relay connection for rehydrated tabs so badges reflect reality.
    try {
      await ensureRelayConnection()
      await reannounceAttachedTabs()
    } catch {
      // Connection failed — scheduleReconnect was already called by ensureRelayConnection.
      // Badges already show 'connecting' from relayBadgeKind().
    }
  }

  serviceReady = true
  for (const fn of whenReadyQueue) {
    try {
      await fn()
    } catch (err) {
      console.error('whenReady callback error:', err)
    }
  }
  whenReadyQueue = []
}

function whenReady(fn) {
  if (serviceReady) {
    void fn()
  } else {
    whenReadyQueue.push(fn)
  }
}

void init()
