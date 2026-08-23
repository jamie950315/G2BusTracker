import assert from 'node:assert/strict'
import test from 'node:test'

import { buildStationArrivals } from '../src/arrivals.ts'

test('shows one entry per route and keeps the direction with the soonest arrival', () => {
  const arrivals = buildStationArrivals(
    [
      { stopId: 101, routeId: 42, goBack: 0 },
      { stopId: 202, routeId: 42, goBack: 1 },
    ],
    new Map([
      [42, { name: '42', departure: '甲站', destination: '乙站' }],
    ]),
    new Map([
      ['42:101', { RouteID: 42, StopID: 101, EstimateTime: '420', GoBack: '0' }],
      ['42:202', { RouteID: 42, StopID: 202, EstimateTime: '90', GoBack: '1' }],
    ]),
  )

  assert.deepEqual(arrivals, [
    {
      key: '42',
      routeId: 42,
      goBack: 1,
      routeName: '42',
      destination: '甲站',
      estimateSeconds: 90,
    },
  ])
})

test('keeps distinct route IDs separate even when their display names match', () => {
  const arrivals = buildStationArrivals(
    [
      { stopId: 101, routeId: 42, goBack: 0 },
      { stopId: 303, routeId: 420, goBack: 1 },
    ],
    new Map([
      [42, { name: '幹線', departure: '甲站', destination: '乙站' }],
      [420, { name: '幹線', departure: '丙站', destination: '丁站' }],
    ]),
    new Map([
      ['42:101', { RouteID: 42, StopID: 101, EstimateTime: '60', GoBack: '0' }],
      ['420:303', { RouteID: 420, StopID: 303, EstimateTime: '120', GoBack: '1' }],
    ]),
  )

  assert.deepEqual(arrivals.map((arrival) => arrival.routeId), [42, 420])
})

test('uses the stop direction when the ETA feed direction is not normalized', () => {
  const arrivals = buildStationArrivals(
    [{ stopId: 101, routeId: 42, goBack: 1 }],
    new Map([
      [42, { name: '42', departure: '甲站', destination: '乙站' }],
    ]),
    new Map([
      ['42:101', { RouteID: 42, StopID: 101, EstimateTime: '30', GoBack: '3' }],
    ]),
  )

  assert.equal(arrivals[0]?.goBack, 1)
  assert.equal(arrivals[0]?.destination, '甲站')
})

test('keeps the preferred direction stable when the opposite ETA becomes sooner', () => {
  const arrivals = buildStationArrivals(
    [
      { stopId: 101, routeId: 42, goBack: 0 },
      { stopId: 202, routeId: 42, goBack: 1 },
    ],
    new Map([
      [42, { name: '42', departure: '甲站', destination: '乙站' }],
    ]),
    new Map([
      ['42:101', { RouteID: 42, StopID: 101, EstimateTime: '180', GoBack: '0' }],
      ['42:202', { RouteID: 42, StopID: 202, EstimateTime: '30', GoBack: '1' }],
    ]),
    new Map([[42, 0]]),
  )

  assert.equal(arrivals[0]?.goBack, 0)
  assert.equal(arrivals[0]?.estimateSeconds, 180)
})

test('does not create a navigable arrival for an invalid stop direction', () => {
  const arrivals = buildStationArrivals(
    [{ stopId: 101, routeId: 42, goBack: 2 }],
    new Map([
      [42, { name: '42', departure: '甲站', destination: '乙站' }],
    ]),
    new Map([
      ['42:101', { RouteID: 42, StopID: 101, EstimateTime: '30', GoBack: '3' }],
    ]),
  )

  assert.deepEqual(arrivals, [])
})

test('keeps the presented route order stable across ETA refreshes', () => {
  const arrivals = buildStationArrivals(
    [
      { stopId: 101, routeId: 10, goBack: 0 },
      { stopId: 202, routeId: 20, goBack: 0 },
    ],
    new Map([
      [10, { name: '10', departure: '甲站', destination: '乙站' }],
      [20, { name: '20', departure: '丙站', destination: '丁站' }],
    ]),
    new Map([
      ['10:101', { RouteID: 10, StopID: 101, EstimateTime: '300', GoBack: '0' }],
      ['20:202', { RouteID: 20, StopID: 202, EstimateTime: '30', GoBack: '0' }],
    ]),
    new Map(),
    [10, 20],
  )

  assert.deepEqual(arrivals.map((arrival) => arrival.routeId), [10, 20])
})

test('keeps ETA visible by route ID when route metadata is unavailable', () => {
  const arrivals = buildStationArrivals(
    [{ stopId: 101, routeId: 42, goBack: 0 }],
    new Map(),
    new Map([
      ['42:101', { RouteID: 42, StopID: 101, EstimateTime: '45', GoBack: '0' }],
    ]),
  )

  assert.deepEqual(arrivals, [
    {
      key: '42',
      routeId: 42,
      goBack: 0,
      routeName: '42',
      destination: '方向未知',
      estimateSeconds: 45,
    },
  ])
})

test('normalizes malformed ETA values to waiting data', () => {
  const arrivals = buildStationArrivals(
    [{ stopId: 101, routeId: 42, goBack: 0 }],
    new Map([
      [42, { name: '42', departure: '甲站', destination: '乙站' }],
    ]),
    new Map([
      ['42:101', { RouteID: 42, StopID: 101, EstimateTime: 'not-a-number', GoBack: '0' }],
    ]),
  )

  assert.equal(arrivals[0]?.estimateSeconds, null)
})
