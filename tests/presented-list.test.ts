import assert from 'node:assert/strict'
import test from 'node:test'

import { PresentedList } from '../src/presented-list.ts'

test('click lookup stays on the last committed snapshot while a new list is pending', () => {
  const presented = new PresentedList([{ id: 'old-station' }])
  const pending = [{ id: 'new-station' }]

  assert.equal(presented.at(0)?.id, 'old-station')
  presented.commit(pending)
  pending[0] = { id: 'mutated-after-commit' }
  assert.equal(presented.at(0)?.id, 'new-station')
})

test('does not replace the visible snapshot after a partial render failure', () => {
  const presented = new PresentedList([{ id: 'visible' }])

  assert.equal(presented.commitIf([{ id: 'partial' }], false), false)
  assert.equal(presented.at(0)?.id, 'visible')
  assert.equal(presented.commitIf([{ id: 'complete' }], true), true)
  assert.equal(presented.at(0)?.id, 'complete')
})
