import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { PresentedText } from '../src/presented-text.ts'
import { PresentedList } from '../src/presented-list.ts'
import { parseEstimateSeconds } from '../src/arrivals.ts'
import { EventSourceType, OsEventTypeList, RebuildPageContainer, TextContainerProperty,
  ListContainerProperty, ListItemContainerProperty } from '@evenrealities/even_hub_sdk'

// Run the production functions with a controllable Host, without starting main.ts.
const source = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

function runtime(names: string[], globals: Record<string, unknown> = {}) {
  const functions = source.statements.filter((node) =>
    ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
  assert.equal(functions.length, names.length)
  const code = ts.transpileModule(functions.map((node) => node.getText(source)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  const context = vm.createContext({ console, ...globals })
  vm.runInContext(code, context)
  return context
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const bridgeFunctions = ['serializeBridgeCall', 'currentPageToken', 'isPageTokenCurrent',
  'upgradeGlassesText', 'rebuildGlassesPage', 'updateGlassesImage']

test('skips unchanged accepted text, retries failed text, and resets after rebuild', async () => {
  let upgrades = 0
  let accepted = true
  const ctx = runtime(bridgeFunctions, {
    appActive: true, pageMode: 'detail', etaRefreshEpoch: 1,
    bridgeCallQueue: Promise.resolve(), presentedText: new PresentedText(),
    bridge: {
      rebuildPageContainer: async () => true,
      textContainerUpgrade: async () => { upgrades += 1; return accepted },
    },
  })
  const text = { containerID: 3, containerName: 'arrival-row-0', content: '2 min' }
  await ctx.rebuildGlassesPage({ textObject: [text] })
  await Promise.all([ctx.upgradeGlassesText(text), ctx.upgradeGlassesText(text)])
  assert.equal(upgrades, 0)
  const changed = { ...text, content: '1 min' }
  accepted = false
  assert.equal(await ctx.upgradeGlassesText(changed), false)
  accepted = true
  assert.equal(await ctx.upgradeGlassesText(changed), true)
  await ctx.upgradeGlassesText(changed)
  assert.equal(upgrades, 2)
  await ctx.rebuildGlassesPage({ textObject: [] })
  await ctx.upgradeGlassesText(changed)
  assert.equal(upgrades, 3)
})

test('drops an obsolete image and text at actual Bridge dispatch', async () => {
  let sent = 0
  let current = true
  const gate = deferred()
  const ctx = runtime(bridgeFunctions, {
    appActive: true, pageMode: 'route', etaRefreshEpoch: 1,
    bridgeCallQueue: gate.promise, presentedText: new PresentedText(),
    bridge: {
      updateImageRawData: async () => { sent += 1; return 0 },
      textContainerUpgrade: async () => { sent += 1; return true },
    },
  })
  const image = ctx.updateGlassesImage({}, () => current)
  const text = ctx.upgradeGlassesText({ content: 'old direction' }, undefined, () => current)
  current = false
  gate.resolve()
  assert.equal(await image, null)
  assert.equal(await text, false)
  assert.equal(sent, 0)
})

test('a rejected rebuild is an explicit failure and does not poison the Bridge queue', async () => {
  let fail = true
  const ctx = runtime(bridgeFunctions, {
    appActive: true, pageMode: 'route', etaRefreshEpoch: 1,
    bridgeCallQueue: Promise.resolve(), presentedText: new PresentedText(),
    console: { error: () => {} },
    bridge: { rebuildPageContainer: async () => {
      if (fail) throw new Error('Host rejected the operation')
      return true
    } },
  })
  assert.equal(await ctx.rebuildGlassesPage({ textObject: [] }), false)
  fail = false
  assert.equal(await ctx.rebuildGlassesPage({ textObject: [] }), true)
})

class Container {
  constructor(data: object) { Object.assign(this, data) }
}

test('waits for route creation and prevents old direction rows overwriting a newer frame', async () => {
  const ready = deferred()
  const oldTabs = deferred()
  const tabsStarted = deferred()
  const sent: string[] = []
  const ctx = runtime(['updateGlassesRouteText', 'performGlassesRouteTextUpdate', 'isCurrentRouteImageUpdate'], {
    appActive: true, selectedRoute: {}, pageMode: 'route', etaRefreshEpoch: 2,
    selectedDirection: 0, glassesRouteImageEpoch: 0, glassesLayoutMode: 'cards',
    glassesRoutePageReady: ready.promise, glassesRouteTextQueue: Promise.resolve(), ROUTE_CONTAINER_IDS: [6, 7, 8, 9],
    TextContainerUpgrade: Container,
    isPageTokenCurrent: () => true,
    glassesRouteRows: () => Array(4).fill(`direction ${ctx.selectedDirection}`),
    updateGlassesDirectionTabs: async () => {
      if (ctx.selectedDirection === 0) { tabsStarted.resolve(); await oldTabs.promise }
      return 'success'
    },
    upgradeGlassesText: async (row: { content: string }, _token: unknown, isCurrent: () => boolean) => {
      if (!isCurrent()) return false
      sent.push(row.content)
      return true
    },
  })
  const old = ctx.updateGlassesRouteText()
  await Promise.resolve()
  assert.equal(sent.length, 0)
  ready.resolve()
  await tabsStarted.promise
  ctx.selectedDirection = 1
  const latest = ctx.updateGlassesRouteText()
  oldTabs.resolve()
  await latest
  await old
  assert.deepEqual(sent, Array(4).fill('direction 1'))
})

test('a direction switch during fallback rebuild keeps the actual layout and updates its container', async () => {
  const rebuilding = deferred()
  const finish = deferred()
  const upgraded: number[] = []
  const ctx = runtime([...bridgeFunctions, 'updateGlassesRouteText', 'performGlassesRouteTextUpdate',
    'isCurrentRouteImageUpdate', 'rebuildGlassesRouteFallback'], {
    appActive: true, selectedRoute: {}, pageMode: 'route', etaRefreshEpoch: 2,
    selectedDirection: 1, glassesRouteImageEpoch: 0, glassesLayoutMode: 'cards',
    glassesDirectionTabsDirection: 0, glassesImageDiagnostic: null,
    glassesRoutePageReady: Promise.resolve(), glassesRouteTextQueue: Promise.resolve(),
    bridgeCallQueue: Promise.resolve(), presentedText: new PresentedText(),
    ROUTE_CONTAINER_IDS: [6, 7, 8, 9], ROUTE_DIRECTION_CONTAINER_ID: 4,
    TextContainerUpgrade: Container, TextContainerProperty: Container, RebuildPageContainer: Container,
    glassesRouteHeaderContainer: () => ({ containerID: 1, content: 'header' }),
    glassesUpdateTimeContainer: () => ({ containerID: 5, content: 'time' }),
    glassesDirectionFallbackLabel: () => `direction ${ctx.selectedDirection}`,
    glassesRouteRows: () => ['stops'],
    updateGlassesDirectionTabs: async () => 'failed',
    bridge: {
      rebuildPageContainer: async () => { rebuilding.resolve(); await finish.promise; return true },
      textContainerUpgrade: async (row: { containerID: number }) => { upgraded.push(row.containerID); return true },
    },
  })
  const old = ctx.updateGlassesRouteText()
  await rebuilding.promise
  ctx.selectedDirection = 0
  const latest = ctx.updateGlassesRouteText()
  finish.resolve()
  await Promise.all([old, latest])
  assert.equal(ctx.glassesLayoutMode, 'fallback')
  assert.equal(ctx.glassesDirectionTabsDirection, null)
  assert.deepEqual(upgraded, [4])
  ctx.glassesLayoutMode = 'cards'
  ctx.glassesDirectionTabsDirection = 0
  ctx.bridge.rebuildPageContainer = async () => false
  assert.equal(await ctx.rebuildGlassesRouteFallback(2), 'failed')
  assert.equal(ctx.glassesLayoutMode, 'cards')
  assert.equal(ctx.glassesDirectionTabsDirection, 0)
})

test('suspending cancels refresh, requests and location, and resuming restores the active page', async () => {
  let cleared = 0
  let aborted = 0
  let unsubscribed = 0
  let stopped = 0
  let resumed = 0
  let hubRemoved = 0
  const ctx = runtime(['clearEtaRefresh', 'stopLocationTracking', 'suspendApp', 'disposeApp', 'resumeApp'], {
    appActive: true, appDisposed: false, etaRefreshEpoch: 1, etaRefreshTimer: 123,
    isRefreshingEta: true, glassesRouteImageEpoch: 1, pageMode: 'home', isLoading: false,
    window: { clearInterval: () => { cleared += 1 } },
    dataRequestControllers: new Set([{ abort: () => { aborted += 1 } }]),
    unsubscribeLocation: () => { unsubscribed += 1 }, locationTrackingRequested: true,
    serializeBridgeCall: (operation: () => Promise<unknown>) => operation(),
    bridge: { stopAppLocationUpdates: async () => { stopped += 1 } },
    beginLocationTracking: async () => {}, showHome: async () => { resumed += 1 },
    unsubscribeHub: () => { hubRemoved += 1 },
  })
  ctx.suspendApp()
  ctx.suspendApp()
  assert.equal(ctx.appActive, false)
  assert.equal(ctx.etaRefreshTimer, null)
  assert.equal(ctx.isRefreshingEta, false)
  assert.deepEqual([cleared, aborted, unsubscribed, stopped], [1, 1, 1, 1])
  await ctx.resumeApp()
  assert.equal(resumed, 1)
  assert.equal(ctx.appActive, true)
  ctx.disposeApp()
  await ctx.resumeApp()
  assert.equal(ctx.appActive, false)
  assert.equal(hubRemoved, 1)
  assert.equal(resumed, 1)
})

function inputRuntime() {
  const calls = { home: 0, favorites: 0, nearby: 0, shutdown: 0, removed: 0, station: null as unknown }
  const ctx = runtime(['handleHubEvent', 'resumeApp', 'suspendApp', 'disposeApp',
    'clearEtaRefresh', 'stopLocationTracking', 'serializeBridgeCall', 'shutDownGlassesPage'], {
    appActive: true, appDisposed: false, pageMode: 'home', isLoading: false,
    etaRefreshEpoch: 1, etaRefreshTimer: null, isRefreshingEta: false, glassesRouteImageEpoch: 0,
    dataRequestControllers: new Set(), unsubscribeLocation: null, locationTrackingRequested: false,
    window: { clearInterval: () => {} }, bridgeCallQueue: Promise.resolve(),
    EventSourceType, OsEventTypeList, HOME_LIST_CONTAINER_ID: 11, LIST_CONTAINER_ID: 2,
    FAVORITES_CONTAINER_ID: 12, ETA_CONTAINER_IDS: [3, 6, 7, 8],
    ROUTE_DIRECTION_CONTAINER_ID: 4, ROUTE_CONTAINER_IDS: [6, 7, 8, 9],
    presentedArrivals: new PresentedList(), selectedArrivalIndex: 0,
    selectedHomeIndex: 0, selectedStationIndex: 0,
    presentedStations: new PresentedList([{ id: 'first' }, { id: 'second' }]),
    showHome: async () => { calls.home += 1 },
    showFavorites: async () => { calls.favorites += 1 },
    showStationList: async () => { calls.nearby += 1 },
    showStationDetail: async (station: unknown) => { calls.station = station },
    beginLocationTracking: async () => {},
    bridge: { shutDownPageContainer: async (mode: number) => {
      assert.equal(mode, 1)
      calls.shutdown += 1
      return true
    } },
    unsubscribeHub: () => { calls.removed += 1 },
  })
  return { ctx, calls }
}

const flushEvents = () => new Promise<void>((resolve) => setImmediate(resolve))

test('cancelled exit restores input for text, list and system foreground events', async () => {
  for (const envelope of ['textEvent', 'listEvent', 'sysEvent']) {
    const { ctx, calls } = inputRuntime()
    ctx.handleHubEvent({ listEvent: { containerID: 11, eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } })
    await flushEvents()
    assert.equal(calls.shutdown, 1)
    ctx.handleHubEvent({ [envelope]: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } })
    assert.equal(ctx.appActive, false, `${envelope} must suspend`)
    ctx.handleHubEvent({ listEvent: { containerID: 11, eventType: OsEventTypeList.CLICK_EVENT } })
    assert.equal(calls.favorites, 0)
    ctx.handleHubEvent({ [envelope]: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } })
    await flushEvents()
    assert.equal(ctx.appActive, true)
    assert.equal(calls.home, 1)
    ctx.handleHubEvent({ listEvent: { containerID: 11, eventType: OsEventTypeList.CLICK_EVENT } })
    assert.equal(calls.favorites, 1)
    ctx.handleHubEvent({ listEvent: { containerID: 11, eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } })
    await flushEvents()
    assert.equal(calls.shutdown, 2)
    // A cancelled dialog can return foreground without a preceding background event.
    ctx.handleHubEvent({ [envelope]: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } })
    await flushEvents()
    assert.equal(calls.home, 2, 'foreground return must restore native event capture even while active')
    ctx.handleHubEvent({ [envelope]: { eventType: OsEventTypeList.SYSTEM_EXIT_EVENT } })
    ctx.handleHubEvent({ [envelope]: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } })
    await flushEvents()
    assert.equal(ctx.appDisposed, true)
    assert.equal(calls.removed, 1)
    assert.equal(calls.home, 2, 'a confirmed exit must stay disposed')
  }
})

