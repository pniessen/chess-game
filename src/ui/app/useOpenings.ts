import { useEffect, useMemo } from 'react'
import type { Game } from '../../game-core/game'
import type { MatchController } from '../../match/controller'
import type { OpeningBook, OpeningEntry } from '../../openings/book'
import { useOpeningBook } from '../useOpeningBook'
import { displayedSanKeyOf, liveKeyOf } from '../gameKey'

/**
 * The opening book (shared with the controller's engines), the opening of
 * the DISPLAYED position, and the name of the LIVE game's opening (what a
 * history entry and the review summary record).
 */
export function useOpenings(
  controller: Pick<MatchController, 'setBook'>,
  game: Game,
): {
  book: OpeningBook | null
  bookFailed: boolean
  opening: OpeningEntry | null
  finalOpeningName: string | null
} {
  const { book, failed: bookFailed } = useOpeningBook()
  // The engine's opening book is the same dataset. Until it loads (or if it
  // failed), the controller has none and engines simply search.
  useEffect(() => {
    controller.setBook(book)
  }, [controller, book])
  // The SANs up to the displayed ply: an undo followed by a different move
  // leaves ply/livePly unchanged, so the moves themselves are the memo key.
  const sanKey = displayedSanKeyOf(game)
  const opening = useMemo(
    () => (book ? book.identify(game.epds(Math.min(game.ply, book.maxPly))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, game, game.ply, sanKey],
  )

  // The LIVE game's full move list: an undo followed by a different move
  // keeps the same Game object and length, so the SANs are the key.
  const liveSanKey = liveKeyOf(game)
  const finalOpening = useMemo(
    () => (book ? book.identify(game.epds(Math.min(game.livePly, book.maxPly))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, game, liveSanKey],
  )
  const finalOpeningName = finalOpening ? `${finalOpening.eco} ${finalOpening.name}` : null
  return { book, bookFailed, opening, finalOpeningName }
}
