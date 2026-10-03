import {
  AppLocationAccuracy,
  CreateStartUpPageContainer,
  EventSourceType,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { ungzip } from 'pako'
import notoSansTcUrl from '@fontsource/noto-sans-tc/files/noto-sans-tc-chinese-traditional-600-normal.woff2?url'
import { buildStationArrivals, parseEstimateSeconds } from './arrivals.ts'
import { PresentedList } from './presented-list.ts'
import { PresentedText } from './presented-text.ts'
import { InputDiagnostics, type InputDiagnosticFields, type InputDiagnosticKind } from './input-diagnostics.ts'
import {
  COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
  canJoinStationCluster,
  mergeComplementaryStationClusters,
} from './station-clustering.ts'
import { chooseNewestStoredValue, encodeStoredValue } from './versioned-storage.ts'

const DATA_ORIGIN = 'https://taiwan-bus.0ruka.dev/blobbus'
const STOP_DATA_URL = `${DATA_ORIGIN}/GetStop.gz`
const ROUTE_DATA_URL = `${DATA_ORIGIN}/GetRoute.gz`
const ETA_DATA_URL = `${DATA_ORIGIN}/GetEstimateTime.gz`
const BUS_DATA_URL = `${DATA_ORIGIN}/GetBusData.gz`

const DEFAULT_LOCATION: LocatedCoordinates = {
  latitude: 25.0474098159326,
  longitude: 121.513985270577,
}

const MAX_VISIBLE_STATIONS = 20
const ETA_PAGE_SIZE = 4
const LIST_CONTAINER_ID = 2
const HOME_LIST_CONTAINER_ID = 11
const FAVORITES_CONTAINER_ID = 12
const FAVORITES_ROW_CONTAINER_IDS = [12, 13] as const
const FAVORITES_PAGE_SIZE = FAVORITES_ROW_CONTAINER_IDS.length
const FAVORITES_STORAGE_KEY = 'taiwan-bus-favorites-v1'
const ETA_CONTAINER_IDS = [3, 6, 7, 8] as const
const ROUTE_DIRECTION_CONTAINER_ID = 4
const ROUTE_DIRECTION_SECOND_CONTAINER_ID = 10
const ROUTE_DIRECTION_CONTAINER_NAMES = ['dir-tab-0', 'dir-tab-1'] as const
const ROUTE_CONTAINER_IDS = [6, 7, 8, 9] as const
const UPDATE_TIME_CONTAINER_ID = 5
const ETA_REFRESH_MS = 5_000
const ROUTE_IMAGE_INITIAL_DELAY_MS = 650
const ROUTE_IMAGE_RETRY_DELAY_MS = 700
const ROUTE_IMAGE_SEND_ATTEMPTS = 2
const STATION_CLUSTER_RADIUS_METERS = 80
const MAX_BUS_TO_STOP_DISTANCE_METERS = 500

const glassesDirectionFont = new FontFace(
  'Noto Sans TC',
  `url(${notoSansTcUrl})`,
  { weight: '600' },
)
document.fonts.add(glassesDirectionFont)
const glassesDirectionFontReady = glassesDirectionFont.load().catch((error) => {
  console.warn('[taiwan-bus] direction font load failed:', error)
  return null
})

interface Coordinates {
  latitude: number
  longitude: number
}

interface LocatedCoordinates extends Coordinates {
  accuracy?: number
}

interface RawStop {
  Id: number
  routeId: number
  nameZh: string
  nameEn?: string
  seqNo: number
  longitude: string
  latitude: string
  goBack?: string
  address?: string
  stopLocationId?: number
  showLon?: string
  showLat?: string
}

interface RawRoute {
  Id: number
  nameZh: string
  departureZh?: string
  destinationZh?: string
  pathAttributeId?: number | string
}

interface RawEta {
  RouteID: number
  StopID: number
  EstimateTime: string
  GoBack: string
}

interface RawBus {
  BusID: string
  RouteID: string
  GoBack: string
  Longitude: string
  Latitude: string
  BusStatus?: string
  DataTime?: string
}

interface TaipeiBusPayload<T> {
  EssentialInfo?: {
    UpdateTime?: string
  }
  BusInfo: T[]
}

interface StationStop {
  stopId: number
  routeId: number
  goBack: number
}

interface BusStation {
  id: string
  name: string
  englishName?: string
  latitude: number
  longitude: number
  address?: string
  positions: Coordinates[]
  routeIds: Set<number>
  stops: StationStop[]
  distanceMeters: number
}

interface RouteInfo {
  name: string
  departure: string
  destination: string
}

interface RouteStop {
  stopId: number
  routeId: number
  goBack: number
  seqNo: number
  name: string
  stationKey: string
  latitude: number
  longitude: number
}

interface Arrival {
  key: string
  routeId: number
  goBack: number
  routeName: string
  destination: string
  estimateSeconds: number | null
}

interface FavoriteGroup {
  id: string
  name: string
}

interface FavoriteItem {
  id: string
  groupId: string
  routeId: number
  goBack: number
  stationId: string
  stationName: string
}

interface FavoriteEntry {
  item: FavoriteItem
  station: BusStation
  arrival: Arrival
}

interface FavoriteSettings {
  groups: FavoriteGroup[]
  items: FavoriteItem[]
  activeGroupId: string
}

type PageMode = 'loading' | 'home' | 'favorites' | 'list' | 'detail' | 'route' | 'error'
type PhoneFavoriteView = 'list' | 'search' | 'groups'
type RouteReturnMode = 'detail' | 'favorites'
type DirectionImageFormat = 'raw4' | 'png'
interface PageToken {
  mode: PageMode
  epoch: number
}

const bridge = await waitForEvenAppBridge()
let bridgeCallQueue: Promise<void> = Promise.resolve()
const presentedText = new PresentedText()
let appActive = true
let appDisposed = false
const inputDiagnosticBuild = import.meta.env.VITE_INPUT_DIAGNOSTICS
const inputDiagnostics = inputDiagnosticBuild ? new InputDiagnostics() : null
let inputDiagnosticOutput: HTMLPreElement | null = null
let inputDiagnosticPanel: HTMLDetailsElement | null = null
let inputDiagnosticCallID = 0
let unsubscribeLocation: (() => void) | null = null
let locationTrackingRequested = false
const dataRequestControllers = new Set<AbortController>()

function recordInputDiagnostic(kind: InputDiagnosticKind, fields: InputDiagnosticFields = {}): void {
  if (!inputDiagnostics) return
  inputDiagnostics.record(kind, { page: pageMode, active: appActive, disposed: appDisposed, ...fields })
  if (inputDiagnosticPanel?.open && inputDiagnosticOutput) {
    inputDiagnosticOutput.textContent = inputDiagnostics.reportLines().join('\n')
    inputDiagnosticOutput.scrollTop = inputDiagnosticOutput.scrollHeight
  }
}

function serializeBridgeCall<T>(
  operation: () => Promise<T>,
  name: NonNullable<InputDiagnosticFields['operation']> = 'bridge',
): Promise<T> {
  if (!inputDiagnostics) {
    const result = bridgeCallQueue.then(operation, operation)
    bridgeCallQueue = result.then(() => undefined, () => undefined)
    return result
  }
  const callID = ++inputDiagnosticCallID
  recordInputDiagnostic('bridge', { operation: name, callID, phase: 'queued' })
  const dispatch = async () => {
    recordInputDiagnostic('bridge', { operation: name, callID, phase: 'dispatch' })
    try {
      const value = await operation()
      const diagnosticValue: unknown = value
      recordInputDiagnostic('bridge', { operation: name, callID, phase: 'complete',
        result: typeof diagnosticValue === 'boolean' || typeof diagnosticValue === 'number' || diagnosticValue === null ? diagnosticValue : undefined })
      return value
    } catch (error) {
      recordInputDiagnostic('bridge', { operation: name, callID, phase: 'error' })
      throw error
    }
  }
  const result = bridgeCallQueue.then(dispatch, dispatch)
  bridgeCallQueue = result.then(() => undefined, () => undefined)
  return result
}

function currentPageToken(): PageToken {
  return { mode: pageMode, epoch: etaRefreshEpoch }
}

function isPageTokenCurrent(token: PageToken): boolean {
  return appActive && pageMode === token.mode && etaRefreshEpoch === token.epoch
}

function rebuildGlassesPage(
  container: RebuildPageContainer,
  token = currentPageToken(),
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  return serializeBridgeCall(async () => {
    if (!isPageTokenCurrent(token) || !isCurrent()) return false
    presentedText.reset()
    let success = false
    try { success = await bridge.rebuildPageContainer(container) } catch (error) {
      if (isPageTokenCurrent(token)) console.error('[taiwan-bus] rebuild exception:', error)
    }
    if (success && isPageTokenCurrent(token) && isCurrent()) {
      presentedText.reset(container.textObject)
    }
    return success
  }, 'rebuild')
}

function upgradeGlassesText(
  container: TextContainerUpgrade,
  token = currentPageToken(),
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  return serializeBridgeCall(async () => {
    if (!isPageTokenCurrent(token) || !isCurrent()) return false
    if (presentedText.matches(container)) return true
    let success = false
    try { success = await bridge.textContainerUpgrade(container) } catch (error) {
      if (isPageTokenCurrent(token)) console.error('[taiwan-bus] text upgrade exception:', error)
    }
    if (success && isPageTokenCurrent(token) && isCurrent()) presentedText.commit(container)
    return success
  }, 'text')
}

function updateGlassesImage(
  data: ImageRawDataUpdate,
  isCurrent: () => boolean,
): Promise<ImageRawDataUpdateResult | null> {
  return serializeBridgeCall(() =>
    appActive && isCurrent() ? bridge.updateImageRawData(data) : Promise.resolve(null), 'image')
}

async function shutDownGlassesPage(exitMode: number): Promise<boolean> {
  let response!: Promise<boolean>
  await serializeBridgeCall(() => {
    // The Host dialog response has no cancellation-completion contract. Serialize
    // its dispatch, but never let that response hold the native rendering queue.
    response = bridge.shutDownPageContainer(exitMode)
    if (inputDiagnostics) void response.then(
      (result) => recordInputDiagnostic('bridge', { operation: 'exit', phase: 'complete', result }),
      () => recordInputDiagnostic('bridge', { operation: 'exit', phase: 'error' }),
    )
    return Promise.resolve()
  }, 'exit')
  return response
}

let pageMode: PageMode = 'loading'
let stations: BusStation[] = []
let stationById = new Map<string, BusStation>()
let visibleStations: BusStation[] = []
const presentedStations = new PresentedList<BusStation>()
let selectedHomeIndex = 0
let selectedStationIndex = 0
let stationDistancesDirty = true
let routeInfo = new Map<number, RouteInfo>()
let routeStopsByDirection = new Map<string, RouteStop[]>()
let routeIdByPathAttributeId = new Map<number, number>()
let stationClusterKeyByStopKey = new Map<string, string>()
let latestEtaByStop = new Map<string, RawEta>()
let busPlatesByStop = new Map<string, string[]>()
let lastDataUpdateTime = '--:--:--'
let lastDataSourceUpdateTime: string | undefined
let currentLocation: LocatedCoordinates = DEFAULT_LOCATION
let locationSource: '預設台北' | 'GPS' = '預設台北'
let selectedStation: BusStation | null = null
let currentArrivals: Arrival[] = []
const presentedArrivals = new PresentedList<Arrival>()
let isLoading = false
let isRefreshingEta = false
let etaRefreshTimer: number | null = null
let etaRefreshEpoch = 0
let arrivalPageStart = 0
let selectedArrivalIndex = 0
let selectedRoute: Arrival | null = null
let selectedDirection = 0
let routePageStart = 0
let stationListRenderEpoch = 0
let routeReturnMode: RouteReturnMode = 'detail'
let favoriteGroups: FavoriteGroup[] = [{ id: 'default', name: '常用' }]
let favoriteItems: FavoriteItem[] = []
let activeFavoriteGroupId = 'default'
let favoriteSettingsRevision = 0
let favoriteSelectedIndex = 0
let favoritePageStart = 0
const presentedFavoriteEntries = new PresentedList<FavoriteEntry>()
let presentedFavoriteSelectedIndex = 0
let phoneFavoriteView: PhoneFavoriteView = 'list'
let favoriteSearchQuery = ''
let favoriteSearchRouteId: number | null = null
let favoriteSearchDirection = 0
let favoritesLayoutMode: 'table' | 'fallback' = 'table'
let glassesFavoritesDiagnostic: string | null = null
let glassesFavoritesUpdatePending = false
let glassesFavoritesUpdatePromise: Promise<void> | null = null
let glassesLayoutMode: 'cards' | 'fallback' = 'cards'
let glassesDirectionTabsDirection: number | null = null
let glassesImageUpdateQueue: Promise<void> = Promise.resolve()
let glassesImageDiagnostic: string | null = null
let glassesRouteImageEpoch = 0
let preferredDirectionImageFormat: DirectionImageFormat | null = null
let glassesRoutePageReady: Promise<void> = Promise.resolve()
let glassesRouteTextQueue: Promise<void> = Promise.resolve()
const inFlightDataRequests = new Map<string, Promise<unknown>>()
let phoneArrivalStructure = ''
let phoneRouteStructure = ''

const appRoot = document.createElement('main')
appRoot.className = 'app-shell'
document.body.append(appRoot)

if (inputDiagnostics) {
  inputDiagnosticPanel = document.createElement('details')
  inputDiagnosticPanel.open = true
  inputDiagnosticPanel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:100;background:#fff;color:#111;border-top:1px solid #999;padding:8px;font-size:12px'
  const summary = document.createElement('summary')
  summary.textContent = `Input trace · ${inputDiagnosticBuild}`
  inputDiagnosticOutput = document.createElement('pre')
  inputDiagnosticOutput.style.cssText = 'max-height:55vh;overflow:auto;white-space:pre-wrap;margin:8px 0;font-size:11px;line-height:1.4;user-select:text'
  inputDiagnosticPanel.append(summary, inputDiagnosticOutput)
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.textContent = 'Copy trace'
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`Input trace ${inputDiagnosticBuild}\n${inputDiagnostics.reportLines().join('\n')}`)
      copy.textContent = 'Copied'
    } catch {
      copy.textContent = 'Select trace text to copy'
    }
  })
  inputDiagnosticPanel.append(copy)
  inputDiagnosticPanel.addEventListener('toggle', () => {
    if (inputDiagnosticPanel?.open && inputDiagnosticOutput) {
      inputDiagnosticOutput.textContent = inputDiagnostics.reportLines().join('\n')
    }
  })
  document.body.append(inputDiagnosticPanel)
  // Independent local observation survives the main handler's unsubscribe.
  // It neither calls the Host nor records user, device or location data.
  bridge.onEvenHubEvent((event) => {
    let found = false
    for (const [envelope, payload] of [['sys', event.sysEvent], ['list', event.listEvent],
      ['text', event.textEvent]] as const) {
      if (!payload) continue
      found = true
      recordInputDiagnostic('event', { envelope, eventType: payload.eventType,
        source: 'eventSource' in payload ? payload.eventSource : undefined,
        containerID: 'containerID' in payload ? payload.containerID : undefined,
        selectedIndex: 'currentSelectItemIndex' in payload ? payload.currentSelectItemIndex : undefined })
    }
    if (!found) recordInputDiagnostic('probe', { code: -1,
      eventType: OsEventTypeList.fromJson(event.jsonData?.eventType ?? event.jsonData?.Event_Type ?? event.jsonData?.event_type),
      containerID: event.jsonData?.containerID ?? event.jsonData?.Container_ID ?? event.jsonData?.container_id })
  })
}

