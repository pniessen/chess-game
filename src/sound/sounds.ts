import type { Game } from '../game-core/game'
import type { GameStatus, PlayedMove } from '../game-core/types'

export type SoundName = 'move' | 'capture' | 'check' | 'game-end'

export interface Tone {
  freq: number
  /** Seconds after the sound starts. */
  start: number
  duration: number
  type: OscillatorType
  gain: number
}

/** Synthesised: no audio assets, nothing to license. */
export const SOUND_TONES: Record<SoundName, readonly Tone[]> = {
  move: [{ freq: 440, start: 0, duration: 0.06, type: 'triangle', gain: 0.25 }],
  capture: [
    { freq: 220, start: 0, duration: 0.05, type: 'square', gain: 0.12 },
    { freq: 330, start: 0.04, duration: 0.08, type: 'triangle', gain: 0.22 },
  ],
  check: [
    { freq: 660, start: 0, duration: 0.08, type: 'sine', gain: 0.25 },
    { freq: 880, start: 0.09, duration: 0.1, type: 'sine', gain: 0.25 },
  ],
  'game-end': [
    { freq: 523.25, start: 0, duration: 0.14, type: 'sine', gain: 0.22 },
    { freq: 659.25, start: 0.12, duration: 0.14, type: 'sine', gain: 0.22 },
    { freq: 783.99, start: 0.24, duration: 0.3, type: 'sine', gain: 0.22 },
  ],
}

export interface AudioLike {
  currentTime: number
  destination: AudioNode
  state: string
  resume(): Promise<void>
  createOscillator(): OscillatorNode
  createGain(): GainNode
}

function defaultCreateContext(): AudioLike | null {
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    return Ctor ? new Ctor() : null
  } catch {
    return null
  }
}

/** 0..1; anything outside it (or not a number) clamps in, NaN to full. */
function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
}

export class SoundPlayer {
  private ctx: AudioLike | null = null
  private unlocked = false
  private enabled: boolean
  private volume: number
  private readonly createContext: () => AudioLike | null

  constructor(opts: { enabled: boolean; volume?: number; createContext?: () => AudioLike | null }) {
    this.enabled = opts.enabled
    this.volume = clampVolume(opts.volume ?? 1)
    this.createContext = opts.createContext ?? defaultCreateContext
  }

  setEnabled(on: boolean): void {
    this.enabled = on
  }

  /**
   * Task 12: playback volume, 0..1, scaling every tone's own gain.
   * Deliberately separate from `setEnabled` — mute is a switch, volume is a
   * level, and each keeps working without the other.
   */
  setVolume(v: number): void {
    this.volume = clampVolume(v)
  }

  /** Call from a user gesture; creates the AudioContext the first time. */
  unlock(): void {
    if (!this.unlocked) {
      this.unlocked = true
      this.ctx = this.createContext()
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
  }

  play(name: SoundName): void {
    const ctx = this.ctx
    // Volume 0 is silence outright, not a zero-gain oscillator:
    // `exponentialRampToValueAtTime` cannot start from 0 in a real
    // AudioContext, and there is nothing to hear either way.
    if (!this.enabled || !ctx || this.volume === 0) return
    try {
      for (const tone of SOUND_TONES[name]) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const t0 = ctx.currentTime + tone.start
        osc.type = tone.type
        osc.frequency.value = tone.freq
        gain.gain.setValueAtTime(tone.gain * this.volume, t0)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.duration)
        osc.connect(gain).connect(ctx.destination)
        osc.start(t0)
        osc.stop(t0 + tone.duration + 0.02)
      }
    } catch {
      // Audio is garnish: never let it break a move.
    }
  }
}

export function soundForMove(move: PlayedMove, statusAfter: GameStatus): SoundName {
  if (statusAfter.kind !== 'in-progress') return 'game-end'
  if (statusAfter.inCheck) return 'check'
  if (move.isCapture) return 'capture'
  return 'move'
}

export interface SoundFrame {
  game: Game
  livePly: number
  finished: boolean
}

export function soundForTransition(
  prev: SoundFrame | null,
  next: SoundFrame & { lastMove: PlayedMove | undefined; status: GameStatus },
): SoundName | null {
  if (!prev || prev.game !== next.game) return null
  if (next.livePly === prev.livePly + 1 && next.lastMove) return soundForMove(next.lastMove, next.status)
  if (!prev.finished && next.finished) return 'game-end'
  return null
}
