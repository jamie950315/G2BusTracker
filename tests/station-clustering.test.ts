import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
  canJoinStationCluster,
  mergeComplementaryStationClusters,
} from '../src/station-clustering.ts'

test('prevents chain clustering when the new position exceeds the cluster diameter', () => {
  const distances = new Map([
    ['A:B', 70],
    ['B:C', 70],
    ['A:C', 140],
  ])
  const distance = (left: string, right: string) =>
    distances.get(`${left}:${right}`) ?? distances.get(`${right}:${left}`) ?? 0

  assert.equal(canJoinStationCluster(['A'], 'B', 80, distance), true)
  assert.equal(canJoinStationCluster(['A', 'B'], 'C', 80, distance), false)
})

test('rejects a candidate on the opposite side of an 80m anchor cluster', () => {
  const distance = (left: number, right: number) => Math.abs(left - right)

  assert.equal(canJoinStationCluster([0, -70], 70, 80, distance), false)
})

test('merges nearby same-name clusters serving opposite directions of one route', () => {
  const result = mergeComplementaryStationClusters(
    [
      {
        id: 'outbound',
        name: '臺北車站(忠孝)',
        positions: [0],
        routeIds: new Set([39]),
        stops: [{ routeId: 39, goBack: 0, position: 0 }],
      },
      {
        id: 'inbound',
        name: '臺北車站(忠孝)',
        positions: [30],
        routeIds: new Set([39]),
        stops: [{ routeId: 39, goBack: 1, position: 30 }],
      },
    ],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 1)
  assert.equal(result.aliases.get('inbound'), 'outbound')
  assert.deepEqual(result.stations[0]?.stops, [
    { routeId: 39, goBack: 0, position: 0 },
    { routeId: 39, goBack: 1, position: 30 },
  ])
})

test('extends complementary-route merging from 80m through 150m', () => {
  const base = { name: '天母棒球場(忠誠)', routeIds: new Set([810]) }
  const result = mergeComplementaryStationClusters(
    [
      { ...base, id: 'northbound', positions: [0], stops: [{ routeId: 810, goBack: 0 }] },
      { ...base, id: 'southbound', positions: [108], stops: [{ routeId: 810, goBack: 1 }] },
    ],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 1)
  assert.equal(result.aliases.get('southbound'), 'northbound')
})

test('includes a complementary pair exactly at the 150m boundary', () => {
  const base = { name: '同名站', routeIds: new Set([39]) }
  const result = mergeComplementaryStationClusters(
    [
      { ...base, id: 'a', positions: [0], stops: [{ routeId: 39, goBack: 0 }] },
      { ...base, id: 'b', positions: [150], stops: [{ routeId: 39, goBack: 1 }] },
    ],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 1)
})

test('keeps 150m as the hard limit for complementary-route merging', () => {
  const base = { name: '同名站', routeIds: new Set([39]) }
  const result = mergeComplementaryStationClusters(
    [
      { ...base, id: 'a', positions: [0], stops: [{ routeId: 39, goBack: 0 }] },
      { ...base, id: 'b', positions: [151], stops: [{ routeId: 39, goBack: 1 }] },
    ],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 2)
  assert.equal(result.aliases.size, 0)
})

test('keeps every position in a merged cluster within the 150m diameter', () => {
  const base = { name: '同名站', routeIds: new Set([39]) }
  const result = mergeComplementaryStationClusters(
    [
      {
        ...base,
        id: 'a',
        positions: [-80, 0],
        stops: [{ routeId: 39, goBack: 0 }],
      },
      {
        ...base,
        id: 'b',
        positions: [150, 230],
        stops: [{ routeId: 39, goBack: 1 }],
      },
    ],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 2)
  assert.equal(result.aliases.size, 0)
})

test('does not extend merging for same-name clusters without a complementary route', () => {
  const result = mergeComplementaryStationClusters(
    [
      {
        id: 'a',
        name: '同名站',
        positions: [0],
        routeIds: new Set([39]),
        stops: [{ routeId: 39, goBack: 0 }],
      },
      {
        id: 'b',
        name: '同名站',
        positions: [108],
        routeIds: new Set([40]),
        stops: [{ routeId: 40, goBack: 1 }],
      },
    ],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 2)
  assert.equal(result.aliases.size, 0)
})

test('does not merge different station names with a complementary route', () => {
  const result = mergeComplementaryStationClusters(
    [
      {
        id: 'a',
        name: '甲站',
        positions: [0],
        routeIds: new Set([39]),
        stops: [{ routeId: 39, goBack: 0 }],
      },
      {
        id: 'b',
        name: '乙站',
        positions: [30],
        routeIds: new Set([39]),
        stops: [{ routeId: 39, goBack: 1 }],
      },
    ],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 2)
  assert.equal(result.aliases.size, 0)
})

test('does not merge same-direction or distant station clusters', () => {
  const base = {
    name: '同名站',
    routeIds: new Set([39]),
  }
  const result = mergeComplementaryStationClusters(
    [
      { ...base, id: 'a', positions: [0], stops: [{ routeId: 39, goBack: 0, position: 0 }] },
      { ...base, id: 'b', positions: [30], stops: [{ routeId: 39, goBack: 0, position: 30 }] },
      { ...base, id: 'c', positions: [200], stops: [{ routeId: 39, goBack: 1, position: 200 }] },
    ],
    80,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 3)
})