function textContainer(
  content: string,
  id = 1,
  name = 'main',
  captureEvents = 1,
): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 8,
    containerID: id,
    containerName: name,
    content,
    isEventCapture: captureEvents,
  })
}

const startupResult = await serializeBridgeCall(() => bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [
      textContainer('台灣公車追蹤\n\n正在載入大台北站牌…\n雙擊可離開'),
    ],
  }),
), 'startup')

if (startupResult !== 0) {
  console.error('[taiwan-bus] startup page failed:', startupResult)
} else {
  console.log('[taiwan-bus] startup page ready')
}

renderPhoneLoading()

const unsubscribeHub = bridge.onEvenHubEvent(handleHubEvent)

function handleHubEvent(event: EvenHubEvent): void {
  const lifecycleEvent = [event.sysEvent?.eventType, event.textEvent?.eventType,
    event.listEvent?.eventType].find((type) =>
    type === OsEventTypeList.FOREGROUND_ENTER_EVENT ||
    type === OsEventTypeList.FOREGROUND_EXIT_EVENT ||
    type === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    type === OsEventTypeList.ABNORMAL_EXIT_EVENT)
  if (lifecycleEvent === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
    // Device traces show these events describe the native foreground layer.
    // Pause while its exit dialog or another native layer is open.
    suspendApp()
    return
  }
  if (lifecycleEvent === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
    // Closing the native layer returns control to the existing app page.
    void resumeApp(true)
    return
  }
  if (lifecycleEvent === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      lifecycleEvent === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    disposeApp()
    return
  }
  if (!appActive) return
  const listEvent = event.listEvent

  if (listEvent?.containerID === HOME_LIST_CONTAINER_ID && pageMode === 'home') {
    const index = listEvent.currentSelectItemIndex
    if (index !== undefined && Number.isInteger(index) && index >= 0 && index < 2) {
      selectedHomeIndex = index
    }
    if (listEvent.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      void shutDownGlassesPage(1)
      return
    }
    if (
      listEvent.eventType === OsEventTypeList.CLICK_EVENT ||
      listEvent.eventType === undefined
    ) {
      if (selectedHomeIndex === 0) void showFavorites()
      else void showStationList()
    }
    return
  }

  if (listEvent?.containerID === LIST_CONTAINER_ID && pageMode === 'list') {
    const index = listEvent.currentSelectItemIndex
    if (index !== undefined && presentedStations.at(index)) selectedStationIndex = index
    if (listEvent.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      void showHome()
      return
    }

    if (
      listEvent.eventType === OsEventTypeList.CLICK_EVENT ||
      listEvent.eventType === undefined
    ) {
      const station = presentedStations.at(selectedStationIndex)
      if (station) void showStationDetail(station)
    }
    return
  }

  const sysEvent = event.sysEvent
  const isTouchSource = sysEvent && (sysEvent.eventSource === undefined || [
    EventSourceType.TOUCH_EVENT_FORM_DUMMY_NULL,
    EventSourceType.TOUCH_EVENT_FROM_GLASSES_R,
    EventSourceType.TOUCH_EVENT_FROM_RING,
    EventSourceType.TOUCH_EVENT_FROM_GLASSES_L,
  ].includes(sysEvent.eventSource))

  if (sysEvent && isTouchSource) {
    if (sysEvent.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      if (pageMode === 'route') void returnFromRoute()
      else if (pageMode === 'detail') void showStationList()
      else if (pageMode === 'favorites' || pageMode === 'list') void showHome()
      else if (pageMode === 'home') void shutDownGlassesPage(1)
      return
    }

    if (
      sysEvent.eventType === OsEventTypeList.CLICK_EVENT ||
      (sysEvent.eventType === undefined && sysEvent.eventSource !== undefined &&
        sysEvent.eventSource !== EventSourceType.TOUCH_EVENT_FORM_DUMMY_NULL)
    ) {
      if (pageMode === 'home') {
        if (selectedHomeIndex === 0) void showFavorites()
        else void showStationList()
        return
      }
      if (pageMode === 'list') {
        const station = presentedStations.at(selectedStationIndex)
        if (station) void showStationDetail(station)
        return
      }
      if (pageMode === 'detail' && presentedArrivals.length === 0) {
        void refreshEta()
        return
      }
      const presentedArrival = presentedArrivals.at(selectedArrivalIndex)
      if (pageMode === 'detail' && presentedArrival) {
        void showRouteDetail(presentedArrival)
      } else if (pageMode === 'route') {
        toggleRouteDirection()
      } else if (pageMode === 'favorites') {
        void openSelectedFavoriteRoute()
      }
      return
    }
  }

  const textEvent = event.textEvent
  if (!textEvent) return

  if (textEvent.containerID === FAVORITES_CONTAINER_ID && pageMode === 'favorites') {
    switch (textEvent.eventType) {
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        void showHome()
        break
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        moveFavoriteSelection()
        void updateGlassesFavoritesText()
        break
      case OsEventTypeList.SCROLL_TOP_EVENT:
        void cycleFavoriteGroup()
        break
      case OsEventTypeList.CLICK_EVENT:
      case undefined:
        void openSelectedFavoriteRoute()
        break
    }
    return
  }

  if (
    textEvent.containerID === ETA_CONTAINER_IDS[0] &&
    pageMode === 'detail'
  ) {
    switch (textEvent.eventType) {
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        void showStationList()
        break
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        selectedArrivalIndex = Math.min(
          selectedArrivalIndex + 1,
          Math.max(0, presentedArrivals.length - 1),
        )
        keepSelectedArrivalVisible()
        void updateGlassesArrivalText()
        break
      case OsEventTypeList.SCROLL_TOP_EVENT:
        selectedArrivalIndex = Math.max(0, selectedArrivalIndex - 1)
        keepSelectedArrivalVisible()
        void updateGlassesArrivalText()
        break
      case OsEventTypeList.CLICK_EVENT:
      case undefined:
        const arrival = presentedArrivals.at(selectedArrivalIndex)
        if (arrival) {
          void showRouteDetail(arrival)
        } else void refreshEta()
        break
    }
    return
  }

  if (
    (textEvent.containerID === ROUTE_DIRECTION_CONTAINER_ID ||
      textEvent.containerID === ROUTE_CONTAINER_IDS[0]) &&
    pageMode === 'route'
  ) {
    switch (textEvent.eventType) {
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        void returnFromRoute()
        break
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        routePageStart = Math.min(
          routePageStart + 1,
          Math.max(0, currentRouteStops().length - ETA_PAGE_SIZE),
        )
        void updateGlassesRouteText()
        break
      case OsEventTypeList.SCROLL_TOP_EVENT:
        routePageStart = Math.max(0, routePageStart - 1)
        void updateGlassesRouteText()
        break
      case OsEventTypeList.CLICK_EVENT:
      case undefined:
        toggleRouteDirection()
        break
    }
    return
  }

  if (textEvent.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    if (pageMode === 'detail') void showStationList()
    else if (pageMode === 'route') void returnFromRoute()
    else if (pageMode === 'favorites' || pageMode === 'list') void showHome()
    else if (pageMode === 'home') void shutDownGlassesPage(1)
    else void shutDownGlassesPage(1)
    return
  }

  if (
    pageMode === 'error' &&
    (textEvent.eventType === OsEventTypeList.CLICK_EVENT ||
      textEvent.eventType === undefined)
  ) {
    void loadBusData()
  }
}

function haversineMeters(a: Coordinates, b: Coordinates): number {
  const earthRadiusMeters = 6_371_000
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const latitudeDelta = toRadians(b.latitude - a.latitude)
  const longitudeDelta = toRadians(b.longitude - a.longitude)
  const latitude1 = toRadians(a.latitude)
  const latitude2 = toRadians(b.latitude)

  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(longitudeDelta / 2) ** 2

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(value))
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  )
}

function stationKeyForStop(
  stop: RawStop,
  latitude: number,
  longitude: number,
): string {
  const fallbackKey = `${stop.nameZh}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`
  const stopLocationId = Number(stop.stopLocationId)
  return stop.stopLocationId !== undefined &&
    stop.stopLocationId !== null &&
    Number.isFinite(stopLocationId)
    ? `station:${stopLocationId}`
    : `stop:${fallbackKey}`
}

function stationSourceKeyForStop(
  stop: RawStop,
  latitude: number,
  longitude: number,
): string {
  return [
    stationKeyForStop(stop, latitude, longitude),
    normalizedStationName(stop.nameZh),
    latitude.toFixed(5),
    longitude.toFixed(5),
  ].join(':')
}

function normalizedStationName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').trim()
}

function sameStationArea(station: BusStation, position: Coordinates): boolean {
  return canJoinStationCluster(
    station.positions,
    position,
    STATION_CLUSTER_RADIUS_METERS,
    haversineMeters,
  )
}

function hasStationPosition(station: BusStation, position: Coordinates): boolean {
  return station.positions.some(
    (candidate) => haversineMeters(candidate, position) < 1,
  )
}

function groupStops(rawStops: RawStop[]): BusStation[] {
  const startedAt = performance.now()
  const grouped = new Map<string, BusStation>()
  const candidatesByName = new Map<string, BusStation[]>()
  const physicalKeys = new Set<string>()
  stationClusterKeyByStopKey = new Map()

  const sortedStops = rawStops.filter((stop) => {
    const latitude = Number(stop.showLat ?? stop.latitude)
    const longitude = Number(stop.showLon ?? stop.longitude)
    return typeof stop.nameZh === 'string' &&
      stop.nameZh.trim().length > 0 &&
      validCoordinate(latitude, longitude)
  }).sort((a, b) => {
    const nameComparison = normalizedStationName(a.nameZh).localeCompare(
      normalizedStationName(b.nameZh),
      'zh-Hant',
    )
    if (nameComparison !== 0) return nameComparison
    const latitudeComparison = Number(a.showLat ?? a.latitude) - Number(b.showLat ?? b.latitude)
    if (latitudeComparison !== 0) return latitudeComparison
    const longitudeComparison = Number(a.showLon ?? a.longitude) - Number(b.showLon ?? b.longitude)
    if (longitudeComparison !== 0) return longitudeComparison
    return Number(a.stopLocationId ?? Number.MAX_SAFE_INTEGER) -
      Number(b.stopLocationId ?? Number.MAX_SAFE_INTEGER) || a.Id - b.Id
  })

  for (const stop of sortedStops) {
    const latitude = Number(stop.showLat ?? stop.latitude)
    const longitude = Number(stop.showLon ?? stop.longitude)
    if (!validCoordinate(latitude, longitude) || !stop.nameZh) continue

    const physicalKey = stationKeyForStop(stop, latitude, longitude)
    const sourceKey = stationSourceKeyForStop(stop, latitude, longitude)
    physicalKeys.add(sourceKey)
    const position = { latitude, longitude }
    const nameKey = normalizedStationName(stop.nameZh)
    const candidates = candidatesByName.get(nameKey) ?? []
    const nearbyStation = candidates.find(
      (candidate) => sameStationArea(candidate, position),
    )
    const key = nearbyStation?.id ?? (grouped.has(physicalKey) ? sourceKey : physicalKey)
    stationClusterKeyByStopKey.set(sourceKey, key)
    const stationStop: StationStop = {
      stopId: stop.Id,
      routeId: stop.routeId,
      goBack: Number(stop.goBack ?? 2),
    }
    const existing = grouped.get(key)

    if (existing) {
      existing.routeIds.add(stop.routeId)
      existing.stops.push(stationStop)
      if (!hasStationPosition(existing, position)) existing.positions.push(position)
      continue
    }

    const station: BusStation = {
      id: key,
      name: stop.nameZh,
      englishName: stop.nameEn,
      latitude,
      longitude,
      address: stop.address,
      positions: [position],
      routeIds: new Set([stop.routeId]),
      stops: [stationStop],
      distanceMeters: 0,
    }
    grouped.set(key, station)
    candidates.push(station)
    candidatesByName.set(nameKey, candidates)
  }

  const merged = mergeComplementaryStationClusters(
    [...grouped.values()],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    haversineMeters,
    normalizedStationName,
  )
  for (const [physicalKey, clusterKey] of stationClusterKeyByStopKey) {
    stationClusterKeyByStopKey.set(
      physicalKey,
      merged.aliases.get(clusterKey) ?? clusterKey,
    )
  }

  console.log(
    '[taiwan-bus] station clustering:',
    `${physicalKeys.size} physical -> ${merged.stations.length} logical`,
    `${Math.round(performance.now() - startedAt)}ms`,
  )
  return merged.stations
}

function groupRouteStops(rawStops: RawStop[]): Map<string, RouteStop[]> {
  const grouped = new Map<string, RouteStop[]>()

  for (const stop of rawStops) {
    const latitude = Number(stop.showLat ?? stop.latitude)
    const longitude = Number(stop.showLon ?? stop.longitude)
    const goBack = Number(stop.goBack)
    if (
      !validCoordinate(latitude, longitude) ||
      !stop.nameZh ||
      ![0, 1].includes(goBack)
    ) continue

    const key = `${stop.routeId}:${goBack}`
    const routeStops = grouped.get(key) ?? []
    const physicalKey = stationKeyForStop(stop, latitude, longitude)
    const sourceKey = stationSourceKeyForStop(stop, latitude, longitude)
    routeStops.push({
      stopId: stop.Id,
      routeId: stop.routeId,
      goBack,
      seqNo: Number(stop.seqNo),
      name: stop.nameZh,
      stationKey: stationClusterKeyByStopKey.get(sourceKey) ?? physicalKey,
      latitude,
      longitude,
    })
    grouped.set(key, routeStops)
  }

  for (const routeStops of grouped.values()) {
    routeStops.sort((a, b) => a.seqNo - b.seqNo)
  }
  return grouped
}

