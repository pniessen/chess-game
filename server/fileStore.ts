import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
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
 *   fail closed instead of treating an unreadable ledger as an empty one. The
 *   error names the file, and the file is logged once (until it reads or is
 *   written cleanly again) through `opts.log`, so the owner knows what to
 *   repair; the HTTP layer never sends error text, so the path stays local.
 * - `keys(prefix)` lists the prefix's directory and maps each `.json` file name
 *   back through the escaping above (temp files and subdirectories are not
 *   keys); a missing directory lists nothing. The escape writes a code unit
 *   above U+00FF as `%` and more than two hex digits, which does not decode
 *   back exactly; every key the games write is ASCII.
 */
export function fileStore(dir: string, opts: { log?: (line: string) => void } = {}): GameStore {
  const log = opts.log ?? ((line: string) => console.error(line))
  const tails = new Map<string, Promise<unknown>>()
  /** Corrupt files already reported, so a polled budget does not flood the log. */
  const reported = new Set<string>()

  const escapeSegment = (seg: string): string => {
    const esc = seg.replace(/[^A-Za-z0-9._-]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    return /^\.*$/.test(esc) ? esc.replace(/\./g, '%2e') || '%00' : esc
  }
  /** The inverse of escapeSegment for everything it writes (see the note on keys above). */
  const unescapeSegment = (name: string): string =>
    name === '%00' ? '' : name.replace(/%([0-9a-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))

  const fileFor = (key: string): string => {
    const parts = key.split('/').map(escapeSegment)
    parts[parts.length - 1] += '.json'
    return join(dir, ...parts)
  }

  return {
    async get(key) {
      const file = fileFor(key)
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          reported.delete(file)
          return null
        }
        throw e
      }
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch (e) {
        if (!reported.has(file)) {
          reported.add(file)
          log(
            `claude games ledger: ${file} is not valid JSON; games fail closed on it (a saved game is left out of head-to-head records) until you repair or remove that file`,
          )
        }
        throw new Error(`corrupt JSON in ${file}`, { cause: e })
      }
      reported.delete(file)
      return value
    },
    async setJSON(key, value) {
      const file = fileFor(key)
      const write = async (): Promise<void> => {
        await mkdir(dirname(file), { recursive: true })
        const tmp = `${file}.${randomUUID()}.tmp`
        await writeFile(tmp, JSON.stringify(value), 'utf8')
        await rename(tmp, file)
        reported.delete(file)
      }
      const run = (tails.get(file) ?? Promise.resolve()).then(write, write)
      tails.set(file, run.catch(() => undefined))
      await run
    },
    async keys(prefix) {
      const segs = (prefix.endsWith('/') ? prefix.slice(0, -1) : prefix).split('/')
      const base = segs.join('/')
      let entries
      try {
        entries = await readdir(join(dir, ...segs.map(escapeSegment)), { withFileTypes: true })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw e
      }
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.json'))
        .map((e) => `${base}/${unescapeSegment(e.name.slice(0, -'.json'.length))}`)
        .sort()
    },
  }
}
