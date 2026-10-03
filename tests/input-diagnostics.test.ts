import assert from 'node:assert/strict'
import test from 'node:test'

import { InputDiagnostics, type InputDiagnosticFields, type InputDiagnosticKind } from '../src/input-diagnostics.ts'

test('keeps the latest 64 entries in order with monotonic elapsed timestamps', () => {
  let now = 100
  const diagnostics = new InputDiagnostics(() => now)
  for (let callID = 1; callID <= 70; callID++) {
    now += 5
    diagnostics.record('bridge', { callID, operation: 'rebuild', phase: 'dispatch' })
  }
  const snapshot = diagnostics.snapshot()
  assert.equal(snapshot.length, 64)
  assert.equal(snapshot[0].sequence, 7)
  assert.equal(snapshot[0].fields.callID, 7)
  assert.equal(snapshot[63].sequence, 70)
  assert.equal(snapshot[63].elapsedMs, 350)

  now = 99
  diagnostics.record('state', { active: true })
  now = Number.NaN
  diagnostics.record('state', { active: false })
  assert.equal(diagnostics.snapshot().at(-2)?.elapsedMs, 350)
  assert.equal(diagnostics.snapshot().at(-1)?.elapsedMs, 350)
})

test('preserves zero event values, false flags and null Bridge results', () => {
  const diagnostics = new InputDiagnostics(() => 1)
  const fields: InputDiagnosticFields = {
    page: 'home', active: false, disposed: false, envelope: 'list',
    eventType: 0, source: 0, containerID: 0, selectedIndex: 0,
    operation: 'exit', callID: 0, phase: 'complete', result: null,
    persisted: false, code: 0,
  }
  diagnostics.record('event', fields)
  assert.deepEqual(diagnostics.snapshot()[0].fields, fields)
  assert.match(diagnostics.reportLines()[0], /eventType=0/)
  assert.match(diagnostics.reportLines()[0], /active=false/)
  assert.match(diagnostics.reportLines()[0], /result=null/)
  assert.doesNotThrow(() => JSON.stringify(diagnostics.snapshot()))
})

test('drops raw objects, unknown keys, arbitrary strings and nonfinite numbers', () => {
  const diagnostics = new InputDiagnostics(() => 1)
  const unsafeFields = {
    page: 'home?token=private', active: { value: true }, disposed: true,
    envelope: 'list', eventType: 0, source: 'private-device',
    containerID: Number.NaN, selectedIndex: Number.POSITIVE_INFINITY,
    operation: 'https://private.example', callID: 1, phase: 'dispatch',
    result: { private: 'raw-response' }, persisted: 1, code: 0,
    rawEvent: { private: 'raw-event' }, identifier: 'device-secret',
    coordinates: { latitude: 25, longitude: 121 }, querystring: 'token=secret',
  } as unknown as InputDiagnosticFields
  Object.defineProperty(unsafeFields, 'unknownGetter', {
    enumerable: true,
    get() { throw new Error('Unknown fields must never be read') },
  })
  diagnostics.record('event', unsafeFields)
  diagnostics.record('raw-event-secret' as InputDiagnosticKind, { active: true })
  assert.deepEqual(diagnostics.snapshot()[0].fields, {
    envelope: 'list', phase: 'dispatch', disposed: true, eventType: 0, callID: 1, code: 0,
  })
  assert.equal(diagnostics.snapshot().length, 1)
  assert.doesNotMatch(JSON.stringify(diagnostics.snapshot()), /private|secret|raw-event|latitude|querystring|unknownGetter/)
})

test('stored fields and returned snapshots cannot mutate the buffer', () => {
  const diagnostics = new InputDiagnostics(() => 1)
  const fields: InputDiagnosticFields = { page: 'home', active: true }
  diagnostics.record('state', fields)
  fields.page = 'error'
  const snapshot = diagnostics.snapshot()
  assert.equal(snapshot[0].fields.page, 'home')
  assert.throws(() => (snapshot[0].fields as InputDiagnosticFields).page = 'route', TypeError)
  assert.throws(() => (snapshot as unknown as unknown[]).push({}), TypeError)
  assert.throws(() => (snapshot[0] as unknown as { sequence: number }).sequence = 100, TypeError)
  assert.deepEqual(diagnostics.snapshot(), snapshot)
  assert.notEqual(diagnostics.snapshot()[0], snapshot[0])
  assert.notEqual(diagnostics.snapshot()[0].fields, snapshot[0].fields)
})