function sortStationsByDistance(): void {
  if (!stationDistancesDirty && visibleStations.length > 0) return
  const startedAt = performance.now()
  for (const station of stations) {
    station.distanceMeters = Math.min(
      ...station.positions.map((position) => haversineMeters(currentLocation, position)),
    )
  }

  stations.sort((a, b) => a.distanceMeters - b.distanceMeters)
  visibleStations = stations.slice(0, MAX_VISIBLE_STATIONS)
  stationDistancesDirty = false
  console.debug('[taiwan-bus] distance sort:', {
    stations: stations.length,
    milliseconds: Math.round(performance.now() - startedAt),
  })
}

function formatDistance(meters: number): string {
  if (meters < 1_000) return `${Math.round(meters)}m`
  return `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)}km`
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(value).byteLength <= maxBytes) return value

  let output = ''
  for (const character of value) {
    if (encoder.encode(`${output}${character}…`).byteLength > maxBytes) break
    output += character
  }
  return `${output}…`
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function formatDataUpdateTime(value?: string): string {
  if (!value) return '--:--:--'
  const match = value.match(/(?:^|\s)(\d{2}:\d{2}:\d{2})(?:\s|$)/)
  if (match) return match[1]

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '--:--:--'
  return new Intl.DateTimeFormat('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Taipei',
  }).format(parsed)
}

function applyEtaPayload(payload: TaipeiBusPayload<RawEta>): void {
  latestEtaByStop = new Map(
    payload.BusInfo.map((eta) => [`${eta.RouteID}:${eta.StopID}`, eta]),
  )
  lastDataUpdateTime = formatDataUpdateTime(payload.EssentialInfo?.UpdateTime)
  lastDataSourceUpdateTime = payload.EssentialInfo?.UpdateTime
}

function glassesUpdateTimeContainer(): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 440,
    yPosition: 0,
    width: 136,
    height: 42,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: UPDATE_TIME_CONTAINER_ID,
    containerName: 'update-time',
    content: lastDataUpdateTime,
    isEventCapture: 0,
  })
}

function glassesFavoritesHeaderContent(): string {
  const title = `‹ 常用路線｜${currentFavoriteGroup().name}`
  const titleAndTime = `${fitDisplayWidth(title, 44)}${lastDataUpdateTime}`
  const columns = `　 ${fitDisplayWidth('到站', 7)}│ ${fitDisplayWidth('路線／方向', 20)}│ 站牌`
  return truncateUtf8(`${titleAndTime}\n${columns}`, 256)
}

async function updateGlassesUpdateTime(): Promise<void> {
  if (pageMode !== 'detail' && pageMode !== 'route' && pageMode !== 'favorites') return
  const token = currentPageToken()
  await glassesImageUpdateQueue
  if (!isPageTokenCurrent(token)) return
  if (pageMode === 'favorites') {
    const success = favoritesLayoutMode === 'table'
      ? await upgradeGlassesText(new TextContainerUpgrade({
          containerID: 1,
          containerName: 'favorite-header',
          content: glassesFavoritesHeaderContent(),
        }), token)
      : await upgradeGlassesText(new TextContainerUpgrade({
          containerID: FAVORITES_CONTAINER_ID,
          containerName: 'favorite-row-0',
          content: glassesFavoritesFallbackText(),
        }), token)
    if (!success) console.error('[taiwan-bus] favorites time update failed')
    return
  }
  const success = await upgradeGlassesText(
    new TextContainerUpgrade({
      containerID: UPDATE_TIME_CONTAINER_ID,
      containerName: 'update-time',
      content: lastDataUpdateTime,
    }),
  )
  if (!success) console.error('[taiwan-bus] update time text failed')
}

function routeNamesForStation(station: BusStation): string[] {
  return [...station.routeIds]
    .map((routeId) => routeInfo.get(routeId)?.name)
    .filter((name): name is string => Boolean(name))
    .filter((name, index, values) => values.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }))
}

function routeSummary(station: BusStation): string {
  const names = routeNamesForStation(station)
  return names.length > 0 ? names.join(', ') : '路線資料載入中'
}

function stationListLabel(station: BusStation): string {
  return truncateUtf8(
    `${formatDistance(station.distanceMeters)} ${station.name}｜${routeSummary(station)}`,
    63,
  )
}

function clearEtaRefresh(): void {
  etaRefreshEpoch += 1
  isRefreshingEta = false
  if (etaRefreshTimer !== null) {
    window.clearInterval(etaRefreshTimer)
    etaRefreshTimer = null
  }
}

function startEtaRefreshTimer(
  expectedPage: PageMode,
  refreshEpoch: number,
  refresh: () => Promise<void>,
): void {
  if (!appActive || pageMode !== expectedPage || etaRefreshEpoch !== refreshEpoch) return
  etaRefreshTimer = window.setInterval(() => void refresh(), ETA_REFRESH_MS)
}

function stopLocationTracking(): void {
  unsubscribeLocation?.()
  unsubscribeLocation = null
  if (locationTrackingRequested) {
    locationTrackingRequested = false
    void serializeBridgeCall(() => bridge.stopAppLocationUpdates()).catch((error) => {
      console.warn('[taiwan-bus] location stop failed:', error)
    })
  }
}

function suspendApp(): void {
  if (!appActive) return
  appActive = false
  clearEtaRefresh()
  glassesRouteImageEpoch += 1
  for (const controller of dataRequestControllers) controller.abort()
  stopLocationTracking()
  recordInputDiagnostic('state', { action: 'suspend' })
}

function disposeApp(): void {
  suspendApp()
  appDisposed = true
  unsubscribeHub()
  recordInputDiagnostic('state', { action: 'dispose' })
}

async function resumeApp(restorePage = false): Promise<void> {
  recordInputDiagnostic('state', { action: 'resume-request' })
  if (appDisposed || (appActive && !restorePage)) return
  if (appActive) {
    clearEtaRefresh()
    glassesRouteImageEpoch += 1
  }
  appActive = true
  recordInputDiagnostic('state', { action: 'resumed' })
  void beginLocationTracking()
  const refreshEpoch = etaRefreshEpoch
  const mode = pageMode
  if (mode === 'favorites') {
    await refreshFavoriteEta(createGlassesFavoritesPage())
    startEtaRefreshTimer(mode, refreshEpoch, refreshFavoriteEta)
  } else if (mode === 'detail') {
    await refreshEta(createGlassesArrivalPage())
    startEtaRefreshTimer(mode, refreshEpoch, refreshEta)
  } else if (mode === 'route') {
    glassesRoutePageReady = createGlassesRoutePage(refreshEpoch)
    await refreshEta(glassesRoutePageReady)
    startEtaRefreshTimer(mode, refreshEpoch, refreshEta)
  } else if (mode === 'list') await showStationList()
  else if (mode === 'home') await showHome()
  else if (!isLoading) void loadBusData()
}

window.addEventListener('pagehide', (event) => {
  recordInputDiagnostic('state', { action: 'pagehide', persisted: event.persisted })
  event.persisted ? suspendApp() : disposeApp()
})
window.addEventListener('pageshow', (event) => {
  recordInputDiagnostic('state', { action: 'pageshow', persisted: event.persisted })
  if (event.persisted) void resumeApp()
})

function makeId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `${prefix}-${suffix}`
}

function currentFavoriteGroup(): FavoriteGroup {
  return favoriteGroups.find((group) => group.id === activeFavoriteGroupId)
    ?? favoriteGroups[0]
    ?? { id: 'default', name: '常用' }
}

function sanitizeFavoriteSettings(value: unknown): FavoriteSettings {
  if (!value || typeof value !== 'object') {
    return { groups: [{ id: 'default', name: '常用' }], items: [], activeGroupId: 'default' }
  }
  const input = value as Partial<FavoriteSettings>
  const groups = Array.isArray(input.groups)
    ? input.groups.filter((group): group is FavoriteGroup =>
      Boolean(group && typeof group.id === 'string' && typeof group.name === 'string' && group.name.trim()))
    : []
  if (groups.length === 0) groups.push({ id: 'default', name: '常用' })
  const groupIds = new Set(groups.map((group) => group.id))
  const items = Array.isArray(input.items)
    ? input.items.filter((item): item is FavoriteItem => Boolean(
      item &&
      typeof item.id === 'string' &&
      typeof item.groupId === 'string' && groupIds.has(item.groupId) &&
      Number.isFinite(item.routeId) && [0, 1].includes(item.goBack) &&
      typeof item.stationId === 'string' && typeof item.stationName === 'string',
    ))
    : []
  const activeGroupId = typeof input.activeGroupId === 'string' && groupIds.has(input.activeGroupId)
    ? input.activeGroupId
    : groups[0].id
  return { groups, items, activeGroupId }
}

async function loadFavoriteSettings(): Promise<void> {
  let bridgeStored = ''
  try {
    bridgeStored = await serializeBridgeCall(() => bridge.getLocalStorage(FAVORITES_STORAGE_KEY))
  } catch (error) {
    console.warn('[taiwan-bus] bridge favorites read failed:', error)
  }
  let phoneStored = ''
  try { phoneStored = window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? '' } catch { /* ignored */ }
  const stored = chooseNewestStoredValue([bridgeStored, phoneStored])
  const settings = sanitizeFavoriteSettings(stored?.value)
  favoriteSettingsRevision = stored?.revision ?? 0
  favoriteGroups = settings.groups
  favoriteItems = settings.items
  activeFavoriteGroupId = settings.activeGroupId
}

async function saveFavoriteSettings(): Promise<void> {
  favoriteSettingsRevision += 1
  const settings = {
    groups: favoriteGroups,
    items: favoriteItems,
    activeGroupId: activeFavoriteGroupId,
  } satisfies FavoriteSettings
  const value = encodeStoredValue(settings, favoriteSettingsRevision)
  try { window.localStorage.setItem(FAVORITES_STORAGE_KEY, value) } catch { /* ignored */ }
  try {
    const saved = await serializeBridgeCall(() => bridge.setLocalStorage(FAVORITES_STORAGE_KEY, value))
    if (!saved) console.warn('[taiwan-bus] bridge favorites write returned false')
  } catch (error) {
    console.warn('[taiwan-bus] bridge favorites write failed:', error)
  }
}

function stationForFavorite(item: FavoriteItem): BusStation | null {
  const direct = stationById.get(item.stationId)
  if (direct) return direct
  const name = normalizedStationName(item.stationName)
  return stations.find((station) =>
    normalizedStationName(station.name) === name &&
    station.stops.some((stop) => stop.routeId === item.routeId),
  ) ?? null
}

function favoriteArrival(item: FavoriteItem, station: BusStation): Arrival {
  const route = routeInfo.get(item.routeId)
  const stopIds = new Set(
    (routeStopsByDirection.get(`${item.routeId}:${item.goBack}`) ?? [])
      .filter((stop) => stop.stationKey === station.id)
      .map((stop) => stop.stopId),
  )
  for (const stop of station.stops) {
    if (stop.routeId === item.routeId && stop.goBack === item.goBack) stopIds.add(stop.stopId)
  }
  let estimateSeconds: number | null = null
  for (const stopId of stopIds) {
    const eta = latestEtaByStop.get(`${item.routeId}:${stopId}`)
    // GetEstimateTime can use GoBack 2/3 even when GetStop uses 0/1.
    // The direction-specific StopID set above is the dependable join key.
    if (!eta) continue
    const seconds = parseEstimateSeconds(eta.EstimateTime)
    if (estimateSeconds === null || arrivalSortValue(seconds) < arrivalSortValue(estimateSeconds)) {
      estimateSeconds = seconds
    }
  }
  return {
    key: `${item.routeId}:${item.goBack}`,
    routeId: item.routeId,
    goBack: item.goBack,
    routeName: route?.name ?? String(item.routeId),
    destination: (item.goBack === 1 ? route?.departure : route?.destination) || '方向未知',
    estimateSeconds,
  }
}

function currentFavoriteEntries(): FavoriteEntry[] {
  return favoriteItems
    .filter((item) => item.groupId === activeFavoriteGroupId)
    .map((item) => {
      const station = stationForFavorite(item)
      return station ? { item, station, arrival: favoriteArrival(item, station) } : null
    })
    .filter((entry): entry is FavoriteEntry => entry !== null)
}

function keepSelectedFavoriteVisible(entries = currentFavoriteEntries()): void {
  if (entries.length === 0) {
    favoriteSelectedIndex = 0
    favoritePageStart = 0
    return
  }
  favoriteSelectedIndex = Math.min(favoriteSelectedIndex, entries.length - 1)
  if (favoriteSelectedIndex < favoritePageStart) favoritePageStart = favoriteSelectedIndex
  else if (favoriteSelectedIndex >= favoritePageStart + FAVORITES_PAGE_SIZE) {
    favoritePageStart = favoriteSelectedIndex - FAVORITES_PAGE_SIZE + 1
  }
}

function moveFavoriteSelection(): void {
  const entries = currentFavoriteEntries()
  if (entries.length === 0) return
  favoriteSelectedIndex = (favoriteSelectedIndex + 1) % entries.length
  keepSelectedFavoriteVisible(entries)
}

function displayWidth(value: string): number {
  return [...value].reduce((width, character) => {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint >= 0x300 && codePoint <= 0x36f) return width
    return width + (codePoint >= 0x1100 ? 2 : 1)
  }, 0)
}

function fitDisplayWidth(value: string, targetWidth: number): string {
  if (displayWidth(value) <= targetWidth) {
    return `${value}${' '.repeat(targetWidth - displayWidth(value))}`
  }

  let output = ''
  const ellipsisWidth = displayWidth('…')
  for (const character of value) {
    if (displayWidth(output) + displayWidth(character) + ellipsisWidth > targetWidth) break
    output += character
  }
  const truncated = `${output}…`
  return `${truncated}${' '.repeat(Math.max(0, targetWidth - displayWidth(truncated)))}`
}

function favoriteArrivalCell(seconds: number | null): string {
  const status = arrivalStatus(seconds)
  if (status === '資料等待中') return '--'
  if (status === '尚未發車') return '未發車'
  if (status === '交管不停靠') return '不停靠'
  if (status === '末班已過') return '末班'
  if (status === '今日未營運') return '停駛'
  return status.replace(' 分', '分')
}