test('system taps without a touch source use the native list selection after a dialog', async () => {
  for (const eventSource of [undefined, EventSourceType.TOUCH_EVENT_FORM_DUMMY_NULL]) {
    const { ctx, calls } = inputRuntime()
    ctx.handleHubEvent({ listEvent: { containerID: 11, currentSelectItemIndex: 1,
      eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } })
    ctx.handleHubEvent({ sysEvent: { eventType: OsEventTypeList.CLICK_EVENT, eventSource } })
    assert.equal(calls.nearby, 1)
    ctx.handleHubEvent({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT, eventSource } })
    await flushEvents()
    assert.equal(calls.shutdown, 1)
    ctx.pageMode = 'list'
    ctx.handleHubEvent({ listEvent: { containerID: 2, currentSelectItemIndex: 1,
      eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } })
    ctx.handleHubEvent({ sysEvent: { eventType: OsEventTypeList.CLICK_EVENT, eventSource } })
    assert.equal((calls.station as { id: string }).id, 'second')
    ctx.handleHubEvent({ sysEvent: {} })
    ctx.handleHubEvent({ sysEvent: { eventType: OsEventTypeList.IMU_DATA_REPORT } })
    assert.equal(calls.nearby, 1, 'empty and non-touch system events must not be treated as taps')
  }
})

