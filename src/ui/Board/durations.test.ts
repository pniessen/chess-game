import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { FLIGHT_MS } from './useMoveFlight'
import { SNAP_BACK_MS } from './useDragMove'

/**
 * board.css declares its animation durations as CSS custom properties
 * (`--flight-ms`, `--drag-snap-ms`) so keyframes and transitions can share
 * one number; the JS side (FLIGHT_MS, SNAP_BACK_MS) times the React state
 * that clears once each animation has finished. Nothing enforces the two
 * copies stay equal — so this test reads the real board.css and fails the
 * moment either pair drifts apart, instead of leaving a silent mismatch
 * (the state clearing before or after the CSS animation actually ends).
 */
const css = readFileSync(join(process.cwd(), 'src/ui/Board/board.css'), 'utf8')

function cssMs(customProperty: string): number {
  const match = css.match(new RegExp(`${customProperty}:\\s*(\\d+)ms`))
  if (!match) throw new Error(`${customProperty} not found in board.css`)
  return Number(match[1])
}

describe('board.css animation durations match their JS counterparts', () => {
  test('--flight-ms matches FLIGHT_MS', () => {
    expect(cssMs('--flight-ms')).toBe(FLIGHT_MS)
  })

  test('--drag-snap-ms matches SNAP_BACK_MS', () => {
    expect(cssMs('--drag-snap-ms')).toBe(SNAP_BACK_MS)
  })
})