function glassesFavoriteRows(): string[] {
  const entries = currentFavoriteEntries()
  if (entries.length === 0) {
    return FAVORITES_ROW_CONTAINER_IDS.map((_, index) =>
      index === 0
        ? '此分組尚無常用路線'
        : '請在手機右上角搜尋加入',
    )
  }
  keepSelectedFavoriteVisible(entries)
  const visibleEntries = entries.slice(favoritePageStart, favoritePageStart + FAVORITES_PAGE_SIZE)
  return FAVORITES_ROW_CONTAINER_IDS.map((_, offset) => {
      const entry = visibleEntries[offset]
      if (!entry) return ''
      const index = favoritePageStart + offset
      const marker = index === favoriteSelectedIndex ? '▶' : '　'
      const arrival = fitDisplayWidth(favoriteArrivalCell(entry.arrival.estimateSeconds), 7)
      const route = fitDisplayWidth(
        `${entry.arrival.routeName}→${entry.arrival.destination}`,
        20,
      )
      const station = fitDisplayWidth(entry.station.name, 14)
      return truncateUtf8(
        `${marker} ${arrival}│ ${route}│ ${station}`,
        128,
      )
    })
}

function glassesFavoritesFallbackText(): string {
  const title = `‹ 常用路線｜${currentFavoriteGroup().name}`
  return [
    `${fitDisplayWidth(title, 36)}${lastDataUpdateTime}`,
    '單容器相容模式',
    '到站　│ 路線／方向　　　│ 站牌',
    ...glassesFavoriteRows().filter(Boolean),
    '',
    '點按進入｜下滑選取｜上滑分組',
  ].join('\n')
}

function glassesFavoriteRowContainers(): TextContainerProperty[] {
  const rows = glassesFavoriteRows()
  return FAVORITES_ROW_CONTAINER_IDS.map((containerID, index) =>
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 87 + index * 100,
      width: 576,
      height: index === 0 ? 100 : 101,
      borderWidth: 1,
      borderColor: 5,
      paddingLength: 9,
      containerID,
      containerName: `favorite-row-${index}`,
      content: rows[index],
      isEventCapture: index === 0 ? 1 : 0,
    }),
  )
}

async function createGlassesFavoritesPage(): Promise<void> {
  if (pageMode !== 'favorites') return
  const token = currentPageToken()
  if (glassesFavoritesUpdatePromise) await glassesFavoritesUpdatePromise
  await glassesImageUpdateQueue
  if (!isPageTokenCurrent(token)) return
  const header = new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 87,
    borderWidth: 1, borderColor: 5, paddingLength: 7,
    containerID: 1, containerName: 'favorite-header',
    content: glassesFavoritesHeaderContent(), isEventCapture: 0,
  })
  const rows = glassesFavoriteRowContainers()
  const entries = currentFavoriteEntries()
  const selectedIndex = favoriteSelectedIndex
  const tablePage = new RebuildPageContainer({
    containerTotalNum: 1 + rows.length,
    textObject: [header, ...rows],
  })
  glassesFavoritesDiagnostic = null
  let success = await rebuildGlassesPage(tablePage, token)
  if (!success && isPageTokenCurrent(token)) {
    console.warn('[taiwan-bus] 3-container favorites table rebuild returned false, retrying once')
    glassesFavoritesDiagnostic = 'G2 三容器表格第一次傳輸失敗，已序列化後重試。'
    success = await rebuildGlassesPage(tablePage, token)
  }
  if (!isPageTokenCurrent(token)) return
  favoritesLayoutMode = success ? 'table' : 'fallback'
  if (success) {
    presentedFavoriteEntries.commit(entries)
    presentedFavoriteSelectedIndex = selectedIndex
  }
  if (success) console.info('[taiwan-bus] favorites table ready: 3 containers')
  if (!success) {
    glassesFavoritesDiagnostic = 'G2 三容器表格連續兩次傳輸失敗；SDK 僅回傳 false，已使用單容器相容模式。'
    console.error('[taiwan-bus] 3-container favorites table rejected, using 1-container fallback')
    const fallbackEntries = currentFavoriteEntries()
    const fallbackContent = glassesFavoritesFallbackText()
    const fallbackSelectedIndex = favoriteSelectedIndex
    const fallbackSuccess = await rebuildGlassesPage(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [new TextContainerProperty({
          xPosition: 0, yPosition: 0, width: 576, height: 288,
          borderWidth: 0, borderColor: 5, paddingLength: 7,
          containerID: FAVORITES_CONTAINER_ID,
          containerName: 'favorite-row-0',
          content: fallbackContent, isEventCapture: 1,
        })],
      }),
      token,
    )
    if (fallbackSuccess && isPageTokenCurrent(token)) {
      presentedFavoriteEntries.commit(fallbackEntries)
      presentedFavoriteSelectedIndex = fallbackSelectedIndex
    }
    if (!fallbackSuccess) console.error('[taiwan-bus] favorites fallback rebuild failed')
  }
}

async function performGlassesFavoritesTextUpdate(): Promise<void> {
  if (pageMode !== 'favorites') return
  const token = currentPageToken()
  const entries = currentFavoriteEntries()
  if (favoritesLayoutMode === 'fallback') {
    const content = glassesFavoritesFallbackText()
    const selectedIndex = favoriteSelectedIndex
    const success = await upgradeGlassesText(new TextContainerUpgrade({
      containerID: FAVORITES_CONTAINER_ID,
      containerName: 'favorite-row-0',
      content,
    }), token)
    if (success && isPageTokenCurrent(token)) {
      presentedFavoriteEntries.commit(entries)
      presentedFavoriteSelectedIndex = selectedIndex
    }
    if (!success) console.error('[taiwan-bus] favorites fallback update failed')
    return
  }

  const rows = glassesFavoriteRows()
  const selectedIndex = favoriteSelectedIndex
  let complete = true
  for (const [index, containerID] of FAVORITES_ROW_CONTAINER_IDS.entries()) {
    if (pageMode !== 'favorites' || favoritesLayoutMode !== 'table') return
    const success = await upgradeGlassesText(new TextContainerUpgrade({
      containerID,
      containerName: `favorite-row-${index}`,
      content: rows[index],
    }), token)
    if (!isPageTokenCurrent(token) || favoritesLayoutMode !== 'table') return
    if (!success) {
      complete = false
      console.error('[taiwan-bus] favorite row update failed:', index)
    }
  }
  if (complete && isPageTokenCurrent(token)) {
    presentedFavoriteEntries.commit(entries)
    presentedFavoriteSelectedIndex = selectedIndex
  }
}

function updateGlassesFavoritesText(): Promise<void> {
  glassesFavoritesUpdatePending = true
  if (glassesFavoritesUpdatePromise) return glassesFavoritesUpdatePromise

  glassesFavoritesUpdatePromise = (async () => {
    do {
      glassesFavoritesUpdatePending = false
      await performGlassesFavoritesTextUpdate()
    } while (glassesFavoritesUpdatePending && pageMode === 'favorites')
  })().finally(() => {
    glassesFavoritesUpdatePromise = null
  })
  return glassesFavoritesUpdatePromise
}

async function showHome(): Promise<void> {
  clearEtaRefresh()
  stopLocationTracking()
  pageMode = 'home'
  const token = currentPageToken()
  selectedStation = null
  selectedRoute = null
  renderPhoneHome()
  if (glassesFavoritesUpdatePromise) await glassesFavoritesUpdatePromise
  await glassesImageUpdateQueue
  if (!isPageTokenCurrent(token)) return
  const success = await rebuildGlassesPage(new RebuildPageContainer({
    containerTotalNum: 2,
    textObject: [new TextContainerProperty({
      xPosition: 0, yPosition: 0, width: 576, height: 52,
      borderWidth: 0, borderColor: 5, paddingLength: 6,
      containerID: 1, containerName: 'home-header',
      content: '台灣公車追蹤', isEventCapture: 0,
    })],
    listObject: [new ListContainerProperty({
      xPosition: 0, yPosition: 52, width: 576, height: 236,
      borderWidth: 0, borderColor: 5, paddingLength: 6,
      containerID: HOME_LIST_CONTAINER_ID, containerName: 'home-menu',
      itemContainer: new ListItemContainerProperty({
        itemCount: 2, itemWidth: 560, isItemSelectBorderEn: 1,
        itemName: ['★ 常用路線', '⌖ 附近站牌'],
      }),
      isEventCapture: 1,
    })],
  }), token)
  if (success && isPageTokenCurrent(token)) selectedHomeIndex = 0
  if (!success) console.error('[taiwan-bus] home rebuild failed')
}

async function showFavorites(resetSelection = true): Promise<void> {
  clearEtaRefresh()
  stopLocationTracking()
  const refreshEpoch = etaRefreshEpoch
  pageMode = 'favorites'
  presentedFavoriteEntries.commit([])
  phoneFavoriteView = 'list'
  if (resetSelection) {
    favoriteSelectedIndex = 0
    favoritePageStart = 0
  } else {
    keepSelectedFavoriteVisible()
  }
  renderPhoneFavorites()
  const glassesReady = createGlassesFavoritesPage()
  await refreshFavoriteEta(glassesReady)
  if (pageMode !== 'favorites' || etaRefreshEpoch !== refreshEpoch) return
  startEtaRefreshTimer('favorites', refreshEpoch, refreshFavoriteEta)
}

async function cycleFavoriteGroup(): Promise<void> {
  if (pageMode !== 'favorites' || favoriteGroups.length <= 1) return
  const index = favoriteGroups.findIndex((group) => group.id === activeFavoriteGroupId)
  const nextIndex = index < 0 ? 0 : (index + 1) % favoriteGroups.length
  const nextGroup = favoriteGroups[nextIndex]
  await selectFavoriteGroup(nextGroup.id)
}

async function refreshFavoriteEta(
  glassesReady: Promise<void> = Promise.resolve(),
): Promise<void> {
  if (!appActive || pageMode !== 'favorites' || isRefreshingEta) return
  if (currentFavoriteEntries().length === 0) {
    await glassesReady
    return
  }
  const refreshEpoch = etaRefreshEpoch
  isRefreshingEta = true
  try {
    const payload = await fetchGzipJson<TaipeiBusPayload<RawEta>>(ETA_DATA_URL, 'no-store')
    if (refreshEpoch !== etaRefreshEpoch || pageMode !== 'favorites') return
    applyEtaPayload(payload)
    if (phoneFavoriteView === 'list') updatePhoneFavoritesEta()
    try {
      await glassesReady
    } catch (error) {
      console.error('[taiwan-bus] favorites glasses page failed:', error)
      return
    }
    if (refreshEpoch !== etaRefreshEpoch || pageMode !== 'favorites') return
    await updateGlassesUpdateTime()
    if (refreshEpoch !== etaRefreshEpoch || pageMode !== 'favorites') return
    await updateGlassesFavoritesText()
  } catch (error) {
    if (refreshEpoch === etaRefreshEpoch) {
      console.error('[taiwan-bus] favorite ETA load failed:', error)
    }
  } finally {
    if (refreshEpoch === etaRefreshEpoch) isRefreshingEta = false
  }
}

async function openSelectedFavoriteRoute(): Promise<void> {
  const entry = presentedFavoriteEntries.at(presentedFavoriteSelectedIndex)
  if (!entry) return
  await openFavoriteRoute(entry)
}

async function openFavoriteRoute(entry: FavoriteEntry): Promise<void> {
  routeReturnMode = 'favorites'
  selectedStation = entry.station
  await showRouteDetail(entry.arrival)
}

async function returnFromRoute(): Promise<void> {
  if (routeReturnMode === 'favorites') await showFavorites(false)
  else if (selectedStation) await showStationDetail(selectedStation)
  else await showStationList()
}

async function showStationList(refreshLocation = true): Promise<void> {
  clearEtaRefresh()
  const renderEpoch = ++stationListRenderEpoch
  sortStationsByDistance()
  const nextVisibleStations = [...visibleStations]
  pageMode = 'list'
  const token = currentPageToken()
  selectedStation = null
  currentArrivals = []
  presentedArrivals.commit([])
  renderPhoneStationList(nextVisibleStations)
  await glassesImageUpdateQueue
  if (pageMode !== 'list' || stationListRenderEpoch !== renderEpoch) return

  const accuracy =
    locationSource === 'GPS' && currentLocation.accuracy
      ? ` ±${Math.round(currentLocation.accuracy)}m`
      : ''

  const header = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 42,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 1,
    containerName: 'header',
    content: `附近站牌｜${locationSource}${accuracy}`,
    isEventCapture: 0,
  })

  const list = new ListContainerProperty({
    xPosition: 0,
    yPosition: 42,
    width: 576,
    height: 246,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: LIST_CONTAINER_ID,
    containerName: 'stations',
    itemContainer: new ListItemContainerProperty({
      itemCount: nextVisibleStations.length,
      itemWidth: 560,
      isItemSelectBorderEn: 1,
      itemName: nextVisibleStations.map(stationListLabel),
    }),
    isEventCapture: 1,
  })

  const success = await rebuildGlassesPage(
    new RebuildPageContainer({
      containerTotalNum: 2,
      textObject: [header],
      listObject: [list],
    }),
    token,
  )

  if (pageMode !== 'list' || stationListRenderEpoch !== renderEpoch) return
  if (success) {
    presentedStations.commit(nextVisibleStations)
    selectedStationIndex = 0
  }
  else console.error('[taiwan-bus] list rebuild failed')
  if (refreshLocation && isPageTokenCurrent(token)) {
    void beginLocationTracking()
  }
}

async function showStationDetail(station: BusStation): Promise<void> {
  clearEtaRefresh()
  stopLocationTracking()
  const refreshEpoch = etaRefreshEpoch
  pageMode = 'detail'
  routeReturnMode = 'detail'
  selectedStation = station
  currentArrivals = []
  presentedArrivals.commit([])
  arrivalPageStart = 0
  selectedArrivalIndex = 0
  selectedRoute = null
  lastDataUpdateTime = '--:--:--'
  console.log('[taiwan-bus] open station:', station.name)

  renderPhoneArrivalLoading(station)
  const glassesReady = createGlassesArrivalPage('正在取得到站時間…')
  await refreshEta(glassesReady)
  if (pageMode !== 'detail' || etaRefreshEpoch !== refreshEpoch) return
  startEtaRefreshTimer('detail', refreshEpoch, refreshEta)
}

function buildArrivals(station: BusStation): Arrival[] {
  const preferredDirections = new Map(
    currentArrivals.map((arrival) => [arrival.routeId, arrival.goBack]),
  )
  const preferredRouteOrder = currentArrivals.map((arrival) => arrival.routeId)
  return buildStationArrivals(
    station.stops,
    routeInfo,
    latestEtaByStop,
    preferredDirections,
    preferredRouteOrder,
  )
}

function arrivalSortValue(seconds: number | null): number {
  if (seconds === null || seconds < 0) return 1_000_000 + Math.abs(seconds ?? 99)
  return seconds
}

