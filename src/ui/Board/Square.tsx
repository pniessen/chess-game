import type { ReactNode } from 'react'
import type { Square as SquareName } from '../../game-core/types'
import { isLightSquare } from './squares'

export function Square({
  name,
  classes,
  onClick,
  fileLabel,
  rankLabel,
  children,
}: {
  name: SquareName
  classes: string[]
  onClick: (square: SquareName) => void
  /** Shown in the corner of squares along the bottom edge of the view. */
  fileLabel?: string
  /** Shown in the corner of squares along the left edge of the view. */
  rankLabel?: string
  children?: ReactNode
}) {
  const className = [
    'square',
    isLightSquare(name) ? 'light' : 'dark',
    ...classes,
  ].join(' ')
  return (
    <div
      className={className}
      data-square={name}
      role="gridcell"
      aria-label={name}
      onClick={() => onClick(name)}
    >
      {rankLabel ? <span className="coord rank">{rankLabel}</span> : null}
      {fileLabel ? <span className="coord file">{fileLabel}</span> : null}
      {children}
    </div>
  )
}
