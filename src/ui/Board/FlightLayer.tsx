import type { CSSProperties } from 'react'
import { pieceImageSrc } from '../pieceSets'
import type { ActiveFlight } from './useMoveFlight'
import { squareCell } from './squares'

/**
 * The pieces of ONE move, in the air above the squares. Decoration only:
 * the real position is already rendered underneath (its arriving pieces
 * simply wait, invisible, for the landing — see `.square.arriving` in
 * board.css), so removing this layer at any instant leaves a correct board.
 *
 * `pointer-events: none` (board.css) is load-bearing, exactly as it is for
 * BoardOverlay: clicks, drags and useDragMove's document.elementFromPoint()
 * must all pass straight through to the squares.
 */
export function FlightLayer({
  flight,
  orientation,
  pieceSet,
}: {
  flight: ActiveFlight
  orientation: 'white' | 'black'
  pieceSet: string
}) {
  return (
    <div className="flight-layer" data-testid="flight-layer" aria-hidden="true">
      {flight.flyers.map((flyer) => {
        const start = squareCell(flyer.from, orientation)
        const end = squareCell(flyer.to, orientation)
        return (
          <span
            key={`${flight.id}-${flyer.key}`}
            // Prefixed: a bare `captured` would collide with the captured-pieces
            // card in app.css (which paints a surface and an empty-state label).
            className={`flight-piece flight-${flyer.kind}`}
            data-flight={flyer.kind}
            data-flight-from={flyer.from}
            data-flight-to={flyer.to}
            style={
              {
                // Laid out at the DESTINATION and offset back to the origin
                // by the animation, so the resting state is always correct.
                left: `${end.col * 12.5}%`,
                top: `${end.row * 12.5}%`,
                '--flight-x': String(start.col - end.col),
                '--flight-y': String(start.row - end.row),
              } as CSSProperties
            }
          >
            <img className="piece" src={pieceImageSrc(pieceSet, flyer.code)} alt="" draggable={false} />
          </span>
        )
      })}
    </div>
  )
}