function arrivalStatus(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return '資料等待中'
  if (seconds === -1) return '尚未發車'
  if (seconds === -2) return '交管不停靠'
  if (seconds === -3) return '末班已過'
  if (seconds === -4) return '今日未營運'
  if (seconds <= 30) return '進站中'
  return `${Math.max(1, Math.ceil(seconds / 60))} 分`
}

function arrivalClass(seconds: number | null): string {
  if (seconds === null || seconds < 0) return 'inactive'
  if (seconds <= 30) return 'arriving'
  if (seconds <= 120) return 'soon'
  return 'normal'
}

function keepSelectedArrivalVisible(): void {
  if (selectedArrivalIndex < arrivalPageStart) {
    arrivalPageStart = selectedArrivalIndex
  } else if (selectedArrivalIndex >= arrivalPageStart + ETA_PAGE_SIZE) {
    arrivalPageStart = selectedArrivalIndex - ETA_PAGE_SIZE + 1
  }
}

function glassesArrivalRows(message?: string): string[] {
  if (message) return [message, '', '', '']
  if (currentArrivals.length === 0) return ['目前沒有到站資料', '', '', '']

  arrivalPageStart = Math.min(
    arrivalPageStart,
    Math.max(0, currentArrivals.length - ETA_PAGE_SIZE),
  )
  return ETA_CONTAINER_IDS.map((_, rowIndex) => {
    const arrivalIndex = arrivalPageStart + rowIndex
    const arrival = currentArrivals[arrivalIndex]
    if (!arrival) return ''
    const marker = arrivalIndex === selectedArrivalIndex ? '▶' : ' '
    return truncateUtf8(
      `${marker} ${arrivalStatus(arrival.estimateSeconds)}  │  ${arrival.routeName}  往${arrival.destination}`,
      63,
    )
  })
}

function glassesArrivalRowContainers(message?: string): TextContainerProperty[] {
  const rows = glassesArrivalRows(message)
  return ETA_CONTAINER_IDS.map((containerID, index) =>
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 42 + index * 61,
      width: 576,
      height: index === ETA_PAGE_SIZE - 1 ? 63 : 61,
      borderWidth: 1,
      borderColor: 5,
      paddingLength: 8,
      containerID,
      containerName: `arrival-row-${index}`,
      content: rows[index],
      isEventCapture: index === 0 ? 1 : 0,
    }),
  )
}

async function createGlassesArrivalPage(message?: string): Promise<void> {
  if (!selectedStation) return
  const token = currentPageToken()
  await glassesImageUpdateQueue
  if (!isPageTokenCurrent(token)) return

  const header = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 440,
    height: 42,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 1,
    containerName: 'eta-header',
    content: truncateUtf8(`‹ ${selectedStation.name}`, 88),
    isEventCapture: 0,
  })

  const rows = glassesArrivalRowContainers(message)

  const success = await rebuildGlassesPage(
    new RebuildPageContainer({
      containerTotalNum: 2 + rows.length,
      textObject: [header, glassesUpdateTimeContainer(), ...rows],
    }),
    token,
  )
  if (!isPageTokenCurrent(token)) return
  glassesLayoutMode = success ? 'cards' : 'fallback'
  if (!success && isPageTokenCurrent(token)) {
    console.error('[taiwan-bus] arrival cards rejected, using fallback')
    await rebuildGlassesPage(
      new RebuildPageContainer({
        containerTotalNum: 3,
        textObject: [
          header,
          glassesUpdateTimeContainer(),
          new TextContainerProperty({
            xPosition: 0,
            yPosition: 42,
            width: 576,
            height: 246,
            borderWidth: 0,
            borderColor: 5,
            paddingLength: 6,
            containerID: ETA_CONTAINER_IDS[0],
            containerName: 'arrival-row-0',
            content: glassesArrivalRows(message).filter(Boolean).join('\n'),
            isEventCapture: 1,
          }),
        ],
      }),
      token,
    )
  }
}

async function updateGlassesArrivalText(message?: string): Promise<void> {
  if (!selectedStation || pageMode !== 'detail') return
  const refreshEpoch = etaRefreshEpoch
  const token = currentPageToken()
  const arrivalSnapshot = [...currentArrivals]
  const rows = glassesArrivalRows(message)
  if (glassesLayoutMode === 'fallback') {
    const success = await upgradeGlassesText(
      new TextContainerUpgrade({
        containerID: ETA_CONTAINER_IDS[0],
        containerName: 'arrival-row-0',
        content: rows.filter(Boolean).join('\n'),
      }),
      token,
    )
    if (success && pageMode === 'detail' && etaRefreshEpoch === refreshEpoch && !message) {
      presentedArrivals.commit(arrivalSnapshot)
    }
    return
  }
  for (const [index, containerID] of ETA_CONTAINER_IDS.entries()) {
    if (pageMode !== 'detail' || etaRefreshEpoch !== refreshEpoch) return
    const success = await upgradeGlassesText(
      new TextContainerUpgrade({
        containerID,
        containerName: `arrival-row-${index}`,
        content: rows[index],
      }),
      token,
    )
    if (pageMode !== 'detail' || etaRefreshEpoch !== refreshEpoch) return
    if (!success) {
      console.error('[taiwan-bus] ETA row update failed:', index)
      return
    }
  }
  if (!message) presentedArrivals.commitIf(arrivalSnapshot, true)
}

function currentRouteStops(): RouteStop[] {
  if (!selectedRoute) return []
  return routeStopsByDirection.get(`${selectedRoute.routeId}:${selectedDirection}`) ?? []
}

function directionDestination(direction = selectedDirection): string {
  if (!selectedRoute) return '方向未知'
  const route = routeInfo.get(selectedRoute.routeId)
  if (!route) return selectedRoute.destination
  return (direction === 1 ? route.departure : route.destination) || '方向未知'
}

function directionTabLabel(direction: number): string {
  return `往 ${directionDestination(direction)}`
}

interface DirectionTabImageAssets {
  raw4: number[]
  png: Uint8Array
}

type DirectionImageUpdateStatus = 'success' | 'failed' | 'stale'

function waitForBridgeSettle(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function isCurrentRouteImageUpdate(
  refreshEpoch: number,
  imageEpoch: number,
  activeDirection: number,
): boolean {
  return pageMode === 'route' &&
    appActive &&
    etaRefreshEpoch === refreshEpoch &&
    glassesRouteImageEpoch === imageEpoch &&
    selectedDirection === activeDirection
}

async function directionTabImageAssets(
  direction: number,
  activeDirection: number,
): Promise<DirectionTabImageAssets | null> {
  const width = 288
  const height = 42
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null

  const isActive = direction === activeDirection
  context.fillStyle = isActive ? '#fff' : '#000'
  context.fillRect(0, 0, width, height)
  context.strokeStyle = '#fff'
  context.lineWidth = 1
  context.strokeRect(0.5, 0.5, width - 1, height - 1)
  context.fillStyle = isActive ? '#000' : '#fff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  const label = directionTabLabel(direction)
  let fontSize = 23
  do {
    context.font = `600 ${fontSize}px "Noto Sans TC", sans-serif`
    fontSize -= 1
  } while (fontSize > 14 && context.measureText(label).width > width - 20)
  context.fillText(label, width / 2, height / 2 + 1, width - 20)

  const rgba = context.getImageData(0, 0, width, height).data
  const raw4 = new Array<number>(width * height)
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
    raw4[target] = Math.round(rgba[source] / 17)
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  return blob
    ? { raw4, png: new Uint8Array(await blob.arrayBuffer()) }
    : null
}

async function sendDirectionImage(
  direction: number,
  containerID: number,
  assets: DirectionTabImageAssets,
  isCurrent: () => boolean,
): Promise<DirectionImageUpdateStatus> {
  const containerName = ROUTE_DIRECTION_CONTAINER_NAMES[direction]
  const failures: string[] = []
  const update = glassesImageUpdateQueue.then(async (): Promise<DirectionImageUpdateStatus> => {
    const assetsByFormat: Record<DirectionImageFormat, number[] | Uint8Array> = {
      raw4: assets.raw4,
      png: assets.png,
    }
    const formats: DirectionImageFormat[] = preferredDirectionImageFormat
      ? [
          preferredDirectionImageFormat,
          preferredDirectionImageFormat === 'raw4' ? 'png' : 'raw4',
        ]
      : ['raw4', 'png']
    for (const format of formats) {
      const imageData = assetsByFormat[format]
      for (let attempt = 1; attempt <= ROUTE_IMAGE_SEND_ATTEMPTS; attempt += 1) {
        if (!isCurrent()) return 'stale'
        const result = await updateGlassesImage(
          new ImageRawDataUpdate({
            containerID,
            containerName,
            imageData,
          }),
          isCurrent,
        )
        if (result === null || !isCurrent()) return 'stale'
        if (ImageRawDataUpdateResult.isSuccess(result)) {
          if (preferredDirectionImageFormat !== format) {
            preferredDirectionImageFormat = format
            console.info('[taiwan-bus] direction image format selected:', format)
          }
          console.log(
            '[taiwan-bus] direction image ready:',
            containerName,
            format,
            `attempt=${attempt}`,
            `${imageData.length} bytes`,
          )
          return 'success'
        }
        failures.push(`${format}#${attempt}=${result}`)
        console.warn(
          '[taiwan-bus] direction image format failed:',
          containerName,
          format,
          `attempt=${attempt}`,
          result,
        )
        if (
          result !== ImageRawDataUpdateResult.sendFailed ||
          attempt === ROUTE_IMAGE_SEND_ATTEMPTS
        ) break
        await waitForBridgeSettle(ROUTE_IMAGE_RETRY_DELAY_MS)
      }
    }
    return 'failed'
  })
  glassesImageUpdateQueue = update.then(
    () => undefined,
    (error) => {
      console.error('[taiwan-bus] direction image exception:', containerName, error)
    },
  )
  try {
    const status = await update
    if (status === 'failed') {
      glassesImageDiagnostic = `${containerName}: ${failures.join(', ')}`
    }
    return status
  } catch {
    glassesImageDiagnostic = `${containerName}: exception`
    return 'failed'
  }
}

async function updateGlassesDirectionTabs(
  force: boolean,
  refreshEpoch: number,
  imageEpoch: number,
): Promise<DirectionImageUpdateStatus> {
  if (!force && glassesDirectionTabsDirection === selectedDirection) return 'success'
  if (!await glassesDirectionFontReady) return 'failed'
  const activeDirection = selectedDirection
  const isCurrent = () => isCurrentRouteImageUpdate(
    refreshEpoch,
    imageEpoch,
    activeDirection,
  )
  if (!isCurrent()) return 'stale'
  glassesImageDiagnostic = null
  for (const [direction, containerID] of [
    [0, ROUTE_DIRECTION_CONTAINER_ID],
    [1, ROUTE_DIRECTION_SECOND_CONTAINER_ID],
  ] as const) {
    let assets: DirectionTabImageAssets | null
    try { assets = await directionTabImageAssets(direction, activeDirection) } catch (error) {
      console.error('[taiwan-bus] direction image rendering failed:', error)
      glassesImageDiagnostic = 'Direction image rendering failed'
      return 'failed'
    }
    if (!assets || !isCurrent()) return assets ? 'stale' : 'failed'
    const status = await sendDirectionImage(direction, containerID, assets, isCurrent)
    if (status !== 'success') {
      if (status === 'failed') {
        console.error('[taiwan-bus] direction image update failed:', direction)
      }
      return status
    }
  }
  if (!isCurrent()) return 'stale'
  glassesDirectionTabsDirection = activeDirection
  return 'success'
}

function glassesDirectionFallbackLabel(): string {
  const otherDirection = selectedDirection === 0 ? 1 : 0
  return `● ${directionTabLabel(selectedDirection)}  │  ○ ${directionTabLabel(otherDirection)}  ｜  點按切換`
}

function centerRouteOnSelectedStation(): void {
  const stops = currentRouteStops()
  const stationIndex = stops.findIndex((stop) => stop.stationKey === selectedStation?.id)
  routePageStart = Math.max(
    0,
    Math.min(
      stationIndex < 0 ? 0 : stationIndex - 1,
      Math.max(0, stops.length - ETA_PAGE_SIZE),
    ),
  )
}

function routeStopEstimate(stop: RouteStop): number | null {
  const eta = latestEtaByStop.get(`${stop.routeId}:${stop.stopId}`)
  return parseEstimateSeconds(eta?.EstimateTime)
}

function routeStopKey(stop: RouteStop): string {
  return `${stop.routeId}:${stop.goBack}:${stop.stopId}`
}

function routeStopBusPlates(stop: RouteStop): string[] {
  return busPlatesByStop.get(routeStopKey(stop)) ?? []
}

function mapBusesToRouteStops(
  buses: RawBus[],
  targetRouteId: number,
): Map<string, string[]> {
  const mapped = new Map<string, Set<string>>()
  let directRouteMatches = 0
  let pathAttributeMatches = 0
  let unmappedRoutes = 0
  let distantVehicles = 0

  for (const bus of buses) {
    const vehicleRouteId = Number(bus.RouteID)
    const goBack = Number(bus.GoBack)
    const latitude = Number(bus.Latitude)
    const longitude = Number(bus.Longitude)
    const plate = bus.BusID?.trim()
    const normalizedRouteId = routeInfo.has(vehicleRouteId)
      ? vehicleRouteId
      : routeIdByPathAttributeId.get(vehicleRouteId)
    if (normalizedRouteId !== targetRouteId) continue
    const routeStops = routeStopsByDirection.get(`${normalizedRouteId}:${goBack}`)
    if (
      !plate ||
      !validCoordinate(latitude, longitude) ||
      (bus.BusStatus !== undefined && !['0', '1'].includes(bus.BusStatus))
    ) continue
    if (!routeStops?.length) {
      unmappedRoutes += 1
      continue
    }
    if (vehicleRouteId === targetRouteId) directRouteMatches += 1
    else pathAttributeMatches += 1

    let nearest = routeStops[0]
    let nearestDistance = haversineMeters({ latitude, longitude }, nearest)
    for (let index = 1; index < routeStops.length; index += 1) {
      const candidate = routeStops[index]
      const distance = haversineMeters({ latitude, longitude }, candidate)
      if (distance < nearestDistance) {
        nearest = candidate
        nearestDistance = distance
      }
    }
    if (nearestDistance > MAX_BUS_TO_STOP_DISTANCE_METERS) {
      distantVehicles += 1
      continue
    }

    const key = routeStopKey(nearest)
    const plates = mapped.get(key) ?? new Set<string>()
    plates.add(plate)
    mapped.set(key, plates)
  }

  console.log('[taiwan-bus] vehicle mapping:', {
    directRouteMatches,
    pathAttributeMatches,
    unmappedRoutes,
    distantVehicles,
  })

  return new Map(
    [...mapped].map(([key, plates]) => [key, [...plates].sort()]),
  )
}

function glassesRouteRows(message?: string): string[] {
  if (message) return [message, '', '', '']
  const stops = currentRouteStops()
  if (stops.length === 0) return ['此方向沒有站序資料', '', '', '']

  routePageStart = Math.min(
    routePageStart,
    Math.max(0, stops.length - ETA_PAGE_SIZE),
  )
  return ROUTE_CONTAINER_IDS.map((_, rowIndex) => {
    const stop = stops[routePageStart + rowIndex]
    if (!stop) return ''
    const marker = stop.stationKey === selectedStation?.id ? '●' : '○'
    const plates = routeStopBusPlates(stop)
    const left = `${arrivalStatus(routeStopEstimate(stop))}  │  ${marker} ${stop.name}`
    if (plates.length === 0) return truncateUtf8(left, 63)

    const plateLabel = truncateUtf8(plates.join(' '), 24)
    const minimumGap = 2
    const fittedLeft = truncateUtf8(
      left,
      Math.max(1, 63 - utf8ByteLength(plateLabel) - minimumGap),
    )
    const gap = ' '.repeat(
      Math.max(minimumGap, 63 - utf8ByteLength(fittedLeft) - utf8ByteLength(plateLabel)),
    )
    return `${fittedLeft}${gap}${plateLabel}`
  })
}

function glassesRouteRowContainers(message?: string): TextContainerProperty[] {
  const rows = glassesRouteRows(message)
  return ROUTE_CONTAINER_IDS.map((containerID, index) =>
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 84 + index * 51,
      width: 576,
      height: 51,
      borderWidth: 1,
      borderColor: 5,
      paddingLength: 7,
      containerID,
      containerName: `route-row-${index}`,
      content: rows[index],
      isEventCapture: index === 0 ? 1 : 0,
    }),
  )
}

