// @vitest-environment node
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { fileStore } from './fileStore'

let root: string
let dir: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'file-store-'))
  dir = join(root, 'games') // does not exist yet: created on first write
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const allFiles = async (d: string): Promise<string[]> => {
  const out: string[] = []
  for (const e of await readdir(d, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) out.push(join(e.parentPath, e.name))
  }
  return out
}

describe('fileStore', () => {
  test('a missing key reads as null and reading does not create the directory', async () => {
    const s = fileStore(dir)
    expect(await s.get('games/nope', { type: 'json' })).toBeNull()
    expect(existsSync(dir)).toBe(false)
  })

  test('round-trips JSON, including nested keys and overwrites', async () => {
    const s = fileStore(dir)
    await s.setJSON('games/budget/2026-09', { spent: 1.5, reserved: 2 })
    await s.setJSON('games/abc', { a: [1, 'x', null] })
    expect(await s.get('games/budget/2026-09', { type: 'json' })).toEqual({ spent: 1.5, reserved: 2 })
    await s.setJSON('games/abc', { b: 2 })
    expect(await s.get('games/abc', { type: 'json' })).toEqual({ b: 2 })
  })

  test('a key and a same-named prefix do not collide', async () => {
    const s = fileStore(dir)
    await s.setJSON('games/x', 1)
    await s.setJSON('games/x/y', 2)
    expect(await s.get('games/x', { type: 'json' })).toBe(1)
    expect(await s.get('games/x/y', { type: 'json' })).toBe(2)
  })

  test('survives a new instance on the same directory', async () => {
    await fileStore(dir).setJSON('games/lock', { gameId: 'g', until: 5 })
    expect(await fileStore(dir).get('games/lock', { type: 'json' })).toEqual({ gameId: 'g', until: 5 })
  })

  test.each(['../escape', '../../escape', 'games/../../escape', '..', '/abs/path', 'a/./b', '..\\win', 'a/../'])(
    'key %j stays inside the directory',
    async (key) => {
      const s = fileStore(dir)
      await s.setJSON(key, { ok: true })
      expect(await s.get(key, { type: 'json' })).toEqual({ ok: true })
      const files = await allFiles(root)
      expect(files.length).toBe(1)
      expect(files[0]!.startsWith(dir + '/')).toBe(true)
    },
  )

  test('concurrent writes to one key leave one complete value and no temp files', async () => {
    const s = fileStore(dir)
    await Promise.all(Array.from({ length: 50 }, (_, i) => s.setJSON('games/race', { i, pad: 'x'.repeat(2000) })))
    const v = (await s.get('games/race', { type: 'json' })) as { i: number }
    expect(v.i).toBe(49) // writes to a key apply in call order
    expect((await allFiles(dir)).map((f) => f.split('/').pop())).toEqual(['race.json'])
  })

  test('a corrupt file throws instead of reading as empty (fail closed)', async () => {
    const s = fileStore(dir)
    await s.setJSON('games/bad', {})
    await writeFile(join(dir, 'games', 'bad.json'), '{not json')
    await expect(s.get('games/bad', { type: 'json' })).rejects.toThrow()
  })
})