test('accepted native menu rebuilds reset the remembered selection to match OS focus', async () => {
  let accepted = false
  const ctx = runtime(['showHome', 'showStationList', 'clearEtaRefresh',
    'currentPageToken', 'isPageTokenCurrent'], {
    appActive: true, pageMode: 'home', etaRefreshEpoch: 1, etaRefreshTimer: null,
    isRefreshingEta: false, selectedHomeIndex: 1, selectedStationIndex: 1,
    stationListRenderEpoch: 0, selectedStation: null, selectedRoute: null,
    currentArrivals: [], presentedArrivals: new PresentedList(), presentedStations: new PresentedList(),
    visibleStations: [{ id: 'first' }, { id: 'second' }], locationSource: 'default',
    window: { clearInterval: () => {} }, stopLocationTracking: () => {},
    renderPhoneHome: () => {}, renderPhoneStationList: () => {}, sortStationsByDistance: () => {},
    stationListLabel: (station: { id: string }) => station.id,
    glassesFavoritesUpdatePromise: null, glassesImageUpdateQueue: Promise.resolve(),
    HOME_LIST_CONTAINER_ID: 11, LIST_CONTAINER_ID: 2,
    RebuildPageContainer, TextContainerProperty, ListContainerProperty, ListItemContainerProperty,
    rebuildGlassesPage: async () => accepted,
    console: { error: () => {} },
  })
  await ctx.showHome()
  assert.equal(ctx.selectedHomeIndex, 1, 'a rejected frame keeps the presented selection')
  accepted = true
  await ctx.showHome()
  assert.equal(ctx.selectedHomeIndex, 0)
  accepted = false
  await ctx.showStationList(false)
  assert.equal(ctx.selectedStationIndex, 1)
  accepted = true
  await ctx.showStationList(false)
  assert.equal(ctx.selectedStationIndex, 0)
})

