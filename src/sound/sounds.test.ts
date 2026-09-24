import { describe, expect, test, vi } from 'vitest'
import { Game } from '../game-core/game'
import type { PlayedMove } from '../game-core/types'
import { SOUND_TONES, SoundPlayer, soundForMove, soundForTransition, type AudioLike } from './sounds'

function fakeContext() {
  const started: number[] = []
  const param = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 }
  const node = () => ({ connect: (n: unknown) => n })
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: node(),
    resume: vi.fn(async () => {}),
    createOscillator: () => ({ ...node(), type: 'sine', frequency: { ...param }, start: (t: number) => started.push(t), stop: vi.fn() }),
    createGain: () => ({ ...node(), gain: { ...param } }),
  }
  return { ctx: ctx as unknown as AudioLike, started }
}

/** Like `fakeContext`, but records the peak gain each tone is scheduled at. */
function gainRecordingContext() {
  const gains: number[] = []
  const node = () => ({ connect: (n: unknown) => n })
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: node(),
    resume: vi.fn(async () => {}),
    createOscillator: () => ({ ...node(), type: 'sine', frequency: { value: 0 }, start: vi.fn(), stop: vi.fn() }),
    createGain: () => ({
      ...node(),
      gain: {
        value: 0,
        setValueAtTime: (v: number) => gains.push(v),
        exponentialRampToValueAtTime: vi.fn(),
      },
    }),
  }
  return { ctx: ctx as unknown as AudioLike, gains }
}

const move = (over: Partial<PlayedMove> = {}): PlayedMove => ({
  san: 'e4', from: 'e2', to: 'e4', piece: 'p', color: 'w',
  isCapture: false, isCastle: false, isEnPassant: false, fenAfter: '', ...over,
})
const LIVE = { kind: 'in-progress', inCheck: false } as const

describe('SoundPlayer', () => {
  test('silent and context-free until the first gesture unlocks it', () => {
    const f = fakeContext()
    const create = vi.fn(() => f.ctx)
    const p = new SoundPlayer({ enabled: true, createContext: create })
    p.play('move')
    expect(create).not.toHaveBeenCalled()
    p.unlock()
    p.unlock()
    expect(create).toHaveBeenCalledTimes(1)
    p.play('move')
    expect(f.started).toHaveLength(SOUND_TONES.move.length)
  })

  test('muted means no oscillators', () => {
    const f = fakeContext()
    const p = new SoundPlayer({ enabled: false, createContext: () => f.ctx })
    p.unlock()
    p.play('capture')
    expect(f.started).toHaveLength(0)
    p.setEnabled(true)
    p.play('capture')
    expect(f.started).toHaveLength(SOUND_TONES.capture.length)
  })

  test('volume scales every tone, and is independent of the mute switch', () => {
    const f = gainRecordingContext()
    const p = new SoundPlayer({ enabled: true, volume: 0.5, createContext: () => f.ctx })
    p.unlock()
    p.play('move')
    expect(f.gains).toEqual(SOUND_TONES.move.map((t) => t.gain * 0.5))

    f.gains.length = 0
    p.setVolume(0.25)
    p.play('capture')
    expect(f.gains).toEqual(SOUND_TONES.capture.map((t) => t.gain * 0.25))

    // Mute still silences outright, whatever the volume is, and unmuting
    // comes back at the volume that was set while muted.
    f.gains.length = 0
    p.setEnabled(false)
    p.play('move')
    expect(f.gains).toEqual([])
    p.setEnabled(true)
    p.play('move')
    expect(f.gains).toEqual(SOUND_TONES.move.map((t) => t.gain * 0.25))
  })

  test('volume defaults to full and is clamped to 0..1', () => {
    const f = gainRecordingContext()
    const p = new SoundPlayer({ enabled: true, createContext: () => f.ctx })
    p.unlock()
    p.play('move')
    expect(f.gains).toEqual(SOUND_TONES.move.map((t) => t.gain))

    f.gains.length = 0
    p.setVolume(4)
    p.play('move')
    expect(f.gains).toEqual(SOUND_TONES.move.map((t) => t.gain))

    f.gains.length = 0
    p.setVolume(-1)
    p.play('move')
    // Zero gain would make exponentialRampToValueAtTime throw in a real
    // context, so silence at volume 0 is "no oscillators", not "gain 0".
    expect(f.gains).toEqual([])
  })

  test('no WebAudio at all is harmless', () => {
    const p = new SoundPlayer({ enabled: true, createContext: () => null })
    p.unlock()
    expect(() => p.play('check')).not.toThrow()
  })
})

describe('which sound', () => {
  test('soundForMove: end > check > capture > move', () => {
    expect(soundForMove(move(), LIVE)).toBe('move')
    expect(soundForMove(move({ isCapture: true }), LIVE)).toBe('capture')
    expect(soundForMove(move({ isCapture: true }), { kind: 'in-progress', inCheck: true })).toBe('check')
    expect(soundForMove(move(), { kind: 'checkmate', winner: 'w' })).toBe('game-end')
  })

  test('soundForTransition: only a one-ply growth of the same game, or a finish', () => {
    const g = new Game()
    const other = new Game()
    const frame = (game: Game, livePly: number, finished = false) => ({ game, livePly, finished })
    const next = (game: Game, livePly: number, finished = false) => ({ ...frame(game, livePly, finished), lastMove: move(), status: LIVE })
    expect(soundForTransition(null, next(g, 1))).toBeNull()
    expect(soundForTransition(frame(g, 0), next(g, 1))).toBe('move')
    expect(soundForTransition(frame(g, 0), next(other, 1))).toBeNull() // new/loaded game
    expect(soundForTransition(frame(g, 2), next(g, 1))).toBeNull() // undo
    expect(soundForTransition(frame(g, 0), next(g, 6))).toBeNull() // bulk load
    expect(soundForTransition(frame(g, 3), next(g, 3, true))).toBe('game-end') // resign / flag
  })
})
