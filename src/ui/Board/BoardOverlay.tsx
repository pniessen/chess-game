import { ANNOTATION_TONES, arrowLine, squareCenter, type Annotation } from './annotations'

/**
 * An SVG layer over the squares. `pointer-events: none` (board.css) is
 * load-bearing: clicks and drags must reach the squares underneath, and
 * useDragMove's document.elementFromPoint() must skip this layer.
 */
export function BoardOverlay({
  annotations,
  orientation,
}: {
  annotations: readonly Annotation[]
  orientation: 'white' | 'black'
}) {
  if (annotations.length === 0) return null
  return (
    <svg className="board-overlay" viewBox="0 0 8 8" aria-hidden="true" data-testid="board-overlay">
      <defs>
        {ANNOTATION_TONES.map((tone) => (
          <marker
            key={tone}
            id={`arrowhead-${tone}`}
            viewBox="0 0 4 4"
            refX="2"
            refY="2"
            markerWidth="3"
            markerHeight="3"
            orient="auto"
          >
            <path d="M0,0 L4,2 L0,4 z" className={`arrowhead tone-${tone}`} />
          </marker>
        ))}
      </defs>
      {annotations.map((a, i) => {
        if (a.kind === 'square') {
          const c = squareCenter(a.square, orientation)
          return (
            <rect
              key={`s-${a.square}-${i}`}
              className={`annotation-square tone-${a.tone}`}
              x={c.x - 0.5}
              y={c.y - 0.5}
              width={1}
              height={1}
              data-annotation="square"
              data-annotation-square={a.square}
              data-tone={a.tone}
            />
          )
        }
        const l = arrowLine(a.from, a.to, orientation)
        return (
          <line
            key={`a-${a.from}${a.to}-${i}`}
            className={`annotation-arrow tone-${a.tone}`}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            markerEnd={`url(#arrowhead-${a.tone})`}
            data-annotation="arrow"
            data-from={a.from}
            data-to={a.to}
            data-tone={a.tone}
          />
        )
      })}
    </svg>
  )
}
