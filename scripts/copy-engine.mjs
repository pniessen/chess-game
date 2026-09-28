import { copyFileSync, mkdirSync, statSync } from 'node:fs'

/**
 * Copies the Stockfish worker and its `.wasm` out of `node_modules` into
 * `public/engine/`, which is generated rather than committed (`.gitignore`).
 *
 * Wired to `postinstall` AND to `predev`/`prebuild`, because postinstall on
 * its own is not enough. A git worktree handed an already-populated
 * `node_modules` never runs it, so the tracked tree arrives with
 * `public/fonts`, `public/openings`, `public/pieces` and `public/puzzles`
 * but no `public/engine`, and nothing says so. What you get instead is:
 *
 *  - the app degrading to "The chess engine is unavailable — playing in
 *    two-player mode only", with `hint` permanently disabled; and, because
 *    that banner adds a row to the header, e2e LAYOUT assertions drift too
 *    (a page-overflow check off by 22px), so a whole cluster of failures
 *    reads as a regression in whatever you happened to be changing;
 *  - `npm run build` silently producing a `dist/` with no engine in it at
 *    all, which is the worse half: that one ships.
 *
 * Idempotent — a destination already the same size as its source is left
 * alone — so sitting in front of every dev server and every build costs
 * nothing and prints nothing once the files are there.
 */
const SRC_DIR = 'node_modules/stockfish/bin'
const OUT_DIR = 'public/engine'
const FILES = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']

/** Size in bytes, or null when the path does not exist. */
function sizeOf(path) {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

mkdirSync(OUT_DIR, { recursive: true })

const copied = []
for (const file of FILES) {
  const from = `${SRC_DIR}/${file}`
  const sourceSize = sizeOf(from)
  if (sourceSize === null) {
    // The dependency itself is missing, which this script cannot fix.
    console.error(`copy-engine: ${from} is missing — the stockfish dependency is not installed.`)
    console.error('copy-engine: run `npm install`.')
    process.exit(1)
  }
  if (sizeOf(`${OUT_DIR}/${file}`) === sourceSize) continue
  copyFileSync(from, `${OUT_DIR}/${file}`)
  copied.push(file)
}

if (copied.length > 0) console.log(`copy-engine: copied ${copied.join(', ')} into ${OUT_DIR}/`)
