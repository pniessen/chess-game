// @vitest-environment node
import { statSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * A guard on the ONE bit of `public/` that is generated rather than
 * committed. `copy-engine.mjs` now runs from `predev` and `prebuild` as well
 * as `postinstall`, so this should never fire — it is here for the routes
 * that reach neither, chiefly running the suites directly (`npx vitest run`,
 * `npx playwright test` against an already-running server) in a git worktree
 * that was handed a populated `node_modules` and so never ran postinstall.
 *
 * It exists because of how that failure presented: not as "the engine is
 * missing" but as nine red LAYOUT assertions in `above-the-fold.spec.ts`
 * (page overflow off by 22px, because the "engine unavailable" banner adds a
 * header row) plus a permanently disabled `hint` button. That reads as a
 * regression in whatever you were touching, and it cost a real debugging
 * detour. One named failure in the fastest gate is worth the small impurity
 * of a test that asserts on generated local state.
 *
 * Nothing here conflicts with the engine-absent degradation path: the e2e
 * specs that cover it stub `**\/engine/stockfish*` at the network layer
 * rather than emptying the directory.
 */
const SRC_DIR = 'node_modules/stockfish/bin'
const OUT_DIR = 'public/engine'
const FILES = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']

/** Size in bytes, or null when the path does not exist. */
function sizeOf(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

describe('the Stockfish worker is in public/engine', () => {
  for (const file of FILES) {
    test(`${file} is present, and matches the copy in node_modules`, () => {
      const sourceSize = sizeOf(`${SRC_DIR}/${file}`)
      expect(
        sourceSize,
        `${SRC_DIR}/${file} is missing — the stockfish dependency is not installed. Run \`npm install\`.`,
      ).not.toBeNull()

      // Same assertion covers missing AND stale, and names the fix either way.
      expect(
        sizeOf(`${OUT_DIR}/${file}`),
        `${OUT_DIR}/${file} is missing or stale. Run \`node scripts/copy-engine.mjs\`. ` +
          'Without it the app loses the engine (hint disabled, two-player only), ' +
          'e2e layout assertions drift, and `npm run build` ships a dist/ with no engine.',
      ).toBe(sourceSize)
    })
  }
})
