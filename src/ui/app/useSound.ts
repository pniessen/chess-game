import { useEffect, useRef, useState } from 'react'
import type { Game } from '../../game-core/game'
import type { MatchPhase } from '../../match/types'
import { SoundPlayer, soundForTransition, type SoundFrame } from '../../sound/sounds'

/**
 * The app's one SoundPlayer, kept in step with the settings and unlocked on
 * the first gesture. Mute and volume are pushed separately, because they
 * are separate settings: turning the volume down does not mute, and muting
 * does not forget the volume.
 */
export function useSoundPlayer(enabled: boolean, volume = 1): SoundPlayer {
  const [sound] = useState(() => new SoundPlayer({ enabled, volume }))
  useEffect(() => {
    sound.setEnabled(enabled)
  }, [sound, enabled])
  useEffect(() => {
    sound.setVolume(volume)
  }, [sound, volume])
  useEffect(() => {
    // Browsers only start audio inside a user gesture: create it on the first one.
    const unlock = () => sound.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [sound])
  return sound
}

/** Plays the sound for each live-game transition (a move, a capture, check, the finish). */
export function useMoveSounds(sound: SoundPlayer, game: Game, phaseKind: MatchPhase['kind']): void {
  const lastSoundFrame = useRef<SoundFrame | null>(null)
  useEffect(() => {
    const finished = phaseKind === 'finished'
    const prev = lastSoundFrame.current
    lastSoundFrame.current = { game, livePly: game.livePly, finished }
    const name = soundForTransition(prev, {
      game,
      livePly: game.livePly,
      finished,
      lastMove: game.moves[game.livePly - 1],
      status: game.status(),
    })
    if (name) sound.play(name)
  }, [sound, game, game.livePly, phaseKind])
}