test('favorites ignore invalid ETA candidates and route stops do not fabricate arrivals', () => {
  const ctx = runtime(['favoriteArrival', 'arrivalSortValue', 'routeStopEstimate'], {
    parseEstimateSeconds,
    routeInfo: new Map(),
    routeStopsByDirection: new Map(),
    latestEtaByStop: new Map([
      ['1:10', { EstimateTime: 'invalid' }], ['1:11', { EstimateTime: '60' }],
      ['1:12', { EstimateTime: ' ' }],
    ]),
  })
  const arrival = ctx.favoriteArrival({ routeId: 1, goBack: 0 }, {
    id: 'station', stops: [{ routeId: 1, goBack: 0, stopId: 10 }, { routeId: 1, goBack: 0, stopId: 11 }],
  })
  assert.equal(arrival.estimateSeconds, 60)
  assert.equal(ctx.routeStopEstimate({ routeId: 1, stopId: 12 }), null)
})

test('empty favorites do not download ETA but still wait for their glasses page', async () => {
  const ready = deferred()
  let complete = false
  const ctx = runtime(['refreshFavoriteEta'], {
    appActive: true, pageMode: 'favorites', isRefreshingEta: false,
    currentFavoriteEntries: () => [],
    fetchGzipJson: () => { assert.fail('empty favorites must not fetch') },
  })
  const refresh = ctx.refreshFavoriteEta(ready.promise).then(() => { complete = true })
  await Promise.resolve()
  assert.equal(complete, false)
  ready.resolve()
  await refresh
  assert.equal(complete, true)
})