function glassesRouteHeaderContainer(): TextContainerProperty | null {
  if (!selectedRoute) return null
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 440,
    height: 42,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 1,
    containerName: 'route-header',
    content: truncateUtf8(`‹ ${selectedRoute.routeName}｜點按切換方向`, 120),
    isEventCapture: 0,
  })
}

async function rebuildGlassesRouteFallback(
  refreshEpoch: number,
  isCurrent: () => boolean = () => true,
): Promise<DirectionImageUpdateStatus> {
  const token: PageToken = { mode: 'route', epoch: refreshEpoch }
  const header = glassesRouteHeaderContainer()
  if (!header || !isPageTokenCurrent(token) || !isCurrent()) return 'stale'
  const success = await rebuildGlassesPage(
    new RebuildPageContainer({
      containerTotalNum: 3,
      textObject: [
        header,
        glassesUpdateTimeContainer(),
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 42,
          width: 576,
          height: 246,
          borderWidth: 0,
          borderColor: 5,
          paddingLength: 6,
          containerID: ROUTE_DIRECTION_CONTAINER_ID,
          containerName: 'route-direction',
          content: [glassesDirectionFallbackLabel(), ...glassesRouteRows()].filter(Boolean).join('\n'),
          isEventCapture: 1,
        }),
      ],
    }),
    token,
    isCurrent,
  )
  if (!isPageTokenCurrent(token)) return 'stale'
  if (success) {
    glassesLayoutMode = 'fallback'
    glassesDirectionTabsDirection = null
  }
  if (!isCurrent()) return 'stale'
  if (success) {
    glassesImageDiagnostic = null
    console.warn('[taiwan-bus] route image tabs unavailable; text direction row ready')
    return 'success'
  }
  glassesImageDiagnostic = '路線文字相容畫面建立失敗'
  console.error('[taiwan-bus] route fallback rebuild failed')
  return 'failed'
}

async function createGlassesRoutePage(refreshEpoch: number): Promise<void> {
  if (!selectedRoute) return
  const token: PageToken = { mode: 'route', epoch: refreshEpoch }
  if (glassesFavoritesUpdatePromise) await glassesFavoritesUpdatePromise
  await glassesImageUpdateQueue
  if (pageMode !== 'route' || etaRefreshEpoch !== refreshEpoch) return
  glassesDirectionTabsDirection = null
  glassesImageDiagnostic = null
  const imageEpoch = ++glassesRouteImageEpoch
  const header = glassesRouteHeaderContainer()
  if (!header) return
  const directionImages = [0, 1].map(
    (direction) => new ImageContainerProperty({
      xPosition: direction * 288,
      yPosition: 42,
      width: 288,
      height: 42,
      containerID: direction === 0
        ? ROUTE_DIRECTION_CONTAINER_ID
        : ROUTE_DIRECTION_SECOND_CONTAINER_ID,
      containerName: ROUTE_DIRECTION_CONTAINER_NAMES[direction],
    }),
  )
  const rows = glassesRouteRowContainers()
  const success = await rebuildGlassesPage(
    new RebuildPageContainer({
      containerTotalNum: 4 + rows.length,
      textObject: [header, glassesUpdateTimeContainer(), ...rows],
      imageObject: directionImages,
    }),
    token,
  )
  if (pageMode !== 'route' || etaRefreshEpoch !== refreshEpoch) return

  let directionStatus: DirectionImageUpdateStatus = 'failed'
  if (success) {
    glassesLayoutMode = 'cards'
    await waitForBridgeSettle(ROUTE_IMAGE_INITIAL_DELAY_MS)
    if (pageMode !== 'route' || etaRefreshEpoch !== refreshEpoch) return
    directionStatus = await updateGlassesDirectionTabs(
      true,
      refreshEpoch,
      imageEpoch,
    )
  }
  if (directionStatus === 'stale') return
  if (directionStatus === 'success') {
    glassesLayoutMode = 'cards'
    return
  }
  console.warn('[taiwan-bus] route image cards unavailable, using text layout')
  await rebuildGlassesRouteFallback(refreshEpoch)
}

function updateGlassesRouteText(message?: string): Promise<void> {
  if (!selectedRoute || pageMode !== 'route' || !appActive) return Promise.resolve()
  const refreshEpoch = etaRefreshEpoch
  const imageEpoch = ++glassesRouteImageEpoch
  const activeDirection = selectedDirection
  const update = glassesRouteTextQueue.then(async () => {
    await glassesRoutePageReady
    if (!isCurrentRouteImageUpdate(refreshEpoch, imageEpoch, activeDirection)) return
    await performGlassesRouteTextUpdate(message, refreshEpoch, imageEpoch, activeDirection)
  })
  glassesRouteTextQueue = update.catch((error) => {
    console.error('[taiwan-bus] route text update exception:', error)
  })
  return glassesRouteTextQueue
}

async function performGlassesRouteTextUpdate(
  message: string | undefined,
  refreshEpoch: number,
  imageEpoch: number,
  activeDirection: number,
): Promise<void> {
  const token: PageToken = { mode: 'route', epoch: refreshEpoch }
  const isCurrent = () => isCurrentRouteImageUpdate(refreshEpoch, imageEpoch, activeDirection)
  const rows = glassesRouteRows(message)
  if (glassesLayoutMode === 'fallback') {
    const success = await upgradeGlassesText(
      new TextContainerUpgrade({
        containerID: ROUTE_DIRECTION_CONTAINER_ID,
        containerName: 'route-direction',
        content: [
          glassesDirectionFallbackLabel(),
          ...rows,
        ].filter(Boolean).join('\n'),
      }),
      token,
      isCurrent,
    )
    if (!success && isCurrent()) console.error('[taiwan-bus] route fallback text update failed')
    return
  }
  const directionStatus = await updateGlassesDirectionTabs(
    false,
    refreshEpoch,
    imageEpoch,
  )
  if (directionStatus === 'stale' || !isCurrent()) return
  if (directionStatus === 'failed') {
    await rebuildGlassesRouteFallback(refreshEpoch, isCurrent)
    return
  }

  for (const [index, containerID] of ROUTE_CONTAINER_IDS.entries()) {
    if (!isCurrent()) return
    const success = await upgradeGlassesText(
      new TextContainerUpgrade({
        containerID,
        containerName: `route-row-${index}`,
        content: rows[index],
      }),
      token,
      isCurrent,
    )
    if (!isCurrent()) return
    if (!success) console.error('[taiwan-bus] route row update failed:', index)
  }
}

async function showRouteDetail(arrival: Arrival): Promise<void> {
  clearEtaRefresh()
  stopLocationTracking()
  const refreshEpoch = etaRefreshEpoch
  pageMode = 'route'
  selectedRoute = arrival
  selectedDirection = arrival.goBack
  glassesImageDiagnostic = null
  console.log('[taiwan-bus] open route:', arrival.routeName, arrival.goBack)
  centerRouteOnSelectedStation()
  renderPhoneRoutePage()
  const glassesReady = glassesRoutePageReady = createGlassesRoutePage(refreshEpoch)
  await refreshEta(glassesReady)
  if (pageMode !== 'route' || etaRefreshEpoch !== refreshEpoch) return
  startEtaRefreshTimer('route', refreshEpoch, refreshEta)
}

async function toggleRouteDirection(direction?: number): Promise<void> {
  if (!selectedRoute || pageMode !== 'route') return
  if (direction === selectedDirection) return
  selectedDirection = direction ?? (selectedDirection === 0 ? 1 : 0)
  glassesRouteImageEpoch += 1
  console.log('[taiwan-bus] route direction:', selectedRoute.routeName, selectedDirection)
  centerRouteOnSelectedStation()
  renderPhoneRoutePage()
  await updateGlassesRouteText()
}

async function refreshEta(
  glassesReady: Promise<void> = Promise.resolve(),
): Promise<void> {
  if (
    !appActive || !selectedStation ||
    (pageMode !== 'detail' && pageMode !== 'route') ||
    isRefreshingEta
  ) return
  const refreshEpoch = etaRefreshEpoch
  const refreshMode = pageMode
  const refreshRouteId = selectedRoute?.routeId
  isRefreshingEta = true

  try {
    const [etaResult, busResult] = await Promise.allSettled([
      fetchGzipJson<TaipeiBusPayload<RawEta>>(ETA_DATA_URL, 'no-store'),
      refreshMode === 'route'
        ? fetchGzipJson<TaipeiBusPayload<RawBus>>(BUS_DATA_URL, 'no-store')
        : Promise.resolve(null),
    ])
    if (etaResult.status === 'rejected') throw etaResult.reason
    if (
      refreshEpoch !== etaRefreshEpoch ||
      !selectedStation ||
      (pageMode !== 'detail' && pageMode !== 'route')
    ) return
    const payload = etaResult.value
    applyEtaPayload(payload)
    if (
      refreshMode === 'route' &&
      refreshRouteId !== undefined &&
      busResult.status === 'fulfilled' &&
      busResult.value
    ) {
      busPlatesByStop = mapBusesToRouteStops(
        busResult.value.BusInfo,
        refreshRouteId,
      )
    } else if (refreshMode === 'route' && busResult.status === 'rejected') {
      busPlatesByStop = new Map()
      console.warn('[taiwan-bus] bus position load failed:', busResult.reason)
    }
    if (pageMode === 'detail') {
      const selectedKey = currentArrivals[selectedArrivalIndex]?.key
      currentArrivals = buildArrivals(selectedStation)
      selectedArrivalIndex = Math.max(
        0,
        selectedKey
          ? currentArrivals.findIndex((arrival) => arrival.key === selectedKey)
          : selectedArrivalIndex,
      )
      selectedArrivalIndex = Math.min(
        selectedArrivalIndex,
        Math.max(0, currentArrivals.length - 1),
      )
      keepSelectedArrivalVisible()
      renderPhoneArrivals(selectedStation, payload.EssentialInfo?.UpdateTime)
    } else {
      updatePhoneRouteStops(payload.EssentialInfo?.UpdateTime, true)
    }
    try {
      await glassesReady
    } catch (error) {
      console.error('[taiwan-bus] detail glasses page failed:', error)
      return
    }
    if (refreshEpoch !== etaRefreshEpoch || pageMode !== refreshMode) return
    await updateGlassesUpdateTime()
    if (refreshEpoch !== etaRefreshEpoch || pageMode !== refreshMode) return
    if (refreshMode === 'detail') {
      await updateGlassesArrivalText(
        currentArrivals.length === 0 ? '目前沒有到站資料' : undefined,
      )
    } else {
      await updateGlassesRouteText()
    }
  } catch (error) {
    if (refreshEpoch !== etaRefreshEpoch) return
    console.error('[taiwan-bus] ETA load failed:', error)
    if (pageMode === 'detail' && currentArrivals.length === 0) {
      renderPhoneArrivalError(selectedStation)
      try {
        await glassesReady
      } catch (glassesError) {
        console.error('[taiwan-bus] detail glasses page failed:', glassesError)
        return
      }
      if (refreshEpoch !== etaRefreshEpoch || pageMode !== 'detail') return
      await updateGlassesArrivalText('到站資料載入失敗｜點按重試')
    } else if (pageMode === 'route') {
      try {
        await glassesReady
      } catch (glassesError) {
        console.error('[taiwan-bus] route glasses page failed:', glassesError)
        return
      }
      if (refreshEpoch !== etaRefreshEpoch || pageMode !== 'route') return
      await updateGlassesRouteText('到站資料更新失敗\n站序仍可瀏覽')
    }
  } finally {
    if (refreshEpoch === etaRefreshEpoch) isRefreshingEta = false
  }
}

async function showError(message: string): Promise<void> {
  clearEtaRefresh()
  stopLocationTracking()
  pageMode = 'error'
  const token = currentPageToken()
  renderPhoneError(message)
  await glassesImageUpdateQueue
  if (!isPageTokenCurrent(token)) return
  await rebuildGlassesPage(
    new RebuildPageContainer({
      containerTotalNum: 1,
      textObject: [
        textContainer(`台灣公車追蹤\n\n${message}\n\n點按重試\n雙擊離開`),
      ],
    }),
    token,
  )
}

