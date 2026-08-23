export const COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS = 150
const EXACT_PAIRING_MAX_STATIONS = 16

export function canJoinStationCluster<T>(
  existingPositions: readonly T[],
  candidate: T,
  radius: number,
  distance: (left: T, right: T) => number,
): boolean {
  return existingPositions.every(
    (existing) => distance(existing, candidate) <= radius,
  )
}

interface DirectionalStop {
  routeId: number
  goBack: number
}

interface MergeableStationCluster<P, S extends DirectionalStop> {
  id: string
  name: string
  positions: P[]
  routeIds: Set<number>
  stops: S[]
}

interface StationPair {
  leftIndex: number
  rightIndex: number
  maximumDistance: number
}

interface StationPairing {
  pairs: StationPair[]
  totalDistance: number
}

function hasComplementaryRoute(
  left: readonly DirectionalStop[],
  right: readonly DirectionalStop[],
): boolean {
  return left.some((leftStop) =>
    [0, 1].includes(leftStop.goBack) && right.some((rightStop) =>
      rightStop.routeId === leftStop.routeId &&
      [0, 1].includes(rightStop.goBack) &&
      rightStop.goBack !== leftStop.goBack))
}

function maximumPairDistance<P>(
  left: readonly P[],
  right: readonly P[],
  radius: number,
  distance: (left: P, right: P) => number,
): number | null {
  if (left.length === 0 || right.length === 0) return null
  let maximum = 0
  for (const leftPosition of left) {
    for (const rightPosition of right) {
      const value = distance(leftPosition, rightPosition)
      if (value > radius) return null
      maximum = Math.max(maximum, value)
    }
  }
  return maximum
}

function pairingKey(pairing: StationPairing): string {
  return pairing.pairs
    .map((pair) => `${pair.leftIndex}:${pair.rightIndex}`)
    .join(',')
}

function betterPairing(candidate: StationPairing, current: StationPairing): boolean {
  if (candidate.pairs.length !== current.pairs.length) {
    return candidate.pairs.length > current.pairs.length
  }
  if (candidate.totalDistance !== current.totalDistance) {
    return candidate.totalDistance < current.totalDistance
  }
  return pairingKey(candidate) < pairingKey(current)
}

function chooseStationPairs<
  P,
  S extends DirectionalStop,
  T extends MergeableStationCluster<P, S>,
>(
  stations: readonly T[],
  radius: number,
  distance: (left: P, right: P) => number,
): StationPair[] {
  const edges = new Map<string, StationPair>()
  for (let leftIndex = 0; leftIndex < stations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < stations.length; rightIndex += 1) {
      const left = stations[leftIndex]
      const right = stations[rightIndex]
      if (!hasComplementaryRoute(left.stops, right.stops)) continue
      const maximumDistance = maximumPairDistance(
        left.positions,
        right.positions,
        radius,
        distance,
      )
      if (maximumDistance === null) continue
      edges.set(`${leftIndex}:${rightIndex}`, {
        leftIndex,
        rightIndex,
        maximumDistance,
      })
    }
  }

  const chooseComponentPairs = (component: readonly number[]): StationPair[] => {
    if (component.length > EXACT_PAIRING_MAX_STATIONS) {
      const members = new Set(component)
      const used = new Set<number>()
      const pairs: StationPair[] = []
      for (const edge of [...edges.values()]
        .filter((candidate) =>
          members.has(candidate.leftIndex) && members.has(candidate.rightIndex))
        .sort((left, right) =>
          left.maximumDistance - right.maximumDistance ||
          left.leftIndex - right.leftIndex ||
          left.rightIndex - right.rightIndex)) {
        if (used.has(edge.leftIndex) || used.has(edge.rightIndex)) continue
        used.add(edge.leftIndex)
        used.add(edge.rightIndex)
        pairs.push(edge)
      }
      return pairs
    }

    const memo = new Map<string, StationPairing>()
    const solve = (remaining: readonly number[]): StationPairing => {
      if (remaining.length < 2) return { pairs: [], totalDistance: 0 }
      const key = remaining.join(',')
      const cached = memo.get(key)
      if (cached) return cached

      const [first, ...rest] = remaining
      let best = solve(rest)
      for (let index = 0; index < rest.length; index += 1) {
        const second = rest[index]
        const edge = edges.get(`${first}:${second}`)
        if (!edge) continue
        const tail = solve(rest.filter((_, restIndex) => restIndex !== index))
        const candidate = {
          pairs: [edge, ...tail.pairs],
          totalDistance: edge.maximumDistance + tail.totalDistance,
        }
        if (betterPairing(candidate, best)) best = candidate
      }
      memo.set(key, best)
      return best
    }

    return solve(component).pairs
  }

  const adjacency = Array.from({ length: stations.length }, () => new Set<number>())
  for (const edge of edges.values()) {
    adjacency[edge.leftIndex].add(edge.rightIndex)
    adjacency[edge.rightIndex].add(edge.leftIndex)
  }
  const visited = new Set<number>()
  const pairs: StationPair[] = []
  for (let start = 0; start < stations.length; start += 1) {
    if (visited.has(start) || adjacency[start].size === 0) continue
    const component: number[] = []
    const pending = [start]
    visited.add(start)
    while (pending.length > 0) {
      const current = pending.pop()
      if (current === undefined) break
      component.push(current)
      for (const neighbor of adjacency[current]) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        pending.push(neighbor)
      }
    }
    component.sort((left, right) => left - right)
    pairs.push(...chooseComponentPairs(component))
  }
  return pairs.sort((left, right) => left.leftIndex - right.leftIndex)
}

export function mergeComplementaryStationClusters<
  P,
  S extends DirectionalStop,
  T extends MergeableStationCluster<P, S>,
>(
  input: readonly T[],
  radius: number,
  distance: (left: P, right: P) => number,
  normalizeName: (name: string) => string,
): { stations: T[]; aliases: Map<string, string> } {
  const stationGroups = new Map<string, T[]>()
  for (const station of input) {
    const copy = {
      ...station,
      positions: [...station.positions],
      routeIds: new Set(station.routeIds),
      stops: [...station.stops],
    } as T
    const name = normalizeName(copy.name)
    const group = stationGroups.get(name) ?? []
    group.push(copy)
    stationGroups.set(name, group)
  }
  const aliases = new Map<string, string>()

  for (const stations of stationGroups.values()) {
    const rightIndices = new Set<number>()
    for (const pair of chooseStationPairs(stations, radius, distance)) {
      const left = stations[pair.leftIndex]
      const right = stations[pair.rightIndex]
      if (right.id !== left.id) aliases.set(right.id, left.id)
      rightIndices.add(pair.rightIndex)
      for (const routeId of right.routeIds) left.routeIds.add(routeId)
      left.stops.push(...right.stops)
      for (const position of right.positions) {
        if (!left.positions.some((existing) => distance(existing, position) < 1)) {
          left.positions.push(position)
        }
      }
    }
    for (const rightIndex of [...rightIndices].sort((left, right) => right - left)) {
      stations.splice(rightIndex, 1)
    }
  }

  return { stations: [...stationGroups.values()].flat(), aliases }
}
