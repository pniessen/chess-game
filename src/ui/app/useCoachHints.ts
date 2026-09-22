import { useCallback } from 'react'
import type { Game } from '../../game-core/game'
import type { MatchController } from '../../match/controller'
import type { MatchPhase } from '../../match/types'
import type { CoachClient } from '../../coach/client'
import { templatedHint } from '../../coach/templated'
import { HINT_BUDGET, hintRequestFrom } from '../../coach/hints'
import { useHints, type HintAnalyze, type HintReasoner } from '../hints/useHints'
import { hintKeyOf } from '../gameKey'

/**
 * The three-press hint: engine analysis through the controller's lane, then
 * the coach's reasoning (templated when the coach server can't). Resets
 * whenever the game or phase changes (`hintKeyOf`).
 */
export function useCoachHints({
  controller,
  coach,
  game,
  phaseKind,
}: {
  controller: Pick<MatchController, 'analyze'>
  coach: Pick<CoachClient, 'hint'>
  game: Game
  phaseKind: MatchPhase['kind']
}) {
  // Through the controller's lane: never races the engine's own move search.
  const analyzeForHint = useCallback<HintAnalyze>(
    (fen, signal) => controller.analyze({ fen, ...HINT_BUDGET }, signal),
    [controller],
  )

  // Press 3 = reasoning: Claude when the coach server can, templated otherwise.
  const reasonForHint = useCallback<HintReasoner>(
    async (s, pos, signal) => {
      const fallback = templatedHint([...s.lines], pos) ?? `${s.san} is the engine's choice.`
      const request = hintRequestFrom(s, pos)
      if (!request) return fallback
      return (await coach.hint(request, signal)) ?? fallback
    },
    [coach],
  )

  const hints = useHints({
    resetKey: hintKeyOf(game, phaseKind),
    analyze: analyzeForHint,
    reason: reasonForHint,
  })

  // Hints are always about the LIVE position (the button is disabled while browsing).
  const handleHint = () => hints.advance(game.positionAt(game.livePly))

  return { hints, handleHint }
}
