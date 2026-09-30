// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { memoryStore } from './memoryStore'

describe('memoryStore', () => {
  test('keys(prefix) lists the keys one level under the prefix, sorted', async () => {
    const s = memoryStore()
    await s.setJSON('games/saved/b', 1)
    await s.setJSON('games/saved/a b', 2)
    await s.setJSON('games/saved/sub/deep', 3)
    await s.setJSON('games/saved', 4)
    await s.setJSON('games/savedx/c', 5)
    await s.setJSON('games/lock', 6)
    expect(await s.keys('games/saved/')).toEqual(['games/saved/a b', 'games/saved/b'])
    // The trailing slash is optional.
    expect(await s.keys('games/saved')).toEqual(['games/saved/a b', 'games/saved/b'])
  })

  test('keys of an unknown prefix is empty', async () => {
    expect(await memoryStore().keys('games/saved/')).toEqual([])
  })
})
