import assert from 'node:assert/strict'
import test from 'node:test'

import {
  chooseNewestStoredValue,
  encodeStoredValue,
} from '../src/versioned-storage.ts'

test('chooses newer phone storage when a failed Bridge write left stale data', () => {
  const bridge = encodeStoredValue({ name: 'old' }, 4)
  const phone = encodeStoredValue({ name: 'new' }, 5)

  assert.deepEqual(chooseNewestStoredValue([bridge, phone]), {
    revision: 5,
    value: { name: 'new' },
  })
})

test('loads legacy unversioned data at revision zero', () => {
  assert.deepEqual(chooseNewestStoredValue(['{"name":"legacy"}']), {
    revision: 0,
    value: { name: 'legacy' },
  })
})
