export interface StationStop {
  stopId: number
  routeId: number
  goBack: number
}

export interface RouteInfo {
  name: string
  departure: string
  destination: string
}

export interface RawEta {
  RouteID: number
  StopID: number
  EstimateTime: string
  GoBack: string
}

export interface Arrival {
  key: string
  routeId: number
  goBack: number
  routeName: string
  destination: string
  estimateSeconds: number | null
}

function arrivalSortValue(seconds: number | null): number {
  if (seconds === null || seconds < 0) return 1_000_000 + Math.abs(seconds ?? 99)
  return seconds
}

export function buildStationArrivals(
  stops: readonly StationStop[],
  routes: ReadonlyMap<number, RouteInfo>,
  etaByStop: ReadonlyMap<string, RawEta>,
  preferredDirections: ReadonlyMap<number, number> = new Map(),
  preferredRouteOrder: readonly number[] = [],
): Arrival[] {
  const candidatesByRoute = new Map<number, Arrival[]>()

  for (const stop of stops) {
    if (![0, 1].includes(stop.goBack)) continue
    const route = routes.get(stop.routeId) ?? {
      name: String(stop.routeId),
      departure: '方向未知',
      destination: '方向未知',
    }

    const eta = etaByStop.get(`${stop.routeId}:${stop.stopId}`)
    const goBack = eta && ['0', '1'].includes(eta.GoBack)
      ? Number(eta.GoBack)
      : stop.goBack
    const parsedEstimateSeconds = eta ? Number(eta.EstimateTime) : null
    const estimateSeconds = parsedEstimateSeconds !== null && Number.isFinite(parsedEstimateSeconds)
      ? parsedEstimateSeconds
      : null
    const candidate: Arrival = {
      key: String(stop.routeId),
      routeId: stop.routeId,
      goBack,
      routeName: route.name,
      destination: (goBack === 1 ? route.departure : route.destination) || '終點資料未提供',
      estimateSeconds,
    }
    const routeCandidates = candidatesByRoute.get(stop.routeId) ?? []
    routeCandidates.push(candidate)
    candidatesByRoute.set(stop.routeId, routeCandidates)
  }

  const arrivals: Arrival[] = []
  for (const [routeId, routeCandidates] of candidatesByRoute) {
    const preferredDirection = preferredDirections.get(routeId)
    const preferredCandidates = routeCandidates.filter(
      (candidate) => candidate.goBack === preferredDirection,
    )
    const eligibleCandidates = preferredCandidates.length > 0
      ? preferredCandidates
      : routeCandidates
    const best = eligibleCandidates.reduce((selected, candidate) =>
      arrivalSortValue(candidate.estimateSeconds) < arrivalSortValue(selected.estimateSeconds)
        ? candidate
        : selected)
    arrivals.push(best)
  }

  const routeOrder = new Map(
    preferredRouteOrder.map((routeId, index) => [routeId, index]),
  )
  return arrivals.sort((a, b) => {
    const aOrder = routeOrder.get(a.routeId)
    const bOrder = routeOrder.get(b.routeId)
    if (aOrder !== undefined || bOrder !== undefined) {
      if (aOrder === undefined) return 1
      if (bOrder === undefined) return -1
      return aOrder - bOrder
    }
    return arrivalSortValue(a.estimateSeconds) - arrivalSortValue(b.estimateSeconds) ||
      a.routeName.localeCompare(b.routeName, 'zh-Hant', { numeric: true })
  })
}