test('favorite gestures open the accepted list while a phone group change is pending', async () => {
  let opened: unknown
  const displayed = { item: { id: 'displayed' } }
  const pending = { item: { id: 'pending' } }
  const ctx = runtime(['openSelectedFavoriteRoute'], {
    presentedFavoriteEntries: new PresentedList([displayed]), presentedFavoriteSelectedIndex: 0,
    favoriteSelectedIndex: 0, currentFavoriteEntries: () => [pending],
    openFavoriteRoute: async (entry: unknown) => { opened = entry },
  })
  await ctx.openSelectedFavoriteRoute()
  assert.equal(opened, displayed)
  ctx.presentedFavoriteEntries.commit([pending])
  await ctx.openSelectedFavoriteRoute()
  assert.equal(opened, pending)
})

test('location runs only for nearby stops and discards duplicate or invalid fixes', async () => {
  let starts = 0
  let renders = 0
  let listener!: (location: object) => void
  const ctx = runtime(['beginLocationTracking', 'validCoordinate'], {
    appActive: true, pageMode: 'home', locationTrackingRequested: false,
    unsubscribeLocation: null, locationSource: 'GPS', currentLocation: { latitude: 25, longitude: 121 },
    stationDistancesDirty: false, AppLocationAccuracy: { High: 'high', Medium: 'medium' },
    serializeBridgeCall: (operation: () => Promise<unknown>) => operation(),
    showStationList: async (requestFix: boolean) => { assert.equal(requestFix, false); renders += 1 },
    bridge: {
      startAppLocationUpdates: async () => { starts += 1; return true },
      onAppLocationChanged: (callback: typeof listener) => { listener = callback; return () => {} },
    },
  })
  await ctx.beginLocationTracking()
  assert.equal(starts, 0)
  ctx.pageMode = 'list'
  await ctx.beginLocationTracking()
  await ctx.beginLocationTracking()
  assert.equal(starts, 1)
  listener({ latitude: 25, longitude: 121 })
  listener({ latitude: NaN, longitude: 121 })
  assert.equal(renders, 0)
  listener({ latitude: 25.01, longitude: 121 })
  assert.equal(renders, 1)
  assert.equal(ctx.stationDistancesDirty, true)
})
