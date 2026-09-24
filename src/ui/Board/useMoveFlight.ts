import { useEffect, useState } from 'react'
import type { PlayedMove } from '../../game-core/types'
import { flightFor, type Flight, type PieceMap } from './flight'

/**
 * How long a piece is in the air. Kept in step with `--flight-ms` in
 * board.css: the CSS plays the animation, this clears the state that
 * carries it once it has landed.
 */
export const FLIGHT_MS = 200

export interface ActiveFlight extends Flight {
  /** Changes with every flight, so React can key the airborne pieces. */
  id: number
}

export interface MoveFlightInput {
  /** The FEN of the position being rendered — the identity of a board layout. */
  fen: string
  /** That position as square -> piece. */
  pieces: PieceMap
  orientation: 'white' | 'black'
  /** The move that produced `pieces`, when there is one. */
  lastPlayed: PlayedMove | null | undefined
  /**
   * Any change to this value makes the NEXT layout change cut instead of
   * animate. Undo, redo and history jumps bump it: each of those can land
   * on a position that is legitimately one move on from the last one
   * rendered, which is otherwise indistinguishable from a move being
   * played.
   */
  cutKey: unknown
}

interface FlightState {
  /** null until the first layout has been rendered (mounting never animates). */
  fen: string | null
  pieces: PieceMap
  orientation: 'white' | 'black'
  cutKey: unknown
  flight: ActiveFlight | null
  seq: number
}

const NO_PIECES: PieceMap = new Map()

/**
 * Derived entirely from the two layouts either side of a change, during
 * render (React's "adjust state when a prop changes" pattern), so the
 * airborne pieces appear in the very same commit as the new position.
 *
 * Deliberately NOT a gate: the board always renders the position it was
 * given. A flight only adds stand-in pieces on top and hides the real
 * arriving piece for `FLIGHT_MS`; dropping the flight at any moment — a
 * second move, an undo, a flip, a new game, an unmount — leaves a correct
 * board, which is why nothing here can strand a piece.
 */
export function useMoveFlight({
  fen,
  pieces,
  orientation,
  lastPlayed,
  cutKey,
}: MoveFlightInput): ActiveFlight | null {
  const [state, setState] = useState<FlightState>(() => ({
    fen: null,
    pieces: NO_PIECES,
    orientation,
    cutKey,
    flight: null,
    seq: 0,
  }))

  let next = state
  // A cut applies to THIS render only. React batches the state change that
  // bumps cutKey with the store update beside it, so both arrive together;
  // carrying an unspent cut forward instead would let a cut that changed no
  // position (Resume when already live, a jump to the ply already shown)
  // silently swallow the next real move.
  const cutAsked = next.cutKey !== cutKey
  if (cutAsked) next = { ...next, cutKey }

  if (next.fen !== fen || next.orientation !== orientation) {
    // A flip re-lays out every square at once: there is no move to follow.
    const cut = cutAsked || next.fen === null || next.orientation !== orientation || !lastPlayed
    const built = cut ? null : flightFor(lastPlayed, next.pieces, pieces)
    const seq = next.seq + 1
    next = {
      ...next,
      fen,
      pieces,
      orientation,
      flight: built ? { ...built, id: seq } : null,
      seq,
    }
  }
  if (next !== state) setState(next)

  const id = next.flight?.id ?? null
  useEffect(() => {
    if (id === null) return
    const timer = setTimeout(
      () => setState((s) => (s.flight?.id === id ? { ...s, flight: null } : s)),
      FLIGHT_MS,
    )
    return () => clearTimeout(timer)
  }, [id])

  return next.flight
}