async function fetchGzipJson<T>(
  url: string,
  cache: RequestCache = 'default',
): Promise<T> {
  if (!appActive) throw new DOMException('App is inactive', 'AbortError')
  const requestKey = `${cache}:${url}`
  const existing = inFlightDataRequests.get(requestKey)
  if (existing) {
    console.debug('[taiwan-bus] sharing in-flight data request:', url)
    return existing as Promise<T>
  }

  const request = (async (): Promise<T> => {
    const controller = new AbortController()
    dataRequestControllers.add(controller)
    const timeout = window.setTimeout(() => controller.abort(), 20_000)
    const startedAt = performance.now()

    try {
      const response = await fetch(url, { signal: controller.signal, cache })
      const receivedAt = performance.now()
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const compressed = new Uint8Array(await response.arrayBuffer())
      const bufferedAt = performance.now()
      const jsonText = ungzip(compressed, { toText: true })
      const unzippedAt = performance.now()
      const payload = JSON.parse(jsonText) as T
      const parsedAt = performance.now()
      console.debug('[taiwan-bus] data timing:', {
        feed: new URL(url).pathname.split('/').pop(),
        cache: response.headers.get('x-taiwan-bus-cache') ?? 'browser',
        responseMs: Math.round(receivedAt - startedAt),
        transferMs: Math.round(bufferedAt - receivedAt),
        ungzipMs: Math.round(unzippedAt - bufferedAt),
        parseMs: Math.round(parsedAt - unzippedAt),
        compressedBytes: compressed.byteLength,
      })
      return payload
    } finally {
      window.clearTimeout(timeout)
      dataRequestControllers.delete(controller)
    }
  })()

  inFlightDataRequests.set(requestKey, request)
  try {
    return await request
  } finally {
    if (inFlightDataRequests.get(requestKey) === request) {
      inFlightDataRequests.delete(requestKey)
    }
  }
}

async function beginLocationTracking(): Promise<void> {
  if (!appActive || pageMode !== 'list' || locationTrackingRequested) return
  locationTrackingRequested = true
  unsubscribeLocation = bridge.onAppLocationChanged((location) => {
    if (!appActive || !validCoordinate(location.latitude, location.longitude)) return
    if (locationSource === 'GPS' &&
        location.latitude === currentLocation.latitude &&
        location.longitude === currentLocation.longitude &&
        location.accuracy === currentLocation.accuracy) return
    currentLocation = location
    locationSource = 'GPS'
    stationDistancesDirty = true
    if (pageMode === 'list') void showStationList(false)
  })

  try {
    const started = await serializeBridgeCall(() => appActive && pageMode === 'list' ? bridge.startAppLocationUpdates({
      accuracy: AppLocationAccuracy.Medium,
      intervalMs: 15_000,
      distanceFilter: 25,
    }) : Promise.resolve(false))
    if (!started && appActive) console.warn('[taiwan-bus] continuous location not started')
  } catch (error) {
    console.warn('[taiwan-bus] continuous location unavailable:', error)
  }
}

function emptyRoot(): void {
  appRoot.replaceChildren()
  phoneArrivalStructure = ''
  phoneRouteStructure = ''
}

function createHeader(
  title: string,
  backAction?: () => void,
  action?: { label: string; text: string; onClick: () => void },
): HTMLElement {
  const header = document.createElement('header')
  header.className = 'topbar'

  const back = document.createElement('button')
  back.className = 'icon-button'
  back.type = 'button'
  back.textContent = backAction ? '‹' : ''
  back.disabled = !backAction
  if (backAction) back.addEventListener('click', backAction)

  const heading = document.createElement('h1')
  heading.textContent = title

  const actionButton = document.createElement('button')
  actionButton.className = 'header-action'
  actionButton.type = 'button'
  actionButton.textContent = action?.text ?? (title === '附近站牌' ? '⌖' : '')
  actionButton.disabled = !action
  if (action) {
    actionButton.setAttribute('aria-label', action.label)
    actionButton.addEventListener('click', action.onClick)
  }

  header.append(back, heading, actionButton)
  return header
}

function renderPhoneLoading(): void {
  emptyRoot()
  appRoot.append(createHeader('台灣公車'))
  const state = document.createElement('section')
  state.className = 'state-panel'
  state.textContent = '正在載入大台北站牌…'
  appRoot.append(state)
}

function renderPhoneHome(): void {
  emptyRoot()
  appRoot.append(createHeader('台灣公車'))
  const menu = document.createElement('section')
  menu.className = 'home-menu'
  const choices = [
    { icon: '★', title: '常用路線', description: '依分組快速查看常搭路線', action: showFavorites },
    { icon: '⌖', title: '附近站牌', description: '依 GPS 距離列出附近站牌', action: showStationList },
  ]
  for (const choice of choices) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'home-card'
    button.addEventListener('click', () => void choice.action())
    const icon = document.createElement('span')
    icon.className = 'home-icon'
    icon.textContent = choice.icon
    const title = document.createElement('strong')
    title.textContent = choice.title
    const description = document.createElement('small')
    description.textContent = choice.description
    button.append(icon, title, description)
    menu.append(button)
  }
  appRoot.append(menu)
}

async function selectFavoriteGroup(groupId: string): Promise<void> {
  if (
    groupId === activeFavoriteGroupId ||
    !favoriteGroups.some((group) => group.id === groupId)
  ) return
  activeFavoriteGroupId = groupId
  favoriteSelectedIndex = 0
  favoritePageStart = 0
  if (pageMode === 'favorites') {
    if (phoneFavoriteView === 'list') renderPhoneFavorites()
    else if (phoneFavoriteView === 'search') renderPhoneFavoriteSearch()
  }
  await saveFavoriteSettings()
  if (pageMode === 'favorites') {
    await createGlassesFavoritesPage()
  }
  console.log('[taiwan-bus] favorite group:', currentFavoriteGroup().name)
}

function openFavoriteSearch(): void {
  phoneFavoriteView = 'search'
  favoriteSearchQuery = ''
  favoriteSearchRouteId = null
  favoriteSearchDirection = 0
  renderPhoneFavoriteSearch()
}

function renderPhoneFavorites(preserveScroll = false): void {
  if (pageMode !== 'favorites' || phoneFavoriteView !== 'list') return
  const scrollY = preserveScroll ? window.scrollY : 0
  emptyRoot()
  appRoot.append(createHeader(
    '常用路線',
    () => void showHome(),
    { label: '搜尋並加入常用路線', text: '⌕', onClick: openFavoriteSearch },
  ))

  const toolbar = document.createElement('section')
  toolbar.className = 'favorite-toolbar'
  const tabs = document.createElement('nav')
  tabs.className = 'favorite-tabs'
  for (const group of favoriteGroups) {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = `favorite-tab${group.id === activeFavoriteGroupId ? ' active' : ''}`
    tab.textContent = group.name
    tab.addEventListener('click', () => void selectFavoriteGroup(group.id))
    tabs.append(tab)
  }
  const manage = document.createElement('button')
  manage.type = 'button'
  manage.className = 'manage-groups-button'
  manage.textContent = '管理分組'
  manage.addEventListener('click', () => {
    phoneFavoriteView = 'groups'
    renderPhoneFavoriteGroups()
  })
  toolbar.append(tabs, manage)

  const list = document.createElement('section')
  list.className = 'favorite-list'
  const entries = currentFavoriteEntries()
  for (const entry of entries) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'favorite-row'
    row.dataset.favoriteId = entry.item.id
    row.addEventListener('click', () => void openFavoriteRoute(entry))
    const badge = document.createElement('span')
    badge.className = `favorite-eta ${arrivalClass(entry.arrival.estimateSeconds)}`
    badge.textContent = arrivalStatus(entry.arrival.estimateSeconds)
    const route = document.createElement('strong')
    route.className = 'favorite-route'
    route.textContent = `${entry.arrival.routeName}　往${entry.arrival.destination}`
    const station = document.createElement('span')
    station.className = 'favorite-station'
    station.textContent = entry.station.name
    const time = document.createElement('small')
    time.textContent = lastDataUpdateTime
    row.append(badge, route, station, time)
    list.append(row)
  }
  if (entries.length === 0) {
    const empty = document.createElement('section')
    empty.className = 'state-panel favorite-empty'
    empty.textContent = '此分組尚無常用路線\n按右上角放大鏡搜尋並加入'
    list.append(empty)
  }
  appRoot.append(toolbar)
  if (glassesFavoritesDiagnostic) {
    const diagnostic = document.createElement('aside')
    diagnostic.className = 'glasses-diagnostic'
    diagnostic.textContent = glassesFavoritesDiagnostic
    appRoot.append(diagnostic)
  }
  appRoot.append(list)
  if (preserveScroll) requestAnimationFrame(() => window.scrollTo({ top: scrollY }))
}

function updatePhoneFavoritesEta(): void {
  if (pageMode !== 'favorites' || phoneFavoriteView !== 'list') return
  const entries = new Map(currentFavoriteEntries().map((entry) => [entry.item.id, entry]))
  const rows = [...appRoot.querySelectorAll<HTMLElement>('.favorite-row')]
  if (rows.length !== entries.size) {
    renderPhoneFavorites(true)
    return
  }
  for (const row of rows) {
    const entry = entries.get(row.dataset.favoriteId ?? '')
    const badge = row.querySelector<HTMLElement>('.favorite-eta')
    const time = row.querySelector<HTMLElement>('small')
    if (!entry || !badge || !time) {
      renderPhoneFavorites(true)
      return
    }
    badge.className = `favorite-eta ${arrivalClass(entry.arrival.estimateSeconds)}`
    badge.textContent = arrivalStatus(entry.arrival.estimateSeconds)
    time.textContent = lastDataUpdateTime
  }
}

function favoriteRouteMatches(query: string): Array<[number, RouteInfo]> {
  const normalized = query.normalize('NFKC').trim().toLocaleLowerCase('zh-Hant')
  return [...routeInfo.entries()]
    .filter(([, route]) => !normalized ||
      `${route.name} ${route.departure} ${route.destination}`.toLocaleLowerCase('zh-Hant').includes(normalized))
    .sort((a, b) => a[1].name.localeCompare(b[1].name, 'zh-Hant', { numeric: true }))
    .slice(0, 80)
}

function routeStationsForFavorite(routeId: number, direction: number): BusStation[] {
  const seen = new Set<string>()
  const result: BusStation[] = []
  for (const stop of routeStopsByDirection.get(`${routeId}:${direction}`) ?? []) {
    if (seen.has(stop.stationKey)) continue
    const station = stationById.get(stop.stationKey)
    if (!station) continue
    seen.add(stop.stationKey)
    result.push(station)
  }
  return result
}

function hasFavorite(routeId: number, direction: number, stationId: string): boolean {
  return favoriteItems.some((item) =>
    item.groupId === activeFavoriteGroupId && item.routeId === routeId &&
    item.goBack === direction && item.stationId === stationId)
}

async function toggleFavorite(routeId: number, direction: number, station: BusStation): Promise<void> {
  const index = favoriteItems.findIndex((item) =>
    item.groupId === activeFavoriteGroupId && item.routeId === routeId &&
    item.goBack === direction && item.stationId === station.id)
  if (index >= 0) favoriteItems.splice(index, 1)
  else favoriteItems.push({
    id: makeId('favorite'), groupId: activeFavoriteGroupId, routeId,
    goBack: direction, stationId: station.id, stationName: station.name,
  })
  renderPhoneFavoriteSearch()
  await saveFavoriteSettings()
  if (pageMode === 'favorites') await createGlassesFavoritesPage()
}

function renderPhoneFavoriteSearch(): void {
  phoneFavoriteView = 'search'
  emptyRoot()
  appRoot.append(createHeader('加入常用路線', () => {
    phoneFavoriteView = 'list'
    renderPhoneFavorites()
  }))
  const panel = document.createElement('section')
  panel.className = 'favorite-search-panel'
  const groupLabel = document.createElement('label')
  groupLabel.textContent = '加入分組'
  const groupSelect = document.createElement('select')
  for (const group of favoriteGroups) {
    const option = document.createElement('option')
    option.value = group.id
    option.textContent = group.name
    option.selected = group.id === activeFavoriteGroupId
    groupSelect.append(option)
  }
  groupSelect.addEventListener('change', () => void selectFavoriteGroup(groupSelect.value))
  groupLabel.append(groupSelect)
  const input = document.createElement('input')
  input.className = 'favorite-search-input'
  input.type = 'search'
  input.inputMode = 'search'
  input.placeholder = '輸入路線，例如 218、紅12'
  input.value = favoriteSearchQuery
  const updateSearch = () => {
    favoriteSearchQuery = input.value
    favoriteSearchRouteId = null
    renderPhoneFavoriteSearch()
    const next = appRoot.querySelector<HTMLInputElement>('.favorite-search-input')
    next?.focus()
    next?.setSelectionRange(favoriteSearchQuery.length, favoriteSearchQuery.length)
  }
  input.addEventListener('input', (event) => {
    favoriteSearchQuery = input.value
    if (!(event as InputEvent).isComposing) updateSearch()
  })
  input.addEventListener('compositionend', updateSearch)
  panel.append(groupLabel, input)

  const content = document.createElement('section')
  content.className = 'favorite-search-results'
  if (favoriteSearchRouteId === null) {
    for (const [routeId, route] of favoriteRouteMatches(favoriteSearchQuery)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'route-result'
      button.innerHTML = `<strong></strong><span></span><b>›</b>`
      button.querySelector('strong')!.textContent = route.name
      button.querySelector('span')!.textContent = `${route.departure || '起點未提供'} ↔ ${route.destination || '終點未提供'}`
      button.addEventListener('click', () => {
        favoriteSearchRouteId = routeId
        favoriteSearchDirection = 0
        renderPhoneFavoriteSearch()
      })
      content.append(button)
    }
  } else {
    const route = routeInfo.get(favoriteSearchRouteId)
    const routeHeader = document.createElement('button')
    routeHeader.type = 'button'
    routeHeader.className = 'selected-route-header'
    routeHeader.textContent = `‹ ${route?.name ?? String(favoriteSearchRouteId)}`
    routeHeader.addEventListener('click', () => {
      favoriteSearchRouteId = null
      renderPhoneFavoriteSearch()
    })
    const directions = document.createElement('nav')
    directions.className = 'direction-tabs search-directions'
    for (const direction of [0, 1]) {
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.className = `direction-tab${favoriteSearchDirection === direction ? ' active' : ''}`
      tab.textContent = `往${(direction === 1 ? route?.departure : route?.destination) || '方向未知'}`
      tab.addEventListener('click', () => {
        favoriteSearchDirection = direction
        renderPhoneFavoriteSearch()
      })
      directions.append(tab)
    }
    content.append(routeHeader, directions)
    for (const station of routeStationsForFavorite(favoriteSearchRouteId, favoriteSearchDirection)) {
      const row = document.createElement('article')
      row.className = 'favorite-stop-row'
      const name = document.createElement('span')
      name.textContent = station.name
      const star = document.createElement('button')
      star.type = 'button'
      const active = hasFavorite(favoriteSearchRouteId, favoriteSearchDirection, station.id)
      star.className = `star-button${active ? ' active' : ''}`
      star.textContent = active ? '★' : '☆'
      star.setAttribute('aria-label', active ? '移除常用路線' : '加入常用路線')
      star.addEventListener('click', () => void toggleFavorite(
        favoriteSearchRouteId!, favoriteSearchDirection, station,
      ))
      row.append(name, star)
      content.append(row)
    }
  }
  appRoot.append(panel, content)
}