test('does not chain a complementary merge through a third cluster', () => {
  const base = { name: '同名站', routeIds: new Set([39]) }
  const result = mergeComplementaryStationClusters(
    [
      { ...base, id: 'a', positions: [0], stops: [{ routeId: 39, goBack: 0, position: 0 }] },
      { ...base, id: 'b', positions: [108], stops: [{ routeId: 39, goBack: 1, position: 108 }] },
      { ...base, id: 'c', positions: [216], stops: [{ routeId: 39, goBack: 0, position: 216 }] },
    ],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 2)
})

test('chooses the maximum number of complementary pairs instead of the first match', () => {
  const distances = new Map([
    ['A:B', 100],
    ['A:C', 200],
    ['A:D', 100],
    ['B:C', 100],
    ['B:D', 200],
    ['C:D', 200],
  ])
  const distance = (left: string, right: string) =>
    distances.get(`${left}:${right}`) ?? distances.get(`${right}:${left}`) ?? 0
  const base = { name: '同名站', routeIds: new Set([39]) }
  const result = mergeComplementaryStationClusters(
    [
      { ...base, id: 'a', positions: ['A'], stops: [{ routeId: 39, goBack: 0 }] },
      { ...base, id: 'b', positions: ['B'], stops: [{ routeId: 39, goBack: 1 }] },
      { ...base, id: 'c', positions: ['C'], stops: [{ routeId: 39, goBack: 0 }] },
      { ...base, id: 'd', positions: ['D'], stops: [{ routeId: 39, goBack: 1 }] },
    ],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    distance,
    (name) => name,
  )

  assert.equal(result.stations.length, 2)
  assert.deepEqual([...result.aliases.entries()], [
    ['d', 'a'],
    ['c', 'b'],
  ])
})

test('chooses the shorter total distance when pair counts are equal', () => {
  const distances = new Map([
    ['A:B', 140],
    ['A:C', 200],
    ['A:D', 20],
    ['B:C', 20],
    ['B:D', 200],
    ['C:D', 140],
  ])
  const distance = (left: string, right: string) =>
    distances.get(`${left}:${right}`) ?? distances.get(`${right}:${left}`) ?? 0
  const base = { name: '同名站', routeIds: new Set([39]) }
  const result = mergeComplementaryStationClusters(
    [
      { ...base, id: 'a', positions: ['A'], stops: [{ routeId: 39, goBack: 0 }] },
      { ...base, id: 'b', positions: ['B'], stops: [{ routeId: 39, goBack: 1 }] },
      { ...base, id: 'c', positions: ['C'], stops: [{ routeId: 39, goBack: 0 }] },
      { ...base, id: 'd', positions: ['D'], stops: [{ routeId: 39, goBack: 1 }] },
    ],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    distance,
    (name) => name,
  )

  assert.deepEqual([...result.aliases.entries()], [
    ['d', 'a'],
    ['c', 'b'],
  ])
})

test('bounds work for unusually large dense same-name candidate groups', () => {
  const base = { name: '同名站', routeIds: new Set([39]) }
  const stations = Array.from({ length: 18 }, (_, index) => ({
    ...base,
    id: String(index),
    positions: [index],
    stops: [{ routeId: 39, goBack: index % 2 }],
  }))
  const result = mergeComplementaryStationClusters(
    stations,
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 9)
  assert.equal(result.aliases.size, 9)
})

test('solves small compatible components exactly inside a large same-name group', () => {
  const distances = new Map([
    ['0:1', 1],
    ['0:2', 2],
    ['1:3', 2],
  ])
  const distance = (left: number, right: number) => {
    if (left === right) return 0
    return distances.get(`${left}:${right}`) ?? distances.get(`${right}:${left}`) ?? 1_000
  }
  const base = { name: '同名站', routeIds: new Set([39]) }
  const stations = Array.from({ length: 17 }, (_, index) => ({
    ...base,
    id: String(index),
    positions: [index],
    stops: [{ routeId: 39, goBack: index === 0 || index === 3 ? 0 : 1 }],
  }))
  const result = mergeComplementaryStationClusters(
    stations,
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    distance,
    (name) => name,
  )

  assert.equal(result.stations.length, 15)
  assert.deepEqual([...result.aliases.entries()], [
    ['2', '0'],
    ['3', '1'],
  ])
})

test('does not create a self-referential alias for duplicate cluster IDs', () => {
  const base = { id: 'same', name: '同名站', routeIds: new Set([39]) }
  const result = mergeComplementaryStationClusters(
    [
      { ...base, positions: [0], stops: [{ routeId: 39, goBack: 0 }] },
      { ...base, positions: [30], stops: [{ routeId: 39, goBack: 1 }] },
    ],
    COMPLEMENTARY_STATION_CLUSTER_RADIUS_METERS,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 1)
  assert.equal(result.aliases.size, 0)
})

test('merges nearby clusters even when the shared route rows use other member positions', () => {
  const base = { name: '同名站', routeIds: new Set([39]) }
  const result = mergeComplementaryStationClusters(
    [
      {
        ...base,
        id: 'a',
        positions: [0],
        stops: [{ routeId: 39, goBack: 0, position: 0 }],
      },
      {
        ...base,
        id: 'b',
        positions: [30],
        stops: [{ routeId: 39, goBack: 1, position: 200 }],
      },
    ],
    80,
    (left: number, right: number) => Math.abs(left - right),
    (name) => name,
  )

  assert.equal(result.stations.length, 1)
})
