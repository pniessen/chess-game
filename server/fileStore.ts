import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GameStore } from './store'

/**
 * A `GameStore` that keeps one JSON file per key under `dir`.
 *
 * - Keys are like `games/<id>` or `games/budget/2026-09`; each `/`-separated
 *   segment becomes a path component after every character outside
 *   `[A-Za-z0-9._-]` is percent-escaped and a segment made only of dots is
 *   escaped too, so no key can name a file outside `dir` (`../x` stays inside).
 *   Files end in `.json`, which also keeps `games/x` (a file) apart from
 *   `games/x/y` (a directory named `x`).
 * - Writes go to a unique temp file that is then renamed over the target, so a
 *   crash never leaves a half-written file. `dir` is created on first write.
 * - Concurrency: safe within one process (writes to a key are chained one after
 *   another, and rename is atomic). Two processes on the same dir are not
 *   coordinated; the games rules already accept last-write-wins.
 * - A missing file reads as null. A corrupt file throws, so the games guards
 *   fail closed instead of treating an unreadable ledger as an empty one.
 */
export function fileStore(dir: string): GameStore {
  const tails = new Map<string, Promise<unknown>>()

  const fileFor = (key: string): string => {
    const parts = key.split('/').map((seg) => {
      const esc = seg.replace(/[^A-Za-z0-9._-]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
      return /^\.*$/.test(esc) ? esc.replace(/\./g, '%2e') || '%00' : esc
    })
    parts[parts.length - 1] += '.json'
    return join(dir, ...parts)
  }

  return {
    async get(key) {
      let text: string
      try {
        text = await readFile(fileFor(key), 'utf8')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
      return JSON.parse(text)
    },
    async setJSON(key, value) {
      const file = fileFor(key)
      const write = async (): Promise<void> => {
        await mkdir(dirname(file), { recursive: true })
        const tmp = `${file}.${randomUUID()}.tmp`
        await writeFile(tmp, JSON.stringify(value), 'utf8')
        await rename(tmp, file)
      }
      const run = (tails.get(file) ?? Promise.resolve()).then(write, write)
      tails.set(file, run.catch(() => undefined))
      await run
    },
  }
}