function renderPhoneFavoriteGroups(): void {
  phoneFavoriteView = 'groups'
  emptyRoot()
  appRoot.append(createHeader('管理分組', () => {
    phoneFavoriteView = 'list'
    renderPhoneFavorites()
  }))
  const manager = document.createElement('section')
  manager.className = 'group-manager'
  for (const group of favoriteGroups) {
    const row = document.createElement('div')
    row.className = 'group-row'
    const input = document.createElement('input')
    input.value = group.name
    input.maxLength = 12
    input.setAttribute('aria-label', '分組名稱')
    input.addEventListener('change', () => {
      const name = input.value.trim()
      if (name) group.name = name
      else input.value = group.name
      void saveFavoriteSettings().then(() => {
        if (pageMode === 'favorites') return createGlassesFavoritesPage()
      })
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '刪除'
    remove.disabled = favoriteGroups.length === 1
    remove.addEventListener('click', () => void deleteFavoriteGroup(group.id))
    row.append(input, remove)
    manager.append(row)
  }
  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'add-group-button'
  add.textContent = '＋ 新增分組'
  add.addEventListener('click', () => void addFavoriteGroup())
  manager.append(add)
  appRoot.append(manager)
}

async function addFavoriteGroup(): Promise<void> {
  const group = { id: makeId('group'), name: `分組 ${favoriteGroups.length + 1}` }
  favoriteGroups.push(group)
  activeFavoriteGroupId = group.id
  renderPhoneFavoriteGroups()
  await saveFavoriteSettings()
  if (pageMode === 'favorites') await createGlassesFavoritesPage()
}

async function deleteFavoriteGroup(groupId: string): Promise<void> {
  if (favoriteGroups.length <= 1) return
  favoriteGroups = favoriteGroups.filter((group) => group.id !== groupId)
  favoriteItems = favoriteItems.filter((item) => item.groupId !== groupId)
  if (activeFavoriteGroupId === groupId) activeFavoriteGroupId = favoriteGroups[0].id
  renderPhoneFavoriteGroups()
  await saveFavoriteSettings()
  if (pageMode === 'favorites') await createGlassesFavoritesPage()
}

function renderPhoneStationList(stationList: readonly BusStation[]): void {
  emptyRoot()
  appRoot.append(createHeader('附近站牌', () => void showHome()))

  const list = document.createElement('section')
  list.className = 'station-list'

  for (const station of stationList) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'station-card'
    button.addEventListener('click', () => void showStationDetail(station))

    const title = document.createElement('span')
    title.className = 'station-name'
    title.textContent = station.name

    const routes = document.createElement('span')
    routes.className = 'station-routes'
    routes.textContent = routeSummary(station)

    const distance = document.createElement('span')
    distance.className = 'station-distance'
    distance.textContent = formatDistance(station.distanceMeters)

    button.append(title, routes, distance)
    list.append(button)
  }

  const locationBar = document.createElement('footer')
  locationBar.className = 'location-bar'
  locationBar.textContent = `目前位置：${locationSource}　${currentLocation.latitude.toFixed(5)}, ${currentLocation.longitude.toFixed(5)}`

  appRoot.append(list, locationBar)
}

function renderPhoneArrivalLoading(station: BusStation): void {
  emptyRoot()
  appRoot.append(createHeader(station.name, () => void showStationList()))
  const state = document.createElement('section')
  state.className = 'state-panel'
  state.textContent = '正在取得到站時間…'
  appRoot.append(state)
}

function renderPhoneArrivals(station: BusStation, updatedAt?: string): void {
  let list = appRoot.querySelector<HTMLElement>('.arrival-list')
  let footer = appRoot.querySelector<HTMLElement>('.detail-footer')
  const preserveScroll = Boolean(list && footer)
  const scrollY = preserveScroll ? window.scrollY : 0

  if (!list || !footer) {
    emptyRoot()
    appRoot.append(createHeader(station.name, () => void showStationList()))
    list = document.createElement('section')
    list.className = 'arrival-list'
    footer = document.createElement('footer')
    footer.className = 'detail-footer'
    appRoot.append(list, footer)
  }

  const structure = JSON.stringify(currentArrivals.map((arrival) => arrival.key))
  if (phoneArrivalStructure !== structure) {
    list.replaceChildren()
    for (const arrival of currentArrivals) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'arrival-row'
      row.dataset.routeId = String(arrival.routeId)
      row.addEventListener('click', () => {
        const latest = currentArrivals.find((candidate) => candidate.routeId === arrival.routeId)
        if (latest) void showRouteDetail(latest)
      })

      const badge = document.createElement('span')
      badge.className = `eta-badge ${arrivalClass(arrival.estimateSeconds)}`
      badge.textContent = arrivalStatus(arrival.estimateSeconds)

      const route = document.createElement('span')
      route.className = 'arrival-route'
      route.textContent = `${arrival.routeName} - 往${arrival.destination}`

      const update = document.createElement('small')
      update.textContent = '5 秒自動更新'

      row.append(badge, route, update)
      list.append(row)
    }
    if (currentArrivals.length === 0) {
      const state = document.createElement('section')
      state.className = 'state-panel'
      state.textContent = '目前沒有到站資料'
      list.append(state)
    }
    phoneArrivalStructure = structure
  }
  for (const [index, row] of [...list.querySelectorAll<HTMLElement>('.arrival-row')].entries()) {
    const arrival = currentArrivals[index]
    const badge = row.querySelector<HTMLElement>('.eta-badge')!
    const route = row.querySelector<HTMLElement>('.arrival-route')!
    setElementClass(badge, `eta-badge ${arrivalClass(arrival.estimateSeconds)}`)
    setElementText(badge, arrivalStatus(arrival.estimateSeconds))
    setElementText(route, `${arrival.routeName} - 往${arrival.destination}`)
  }

  setElementText(footer, `${formatDistance(station.distanceMeters)}｜資料時間 ${updatedAt ?? '未提供'}`)
  if (preserveScroll) requestAnimationFrame(() => window.scrollTo({ top: scrollY }))
}

function renderPhoneRoutePage(): void {
  if (!selectedRoute || !selectedStation) return
  emptyRoot()
  appRoot.append(
    createHeader(selectedRoute.routeName, () => void returnFromRoute()),
  )

  const route = routeInfo.get(selectedRoute.routeId)
  const directions = document.createElement('nav')
  directions.className = 'direction-tabs'
  for (const direction of [0, 1]) {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = `direction-tab${selectedDirection === direction ? ' active' : ''}`
    tab.textContent = `往${
      (direction === 1 ? route?.departure : route?.destination) || '方向未知'
    }`
    tab.addEventListener('click', () => toggleRouteDirection(direction))
    directions.append(tab)
  }

  const list = document.createElement('section')
  list.className = 'route-stop-list'
  const footer = document.createElement('footer')
  footer.className = 'detail-footer'
  appRoot.append(directions)
  if (glassesImageDiagnostic) {
    const diagnostic = document.createElement('aside')
    diagnostic.className = 'glasses-diagnostic'
    diagnostic.textContent = `G2 顯示錯誤：${glassesImageDiagnostic}`
    appRoot.append(diagnostic)
  }
  appRoot.append(list, footer)
  updatePhoneRouteStops()

  const current = list.querySelector<HTMLElement>('.route-stop.current')
  current?.scrollIntoView({ block: 'center' })
}

function setElementText(element: HTMLElement, content: string): void {
  if (element.textContent !== content) element.textContent = content
}

function setElementClass(element: HTMLElement, className: string): void {
  if (element.className !== className) element.className = className
}

function updatePhoneRouteStops(updatedAt = lastDataSourceUpdateTime, preserveScroll = false): void {
  if (pageMode !== 'route') return
  const list = appRoot.querySelector<HTMLElement>('.route-stop-list')
  const footer = appRoot.querySelector<HTMLElement>('.detail-footer')
  if (!list || !footer) return
  const scrollY = preserveScroll ? window.scrollY : 0

  const stops = currentRouteStops()
  const structure = `${selectedRoute?.routeId}:${selectedDirection}:${selectedStation?.id}`
  if (phoneRouteStructure !== structure) {
    list.replaceChildren()
    for (const stop of stops) {
      const row = document.createElement('article')
      const isCurrent = stop.stationKey === selectedStation?.id
      const estimateSeconds = routeStopEstimate(stop)
      row.className = `route-stop${isCurrent ? ' current' : ''}`

      const badge = document.createElement('span')
      badge.className = `route-eta ${arrivalClass(estimateSeconds)}`
      badge.textContent = arrivalStatus(estimateSeconds)

      const name = document.createElement('span')
      name.className = 'route-stop-name'
      name.textContent = stop.name

      const plates = document.createElement('span')
      plates.className = 'route-bus-plates'

      const dot = document.createElement('span')
      dot.className = 'timeline-dot'
      dot.setAttribute('aria-hidden', 'true')
      row.append(badge, name, plates, dot)
      list.append(row)
    }
    if (stops.length === 0) {
      const state = document.createElement('section')
      state.className = 'state-panel'
      state.textContent = '此方向沒有站序資料'
      list.append(state)
    }
    phoneRouteStructure = structure
  }
  for (const [index, row] of [...list.querySelectorAll<HTMLElement>('.route-stop')].entries()) {
    const stop = stops[index]
    const estimateSeconds = routeStopEstimate(stop)
    const badge = row.querySelector<HTMLElement>('.route-eta')!
    const plates = row.querySelector<HTMLElement>('.route-bus-plates')!
    setElementClass(badge, `route-eta ${arrivalClass(estimateSeconds)}`)
    setElementText(badge, arrivalStatus(estimateSeconds))
    const plateValues = routeStopBusPlates(stop)
    const plateKey = JSON.stringify(plateValues)
    if (plates.dataset.plates !== plateKey) {
      plates.replaceChildren(...plateValues.map((plate) => {
        const label = document.createElement('span')
        label.className = 'route-bus-plate'
        label.textContent = plate
        return label
      }))
      plates.dataset.plates = plateKey
    }
  }
  setElementText(footer, `往${directionDestination()}｜資料時間 ${updatedAt ?? '未提供'}`)
  if (preserveScroll) requestAnimationFrame(() => window.scrollTo({ top: scrollY }))
}

function renderPhoneArrivalError(station: BusStation): void {
  emptyRoot()
  appRoot.append(createHeader(station.name, () => void showStationList()))
  const state = document.createElement('button')
  state.type = 'button'
  state.className = 'state-panel retry-button'
  state.textContent = '到站資料載入失敗\n點按重試'
  state.addEventListener('click', () => void refreshEta())
  appRoot.append(state)
}

function renderPhoneError(message: string): void {
  emptyRoot()
  appRoot.append(createHeader('附近站牌'))
  const state = document.createElement('button')
  state.type = 'button'
  state.className = 'state-panel retry-button'
  state.textContent = `${message}\n點按重試`
  state.addEventListener('click', () => void loadBusData())
  appRoot.append(state)
}

async function loadBusData(): Promise<void> {
  if (!appActive || isLoading) return
  isLoading = true
  stopLocationTracking()
  const loadEpoch = etaRefreshEpoch
  pageMode = 'loading'
  renderPhoneLoading()

  try {
    const favoritesPromise = loadFavoriteSettings()
    const [stopsResult, routesResult] = await Promise.allSettled([
      fetchGzipJson<TaipeiBusPayload<RawStop>>(STOP_DATA_URL),
      fetchGzipJson<TaipeiBusPayload<RawRoute>>(ROUTE_DATA_URL),
    ])

    if (stopsResult.status === 'rejected') throw stopsResult.reason
    if (!appActive || etaRefreshEpoch !== loadEpoch) return

    stations = groupStops(stopsResult.value.BusInfo)
    stationDistancesDirty = true
    stationById = new Map(stations.map((station) => [station.id, station]))
    for (const [physicalKey, clusterKey] of stationClusterKeyByStopKey) {
      const station = stationById.get(clusterKey)
      if (station) stationById.set(physicalKey, station)
    }
    routeStopsByDirection = groupRouteStops(stopsResult.value.BusInfo)
    if (stations.length === 0) throw new Error('站牌資料為空')

    if (routesResult.status === 'fulfilled') {
      const routes = routesResult.value.BusInfo
      routeInfo = new Map(
        routes.map((route) => [
          route.Id,
          {
            name: route.nameZh,
            departure: route.departureZh ?? '',
            destination: route.destinationZh ?? '',
          },
        ]),
      )
      const exactRouteIds = new Set(routes.map((route) => Number(route.Id)))
      const ambiguousPathAttributeIds = new Set<number>()
      routeIdByPathAttributeId = new Map()
      for (const route of routes) {
        const pathAttributeId = Number(route.pathAttributeId)
        if (!Number.isFinite(pathAttributeId) || exactRouteIds.has(pathAttributeId)) continue
        const existingRouteId = routeIdByPathAttributeId.get(pathAttributeId)
        if (existingRouteId !== undefined && existingRouteId !== Number(route.Id)) {
          ambiguousPathAttributeIds.add(pathAttributeId)
          routeIdByPathAttributeId.delete(pathAttributeId)
          continue
        }
        if (!ambiguousPathAttributeIds.has(pathAttributeId)) {
          routeIdByPathAttributeId.set(pathAttributeId, Number(route.Id))
        }
      }
      if (ambiguousPathAttributeIds.size > 0) {
        console.warn(
          '[taiwan-bus] ambiguous pathAttributeId values ignored:',
          [...ambiguousPathAttributeIds],
        )
      }
    } else {
      routeIdByPathAttributeId = new Map()
      console.warn('[taiwan-bus] route names unavailable:', routesResult.reason)
    }

    await favoritesPromise
    if (!appActive || etaRefreshEpoch !== loadEpoch) return
    currentLocation = DEFAULT_LOCATION
    locationSource = '預設台北'
    await showHome()

    console.log(`[taiwan-bus] ready with ${stations.length} grouped stations`)
  } catch (error) {
    if (!appActive || etaRefreshEpoch !== loadEpoch) return
    console.error(
      '[taiwan-bus] data load failed:',
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    )
    await showError('站牌資料載入失敗，請確認手機網路。')
  } finally {
    isLoading = false
    if (appActive && pageMode === 'loading' && etaRefreshEpoch !== loadEpoch) void loadBusData()
  }
}

void loadBusData()
